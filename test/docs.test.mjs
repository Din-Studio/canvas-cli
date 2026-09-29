/* oxlint-disable eslint/no-await-in-loop -- the fake page answers the daemon's long poll one request at a time, and the CLI calls in each case run in order. */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cli, fixture, request } from "./helpers.mjs";
import { applyUnifiedDiff, formatDocsTable } from "../src/docs.mjs";
import { parseArgs } from "../src/cli.mjs";
import { CANVAS_CONTRACT } from "../src/contract.mjs";

/**
 * doc@1 文档库：`docs ls / read / create / update / delete` 端到端 —— 真 CLI 进程、真守护进程、
 * 一个假页面。假页面照页面桥的语义回答四个 `documents_*` 方法（版本号每写 +1、`expectVersion`
 * 对不上回 `doc_conflict` 带 currentVersion / currentSha、软删），并把收到的每个请求记下来，
 * 于是「CLI 到底发了什么、有没有发」都能直接断言。
 *
 * 文档库是唯一源数据：这里没有任何本地镜像 / 同步的断言，`--out` 只是临时阅读副本。
 */

/** 与画布 `read` 同算法的 contentSha：FNV-1a 64，UTF-16 码元，换行统一 LF。 */
function contentSha(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n");
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < normalized.length; i++) {
    h ^= BigInt(normalized.charCodeAt(i));
    h = (h * 0x100000001b3n) & ((1n << 64n) - 1n);
  }
  return h.toString(16).padStart(16, "0");
}

/** 一个按页面桥语义回答 documents_* 的内存文档库 + 请求日志。 */
function fakeLibrary() {
  const docs = new Map();
  const seen = [];
  const dto = (id, doc) => ({
    id,
    section: doc.section,
    folder: doc.folder ?? null,
    docType: doc.docType,
    series: "狂飙",
    episode: doc.episode ?? null,
    scene: null,
    title: doc.title,
    format: "markdown",
    version: doc.version,
    contentSha: contentSha(doc.content),
    sourceAgent: doc.sourceAgent ?? null,
    source: doc.source ?? null,
    assetTags: [],
    derivedFrom: null,
    updatedAt: "2026-09-24T00:00:00.000Z",
    summary: doc.summary ?? null,
  });
  const conflict = (id, current) => ({
    error: {
      code: "doc_conflict",
      message: `document ${id} was changed`,
      id,
      currentVersion: current?.deleted ? 0 : (current?.version ?? 0),
      ...(current && !current.deleted ? { currentSha: contentSha(current.content) } : {}),
    },
  });
  const handle = (rpc) => {
    seen.push(rpc);
    const p = rpc.params;
    if (rpc.method === "documents_list") {
      const items = [...docs.entries()]
        .filter(([, doc]) => !doc.deleted)
        .filter(([, doc]) => !p.section || doc.section === p.section)
        .filter(([, doc]) => p.episode === undefined || doc.episode === p.episode)
        .map(([id, doc]) => dto(id, doc));
      return {
        result: {
          ok: true,
          items,
          total: items.length,
          limit: p.limit ?? 50,
          offset: 0,
          nextOffset: null,
        },
      };
    }
    if (rpc.method === "documents_get") {
      const doc = docs.get(p.id);
      if (!doc || doc.deleted)
        return { error: { code: "doc_not_found", message: `document not found: ${p.id}` } };
      return { result: { ok: true, document: { ...dto(p.id, doc), content: doc.content } } };
    }
    if (rpc.method === "documents_put") {
      const id =
        p.id ??
        (p.episode !== undefined
          ? `${p.docType}:ep:${String(p.episode).padStart(2, "0")}`
          : p.docType);
      const current = docs.get(id);
      const visible = current && !current.deleted ? current.version : 0;
      if (p.expectVersion !== visible) return conflict(id, current);
      if (!current || current.deleted) {
        const doc = {
          section: p.section ?? (p.docType === "script" ? "script" : "reference"),
          docType: p.docType,
          episode: p.episode,
          title: p.title,
          content: p.content,
          version: (current?.version ?? 0) + 1,
          source: p.source,
          sourceAgent: p.sourceAgent,
        };
        docs.set(id, doc);
        return { result: { ok: true, document: dto(id, doc), created: true, unchanged: false } };
      }
      const next = {
        ...current,
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        ...(p.content !== undefined ? { content: p.content } : {}),
      };
      const unchanged =
        next.content === current.content &&
        next.title === current.title &&
        next.summary === current.summary;
      if (unchanged)
        return {
          result: { ok: true, document: dto(id, current), created: false, unchanged: true },
        };
      next.version = current.version + 1;
      docs.set(id, next);
      return { result: { ok: true, document: dto(id, next), created: false, unchanged: false } };
    }
    if (rpc.method === "documents_delete") {
      const doc = docs.get(p.id);
      if (!doc || doc.deleted)
        return { error: { code: "doc_not_found", message: `document not found: ${p.id}` } };
      doc.deleted = true;
      return { result: { ok: true, id: p.id, version: doc.version, deleted: true } };
    }
    return { error: { code: "method_not_allowed", message: rpc.method } };
  };
  return { docs, seen, handle };
}

/** 假页面：轮询 /v1/next，按 fakeLibrary 回 result 或 error（`f.pump` 只会回 result）。 */
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

async function delegate(f) {
  const workspace = path.join(f.root, randomUUID());
  await fs.mkdir(workspace);
  const made = await f.cli(["delegate", "--name", "Worker", "--workspace", workspace]);
  assert.equal(made.code, 0, made.stdout);
  return {
    workspace,
    cli: (args) => cli([...args, "--session", made.result.sessionId], f.env),
  };
}

async function connected(t) {
  const f = await fixture(t);
  await f.pair();
  const library = fakeLibrary();
  await servePage(t, f, library);
  return { f, library };
}

test("docs ls / read：读的是文档库本身；--out 只写一份临时阅读副本，不覆盖已有文件", async (t) => {
  const { f, library } = await connected(t);
  library.docs.set("script:ep:03", {
    section: "script",
    docType: "script",
    episode: 3,
    title: "第3集",
    content: "# 第3集\n\n1-1. 茶馆 日 内\n",
    version: 4,
  });
  library.docs.set("outline", {
    section: "reference",
    docType: "outline",
    title: "大纲",
    content: "大纲正文",
    version: 1,
  });

  const ls = await f.cli(["docs", "ls", "--section", "script", "--episode", "EP03"]);
  assert.equal(ls.code, 0, ls.stdout);
  const listed = library.seen.at(-1);
  assert.equal(listed.method, "documents_list");
  assert.deepEqual(listed.params, { section: "script", episode: 3 });
  assert.deepEqual(
    ls.result.items.map((doc) => doc.id),
    ["script:ep:03"],
  );
  assert.match(ls.result.table, /^id\s+section\s+type\s+ep\s+v\s+title\s+folder/);
  assert.match(ls.result.table, /script:ep:03\s+script\s+script\s+3\s+4\s+第3集/);

  const read = await f.cli(["docs", "read", "script:ep:03"]);
  assert.equal(read.code, 0, read.stdout);
  assert.deepEqual(library.seen.at(-1).params, { id: "script:ep:03" });
  assert.equal(read.result.document.content, "# 第3集\n\n1-1. 茶馆 日 内\n");
  assert.equal(read.result.document.version, 4);

  await fs.mkdir(path.join(f.workspace, "看"));
  const saved = await f.cli(["docs", "read", "script:ep:03", "--out", "看/第3集.md"]);
  assert.equal(saved.code, 0, saved.stdout);
  assert.equal(
    await fs.readFile(path.join(f.workspace, "看", "第3集.md"), "utf8"),
    "# 第3集\n\n1-1. 茶馆 日 内\n",
  );
  assert.equal(saved.result.document.content, undefined, "--out 回包不重复带正文");
  assert.match(saved.result.note, /临时阅读副本/);
  const again = await f.cli(["docs", "read", "script:ep:03", "--out", "看/第3集.md"]);
  assert.equal(again.code, 2);
  assert.equal(again.result.error.code, "file_exists");
  const overwritten = await f.cli([
    "docs",
    "read",
    "outline",
    "--out",
    "看/第3集.md",
    "--overwrite",
  ]);
  assert.equal(overwritten.code, 0, overwritten.stdout);
  assert.equal(await fs.readFile(path.join(f.workspace, "看", "第3集.md"), "utf8"), "大纲正文");

  const missing = await f.cli(["docs", "read", "script:ep:99"]);
  assert.equal(missing.code, 1);
  assert.equal(missing.result.error.code, "doc_not_found");

  // 本地就挡掉的：认不出的 id、多余的 positional、没有子命令 —— 一个请求都不发。
  const before = library.seen.length;
  for (const argv of [
    ["docs", "read", "Script:EP"],
    ["docs", "read", "a:b", "c:d"],
    ["docs", "ls", "extra"],
    ["docs"],
    ["docs", "read", "outline", "--overwrite"],
  ]) {
    const refused = await f.cli(argv);
    assert.equal(refused.code, 2, `${argv.join(" ")} → ${refused.stdout}`);
    assert.equal(refused.result.error.code, "invalid_argument");
  }
  assert.equal(library.seen.length, before);
});

test("docs read --out：上级目录不在就一级一级建出来；符号链接 / 文件挡在半路就停，不往 workspace 外写", async (t) => {
  const { f, library } = await connected(t);
  library.docs.set("script:ep:03", {
    section: "script",
    docType: "script",
    episode: 3,
    title: "第3集",
    content: "# 第3集\n",
    version: 1,
  });
  // 手册的例子就写在子目录里（`看/第3集.md`）：目录不在也能存，多级也行。
  const nested = await f.cli(["docs", "read", "script:ep:03", "--out", "看/第3集/正文.md"]);
  assert.equal(nested.code, 0, nested.stdout);
  assert.equal(
    await fs.readFile(path.join(f.workspace, "看", "第3集", "正文.md"), "utf8"),
    "# 第3集\n",
  );
  assert.equal((await fs.lstat(path.join(f.workspace, "看", "第3集"))).isDirectory(), true);

  // 半路是指向 workspace 外面的符号链接：workspace_boundary，外面什么都没建。
  const outside = path.join(f.root, `outside-${randomUUID()}`);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.workspace, "链"));
  const viaLink = await f.cli(["docs", "read", "script:ep:03", "--out", "链/子/正文.md"]);
  assert.equal(viaLink.code, 2, viaLink.stdout);
  assert.equal(viaLink.result.error.code, "workspace_boundary");
  assert.deepEqual(await fs.readdir(outside), []);

  // 半路是个文件：invalid_path。
  await fs.writeFile(path.join(f.workspace, "文件"), "x");
  const viaFile = await f.cli(["docs", "read", "script:ep:03", "--out", "文件/正文.md"]);
  assert.equal(viaFile.code, 2, viaFile.stdout);
  assert.equal(viaFile.result.error.code, "invalid_path");

  // 越界照旧拒，而且不会先在外面建目录。
  const escape = `../escape-${randomUUID()}`;
  const up = await f.cli(["docs", "read", "script:ep:03", "--out", `${escape}/正文.md`]);
  assert.equal(up.code, 2, up.stdout);
  assert.equal(up.result.error.code, "workspace_boundary");
  await assert.rejects(fs.lstat(path.join(f.workspace, escape)), { code: "ENOENT" });
});

test("docs create：新建一篇，id 可以不给；同一篇再建回 doc_conflict（改就 update）", async (t) => {
  const { f, library } = await connected(t);
  await fs.mkdir(path.join(f.workspace, "剧本"));
  await fs.writeFile(
    path.join(f.workspace, "剧本", "第1集.md"),
    "﻿# 第1集：开端\r\n\r\n他醒了。\r\n",
  );

  const created = await f.cli([
    "docs",
    "create",
    "--type",
    "script",
    "--episode",
    "1",
    "--file",
    "剧本/第1集.md",
    "--meta",
    '{"sourceAgent":"novel-to-scripts"}',
  ]);
  assert.equal(created.code, 0, created.stdout);
  const put = library.seen.at(-1);
  assert.equal(put.method, "documents_put");
  assert.deepEqual(put.params, {
    expectVersion: 0,
    docType: "script",
    title: "第1集：开端",
    content: "# 第1集：开端\r\n\r\n他醒了。\r\n",
    sourceAgent: "novel-to-scripts",
    episode: 1,
  });
  assert.equal(Object.hasOwn(put.params, "id"), false, "不给 --id 就让文档库起 id");
  assert.equal(created.result.document.id, "script:ep:01");
  assert.equal(created.result.created, true);
  assert.match(created.result.summary, /已新建 script:ep:01（v1）/);

  const withId = await f.cli([
    "docs",
    "create",
    "--type",
    "lap-report",
    "--id",
    "lap-report:狂飙01",
    "--text",
    "报告正文",
    "--title",
    "狂飙第1集拉片报告",
  ]);
  assert.equal(withId.code, 0, withId.stdout);
  assert.equal(library.seen.at(-1).params.id, "lap-report:狂飙01");

  const dup = await f.cli([
    "docs",
    "create",
    "--type",
    "script",
    "--episode",
    "1",
    "--text",
    "# 又一份\n",
  ]);
  assert.equal(dup.code, 1);
  assert.equal(dup.result.error.code, "doc_conflict");
  assert.equal(dup.result.error.currentVersion, 1);
  assert.equal(library.docs.get("script:ep:01").version, 1, "冲突时什么都没写");

  const before = library.seen.length;
  for (const argv of [
    ["docs", "create", "--text", "x", "--title", "t"],
    ["docs", "create", "--type", "novelx", "--text", "x", "--title", "t"],
    ["docs", "create", "--type", "note", "--text", "x"],
    ["docs", "create", "--type", "note", "--title", "t"],
    ["docs", "create", "--type", "note", "--text", "x", "--file", "剧本/第1集.md", "--title", "t"],
    [
      "docs",
      "create",
      "--type",
      "note",
      "--text",
      "x",
      "--title",
      "t",
      "--meta",
      '{"docType":"script"}',
    ],
    ["docs", "create", "outline", "--type", "outline", "--text", "x", "--title", "t"],
  ]) {
    const refused = await f.cli(argv);
    assert.equal(refused.code, 2, `${argv.join(" ")} → ${refused.stdout}`);
    assert.equal(refused.result.error.code, "invalid_argument");
  }
  await fs.writeFile(path.join(f.workspace, "a.docx"), "PK");
  const docx = await f.cli(["docs", "create", "--type", "note", "--file", "a.docx"]);
  assert.equal(docx.code, 2);
  assert.match(docx.result.error.message, /upload \.docx in the canvas document library panel/);
  assert.equal(library.seen.length, before, "本地挡掉的都没发出去");
});

test("docs update：带 --expect-version 原地改；版本对不上回 doc_conflict；--patch 在读到的那一版上打补丁", async (t) => {
  const { f, library } = await connected(t);
  library.docs.set("script:ep:03", {
    section: "script",
    docType: "script",
    episode: 3,
    title: "第3集",
    content: "# 第3集\n1-1. 茶馆 日 内\n她推门进来。\n他抬头。\n",
    version: 4,
  });

  const whole = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "4",
    "--text",
    "# 第3集\n重写\n",
  ]);
  assert.equal(whole.code, 0, whole.stdout);
  assert.deepEqual(library.seen.at(-1).params, {
    id: "script:ep:03",
    expectVersion: 4,
    content: "# 第3集\n重写\n",
  });
  assert.equal(whole.result.document.version, 5);
  assert.match(whole.result.summary, /已原地更新 script:ep:03 → v5/);

  // 旧版本号再写：页面回冲突，带现在的版本与 sha；什么都没写。
  const stale = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "4",
    "--text",
    "旧的",
  ]);
  assert.equal(stale.code, 1);
  assert.equal(stale.result.error.code, "doc_conflict");
  assert.equal(stale.result.error.id, "script:ep:03");
  assert.equal(stale.result.error.currentVersion, 5);
  assert.equal(stale.result.error.currentSha, contentSha("# 第3集\n重写\n"));
  assert.equal(library.docs.get("script:ep:03").content, "# 第3集\n重写\n");

  // 没变：unchanged，版本号不动。
  const same = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "5",
    "--text",
    "# 第3集\n重写\n",
  ]);
  assert.equal(same.code, 0, same.stdout);
  assert.equal(same.result.unchanged, true);
  assert.equal(same.result.document.version, 5);

  // --patch：先读（自己的 request id），版本对得上才在这一版上打补丁，再带同一个版本号写。
  const patch = "@@ -2,1 +2,2 @@\n 重写\n+她推门进来。\n";
  const requestId = randomUUID();
  const patched = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "5",
    "--patch",
    patch,
    "--request-id",
    requestId,
  ]);
  assert.equal(patched.code, 0, patched.stdout);
  const [getRpc, putRpc] = library.seen.slice(-2);
  assert.equal(getRpc.method, "documents_get");
  assert.equal(putRpc.method, "documents_put");
  assert.notEqual(getRpc.requestId, requestId, "读不占用 --request-id");
  assert.equal(putRpc.requestId, requestId, "--request-id 归那次写");
  assert.deepEqual(putRpc.params, {
    id: "script:ep:03",
    expectVersion: 5,
    content: "# 第3集\n重写\n她推门进来。\n",
  });
  assert.equal(patched.result.document.version, 6);

  // --patch 但版本已经动了：CLI 自己回 doc_conflict，不写。
  let before = library.seen.length;
  const moved = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "5",
    "--patch",
    patch,
  ]);
  assert.equal(moved.code, 1);
  assert.equal(moved.result.error.code, "doc_conflict");
  assert.equal(moved.result.error.deleted, false, "与页面桥的 doc_conflict 同一组字段");
  assert.equal(moved.result.error.id, "script:ep:03", "错误里带冲突落在哪一篇上");
  assert.equal(moved.result.error.currentVersion, 6);
  assert.deepEqual(
    library.seen.slice(before).map((rpc) => rpc.method),
    ["documents_get"],
  );

  // 补丁对不上当前正文：patch_failed，不写。
  before = library.seen.length;
  const mismatch = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "6",
    "--patch",
    "@@ -1,1 +1,1 @@\n-不存在的一行\n+新的\n",
  ]);
  assert.equal(mismatch.code, 1);
  assert.equal(mismatch.result.error.code, "patch_failed");
  assert.deepEqual(
    library.seen.slice(before).map((rpc) => rpc.method),
    ["documents_get"],
  );

  // 只改标题：没有正文也行。
  const retitled = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "6",
    "--title",
    "第3集：夜宴",
  ]);
  assert.equal(retitled.code, 0, retitled.stdout);
  assert.deepEqual(library.seen.at(-1).params, {
    id: "script:ep:03",
    expectVersion: 6,
    title: "第3集：夜宴",
  });

  before = library.seen.length;
  for (const argv of [
    ["docs", "update", "script:ep:03", "--text", "x"],
    ["docs", "update", "script:ep:03", "--expect-version", "7"],
    ["docs", "update", "script:ep:03", "--expect-version", "0", "--text", "x"],
    ["docs", "update", "script:ep:03", "--expect-version", "7", "--text", "x", "--patch", patch],
    ["docs", "update", "--expect-version", "7", "--text", "x"],
  ]) {
    const refused = await f.cli(argv);
    assert.equal(refused.code, 2, `${argv.join(" ")} → ${refused.stdout}`);
    assert.equal(refused.result.error.code, "invalid_argument");
  }
  assert.equal(library.seen.length, before);
});

test("docs create / update：正文超过一篇的上限（100 万字）在发出去之前就回 too_large，说清多长、上限多少；写请求一个都不发", async (t) => {
  const { f, library } = await connected(t);
  const max = CANVAS_CONTRACT.documents.contentMaxChars;
  assert.equal(max, 1_000_000);
  await fs.writeFile(path.join(f.workspace, "整部.md"), "雨".repeat(max + 1));
  await fs.writeFile(path.join(f.workspace, "正好.md"), "雨".repeat(max));
  library.docs.set("script:ep:03", {
    section: "script",
    docType: "script",
    episode: 3,
    title: "第3集",
    content: `a\n${"x".repeat(max - 4)}\n`,
    version: 1,
  });

  const before = library.seen.length;
  const created = await f.cli(["docs", "create", "--type", "note", "--file", "整部.md"]);
  assert.equal(created.code, 2, created.stdout);
  assert.equal(created.result.error.code, "too_large");
  assert.equal(created.result.error.chars, max + 1);
  assert.equal(created.result.error.maxChars, max);
  assert.match(
    created.result.error.message,
    /整部\.md is 1000001 characters; one document holds at most 1000000\. Split it into several documents/,
  );
  const updated = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "1",
    "--file",
    "整部.md",
  ]);
  assert.equal(updated.code, 2, updated.stdout);
  assert.equal(updated.result.error.code, "too_large");
  assert.equal(library.seen.length, before, "本地就挡了，一个请求都没发");

  // --patch：先读，打完补丁超了也不写（读发出去了，写没有）。
  const patched = await f.cli([
    "docs",
    "update",
    "script:ep:03",
    "--expect-version",
    "1",
    "--patch",
    "@@ -1,1 +1,2 @@\n a\n+0123456789\n",
  ]);
  assert.equal(patched.code, 2, patched.stdout);
  assert.equal(patched.result.error.code, "too_large");
  assert.match(
    patched.result.error.message,
    /script:ep:03 with this patch applied is 1000010 characters/,
  );
  assert.deepEqual(
    library.seen.slice(before).map((rpc) => rpc.method),
    ["documents_get"],
  );

  // 正好在上限上的照常发。
  const atLimit = await f.cli(["docs", "create", "--type", "note", "--file", "正好.md"]);
  assert.equal(atLimit.code, 0, atLimit.stdout.slice(0, 300));
  assert.equal(library.seen.at(-1).params.content.length, max);

  // 换行按 LF 计（与服务端存的形态同一个口径）：CRLF 正文的原始长度超了上限、换成 LF 后正好在上限上 ——
  // CLI 照常发，守护进程的 policy 也放行；换成 LF 后多一个字就挡，回的 chars 也是 LF 口径。
  await fs.writeFile(path.join(f.workspace, "换行.md"), "雨\r\n".repeat(max / 2));
  await fs.writeFile(path.join(f.workspace, "换行超.md"), `${"雨\r\n".repeat(max / 2)}雨`);
  const crlf = await f.cli([
    "docs",
    "create",
    "--type",
    "note",
    "--id",
    "note:crlf",
    "--file",
    "换行.md",
  ]);
  assert.equal(crlf.code, 0, crlf.stdout.slice(0, 300));
  const sent = library.seen.at(-1);
  assert.equal(sent.method, "documents_put");
  assert.ok(sent.params.content.length > max);
  assert.equal(sent.params.content.replace(/\r\n?/g, "\n").length, max);
  const crlfOver = await f.cli([
    "docs",
    "create",
    "--type",
    "note",
    "--id",
    "note:crlf2",
    "--file",
    "换行超.md",
  ]);
  assert.equal(crlfOver.code, 2, crlfOver.stdout.slice(0, 300));
  assert.equal(crlfOver.result.error.code, "too_large");
  assert.equal(crlfOver.result.error.chars, max + 1);
});

test("docs delete：L3，必须 --approved；带上的同意点名这一篇", async (t) => {
  const { f, library } = await connected(t);
  library.docs.set("note:旧大纲", {
    section: "reference",
    docType: "note",
    title: "旧大纲",
    content: "x",
    version: 2,
  });
  const before = library.seen.length;
  const refused = await f.cli(["docs", "delete", "note:旧大纲"]);
  assert.equal(refused.code, 2);
  assert.equal(refused.result.error.code, "approval_required");
  assert.equal(library.seen.length, before, "没同意就一个请求都不发");

  const deleted = await f.cli([
    "docs",
    "delete",
    "note:旧大纲",
    "--approved",
    "--expect-version",
    "2",
  ]);
  assert.equal(deleted.code, 0, deleted.stdout);
  assert.deepEqual(library.seen.at(-1).params, {
    id: "note:旧大纲",
    approval: { userApprovedDocumentIds: ["note:旧大纲"] },
    expectVersion: 2,
  });
  assert.match(deleted.result.summary, /已删除 note:旧大纲/);
  const gone = await f.cli(["docs", "read", "note:旧大纲"]);
  assert.equal(gone.result.error.code, "doc_not_found");

  // 守护进程那一侧同样要 approval（绕过 CLI 直接发线协议也不行）。
  const raw = await f.rpc({
    requestId: randomUUID(),
    method: "documents_delete",
    turnId: "t",
    params: { id: "note:旧大纲" },
  });
  assert.equal(raw.result.error.code, "approval_required");
});

test("worker 只读文档库：ls / read 能发；create / update / delete 回 worker_forbidden，页面收不到", async (t) => {
  const { f, library } = await connected(t);
  library.docs.set("outline", {
    section: "reference",
    docType: "outline",
    title: "大纲",
    content: "大纲正文",
    version: 1,
  });
  const worker = await delegate(f);
  const ls = await worker.cli(["docs", "ls"]);
  assert.equal(ls.code, 0, ls.stdout);
  assert.equal(library.seen.at(-1).role, "worker");
  const read = await worker.cli(["docs", "read", "outline"]);
  assert.equal(read.code, 0, read.stdout);
  assert.equal(read.result.document.content, "大纲正文");

  const before = library.seen.length;
  for (const argv of [
    ["docs", "create", "--type", "note", "--text", "x", "--title", "t"],
    ["docs", "update", "outline", "--expect-version", "1", "--text", "改"],
    ["docs", "delete", "outline", "--approved"],
  ]) {
    const refused = await worker.cli(argv);
    assert.equal(
      refused.result.error.code,
      "worker_forbidden",
      `${argv.join(" ")} → ${refused.stdout}`,
    );
    assert.equal(refused.code, 1);
  }
  assert.equal(library.seen.length, before, "worker 的写一个都没送到页面");
  assert.equal(library.docs.get("outline").version, 1);

  // 直接发线协议也一样：守护进程按 MAIN_METHODS 拒。
  const record = JSON.parse(
    await fs.readFile(
      path.join(f.home, "sessions", `${(await worker.cli(["status"])).result.sessionId}.json`),
      "utf8",
    ),
  );
  const raw = await request(f.info.endpoint, "/v1/call", {
    headers: { Authorization: `Bearer ${record.cliToken}` },
    body: {
      requestId: randomUUID(),
      method: "documents_put",
      turnId: "t",
      params: { id: "outline", expectVersion: 1, content: "改" },
    },
  });
  assert.equal(raw.result.error.code, "worker_forbidden");
});

/* ───────────────────────────── 纯函数 ───────────────────────────── */

test("applyUnifiedDiff：多块、行号偏移、纯插入、无换行结尾；对不上就 patch_failed", () => {
  const text = "一\n二\n三\n四\n五\n六\n";
  assert.equal(
    applyUnifiedDiff(
      text,
      "--- a/x\n+++ b/x\n@@ -2,2 +2,2 @@\n 二\n-三\n+叁\n@@ -5,2 +5,3 @@\n 五\n+五点五\n 六\n",
    ),
    "一\n二\n叁\n四\n五\n五点五\n六\n",
  );
  // 头里的行号不对（整段挪了两行）也能在附近找到。
  assert.equal(applyUnifiedDiff(text, "@@ -4,1 +4,1 @@\n-六\n+陆\n"), "一\n二\n三\n四\n五\n陆\n");
  // 纯插入：`-N,0` 插在第 N 行之后；`-0,0` 插在最前。
  assert.equal(applyUnifiedDiff("a\nb\n", "@@ -1,0 +2,1 @@\n+x\n"), "a\nx\nb\n");
  assert.equal(applyUnifiedDiff("a\nb\n", "@@ -0,0 +1,1 @@\n+x\n"), "x\na\nb\n");
  // 无换行结尾：旧文件没有、新文件补上；以及反过来。
  assert.equal(
    applyUnifiedDiff("a\nb", "@@ -2,1 +2,1 @@\n-b\n\\ No newline at end of file\n+b\n"),
    "a\nb\n",
  );
  assert.equal(
    applyUnifiedDiff("a\nb\n", "@@ -2,1 +2,1 @@\n-b\n+c\n\\ No newline at end of file\n"),
    "a\nc",
  );
  // CRLF 的 diff 与正文都按 LF 处理；空的上下文行（尾部空格被编辑器吃掉）也认。
  assert.equal(
    applyUnifiedDiff("a\r\n\r\nb\r\n", "@@ -1,3 +1,3 @@\r\n a\r\n\r\n-b\r\n+c\r\n"),
    "a\n\nc\n",
  );
  assert.throws(
    () => applyUnifiedDiff(text, "@@ -1,1 +1,1 @@\n-不在正文里\n+x\n"),
    (error) => error.code === "patch_failed" && /hunk 1/.test(error.message),
  );
  assert.throws(
    () => applyUnifiedDiff(text, "随便写的一段"),
    (error) => error.code === "invalid_argument" && /no @@ hunk/.test(error.message),
  );
  assert.throws(
    () => applyUnifiedDiff(text, "@@ -1,2 +1,2 @@\n 一\n"),
    (error) => error.code === "invalid_argument" && /cut short/.test(error.message),
  );
});

test("docs 的子命令在 parseArgs 里是一个两个词的命令名，与规格表、分级表的键一致", () => {
  assert.equal(parseArgs(["docs", "ls", "--type", "script"]).command, "docs ls");
  assert.deepEqual(parseArgs(["docs", "read", "outline"]).positionals, ["outline"]);
  assert.deepEqual(parseArgs(["help", "docs", "update"]).positionals, ["docs update"]);
  assert.equal(parseArgs(["docs"]).command, "docs");
  assert.equal(parseArgs(["docs", "sync"]).command, "docs", "认不出的子命令不拼");
  for (const sub of ["ls", "read", "create", "update", "delete"])
    assert.ok(CANVAS_CONTRACT.tiers[`docs ${sub}`], `tiers 里没有 docs ${sub}`);
  assert.deepEqual(
    Object.fromEntries(
      ["ls", "read", "create", "update", "delete"].map((sub) => [
        sub,
        [CANVAS_CONTRACT.tiers[`docs ${sub}`].level, CANVAS_CONTRACT.tiers[`docs ${sub}`].mainOnly],
      ]),
    ),
    {
      ls: ["L0", false],
      read: ["L0", false],
      create: ["L1", true],
      update: ["L1", true],
      delete: ["L3", true],
    },
  );
});

test("formatDocsTable 一行一篇、列顺序固定", () => {
  const table = formatDocsTable([
    {
      id: "outline",
      section: "reference",
      docType: "outline",
      episode: null,
      version: 2,
      title: "大纲",
      folder: null,
    },
    {
      id: "novel:k3x9:0001",
      section: "reference",
      docType: "novel",
      episode: null,
      version: 1,
      title: "第一章",
      folder: "海巫",
    },
  ]);
  const lines = table.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^outline\s+reference\s+outline\s+-\s+2\s+大纲\s+-$/);
  assert.match(lines[2], /^novel:k3x9:0001\s+reference\s+novel\s+-\s+1\s+第一章\s+海巫$/);
});
