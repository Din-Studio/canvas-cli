/* oxlint-disable eslint/no-await-in-loop -- the fake page answers the daemon's long poll one request at a time, and the CLI calls in each case run in order. */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cli, fixture } from "./helpers.mjs";
import { folderFileName, formatFoldersTable } from "../src/docs.mjs";
import { CANVAS_CONTRACT } from "../src/contract.mjs";

/**
 * doc@1 文件夹（上传的小说一部一个）：`docs ls --folders` 列文件夹（名、id、篇数、更新时间），
 * `docs read --folder <名或 id> --out-dir <目录>` 把整个文件夹一次存成本地文件（每篇一个，带序号与标题）。
 * 真 CLI 进程、真守护进程、一个假页面（回 `documents_folders` / `documents_list` / `documents_get`，按
 * limit / offset 分页），请求逐个记下来。`docs read <id>` 单篇的老行为由 docs.test.mjs 守着。
 */

function fakeLibrary() {
  const docs = [];
  const seen = [];
  const failGet = new Set();
  const dto = (doc) => ({
    id: doc.id,
    section: doc.section,
    folder: doc.folder ?? null,
    docType: doc.docType,
    series: null,
    episode: null,
    scene: null,
    title: doc.title,
    format: doc.format ?? "markdown",
    version: doc.version ?? 1,
    contentSha: `sha-${doc.id}`,
    sourceAgent: null,
    source: null,
    assetTags: [],
    derivedFrom: null,
    updatedAt: "2026-09-24T00:00:00.000Z",
    summary: null,
  });
  const handle = (rpc) => {
    seen.push(rpc);
    const p = rpc.params;
    if (rpc.method === "documents_folders") {
      const groups = new Map();
      for (const doc of docs) {
        if (!doc.folder || (p.section && doc.section !== p.section)) continue;
        const key = `${doc.section}\u0000${doc.folder}`;
        const group = groups.get(key) ?? { section: doc.section, name: doc.folder, docs: [] };
        group.docs.push(doc);
        groups.set(key, group);
      }
      const items = [...groups.values()].map((group) => {
        const first = [...group.docs].sort((a, b) => a.id.localeCompare(b.id))[0];
        const hit = /^([a-z][a-z0-9-]*:[a-z0-9]{4}):\d{4}$/.exec(first.id);
        return {
          section: group.section,
          name: group.name,
          id: hit ? hit[1] : null,
          count: group.docs.length,
          updatedAt: "2026-09-24T00:00:00.000Z",
        };
      });
      return { result: { ok: true, items } };
    }
    if (rpc.method === "documents_list") {
      const all = docs
        .filter((doc) => (!p.section || doc.section === p.section) && doc.folder === p.folder)
        .sort((a, b) => a.id.localeCompare(b.id));
      const offset = p.offset ?? 0;
      const limit = p.limit ?? 50;
      const items = all.slice(offset, offset + limit).map(dto);
      const next = offset + items.length;
      return {
        result: {
          ok: true,
          items,
          total: all.length,
          limit,
          offset,
          nextOffset: next < all.length ? next : null,
        },
      };
    }
    if (rpc.method === "documents_get") {
      const doc = docs.find((entry) => entry.id === p.id);
      if (!doc || failGet.has(p.id))
        return { error: { code: "doc_not_found", message: `document not found: ${p.id}` } };
      return { result: { ok: true, document: { ...dto(doc), content: doc.content } } };
    }
    return { error: { code: "method_not_allowed", message: rpc.method } };
  };
  return { docs, seen, failGet, handle };
}

async function servePage(t, f, library) {
  const controller = new AbortController();
  const loop = (async () => {
    while (!controller.signal.aborted) {
      const next = await f.browser("/v1/next", {}, { signal: controller.signal });
      if (next.status !== 200) break;
      if (next.result.idle) continue;
      const reply = library.handle(next.result);
      await f.browser(
        "/v1/reply",
        { requestId: next.result.requestId, ...reply },
        { signal: controller.signal },
      );
    }
  })().catch((error) => {
    if (!controller.signal.aborted) throw error;
  });
  t.after(async () => {
    controller.abort();
    await loop;
  });
}

/** 一部上传的小说：`novel:k3x9:0001…`，每章一篇，都在参考资料栏的「name」文件夹里。 */
function novel(
  library,
  { name = "忽悠少帅", key = "k3x9", chapters = 3, section = "reference" } = {},
) {
  for (let i = 1; i <= chapters; i++)
    library.docs.push({
      id: `novel:${key}:${String(i).padStart(4, "0")}`,
      section,
      folder: name,
      docType: "novel",
      title: i === 2 ? "第二章 风起/云涌?" : `第${i}章`,
      content: `# 第${i}章\n\n正文 ${i}\n`,
      version: i,
    });
}

async function connected(t) {
  const f = await fixture(t);
  await f.pair();
  const library = fakeLibrary();
  await servePage(t, f, library);
  const workspace = await fs.realpath(f.workspace);
  return { f, library, workspace };
}

test("docs ls --folders：列参考资料栏的文件夹（名、id、篇数、更新时间）走 documents_folders；--section 可换栏；与文档筛选互斥", async (t) => {
  const { f, library } = await connected(t);
  novel(library);
  novel(library, { name: "剧本草稿", key: "a1b2", chapters: 2, section: "script" });
  library.docs.push({
    id: "outline",
    section: "reference",
    docType: "outline",
    title: "大纲",
    content: "x",
  });
  const run = await f.cli(["docs", "ls", "--folders"]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(run.result.items, [
    {
      section: "reference",
      name: "忽悠少帅",
      id: "novel:k3x9",
      count: 3,
      updatedAt: "2026-09-24T00:00:00.000Z",
    },
  ]);
  assert.equal(run.result.section, "reference");
  assert.match(
    run.result.table,
    /^id\s+name\s+chapters\s+updatedAt\s+section\nnovel:k3x9\s+忽悠少帅\s+3\s/u,
  );
  assert.match(run.result.hint, /docs read --folder/);
  assert.deepEqual(
    library.seen.map((rpc) => [rpc.method, rpc.params]),
    [["documents_folders", { section: "reference" }]],
  );
  const script = await f.cli(["docs", "ls", "--folders", "--section", "script"]);
  assert.deepEqual(
    script.result.items.map((folder) => folder.id),
    ["novel:a1b2"],
  );
  for (const extra of [
    ["--type", "novel"],
    ["--folder", "忽悠少帅"],
    ["--q", "x"],
    ["--limit", "5"],
  ]) {
    const bad = await f.cli(["docs", "ls", "--folders", ...extra]);
    assert.equal(bad.code, 2, extra.join(" "));
    assert.equal(bad.result.error.code, "invalid_argument");
  }
});

test("docs read --folder 名 --out-dir：整个文件夹一次存成本地文件（序号 + 标题，章节顺序），回包列出每篇的文件与版本；只读，不写回", async (t) => {
  const { f, library, workspace } = await connected(t);
  novel(library);
  novel(library, { name: "另一部", key: "zz99", chapters: 1 });
  const run = await f.cli(["docs", "read", "--folder", "忽悠少帅", "--out-dir", "读/小说"]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(run.result.folder, {
    section: "reference",
    name: "忽悠少帅",
    id: "novel:k3x9",
    count: 3,
  });
  assert.equal(run.result.outDir, "读/小说");
  assert.deepEqual(
    run.result.files.map((file) => [file.path, file.id, file.version, file.contentSha]),
    [
      ["读/小说/001_第1章.md", "novel:k3x9:0001", 1, "sha-novel:k3x9:0001"],
      ["读/小说/002_第二章 风起_云涌_.md", "novel:k3x9:0002", 2, "sha-novel:k3x9:0002"],
      ["读/小说/003_第3章.md", "novel:k3x9:0003", 3, "sha-novel:k3x9:0003"],
    ],
  );
  assert.match(run.result.note, /临时阅读副本/);
  const dir = path.join(workspace, "读", "小说");
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    "001_第1章.md",
    "002_第二章 风起_云涌_.md",
    "003_第3章.md",
  ]);
  assert.equal(await fs.readFile(path.join(dir, "003_第3章.md"), "utf8"), "# 第3章\n\n正文 3\n");
  // 只读：找文件夹、列一页、逐篇取正文，没有任何写方法。
  const methods = library.seen.map((rpc) => rpc.method);
  assert.deepEqual([...new Set(methods)].sort(), [
    "documents_folders",
    "documents_get",
    "documents_list",
  ]);
  assert.equal(methods.filter((method) => method === "documents_get").length, 3);
  assert.deepEqual(library.seen[1].params, {
    section: "reference",
    folder: "忽悠少帅",
    limit: CANVAS_CONTRACT.documents.listMaxLimit,
    offset: 0,
  });

  // 按 id 找同一个文件夹；已有的文件不覆盖（一个都不写），--overwrite 才换。
  await fs.writeFile(path.join(dir, "001_第1章.md"), "我改过的");
  const taken = await f.cli(["docs", "read", "--folder", "novel:k3x9", "--out-dir", "读/小说"]);
  assert.equal(taken.code, 2, taken.stdout);
  assert.equal(taken.result.error.code, "file_exists");
  assert.equal(taken.result.error.files.length, 3);
  assert.equal(await fs.readFile(path.join(dir, "001_第1章.md"), "utf8"), "我改过的");
  const again = await f.cli([
    "docs",
    "read",
    "--folder",
    "novel:k3x9",
    "--out-dir",
    "读/小说",
    "--overwrite",
  ]);
  assert.equal(again.code, 0, again.stdout);
  assert.equal(await fs.readFile(path.join(dir, "001_第1章.md"), "utf8"), "# 第1章\n\n正文 1\n");
});

test("docs read --folder：超过一页（200 篇）的文件夹一页页列全；中途有一篇读不到就一个文件都不写，也不留这次新建的空目录", async (t) => {
  const { f, library, workspace } = await connected(t);
  novel(library, { chapters: 205 });
  const run = await f.cli(["docs", "read", "--folder", "novel:k3x9", "--out-dir", "长篇"]);
  assert.equal(run.code, 0, run.stdout);
  assert.equal(run.result.files.length, 205);
  assert.equal(run.result.files[204].path, "长篇/205_第205章.md");
  assert.deepEqual(
    library.seen.filter((rpc) => rpc.method === "documents_list").map((rpc) => rpc.params.offset),
    [0, 200],
  );
  assert.equal((await fs.readdir(path.join(workspace, "长篇"))).length, 205);

  library.failGet.add("novel:k3x9:0150");
  const broken = await f.cli(["docs", "read", "--folder", "novel:k3x9", "--out-dir", "长篇2"]);
  assert.equal(broken.result.ok, false);
  assert.equal(broken.result.error.code, "doc_not_found");
  await assert.rejects(fs.stat(path.join(workspace, "长篇2")), { code: "ENOENT" });
  // 只删这次新建的几级：原来就有的（哪怕是空的）上级目录留着。
  await fs.mkdir(path.join(workspace, "已有"));
  const nested = await f.cli([
    "docs",
    "read",
    "--folder",
    "novel:k3x9",
    "--out-dir",
    "已有/新的/深",
  ]);
  assert.equal(nested.result.error.code, "doc_not_found");
  assert.deepEqual(await fs.readdir(path.join(workspace, "已有")), []);
});

test("docs read --folder 的参数与找不到 / 重名：不写任何东西", async (t) => {
  const { f, library, workspace } = await connected(t);
  novel(library);
  novel(library, { name: "忽悠少帅", key: "q7w8", chapters: 1, section: "script" });
  const missing = await f.cli(["docs", "read", "--folder", "不存在的", "--out-dir", "x"]);
  assert.equal(missing.code, 1);
  assert.equal(missing.result.error.code, "doc_not_found");
  assert.match(missing.result.error.message, /docs ls --folders/);
  const ambiguous = await f.cli(["docs", "read", "--folder", "忽悠少帅", "--out-dir", "x"]);
  assert.equal(ambiguous.code, 2);
  assert.equal(ambiguous.result.error.code, "invalid_argument");
  assert.match(ambiguous.result.error.message, /novel:k3x9.*novel:q7w8/);
  for (const args of [
    ["--folder", "novel:k3x9"],
    ["novel:k3x9:0001", "--folder", "novel:k3x9", "--out-dir", "x"],
    ["--folder", "novel:k3x9", "--out", "a.md"],
    ["novel:k3x9:0001", "--out-dir", "x"],
    ["--folder", "  ", "--out-dir", "x"],
  ]) {
    const bad = await f.cli(["docs", "read", ...args]);
    assert.equal(bad.code, 2, args.join(" "));
    assert.equal(bad.result.error.code, "invalid_argument", args.join(" "));
  }
  // --out-dir 越出 workspace / 走符号链接：边界照旧。
  const outside = await f.cli(["docs", "read", "--folder", "novel:k3x9", "--out-dir", "../外面"]);
  assert.equal(outside.code, 2);
  assert.equal(outside.result.error.code, "workspace_boundary");
  await fs.mkdir(path.join(f.root, "real"));
  await fs.symlink(path.join(f.root, "real"), path.join(workspace, "linked"));
  const linked = await f.cli([
    "docs",
    "read",
    "--folder",
    "novel:k3x9",
    "--out-dir",
    "linked/小说",
  ]);
  assert.equal(linked.result.error.code, "workspace_boundary");
  assert.deepEqual(await fs.readdir(path.join(f.root, "real")), []);
  await assert.rejects(fs.stat(path.join(workspace, "x")), { code: "ENOENT" });
});

test("worker 也能读文件夹（只读）：写进 worker 自己的 workspace", async (t) => {
  const { f, library } = await connected(t);
  novel(library, { chapters: 2 });
  const workerWorkspace = path.join(f.root, randomUUID());
  await fs.mkdir(workerWorkspace);
  const made = await f.cli(["delegate", "--name", "Worker", "--workspace", workerWorkspace]);
  const ls = await cli(["docs", "ls", "--folders", "--session", made.result.sessionId], f.env);
  assert.equal(ls.code, 0, ls.stdout);
  assert.equal(ls.result.items[0].id, "novel:k3x9");
  const read = await cli(
    [
      "docs",
      "read",
      "--folder",
      "novel:k3x9",
      "--out-dir",
      "读",
      "--session",
      made.result.sessionId,
    ],
    f.env,
  );
  assert.equal(read.code, 0, read.stdout);
  assert.equal((await fs.readdir(path.join(await fs.realpath(workerWorkspace), "读"))).length, 2);
});

test("folderFileName / formatFoldersTable：序号补零到至少三位、按篇数够宽；文件名放不下的字符换成 _；按格式给扩展名", () => {
  const doc = (title, format = "markdown") => ({ id: "novel:k3x9:0007", title, format });
  assert.equal(folderFileName(7, 12, doc("第七章")), "007_第七章.md");
  assert.equal(folderFileName(7, 1200, doc("第七章")), "0007_第七章.md");
  assert.equal(
    folderFileName(1, 1, doc('a/b\\c:d*e?f"g<h>i|j\u0001k')),
    "001_a_b_c_d_e_f_g_h_i_j_k.md",
  );
  assert.equal(folderFileName(1, 1, doc("  ..  ")), "001_0007.md");
  assert.equal(folderFileName(1, 1, doc("字幕", "srt")), "001_字幕.srt");
  assert.equal(folderFileName(1, 1, doc("x".repeat(80))).length, "001_".length + 60 + ".md".length);
  assert.equal(
    formatFoldersTable([
      { id: null, name: "旧文件夹", count: 2, updatedAt: "t", section: "reference" },
    ]),
    "id  name  chapters  updatedAt  section\n-   旧文件夹  2         t          reference",
  );
});
