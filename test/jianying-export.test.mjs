import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cli, fixture } from "./helpers.mjs";
import { mp4 } from "./mp4-fixture.mjs";

/* oxlint-disable eslint/no-await-in-loop -- 测试逐个工程、逐个文件按顺序核对，串行是有意的 */

/**
 * `export-jianying` 端到端：真的 CLI 进程 + 真的守护进程 + 假页面（只回 `timeline_export`）
 * + 本地假 CDN（`SCENEMINT_CANVAS_TEST_MEDIA_ORIGIN`，只在 NODE_ENV=test 时生效；白名单照旧按
 * 原地址 `https://cdn.echojoy.cn/...` 判）。一次导出之后逐项核对 workspace 里的文件树与草稿 JSON。
 */

const DAY = "2026-09-23";
const fileId = (n) => `3f2a3a51-1111-4222-8333-${String(n).padStart(12, "0")}`;
const srcOf = (n) => `https://cdn.echojoy.cn/files/${DAY}/${fileId(n)}.mp4`;
const pathOf = (n) => `/files/${DAY}/${fileId(n)}.mp4`;

function clip(id, title, file, extra = {}) {
  return { id, sourceId: `node-${id}`, title, src: srcOf(file), inMs: 0, outMs: null, ...extra };
}

const MEDIA = {
  1: mp4({ mdatBytes: 3000 }),
  2: mp4({ width: 1920, height: 1080, mdatBytes: 5000 }),
  3: mp4({ mdatBytes: 7000 }),
};

/** 本地假 CDN：GET / HEAD / Range 0-0，按路径计数；`fail` 里的路径回指定状态码。 */
async function startCdn(t, files = MEDIA) {
  const hits = [];
  const fail = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://cdn.test");
    hits.push({ method: req.method, path: url.pathname, range: req.headers.range ?? null });
    const status = fail.get(url.pathname);
    if (status) {
      res.writeHead(status, { "Content-Type": "text/plain" });
      res.end(req.method === "HEAD" ? undefined : "nope");
      return;
    }
    const n = Object.keys(files).find((key) => pathOf(key) === url.pathname);
    if (n === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    const body = files[n];
    if (req.headers.range === "bytes=0-0") {
      res.writeHead(206, { "Content-Range": `bytes 0-0/${body.length}`, "Content-Length": "1" });
      res.end(body.subarray(0, 1));
      return;
    }
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(body.length) });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const count = (method, n) =>
    hits.filter((hit) => hit.method === method && hit.path === pathOf(n)).length;
  return { origin: `http://127.0.0.1:${server.address().port}`, hits, fail, count };
}

const TIMELINE = {
  ok: true,
  canvasId: "canvas-a",
  title: "测试剧",
  revision: "t5-abc",
  clips: [
    clip("a", "ep01 镜1", 1, {
      inMs: 500,
      outMs: 3500,
      transitionOut: { type: "dissolve", durationMs: 400 },
      subtitles: [{ text: "你回来了", startMs: 600, endMs: 2000, role: "白妍" }],
    }),
    clip("b", "ep01 镜2", 2, { volume: 0.5 }),
    clip("c", "ep01 镜3", 1, { inMs: 1000, outMs: 2000 }),
    clip("d", "ep02 镜1", 2),
    clip("e", "片尾", 3),
  ],
};

/** 配好的一套：会话 + 已配对的假页面 + 假 CDN。 */
async function setup(t, { timeline = TIMELINE, reply } = {}) {
  const f = await fixture(t);
  const cdn = await startCdn(t);
  f.env.SCENEMINT_CANVAS_TEST_MEDIA_ORIGIN = cdn.origin;
  f.env.SCENEMINT_CANVAS_TEST_BACKOFF_MS = "0";
  await f.pair();
  const seen = [];
  const pump = await f.pump((rpc) => {
    seen.push(rpc);
    if (rpc.method === "timeline_export") return reply ?? timeline;
    return { ok: true };
  });
  t.after(() => pump.stop());
  const workspace = await fs.realpath(f.workspace);
  const outAbs = path.join(workspace, "产出", "剪映工程");
  return { f, cdn, seen, workspace, outAbs };
}

const DRAFT_FILES = [
  "attachment_pc_common.json",
  "draft_agency_config.json",
  "draft_biz_config.json",
  "draft_content.json",
  "draft_info.json",
  "draft_info.json.bak",
  "draft_meta_info.json",
  "draft_settings",
  "template-2.tmp",
  "template.tmp",
];

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

test("按集导出：每集一个完整工程写进 产出/剪映工程/，素材整段、跨工程只下一遍，草稿按目标目录的绝对路径引用", async (t) => {
  const { f, cdn, seen, workspace, outAbs } = await setup(t);
  const run = await f.cli(["export-jianying"]);
  assert.equal(run.code, 0, run.stdout);
  const result = run.result;
  assert.equal(result.ok, true);
  assert.equal(result.layout, "episodes");
  assert.equal(result.outDir, "产出/剪映工程");
  assert.equal(result.draftRoot, outAbs);
  assert.match(result.note, /不代表剪映一定能打开/);
  // 交给剪映的首选改成直写（拍板 A6）：jianying-roots 选 / 给路径后加 --draft-root 重导，素材不重下；
  // 不再教用户把剪映的全局草稿位置改成 workspace。不要移动工程目录（素材按绝对路径引用，移走就离线）。
  assert.match(result.note, /首选.*jianying-roots.*--draft-root/);
  assert.doesNotMatch(result.note, /草稿位置设成/);
  assert.match(result.note, /不要移动工程目录.*素材离线/);
  // 页面只被问了一次时间线，而且是只读的那个方法、没有任何参数。
  assert.deepEqual(
    seen.map((rpc) => [rpc.method, rpc.params]),
    [["timeline_export", {}]],
  );

  const [ep01, ep02, other] = result.projects;
  assert.deepEqual(
    result.projects.map((p) => [p.episode, p.clips, p.assets, p.status]),
    [
      ["EP01", 3, 2, "ok"],
      ["EP02", 1, 1, "ok"],
      ["其他", 1, 1, "ok"],
    ],
  );
  assert.match(ep01.name, /^测试剧_EP01_\d{8}_\d{6}$/);
  assert.match(ep02.name, /^测试剧_EP02_\d{8}_\d{6}$/);
  assert.match(other.name, /^测试剧_其他_\d{8}_\d{6}$/);
  assert.equal(ep01.dir, `产出/剪映工程/${ep01.name}`);
  assert.equal(ep01.absoluteDir, path.join(outAbs, ep01.name));
  assert.equal(ep01.bytes, MEDIA[1].length + MEDIA[2].length);
  assert.equal(ep01.durationMs, 3000 + 5000 + 1000);

  // 素材：同一个文件只下了一遍（EP01 用了 1、2，EP02 也用 2），而且没有多余的 HEAD。
  assert.deepEqual(
    [1, 2, 3].map((n) => cdn.count("GET", n)),
    [1, 1, 1],
  );
  assert.equal(cdn.hits.filter((hit) => hit.method === "HEAD").length, 0);
  assert.equal(result.downloadedBytes, MEDIA[1].length + MEDIA[2].length + MEDIA[3].length);
  assert.equal(result.reusedBytes, 0);

  // 每个工程目录：10 个草稿文件 + assets/video；没有残留的暂存目录 / 续传标记 / .part。
  assert.deepEqual((await fs.readdir(outAbs)).sort(), [ep01.name, ep02.name, other.name].sort());
  for (const project of result.projects) {
    const dir = path.join(outAbs, project.name);
    assert.deepEqual((await fs.readdir(dir)).sort(), [...DRAFT_FILES, "assets"].sort());
    for (const name of await fs.readdir(path.join(dir, "assets", "video")))
      assert.match(name, /^\d{3}_[0-9a-f]{8}\.mp4$/);
  }
  const ep01Video = path.join(outAbs, ep01.name, "assets", "video");
  const ep02Video = path.join(outAbs, ep02.name, "assets", "video");
  const ep01Assets = (await fs.readdir(ep01Video)).sort();
  const ep02Assets = await fs.readdir(ep02Video);
  assert.equal(ep01Assets.length, 2);
  assert.deepEqual(await fs.readFile(path.join(ep01Video, ep01Assets[0])), MEDIA[1]);
  assert.deepEqual(await fs.readFile(path.join(ep01Video, ep01Assets[1])), MEDIA[2]);
  // 跨工程同一个素材：同一个摘要（文件名去掉序号那部分），而且是硬链接（不占第二份磁盘）。
  assert.equal(ep02Assets[0].slice(3), ep01Assets[1].slice(3));
  const [s1, s2] = await Promise.all([
    fs.stat(path.join(ep01Video, ep01Assets[1])),
    fs.stat(path.join(ep02Video, ep02Assets[0])),
  ]);
  assert.equal(s1.ino, s2.ino);

  // 草稿：素材路径 = 目标目录的绝对路径，且真的指向盘上那个文件；片段只记入出点。
  const draft = await readJson(path.join(outAbs, ep01.name, "draft_content.json"));
  assert.equal(
    await fs.readFile(path.join(outAbs, ep01.name, "draft_info.json"), "utf8"),
    await fs.readFile(path.join(outAbs, ep01.name, "draft_content.json"), "utf8"),
  );
  for (const video of draft.materials.videos) {
    assert.equal(video.path, path.join(outAbs, ep01.name, "assets", "video", video.material_name));
    assert.equal((await fs.stat(video.path)).isFile(), true);
    assert.equal(video.duration, 5_000_000); // 源文件全长，不是裁剪后长度：剪映里能拉回整段
  }
  const [segA, segB, segC] = draft.tracks[0].segments;
  assert.deepEqual(segA.source_timerange, { start: 500_000, duration: 3_000_000 });
  assert.deepEqual(segB.source_timerange, { start: 0, duration: 5_000_000 });
  assert.deepEqual(segC.source_timerange, { start: 1_000_000, duration: 1_000_000 });
  assert.equal(segB.volume, 0.5);
  assert.equal(segA.volume, 1);
  // 转场：片段上有才写，挂在前一段的 extra_material_refs 上。
  assert.equal(draft.materials.transitions.length, 1);
  assert.equal(draft.materials.transitions[0].name, "叠化");
  assert.equal(draft.materials.transitions[0].duration, 400_000);
  assert.ok(segA.extra_material_refs.includes(draft.materials.transitions[0].id));
  // 字幕轨：按入出点截取、换到时间轨时间（源 600ms → 轨上 100ms）。
  const textTrack = draft.tracks.find((track) => track.type === "text");
  assert.ok(textTrack);
  assert.deepEqual(textTrack.segments[0].target_timerange, { duration: 1_400_000, start: 100_000 });
  assert.equal(draft.materials.texts.length, 1);
  // 画布尺寸按素材实测（EP01 两个 1080×1920、一个 1920×1080 → 众数竖屏）。
  assert.deepEqual(draft.canvas_config, { height: 1920, ratio: "original", width: 1080 });

  const meta = await readJson(path.join(outAbs, ep01.name, "draft_meta_info.json"));
  assert.equal(meta.draft_fold_path, path.join(outAbs, ep01.name));
  assert.equal(meta.draft_root_path, outAbs);
  assert.equal(meta.draft_name, ep01.name);
  // oxlint-disable-next-line eslint/no-underscore-dangle -- 结尾下划线是剪映自己的键名
  assert.equal(meta.draft_timeline_materials_size_, MEDIA[1].length + MEDIA[2].length);

  // 没有转场、没有字幕的工程：transitions 为空、没有文本轨（与浏览器导出同一份逻辑）。
  const plain = await readJson(path.join(outAbs, ep02.name, "draft_content.json"));
  assert.deepEqual(plain.materials.transitions, []);
  assert.equal(plain.tracks.length, 1);
  assert.equal(path.relative(workspace, outAbs), path.join("产出", "剪映工程"));
});

test("重跑：out-dir 里已有且字节数与远端一致的素材直接复用（HEAD 核对），一个字节都不重下", async (t) => {
  const { f, cdn, outAbs } = await setup(t);
  assert.equal((await f.cli(["export-jianying"])).code, 0);
  // 换个剧名再导一次（时间戳到秒，同名目录会被当成冲突；这里要测的是复用）。
  const again = await f.cli(["export-jianying", "--name", "测试剧·二版"]);
  assert.equal(again.code, 0, again.stdout);
  assert.deepEqual(
    [1, 2, 3].map((n) => cdn.count("GET", n)),
    [1, 1, 1],
  );
  assert.ok(cdn.hits.some((hit) => hit.method === "HEAD"));
  assert.equal(again.result.downloadedBytes, 0);
  assert.equal(again.result.reusedBytes, MEDIA[1].length + MEDIA[2].length + MEDIA[3].length);
  assert.equal((await fs.readdir(outAbs)).length, 6);
});

test("下载最终失败：其余工程照常写好，受影响的工程标 partial 并列出 nodeId；按回包的 retry 重跑接着下，不重下已有的", async (t) => {
  const { f, cdn, outAbs } = await setup(t);
  cdn.fail.set(pathOf(2), 503);
  const first = await f.cli(["export-jianying"]);
  assert.equal(first.code, 1, first.stdout);
  const result = first.result;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "export_partial");
  assert.deepEqual(result.error.failedNodeIds.sort(), ["node-b", "node-d"]);
  assert.deepEqual(result.error.retry, [
    "export-jianying",
    "--layout",
    "episodes",
    "--episode",
    "EP01",
    "--episode",
    "EP02",
  ]);
  // 5xx 按页面的重试策略试满 3 次。
  assert.equal(cdn.count("GET", 2), 3);
  const byEpisode = Object.fromEntries(result.projects.map((p) => [p.episode, p]));
  assert.equal(byEpisode["其他"].status, "ok");
  assert.equal(byEpisode.EP01.status, "partial");
  assert.equal(byEpisode.EP02.status, "partial");
  assert.deepEqual(byEpisode.EP01.failedNodeIds, ["node-b"]);
  assert.equal(byEpisode.EP01.errors[0].code, "download_failed");
  assert.match(byEpisode.EP01.dir, /^产出\/剪映工程\/\.测试剧_EP01_\d{8}_\d{6}\.partial$/);
  // 未完成的工程留在 .partial 暂存目录里：剪映看不到它（没有 draft_meta_info.json）。
  const staged = path.join(outAbs, path.basename(byEpisode.EP01.dir));
  assert.equal((await fs.readdir(staged)).includes("draft_meta_info.json"), false);
  assert.equal((await fs.readdir(path.join(staged, "assets", "video"))).length, 1);

  cdn.fail.clear();
  const retry = await f.cli(result.error.retry);
  assert.equal(retry.code, 0, retry.stdout);
  assert.deepEqual(
    retry.result.projects.map((p) => [p.episode, p.status, p.resumed ?? false]),
    [
      ["EP01", "ok", true],
      ["EP02", "ok", true],
    ],
  );
  // 素材 1 在上一次就下好了（复用），素材 2 这次才真正下下来（一次）。
  assert.equal(cdn.count("GET", 1), 1);
  assert.equal(cdn.count("GET", 2), 3 + 1);
  const entries = await fs.readdir(outAbs);
  assert.equal(
    entries.some((name) => name.endsWith(".partial")),
    false,
  );
  assert.equal(entries.filter((name) => name.includes("_其他_")).length, 1);
  assert.equal(entries.length, 3);
  for (const project of retry.result.projects) {
    const dir = path.join(outAbs, project.name);
    assert.deepEqual((await fs.readdir(dir)).sort(), [...DRAFT_FILES, "assets"].sort());
    const draft = await readJson(path.join(dir, "draft_content.json"));
    for (const video of draft.materials.videos) assert.equal(video.path.startsWith(dir), true);
  }
});

test("--dry-run：只出计划（工程数、每工程段数、素材总字节、目标目录），不建目录、不下载", async (t) => {
  const { f, cdn, outAbs } = await setup(t);
  const plan = await f.cli(["export-jianying", "--dry-run"]);
  assert.equal(plan.code, 0, plan.stdout);
  const result = plan.result;
  assert.equal(result.dryRun, true);
  assert.equal(result.projectCount, 3);
  assert.deepEqual(
    result.projects.map((p) => [p.episode, p.clips, p.assets, p.bytes, p.exists]),
    [
      ["EP01", 3, 2, MEDIA[1].length + MEDIA[2].length, false],
      ["EP02", 1, 1, MEDIA[2].length, false],
      ["其他", 1, 1, MEDIA[3].length, false],
    ],
  );
  assert.match(result.projects[0].dir, /^产出\/剪映工程\/测试剧_EP01_\d{8}_\d{6}$/);
  const total = MEDIA[1].length + MEDIA[2].length + MEDIA[3].length;
  assert.equal(result.totalBytes, total);
  assert.equal(result.downloadBytes, total);
  assert.equal(result.reusableBytes, 0);
  assert.equal(cdn.hits.filter((hit) => hit.method === "GET").length, 0);
  await assert.rejects(fs.stat(path.dirname(outAbs)), { code: "ENOENT" });
});

test("预检闸与页面导出同一份：不受信任的主机、转场放不下、单工程超 200 段、空时间线 —— 一个字节都不下、一个目录都不建", async (t) => {
  const cases = [
    [
      {
        ...TIMELINE,
        clips: [{ ...TIMELINE.clips[0], src: "https://evil.example.com/files/x.mp4" }],
      },
      "untrusted-host",
    ],
    [
      {
        ...TIMELINE,
        clips: [
          clip("a", "ep01 a", 1, {
            inMs: 0,
            outMs: 300,
            transitionOut: { type: "dissolve", durationMs: 400 },
          }),
          clip("b", "ep01 b", 2),
        ],
      },
      "invalid-transition",
    ],
    [
      {
        ...TIMELINE,
        clips: [
          clip("a", "ep01 a", 1, { transitionOut: { type: "wipe", durationMs: 300 } }),
          clip("b", "ep01 b", 2),
        ],
      },
      "invalid-transition",
    ],
    [
      { ...TIMELINE, clips: Array.from({ length: 201 }, (_, i) => clip(`c${i}`, `ep01 ${i}`, 1)) },
      "too-many-clips",
    ],
    [
      {
        ...TIMELINE,
        clips: [clip("a", "ep01 a", 1, { audioUrl: "https://cdn.echojoy.cn/x.mp3" })],
      },
      "separate-audio",
    ],
  ];
  for (const [timeline, reason] of cases) {
    const { f, cdn, outAbs } = await setup(t, { timeline });
    const run = await f.cli(["export-jianying"]);
    assert.equal(run.code, 1, `${reason}: ${run.stdout}`);
    assert.equal(run.result.error.code, "jianying_refused");
    assert.equal(run.result.error.reason, reason);
    assert.ok(run.result.error.message.length > 0);
    assert.equal(cdn.hits.length, 0);
    await assert.rejects(fs.stat(outAbs), { code: "ENOENT" });
  }
  const { f } = await setup(t, { timeline: { ...TIMELINE, clips: [] } });
  const empty = await f.cli(["export-jianying"]);
  assert.equal(empty.result.error.code, "jianying_refused");
  assert.equal(empty.result.error.reason, "empty-timeline");
});

test("参数与 workspace 边界：错集名 / 不存在的集 / 错布局是参数错误（退出码 2）；--out-dir 出不了 workspace", async (t) => {
  const { f, cdn, workspace } = await setup(t);
  const missing = await f.cli(["export-jianying", "--episode", "EP09"]);
  assert.equal(missing.code, 2);
  assert.equal(missing.result.error.code, "invalid_argument");
  assert.match(missing.result.error.message, /EP01、EP02、其他/);
  for (const [args, code] of [
    [["--episode", "第一集"], "invalid_argument"],
    [["--episode", "all", "--episode", "EP01"], "invalid_argument"],
    [["--layout", "both"], "invalid_argument"],
    [["--name", "  "], "invalid_argument"],
    [["--out-dir", "../outside"], "workspace_boundary"],
    [["--out-dir", "/tmp/elsewhere"], "workspace_boundary"],
    [["--out-dir", "."], "workspace_boundary"],
  ]) {
    const run = await f.cli(["export-jianying", ...args]);
    assert.equal(run.code, 2, `${args.join(" ")}: ${run.stdout}`);
    assert.equal(run.result.error.code, code, args.join(" "));
  }
  await fs.mkdir(path.join(workspace, "real"));
  await fs.symlink(path.join(workspace, "real"), path.join(workspace, "linked"));
  const linked = await f.cli(["export-jianying", "--out-dir", "linked/剪映"]);
  assert.equal(linked.result.error.code, "workspace_boundary");
  assert.equal(cdn.hits.filter((hit) => hit.method === "GET").length, 0);
  // 覆盖同名目录沿用 CLI 的 --overwrite；没有 --force 这个开关（名字最近的会被点出来）。
  const force = await f.cli(["export-jianying", "--force"]);
  assert.equal(force.code, 2);
  assert.equal(force.result.error.code, "invalid_argument");
});

test("--episode 与 --layout：指名一集就按集命名（「其他」一组叫 _其他_），显式 single 则不带集标签", async (t) => {
  const { f } = await setup(t);
  const other = await f.cli(["export-jianying", "--episode", "其他"]);
  assert.equal(other.code, 0, other.stdout);
  assert.deepEqual(
    other.result.projects.map((p) => [p.episode, p.clips]),
    [["其他", 1]],
  );
  assert.match(other.result.projects[0].name, /^测试剧_其他_\d{8}_\d{6}$/);
  const two = await f.cli([
    "export-jianying",
    "--episode",
    "ep2,1",
    "--layout",
    "single",
    "--name",
    "合集",
  ]);
  assert.equal(two.code, 0, two.stdout);
  assert.equal(two.result.layout, "single");
  assert.deepEqual(
    two.result.projects.map((p) => [p.episode, p.clips]),
    [[null, 4]],
  );
  assert.match(two.result.projects[0].name, /^合集_\d{8}_\d{6}$/);
});

test("worker 也能导（只读画布 + 写自己的 workspace），产物落在 worker 自己的 workspace 里", async (t) => {
  const { f, workspace } = await setup(t);
  const workerWorkspace = path.join(f.root, randomUUID());
  await fs.mkdir(workerWorkspace);
  const made = await f.cli(["delegate", "--name", "Worker", "--workspace", workerWorkspace]);
  assert.equal(made.code, 0, made.stdout);
  const run = await cli(["export-jianying", "--session", made.result.sessionId], f.env);
  assert.equal(run.code, 0, run.stdout);
  assert.equal(run.result.ok, true);
  const workerOut = path.join(await fs.realpath(workerWorkspace), "产出", "剪映工程");
  assert.equal((await fs.readdir(workerOut)).length, 3);
  await assert.rejects(fs.stat(path.join(workspace, "产出")), { code: "ENOENT" });
});

test("老页面没有 timeline_export：说清楚要刷新页面（bridge_missing），而不是导出一个空工程", async (t) => {
  const { f, outAbs } = await setup(t, {
    reply: { ok: false, error: { code: "method_not_allowed", message: "Unknown canvas method" } },
  });
  const run = await f.cli(["export-jianying"]);
  assert.equal(run.code, 1);
  assert.equal(run.result.error.code, "bridge_missing");
  assert.match(run.result.error.message, /刷新/);
  await assert.rejects(fs.stat(outAbs), { code: "ENOENT" });
});

test("续传的暂存目录里被放了指向 workspace 外的 assets 链接：按 retry 重跑报 workspace_boundary（退出码 2、ok:false），素材一个字节都不写到外面", async (t) => {
  const { f, cdn, outAbs } = await setup(t);
  cdn.fail.set(pathOf(3), 503);
  const first = await f.cli(["export-jianying", "--episode", "其他"]);
  assert.equal(first.result.projects[0].status, "partial", first.stdout);
  const staged = path.join(outAbs, path.basename(first.result.projects[0].dir));
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.rm(path.join(staged, "assets"), { recursive: true });
  await fs.symlink(outside, path.join(staged, "assets"), "junction");

  cdn.fail.clear();
  const retry = await f.cli(first.result.error.retry);
  assert.equal(retry.code, 2, retry.stdout);
  assert.equal(retry.result.ok, false);
  assert.equal(retry.result.error.code, "workspace_boundary");
  assert.match(
    retry.result.error.path,
    /^产出\/剪映工程\/\.测试剧_其他_\d{8}_\d{6}\.partial\/assets$/,
  );
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(cdn.count("GET", 3), 3, "只有第一次的 3 次失败请求，重跑一个字节都没下");
});

test("几个工程共用的素材是硬链接（链接数 > 1）：CLI 自己的 upload 按安全规则拒收（workspace_boundary）；只有一个工程用的素材是普通文件，照常能传", async (t) => {
  const { f, outAbs } = await setup(t);
  const run = await f.cli(["export-jianying"]);
  assert.equal(run.code, 0, run.stdout);
  const [ep01, ep02] = run.result.projects;
  const ep01Video = path.join(outAbs, ep01.name, "assets", "video");
  // EP01 的 001 是素材 1（只有 EP01 用），002 是素材 2（EP02 也用，硬链接过去的）。
  const [single, shared] = (await fs.readdir(ep01Video)).sort();
  assert.equal((await fs.stat(path.join(ep01Video, shared))).nlink, 2);
  assert.equal((await fs.stat(path.join(ep01Video, single))).nlink, 1);

  const rel = (name) => `产出/剪映工程/${ep01.name}/assets/video/${name}`;
  const refused = await f.cli(["upload", rel(shared)]);
  assert.equal(refused.code, 2, refused.stdout);
  assert.equal(refused.result.error.code, "workspace_boundary");
  assert.match(refused.result.error.message, /independent regular file/);
  // EP02 里的那一份是同一个文件，同样拒收。
  const ep02Asset = (await fs.readdir(path.join(outAbs, ep02.name, "assets", "video")))[0];
  const refusedToo = await f.cli([
    "upload",
    `产出/剪映工程/${ep02.name}/assets/video/${ep02Asset}`,
  ]);
  assert.equal(refusedToo.result.error.code, "workspace_boundary");
  const accepted = await f.cli(["upload", rel(single)]);
  assert.equal(accepted.code, 0, accepted.stdout);
});
