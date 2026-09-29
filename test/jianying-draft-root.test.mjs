import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cli, fixture, request } from "./helpers.mjs";
import { mp4 } from "./mp4-fixture.mjs";
import { exportOptions } from "../src/jianying/export.mjs";
import { onThisPlatform, refuseDraftRoot, resolveDraftRoot } from "../src/jianying/draft-root.mjs";
import { formatRootsTable, probeDraftRoot } from "../src/jianying/roots.mjs";

/* oxlint-disable eslint/no-await-in-loop -- 测试逐条核对，串行是有意的 */

/**
 * 拍板 A6：`jianying-roots`（查用户登记的剪映草稿目录）与 `export-jianying --draft-root`（直接写进
 * 用户的剪映草稿目录）。真的 CLI 进程 + 真的守护进程 + 假页面（回 `timeline_export` /
 * `jianying_roots_list` / `jianying_roots_touch`）+ 本地假 CDN。
 */

const DAY = "2026-09-23";
async function scratchDir(prefix) {
  return fs.mkdtemp(path.join(os.homedir(), `scenemint-canvas-cli-${prefix}`));
}
const fileId = (n) => `3f2a3a51-1111-4222-8333-${String(n).padStart(12, "0")}`;
const srcOf = (n) => `https://cdn.echojoy.cn/files/${DAY}/${fileId(n)}.mp4`;
const pathOf = (n) => `/files/${DAY}/${fileId(n)}.mp4`;
const clip = (id, title, file, extra = {}) => ({
  id,
  sourceId: `node-${id}`,
  title,
  src: srcOf(file),
  inMs: 0,
  outMs: null,
  ...extra,
});
const MEDIA = { 1: mp4({ mdatBytes: 3000 }), 2: mp4({ mdatBytes: 5000 }) };
const TIMELINE = {
  ok: true,
  canvasId: "canvas-a",
  title: "测试剧",
  revision: "t1",
  clips: [clip("a", "ep01 镜1", 1), clip("b", "ep01 镜2", 2), clip("c", "ep02 镜1", 2)],
};

async function startCdn(t) {
  const hits = [];
  const fail = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://cdn.test");
    hits.push({ method: req.method, path: url.pathname });
    const status = fail.get(url.pathname);
    if (status) {
      res.writeHead(status);
      res.end();
      return;
    }
    const n = Object.keys(MEDIA).find((key) => pathOf(key) === url.pathname);
    if (n === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    const body = MEDIA[n];
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(body.length) });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const gets = () => hits.filter((hit) => hit.method === "GET").length;
  return { origin: `http://127.0.0.1:${server.address().port}`, hits, fail, gets };
}

/**
 * 会话 + 已配对的假页面 + 假 CDN。`page.roots` 是用户登记的那几条（`jianying_roots_list` 回它），
 * `page.touch(params)` 决定 `jianying_roots_touch` 回什么；`page.replies[method]` 可以整条换掉回包。
 */
async function setup(t, { home } = {}) {
  const f = await fixture(t);
  const cdn = await startCdn(t);
  f.env.SCENEMINT_CANVAS_TEST_MEDIA_ORIGIN = cdn.origin;
  f.env.SCENEMINT_CANVAS_TEST_BACKOFF_MS = "0";
  if (home) f.env.HOME = home;
  await f.pair();
  const seen = [];
  const page = {
    roots: [],
    replies: {},
    touch: (params) => ({
      ok: true,
      root: { path: params.path, lastUsedAt: "2026-09-24T10:00:00.000Z" },
      added: !page.roots.some((root) => root.path === params.path),
      evicted: [],
      roots: page.roots,
    }),
  };
  const pump = await f.pump((rpc) => {
    seen.push({ method: rpc.method, role: rpc.role, params: rpc.params });
    if (page.replies[rpc.method]) return page.replies[rpc.method];
    if (rpc.method === "timeline_export") return TIMELINE;
    if (rpc.method === "jianying_roots_list") return { ok: true, roots: page.roots, max: 5 };
    if (rpc.method === "jianying_roots_touch") return page.touch(rpc.params);
    return { ok: true };
  });
  t.after(() => pump.stop());
  const root = await fs.realpath(f.root);
  const workspace = await fs.realpath(f.workspace);
  return { f, cdn, seen, page, root, workspace };
}

/** 一个像样的剪映草稿根：剪映自己的索引文件 + 一份别人的草稿 + 一个随手放的文件。 */
async function draftFolder(base, name = "剪映 草稿") {
  const dir = path.join(base, name);
  await fs.mkdir(path.join(dir, "别人的草稿"), { recursive: true });
  await fs.writeFile(path.join(dir, "root_meta_info.json"), '{"all_draft_store":[]}');
  await fs.writeFile(path.join(dir, "别人的草稿", "draft_meta_info.json"), "{}");
  await fs.writeFile(path.join(dir, "别动我.txt"), "用户自己的文件");
  return dir;
}

/** 根下除了本命令新建的工程目录之外的东西（名字 → 内容），导出前后必须一模一样。 */
async function untouched(dir) {
  return {
    names: (await fs.readdir(dir)).filter((name) => !name.startsWith("测试剧_")).sort(),
    meta: await fs.readFile(path.join(dir, "root_meta_info.json"), "utf8"),
    other: await fs.readFile(path.join(dir, "别人的草稿", "draft_meta_info.json"), "utf8"),
    file: await fs.readFile(path.join(dir, "别动我.txt"), "utf8"),
  };
}

const methods = (seen) => seen.map((rpc) => rpc.method);

test("jianying-roots：最近用过的在前，每条看本机在不在、像不像剪映草稿根、--draft-root 收不收，回一张表", async (t) => {
  const { f, seen, page, root } = await setup(t);
  const withMeta = await draftFolder(root, "有索引");
  const withDrafts = path.join(root, "有草稿");
  await fs.mkdir(path.join(withDrafts, "某集"), { recursive: true });
  await fs.writeFile(path.join(withDrafts, "某集", "draft_meta_info.json"), "{}");
  const empty = path.join(root, "空目录");
  await fs.mkdir(empty);
  page.roots = [
    { path: empty, label: "空的", lastUsedAt: "2026-09-20T00:00:00.000Z" },
    { path: "D:\\JianyingPro\\User Data\\Projects\\com.lveditor.draft", label: "公司 Windows" },
    { path: withMeta, label: "家里", lastUsedAt: "2026-09-24T08:00:00.000Z" },
    { path: path.join(root, "不存在"), lastUsedAt: "2026-09-22T00:00:00.000Z" },
    { path: withDrafts, lastUsedAt: "2026-09-23T00:00:00.000Z" },
  ];
  const run = await f.cli(["jianying-roots"]);
  assert.equal(run.code, 0, run.stdout);
  const { roots } = run.result;
  assert.equal(run.result.max, 5);
  // 最近用过的在前；没有时间的（旧数据）排最后。
  assert.deepEqual(
    roots.map((row) => row.path),
    [
      withMeta,
      withDrafts,
      path.join(root, "不存在"),
      empty,
      "D:\\JianyingPro\\User Data\\Projects\\com.lveditor.draft",
    ],
  );
  const [home, drafts, missing, blank, windows] = roots;
  assert.deepEqual(
    [home.exists, home.looksLikeDraftRoot, home.rootMetaInfo, home.drafts, home.usable],
    [true, true, true, 1, true],
  );
  assert.equal(home.label, "家里");
  assert.equal(home.lastUsedAt, "2026-09-24T08:00:00.000Z");
  assert.deepEqual([drafts.exists, drafts.looksLikeDraftRoot, drafts.drafts], [true, true, 1]);
  assert.deepEqual([missing.exists, missing.reason, missing.usable], [false, "not_found", false]);
  // 空目录在、能直写，但不像草稿根（可能是用户刚建的，也可能填错了）。
  assert.deepEqual([blank.exists, blank.looksLikeDraftRoot, blank.usable], [true, false, true]);
  // 另一台系统形状的路径不去碰文件系统。
  assert.deepEqual(
    [windows.exists, windows.reason, windows.lastUsedAt],
    [false, "other_platform", null],
  );
  assert.match(
    run.result.table,
    /^#\s+lastUsedAt\s+label\s+exists\s+looksLikeDraftRoot\s+usable\s+path/,
  );
  assert.match(run.result.table, /家里/);
  assert.match(run.result.hint, /--draft-root/);
  assert.match(run.result.hint, /--approved/);
  assert.deepEqual(methods(seen), ["jianying_roots_list"]);
  assert.deepEqual(seen[0].params, {});

  // 一条都没登记：提示改成「请用户给路径」。
  page.roots = [];
  const none = await f.cli(["jianying-roots"]);
  assert.equal(none.code, 0);
  assert.deepEqual(none.result.roots, []);
  assert.match(none.result.hint, /还没有登记/);
});

test("jianying-roots 只有主会话能查：worker 在 CLI 这一层就 worker_forbidden，页面一次都没被问；老页面回 bridge_missing", async (t) => {
  const { f, seen, page } = await setup(t);
  const workerWorkspace = path.join(f.root, randomUUID());
  await fs.mkdir(workerWorkspace);
  const made = await f.cli(["delegate", "--name", "Worker", "--workspace", workerWorkspace]);
  assert.equal(made.code, 0, made.stdout);
  const worker = await cli(["jianying-roots", "--session", made.result.sessionId], f.env);
  assert.equal(worker.result.ok, false);
  assert.equal(worker.result.error.code, "worker_forbidden");
  assert.equal(seen.length, 0);
  // 守护进程那一层同样拒：绕过 CLI，拿 worker 自己的凭据直接打线协议，两个方法都不许。
  const workerRecord = JSON.parse(
    await fs.readFile(path.join(f.home, "sessions", `${made.result.sessionId}.json`), "utf8"),
  );
  for (const [method, params] of [
    ["jianying_roots_list", {}],
    ["jianying_roots_touch", { path: "/a/b" }],
  ]) {
    const raw = await request(f.info.endpoint, "/v1/call", {
      headers: { Authorization: `Bearer ${workerRecord.cliToken}` },
      body: { requestId: randomUUID(), method, params, turnId: "t-1" },
    });
    assert.equal(raw.result.ok, false, method);
    assert.equal(raw.result.error.code, "worker_forbidden", method);
  }
  assert.equal(seen.length, 0);

  page.replies.jianying_roots_list = {
    ok: false,
    error: { code: "method_not_allowed", message: "Unknown canvas method" },
  };
  const old = await f.cli(["jianying-roots"]);
  assert.equal(old.code, 1);
  assert.equal(old.result.error.code, "bridge_missing");
  assert.match(old.result.error.message, /刷新/);
});

test("--draft-root 直写登记过的目录：工程直接建在根下、素材按根的绝对路径引用，workspace 里一样都不留，根里别的东西不动，成功后记住它", async (t) => {
  const { f, cdn, seen, page, root, workspace } = await setup(t);
  const drafts = await draftFolder(root);
  // 登记表里写的带结尾分隔符：按 draftRootKey 比，是同一条。
  page.roots = [{ path: `${drafts}/`, label: "这台电脑", lastUsedAt: "2026-09-01T00:00:00.000Z" }];
  const before = await untouched(drafts);
  const run = await f.cli(["export-jianying", "--draft-root", drafts]);
  assert.equal(run.code, 0, run.stdout);
  const result = run.result;
  assert.equal(result.ok, true);
  assert.equal(result.draftRoot, drafts);
  assert.equal(result.outDir, null);
  assert.equal(result.draftRootRegistered, true);
  assert.match(result.note, /重启剪映/);
  assert.deepEqual(
    result.projects.map((p) => [p.episode, p.status, p.dir === p.name]),
    [
      ["EP01", "ok", true],
      ["EP02", "ok", true],
    ],
  );
  // 先查白名单、再要时间线，成功之后记住这个根。
  assert.deepEqual(methods(seen), [
    "jianying_roots_list",
    "timeline_export",
    "jianying_roots_touch",
  ]);
  assert.deepEqual(seen[2].params, { path: drafts });
  assert.deepEqual(result.remembered, { ok: true, added: true, evicted: [] });
  for (const project of result.projects) {
    const dir = path.join(drafts, project.name);
    assert.equal(project.absoluteDir, dir);
    const meta = JSON.parse(await fs.readFile(path.join(dir, "draft_meta_info.json"), "utf8"));
    assert.equal(meta.draft_root_path, drafts);
    assert.equal(meta.draft_fold_path, dir);
    const draft = JSON.parse(await fs.readFile(path.join(dir, "draft_content.json"), "utf8"));
    for (const video of draft.materials.videos) {
      assert.equal(video.path, path.join(dir, "assets", "video", video.material_name));
      assert.equal((await fs.stat(video.path)).isFile(), true);
    }
  }
  // 只多了这两个工程目录；没有残留的 .partial；别人的草稿、剪映的索引、用户的文件一个字节没动。
  assert.deepEqual(
    (await fs.readdir(drafts)).filter((name) => name.startsWith("测试剧_") || name.startsWith(".")),
    result.projects.map((p) => p.name).sort(),
  );
  assert.deepEqual(await untouched(drafts), before);
  // workspace 里不另留一份。
  await assert.rejects(fs.stat(path.join(workspace, "产出")), { code: "ENOENT" });
  assert.equal(cdn.gets(), 2);
});

test("表外目录：不带 --approved 回 approval_required（退出码 2），不要时间线、不下载、什么都不建；用户同意后带 --approved 才导，成功后登记进表（挤掉的点名）", async (t) => {
  const { f, cdn, seen, page, root } = await setup(t);
  const drafts = await draftFolder(root, "新买的盘");
  page.roots = [{ path: path.join(root, "别的目录"), lastUsedAt: "2026-09-24T00:00:00.000Z" }];
  const before = await untouched(drafts);
  const refused = await f.cli(["export-jianying", "--draft-root", drafts]);
  assert.equal(refused.code, 2, refused.stdout);
  assert.equal(refused.result.error.code, "approval_required");
  assert.equal(refused.result.error.draftRoot, drafts);
  assert.match(refused.result.error.message, /念给用户/);
  assert.deepEqual(methods(seen), ["jianying_roots_list"]);
  assert.equal(cdn.hits.length, 0);
  assert.deepEqual(await fs.readdir(drafts), before.names);

  page.touch = (params) => ({
    ok: true,
    root: { path: params.path, lastUsedAt: "2026-09-24T10:00:00.000Z" },
    added: true,
    evicted: [{ path: "/old/drafts", label: "旧电脑", lastUsedAt: "2026-01-01T00:00:00.000Z" }],
    roots: [],
  });
  const approved = await f.cli(["export-jianying", "--draft-root", drafts, "--approved"]);
  assert.equal(approved.code, 0, approved.stdout);
  assert.equal(approved.result.draftRootRegistered, false);
  assert.deepEqual(approved.result.remembered, {
    ok: true,
    added: true,
    evicted: [{ path: "/old/drafts", label: "旧电脑" }],
  });
  assert.ok(approved.result.warnings.some((line) => /挤掉了最久没用的.*旧电脑/.test(line)));
  assert.equal(seen.filter((rpc) => rpc.method === "jianying_roots_touch").length, 1);
  assert.deepEqual(await untouched(drafts), before);
});

test("--draft-root 的根检查：符号链接 / 联接点、盘根、家目录及其上级、系统目录、不存在、不是目录、相对路径 —— invalid_path + reason，页面一次都没问、一个字节都不下", async (t) => {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "draft-root-home-")),
  );
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const home = path.join(base, "home");
  await fs.mkdir(home);
  const { f, cdn, seen, root } = await setup(t, { home });
  const real = await draftFolder(root, "真目录");
  await fs.symlink(real, path.join(root, "链接目录"));
  await fs.mkdir(path.join(root, "真上级", "drafts"), { recursive: true });
  await fs.symlink(path.join(root, "真上级"), path.join(root, "链接上级"));
  await fs.writeFile(path.join(root, "一个文件"), "x");
  const cases = [
    [path.join(root, "链接目录"), "symlink", path.join(root, "链接目录")],
    [path.join(root, "链接上级", "drafts"), "symlink", path.join(root, "链接上级")],
    ["/", "drive_root"],
    [home, "home_dir"],
    [base, "home_dir"],
    ["/usr", "system_dir"],
    ["/etc/jianying", "system_dir"],
    [path.join(root, "不存在", "drafts"), "not_found", path.join(root, "不存在")],
    [path.join(root, "一个文件"), "not_directory"],
    ["drafts/relative", "not_absolute"],
    [`${root}/../${path.basename(root)}/真目录`, "relative_segment"],
  ];
  for (const [draftRoot, reason, at] of cases) {
    const run = await f.cli(["export-jianying", "--draft-root", draftRoot, "--approved"]);
    assert.equal(run.code, 2, `${draftRoot}: ${run.stdout}`);
    assert.equal(run.result.error.code, "invalid_path", draftRoot);
    assert.equal(run.result.error.reason, reason, draftRoot);
    if (at) assert.equal(run.result.error.path, at, draftRoot);
  }
  assert.equal(seen.length, 0);
  assert.equal(cdn.hits.length, 0);
  assert.deepEqual(
    (await fs.readdir(real)).sort(),
    ["root_meta_info.json", "别人的草稿", "别动我.txt"].sort(),
  );
});

test("参数：--draft-root 与 --out-dir 二选一、不收 --overwrite，--approved 只配 --draft-root；worker 带 --draft-root 在 CLI 这一层就拒", async (t) => {
  const { f, seen, root } = await setup(t);
  const drafts = await draftFolder(root);
  for (const args of [
    ["--draft-root", drafts, "--out-dir", "产出/剪映工程"],
    ["--draft-root", drafts, "--overwrite"],
    ["--approved"],
    ["--draft-root", "  "],
  ]) {
    const run = await f.cli(["export-jianying", ...args]);
    assert.equal(run.code, 2, `${args.join(" ")}: ${run.stdout}`);
    assert.equal(run.result.error.code, "invalid_argument", args.join(" "));
  }
  const workerWorkspace = path.join(f.root, randomUUID());
  await fs.mkdir(workerWorkspace);
  const made = await f.cli(["delegate", "--name", "Worker", "--workspace", workerWorkspace]);
  const worker = await cli(
    ["export-jianying", "--draft-root", drafts, "--session", made.result.sessionId],
    f.env,
  );
  assert.equal(worker.result.error.code, "worker_forbidden");
  assert.equal(seen.length, 0);
});

test("从 workspace 导出：先导进 workspace，再用 --draft-root 重导 —— 素材从 workspace 里的旧工程硬链接，一个字节都不重下，workspace 里不多任何东西", async (t) => {
  const { f, cdn, page, root, workspace } = await setup(t);
  const drafts = await draftFolder(root);
  page.roots = [{ path: drafts }];
  const first = await f.cli(["export-jianying"]);
  assert.equal(first.code, 0, first.stdout);
  const out = path.join(workspace, "产出", "剪映工程");
  const inWorkspace = (await fs.readdir(out)).sort();
  assert.equal(cdn.gets(), 2);

  const again = await f.cli(["export-jianying", "--draft-root", drafts, "--name", "测试剧"]);
  assert.equal(again.code, 0, again.stdout);
  assert.equal(again.result.downloadedBytes, 0);
  assert.equal(again.result.reusedBytes, MEDIA[1].length + MEDIA[2].length);
  assert.equal(cdn.gets(), 2, "一个字节都没重下");
  assert.deepEqual((await fs.readdir(out)).sort(), inWorkspace, "workspace 里没多出东西");
  // 同一份磁盘：草稿目录里的素材就是 workspace 旧工程里那一份（同一个卷上是硬链接）。
  const [ep01] = again.result.projects;
  const video = path.join(drafts, ep01.name, "assets", "video");
  const [asset] = (await fs.readdir(video)).sort();
  const old = path.join(out, first.result.projects[0].name, "assets", "video", asset);
  const [a, b] = await Promise.all([fs.stat(path.join(video, asset)), fs.stat(old)]);
  assert.equal(a.ino, b.ino);
});

test("--dry-run 带表外目录：不拦，只提醒要先问用户；不建、不下、不登记", async (t) => {
  const { f, cdn, seen, root } = await setup(t);
  const drafts = await draftFolder(root);
  const before = await untouched(drafts);
  const plan = await f.cli(["export-jianying", "--draft-root", drafts, "--dry-run"]);
  assert.equal(plan.code, 0, plan.stdout);
  assert.equal(plan.result.dryRun, true);
  assert.equal(plan.result.draftRoot, drafts);
  assert.equal(plan.result.outDir, null);
  assert.equal(plan.result.draftRootRegistered, false);
  assert.ok(
    plan.result.warnings.some((line) => /不在用户登记的剪映草稿目录里.*--approved/.test(line)),
  );
  assert.deepEqual(
    plan.result.projects.map((p) => [p.episode, p.dir === p.name, p.exists]),
    [
      ["EP01", true, false],
      ["EP02", true, false],
    ],
  );
  assert.deepEqual(methods(seen), ["jianying_roots_list", "timeline_export"]);
  assert.equal(cdn.gets(), 0);
  assert.deepEqual(await fs.readdir(drafts), before.names);
});

test("草稿目录看着不像剪映草稿根（空目录：没有 root_meta_info.json、也没有草稿）：照导，dry-run 与正式导出的回包都提醒；像的不提醒", async (t) => {
  const { f, page, root } = await setup(t);
  const empty = path.join(root, "空的草稿目录");
  await fs.mkdir(empty);
  const drafts = await draftFolder(root);
  page.roots = [{ path: empty }, { path: drafts }];
  const notLike = (reply) =>
    reply.result.warnings.some((line) => /看着不像剪映草稿目录.*草稿位置/.test(line));
  const plan = await f.cli([
    "export-jianying",
    "--draft-root",
    empty,
    "--episode",
    "EP01",
    "--dry-run",
  ]);
  assert.equal(plan.code, 0, plan.stdout);
  assert.equal(notLike(plan), true);
  const run = await f.cli(["export-jianying", "--draft-root", empty, "--episode", "EP01"]);
  assert.equal(run.code, 0, run.stdout);
  assert.equal(run.result.ok, true);
  assert.equal(notLike(run), true);
  const fine = await f.cli(["export-jianying", "--draft-root", drafts, "--episode", "EP01"]);
  assert.equal(fine.code, 0, fine.stdout);
  assert.equal(notLike(fine), false);
});

test("做到一半：没做完的工程留在草稿目录的 .partial 里，retry 带着 --draft-root / --approved；接着做完才登记，不留暂存目录", async (t) => {
  const { f, cdn, seen, root } = await setup(t);
  const drafts = await draftFolder(root);
  cdn.fail.set(pathOf(2), 503);
  const first = await f.cli(["export-jianying", "--draft-root", drafts, "--approved"]);
  assert.equal(first.code, 1, first.stdout);
  assert.equal(first.result.error.code, "export_partial");
  assert.deepEqual(first.result.error.retry.slice(0, 4), [
    "export-jianying",
    "--draft-root",
    drafts,
    "--approved",
  ]);
  assert.equal(
    seen.some((rpc) => rpc.method === "jianying_roots_touch"),
    false,
  );
  const staged = first.result.projects.find((p) => p.status === "partial");
  assert.match(staged.dir, /^\.测试剧_EP0\d_\d{8}_\d{6}\.partial$/);
  assert.equal(staged.absoluteDir, path.join(drafts, staged.dir));
  assert.equal((await fs.readdir(staged.absoluteDir)).includes("draft_meta_info.json"), false);

  cdn.fail.clear();
  const retry = await f.cli(first.result.error.retry);
  assert.equal(retry.code, 0, retry.stdout);
  assert.ok(retry.result.projects.every((p) => p.status === "ok" && p.resumed));
  assert.equal(seen.filter((rpc) => rpc.method === "jianying_roots_touch").length, 1);
  assert.equal(
    (await fs.readdir(drafts)).some((name) => name.endsWith(".partial")),
    false,
  );
});

test("续传的暂存目录里被放了指向外面的 assets 链接：draft_root_boundary（退出码 2），一个字节都不写到外面", async (t) => {
  const { f, cdn, root } = await setup(t);
  const drafts = await draftFolder(root);
  cdn.fail.set(pathOf(2), 503);
  const first = await f.cli([
    "export-jianying",
    "--draft-root",
    drafts,
    "--approved",
    "--episode",
    "EP02",
  ]);
  const staged = first.result.projects[0].absoluteDir;
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.rm(path.join(staged, "assets"), { recursive: true });
  await fs.symlink(outside, path.join(staged, "assets"), "junction");
  cdn.fail.clear();
  const retry = await f.cli(first.result.error.retry);
  assert.equal(retry.code, 2, retry.stdout);
  assert.equal(retry.result.error.code, "draft_root_boundary");
  assert.match(retry.result.error.path, /^\.测试剧_EP02_\d{8}_\d{6}\.partial\/assets$/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("登记失败只是提醒：工程照样写好（ok），remembered 说没记上；页面太旧读不到登记表时，没 --approved 回 bridge_missing，有就照导；其余读不到（worker_forbidden 等）带 --approved 也原样回、不写", async (t) => {
  const { f, seen, page, root } = await setup(t);
  const drafts = await draftFolder(root);
  page.roots = [{ path: drafts }];
  page.replies.jianying_roots_touch = {
    ok: false,
    error: {
      code: "unauthorized",
      message: "The page's sign-in expired; sign in again on the page",
    },
  };
  const run = await f.cli(["export-jianying", "--draft-root", drafts, "--episode", "EP01"]);
  assert.equal(run.code, 0, run.stdout);
  assert.equal(run.result.ok, true);
  assert.deepEqual(run.result.remembered, { ok: false, code: "unauthorized" });
  assert.ok(run.result.warnings.some((line) => /没能把这个剪映草稿目录记进用户设置/.test(line)));

  page.replies.jianying_roots_list = {
    ok: false,
    error: { code: "method_not_allowed", message: "Unknown canvas method" },
  };
  seen.length = 0;
  const old = await f.cli(["export-jianying", "--draft-root", drafts, "--episode", "EP02"]);
  assert.equal(old.code, 1, old.stdout);
  assert.equal(old.result.error.code, "bridge_missing");
  assert.deepEqual(methods(seen), ["jianying_roots_list"]);
  const approved = await f.cli([
    "export-jianying",
    "--draft-root",
    drafts,
    "--episode",
    "EP02",
    "--approved",
  ]);
  assert.equal(approved.code, 0, approved.stdout);
  assert.equal(Object.hasOwn(approved.result, "draftRootRegistered"), false);

  // 只有「页面太旧」能凭 --approved 放行：别的读不到（身份被拒、登录过期、服务端不可用）核对不了白名单，
  // 带 --approved 也不导 —— 原样回页面的错误，不要时间线、不下载、草稿目录里一个文件都不多。
  for (const code of ["worker_forbidden", "jianying_roots_unavailable", "unauthorized"]) {
    page.replies.jianying_roots_list = {
      ok: false,
      error: { code, message: `list failed: ${code}` },
    };
    seen.length = 0;
    const before = (await fs.readdir(drafts)).sort();
    const refused = await f.cli([
      "export-jianying",
      "--draft-root",
      drafts,
      "--episode",
      "EP01",
      "--approved",
    ]);
    assert.notEqual(refused.code, 0, refused.stdout);
    assert.equal(refused.result.ok, false, code);
    assert.equal(refused.result.error.code, code);
    assert.deepEqual(methods(seen), ["jianying_roots_list"], code);
    assert.deepEqual((await fs.readdir(drafts)).sort(), before, code);
  }
});

/* ── 进程内：纯函数与本机检查 ─────────────────────────────────────────────── */

test("refuseDraftRoot 的 Windows 规则（任何系统上都测得到）：盘根、UNC 共享根、家目录及上级、系统目录；剪映默认位置放行", () => {
  const win = {
    platform: "win32",
    home: "C:\\Users\\alice",
    env: { ProgramData: "D:\\ProgramData" },
  };
  const reason = (abs, ctx = win) => refuseDraftRoot(abs, ctx)?.reason ?? null;
  assert.equal(reason("C:\\"), "drive_root");
  assert.equal(reason("d:/"), "drive_root");
  assert.equal(reason("\\\\nas\\share"), "drive_root");
  assert.equal(reason("C:\\Users"), "home_dir");
  assert.equal(reason("c:\\users\\ALICE"), "home_dir");
  assert.equal(reason("C:\\Windows\\Temp\\drafts"), "system_dir");
  assert.equal(reason("C:\\Program Files (x86)\\JianyingPro"), "system_dir");
  assert.equal(reason("D:\\ProgramData\\x"), "system_dir");
  assert.equal(
    reason(
      "C:\\Users\\alice\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft",
    ),
    null,
  );
  assert.equal(reason("D:\\剪映 草稿"), null);
  assert.equal(reason("\\\\nas\\share\\剪映"), null);
  const mac = { platform: "darwin", home: "/Users/alice", env: {} };
  assert.equal(reason("/Volumes/SSD", mac), "drive_root");
  assert.equal(reason("/Volumes/SSD/剪映草稿", mac), null);
  assert.equal(reason("/Users", mac), "home_dir");
  assert.equal(reason("/Library/Caches/x", mac), "system_dir");
  assert.equal(
    reason("/Users/alice/Movies/JianyingPro/User Data/Projects/com.lveditor.draft", mac),
    null,
  );
});

test("onThisPlatform：只认这台机器形状的绝对路径（设备路径 \\\\?\\ 不认）", () => {
  assert.equal(onThisPlatform("D:\\x", "win32"), true);
  assert.equal(onThisPlatform("d:/x", "win32"), true);
  assert.equal(onThisPlatform("\\\\nas\\share\\x", "win32"), true);
  assert.equal(onThisPlatform("\\\\?\\C:\\x", "win32"), false);
  assert.equal(onThisPlatform("\\\\.\\PhysicalDrive0", "win32"), false);
  assert.equal(onThisPlatform("/Users/x", "win32"), false);
  assert.equal(onThisPlatform("/Users/x", "darwin"), true);
  assert.equal(onThisPlatform("C:\\x", "linux"), false);
});

test("resolveDraftRoot 回的是真实路径；结尾分隔符去掉；exportOptions 收 --draft-root 并去空白", async (t) => {
  const base = await fs.realpath(await scratchDir("draft-root-resolve-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const dir = path.join(base, "剪映 草稿");
  await fs.mkdir(dir);
  const env = { platform: process.platform, home: "/nonexistent-home", env: {} };
  assert.equal(await resolveDraftRoot(`${dir}/`, env), dir);
  assert.equal(await resolveDraftRoot(`  ${dir}  `, env), dir);
  assert.deepEqual(
    {
      draftRoot: exportOptions({ "draft-root": `  ${dir} ` }).draftRoot,
      approved: exportOptions({ "draft-root": dir, approved: true }).approved,
    },
    { draftRoot: dir, approved: true },
  );
});

test("probeDraftRoot / formatRootsTable：空目录不像草稿根；剪映的索引或已有草稿才算；表里写清楚为什么不能用", async (t) => {
  const base = await fs.realpath(await scratchDir("draft-root-probe-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const env = { platform: process.platform, home: "/nonexistent-home", env: {} };
  const empty = path.join(base, "空");
  await fs.mkdir(empty);
  assert.deepEqual(await probeDraftRoot(empty, env), {
    exists: true,
    looksLikeDraftRoot: false,
    rootMetaInfo: false,
    drafts: 0,
    usable: true,
  });
  const indexed = await draftFolder(base, "有索引");
  assert.equal((await probeDraftRoot(indexed, env)).looksLikeDraftRoot, true);
  assert.deepEqual(await probeDraftRoot("/usr", env), {
    exists: true,
    looksLikeDraftRoot: false,
    rootMetaInfo: false,
    drafts: 0,
    usable: false,
    reason: "system_dir",
  });
  const table = formatRootsTable([
    {
      path: "/a",
      label: "家里",
      lastUsedAt: "2026-09-24T00:00:00.000Z",
      exists: true,
      looksLikeDraftRoot: true,
      drafts: 3,
      usable: true,
    },
    {
      path: "/usr",
      lastUsedAt: null,
      exists: true,
      looksLikeDraftRoot: false,
      usable: false,
      reason: "system_dir",
    },
    {
      path: "D:\\x",
      lastUsedAt: null,
      exists: false,
      looksLikeDraftRoot: false,
      usable: false,
      reason: "other_platform",
    },
  ]);
  const lines = table.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[1], /家里\s+yes\s+yes \(3 drafts\)\s+yes\s+\/a$/);
  assert.match(lines[2], /no \(system_dir\)\s+\/usr$/);
  assert.match(lines[3], /no \(other_platform\)\s+-\s+-\s+D:\\x$/);
});
