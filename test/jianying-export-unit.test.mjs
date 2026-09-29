import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultExportDeps,
  exportOptions,
  normalizeEpisode,
  runExportJianying,
} from "../src/jianying/export.mjs";
import { mp4 } from "./mp4-fixture.mjs";

/**
 * `export-jianying` 的进程内测试：注入假 fetch / 固定时间，把进程级测试不好造的情形逐个钉住
 * （同一秒重跑的目录冲突、重定向、卡住的下载、截断、探针失败、续传清理……）。
 */

const DAY = "2026-09-23";
const fileId = (n) => `3f2a3a51-1111-4222-8333-${String(n).padStart(12, "0")}`;
const urlOf = (n, host = "cdn.echojoy.cn") => `https://${host}/files/${DAY}/${fileId(n)}.mp4`;
const NOW = new Date(2026, 8, 23, 10, 15, 0);

async function workspace(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "jianying-export-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** 假 CDN：`routes[url] = Buffer | (init) => Response`。记下每个请求。 */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    const route = routes[url];
    if (typeof route === "function") return route(init);
    if (!route) return new Response("missing", { status: 404 });
    return new Response(init.method === "HEAD" ? null : route, {
      status: 200,
      headers: { "content-length": String(route.length) },
    });
  };
  return {
    fetch,
    calls,
    count: (url, method = "GET") =>
      calls.filter((c) => c.url === url && c.method === method).length,
  };
}

function deps(fetch, extra = {}) {
  return {
    ...defaultExportDeps(),
    fetch,
    rewrite: (url) => url,
    backoff: () => 0,
    sleep: async () => {},
    now: () => NOW,
    ...extra,
  };
}

const clip = (id, title, n, extra = {}) => ({
  id,
  sourceId: `node-${id}`,
  title,
  src: urlOf(n),
  inMs: 0,
  outMs: null,
  ...extra,
});

const A = mp4({ mdatBytes: 1000 });
const B = mp4({ mdatBytes: 2000 });

async function run(ws, timeline, options = {}, extraDeps) {
  return runExportJianying({
    workspace: ws,
    timeline,
    options: exportOptions(options),
    deps: extraDeps,
  });
}

test("--episode 的写法与 timeline 命令同一套：EP01 / ep1 / 1 / unknown（也认 其他）/ all", () => {
  assert.equal(normalizeEpisode("EP01"), "EP01");
  assert.equal(normalizeEpisode("ep1"), "EP01");
  assert.equal(normalizeEpisode("12"), "EP12");
  assert.equal(normalizeEpisode("007"), "EP07");
  assert.equal(normalizeEpisode("unknown"), "unknown");
  assert.equal(normalizeEpisode("其他"), "unknown");
  assert.equal(normalizeEpisode("ALL"), "all");
  assert.throws(() => normalizeEpisode("第一集"), { code: "invalid_argument" });
  assert.deepEqual(exportOptions({ episode: ["ep1,EP02", "2"] }).episodes, ["EP01", "EP02"]);
  assert.equal(exportOptions({ episode: "all" }).episodes, undefined);
  assert.deepEqual(exportOptions({}), {
    outDir: "产出/剪映工程",
    draftRoot: null,
    approved: false,
    layout: undefined,
    name: undefined,
    episodes: undefined,
    dryRun: false,
    overwrite: false,
  });
});

test("同名工程目录已存在（同一秒重跑）：下载之前就报 file_exists；--overwrite 才写进去，目录里别的文件不动", async (t) => {
  const ws = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A });
  const timeline = { title: "剧", clips: [clip("a", "片子", 1)] };
  const first = await run(ws, timeline, {}, deps(cdn.fetch));
  assert.equal(first.ok, true);
  const dir = first.projects[0].absoluteDir;
  await fs.writeFile(path.join(dir, "我的备注.txt"), "别删");
  await fs.writeFile(path.join(dir, "draft_content.json"), "{}");
  const calls = cdn.calls.length;

  await assert.rejects(run(ws, timeline, {}, deps(cdn.fetch)), (error) => {
    assert.equal(error.code, "file_exists");
    assert.deepEqual(error.extra.dirs, [`产出/剪映工程/${first.projects[0].name}`]);
    return true;
  });
  assert.equal(cdn.calls.length, calls, "冲突在任何请求之前就报");

  const again = await run(ws, timeline, { overwrite: true }, deps(cdn.fetch));
  assert.equal(again.ok, true);
  assert.equal(again.projects[0].overwritten, true);
  assert.equal(await fs.readFile(path.join(dir, "我的备注.txt"), "utf8"), "别删");
  assert.notEqual(await fs.readFile(path.join(dir, "draft_content.json"), "utf8"), "{}");
  // 素材字节数与远端一致：只 HEAD 核对，不重下。
  assert.equal(cdn.count(urlOf(1)), 1);
  assert.equal(again.reusedBytes, A.length);
});

test("重定向：每一跳都过白名单；跳到白名单外的主机当场失败、不重试", async (t) => {
  const ws = await workspace(t);
  const redirect = (location) => () => new Response(null, { status: 302, headers: { location } });
  const cdn = fakeFetch({
    [urlOf(1)]: redirect(urlOf(1, "file.echojoy.cn")),
    [urlOf(1, "file.echojoy.cn")]: A,
    [urlOf(2)]: redirect("https://evil.example.com/steal.mp4"),
  });
  const result = await run(
    ws,
    { title: "剧", clips: [clip("a", "ep01 好的", 1), clip("b", "ep02 坏的", 2)] },
    {},
    deps(cdn.fetch),
  );
  assert.equal(result.ok, false);
  const [good, bad] = result.projects;
  assert.equal(good.status, "ok");
  assert.equal(bad.status, "partial");
  assert.match(bad.errors[0].message, /白名单/);
  assert.equal(cdn.count(urlOf(2)), 1, "白名单拒绝不重试");
  assert.equal(
    cdn.calls.some((c) => c.url.includes("evil.example.com")),
    false,
    "白名单外的地址一个请求都不发",
  );
});

test("重定向从 https 跳到 http（同一个白名单主机）：报「不允许降级到 http」而不是「不在白名单」，不重试，http 地址一个请求都不发", async (t) => {
  const ws = await workspace(t);
  const plain = urlOf(1).replace(/^https:/, "http:");
  const cdn = fakeFetch({
    [urlOf(1)]: () => new Response(null, { status: 302, headers: { location: plain } }),
    [plain]: A,
  });
  const result = await run(ws, { title: "剧", clips: [clip("a", "片子", 1)] }, {}, deps(cdn.fetch));
  assert.equal(result.projects[0].status, "partial");
  const { code, message } = result.projects[0].errors[0];
  assert.equal(code, "download_failed");
  assert.match(message, /不允许降级到 http/);
  assert.doesNotMatch(message, /白名单/);
  assert.equal(cdn.count(urlOf(1)), 1, "不重试");
  assert.equal(cdn.count(plain), 0, "http 地址一个请求都不发");
});

test("4xx 不重试；5xx / 截断按页面的策略重试 3 次后放弃，工程标 partial", async (t) => {
  const ws = await workspace(t);
  const truncated = () =>
    new Response(A.subarray(0, 100), {
      status: 200,
      headers: { "content-length": String(A.length) },
    });
  const cdn = fakeFetch({
    [urlOf(1)]: () => new Response("gone", { status: 404 }),
    [urlOf(2)]: truncated,
  });
  const result = await run(
    ws,
    { title: "剧", clips: [clip("a", "ep01 a", 1), clip("b", "ep02 b", 2)] },
    {},
    deps(cdn.fetch),
  );
  assert.equal(cdn.count(urlOf(1)), 1);
  assert.equal(cdn.count(urlOf(2)), 3);
  assert.deepEqual(
    result.projects.map((p) => [p.status, p.errors?.[0]?.code]),
    [
      ["partial", "download_failed"],
      ["partial", "download_failed"],
    ],
  );
  assert.match(result.projects[1].errors[0].message, /下载不完整/);
  assert.deepEqual(result.error.failedNodeIds.sort(), ["node-a", "node-b"]);
  // 截断的字节没有以正式文件名落地（只有完整的文件才改名）。
  const staged = result.projects[1].absoluteDir;
  assert.deepEqual(await fs.readdir(path.join(staged, "assets", "video")), []);
});

test("下载卡住（一个字节都不来）：到点中断、按重试策略再来，最后如实报 partial", async (t) => {
  const ws = await workspace(t);
  const stalled = (init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      }),
      { status: 200, headers: { "content-length": "999" } },
    );
  const cdn = fakeFetch({ [urlOf(1)]: stalled });
  const result = await run(
    ws,
    { title: "剧", clips: [clip("a", "片子", 1)] },
    {},
    deps(cdn.fetch, { stallMs: 30 }),
  );
  assert.equal(result.projects[0].status, "partial");
  assert.match(result.projects[0].errors[0].message, /没有进展/);
  assert.equal(cdn.count(urlOf(1)), 3);
});

test("视频编码浏览器导出认不出（MPEG-4 Part 2 的 mov）：不阻断，工程照常 ok；warnings 点名这一段，提醒剪映能否播放以真机为准", async (t) => {
  const ws = await workspace(t);
  const mov = `https://cdn.echojoy.cn/files/${DAY}/${fileId(1)}.mov`;
  const cdn = fakeFetch({ [mov]: mp4({ codec: "mp4v", mdatBytes: 1000 }), [urlOf(2)]: B });
  const result = await run(
    ws,
    { title: "剧", clips: [clip("a", "老素材", 1, { src: mov }), clip("b", "新素材", 2)] },
    {},
    deps(cdn.fetch),
  );
  assert.equal(result.ok, true);
  assert.equal(result.projects[0].status, "ok");
  const codecWarnings = result.warnings.filter((warning) => warning.includes("视频编码"));
  assert.equal(codecWarnings.length, 1, "只点名 mp4v 那一段，H.264 的不提");
  assert.match(codecWarnings[0], /片段「老素材」的素材 001_[0-9a-f]{8}\.mov/);
  assert.match(codecWarnings[0], /MPEG-4 Part 2（mp4v）/);
  assert.match(codecWarnings[0], /剪映能否播放以真机为准/);
  // 编码只用来提醒，不进草稿：草稿里的素材照常引用落盘的 .mov。
  const draft = JSON.parse(
    await fs.readFile(path.join(result.projects[0].absoluteDir, "draft_content.json"), "utf8"),
  );
  assert.match(draft.materials.videos[0].path, /001_[0-9a-f]{8}\.mov$/);
});

test("CDN 回了 200 的 HTML：探针失败（probe_failed），不猜一组宽高时长", async (t) => {
  const ws = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: Buffer.from("<!doctype html><title>login</title>") });
  const result = await run(ws, { title: "剧", clips: [clip("a", "片子", 1)] }, {}, deps(cdn.fetch));
  assert.equal(result.projects[0].status, "partial");
  assert.equal(result.projects[0].errors[0].code, "probe_failed");
});

test("探针之后才看得出的毛病（入点超出源视频长度）：这个工程做不出来，别的工程照常", async (t) => {
  const ws = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A, [urlOf(2)]: B });
  const result = await run(
    ws,
    {
      title: "剧",
      clips: [clip("a", "ep01 越界", 1, { inMs: 6000, outMs: 7000 }), clip("b", "ep02 正常", 2)],
    },
    {},
    deps(cdn.fetch),
  );
  const [bad, good] = result.projects;
  assert.equal(good.status, "ok");
  assert.equal(bad.status, "partial");
  assert.deepEqual(bad.failedNodeIds, ["node-a"]);
  assert.equal(bad.errors[0].reason, "clip-out-of-range");
  assert.match(bad.errors[0].message, /超出源视频的长度/);
});

test("续传：接上一次同一个工程的 .partial（换成这次的名字），清掉用不到的旧素材与 .part，发布后不留标记", async (t) => {
  const ws = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A, [urlOf(2)]: () => new Response("x", { status: 503 }) });
  const timeline = { title: "剧", clips: [clip("a", "ep01 a", 1), clip("b", "ep01 b", 2)] };
  const first = await run(ws, timeline, {}, deps(cdn.fetch));
  const staged = first.projects[0].absoluteDir;
  assert.match(path.basename(staged), /^\.剧_EP01_20260923_101500\.partial$/);
  // 上一次留下的：一个这次用不到的旧素材、一个没下完的 .part。
  await fs.writeFile(path.join(staged, "assets", "video", "009_deadbeef.mp4"), "old");
  await fs.writeFile(path.join(staged, "assets", "video", ".002_x.mp4.1234abcd.part"), "half");

  const later = new Date(2026, 8, 23, 11, 0, 0);
  const fixed = fakeFetch({ [urlOf(1)]: A, [urlOf(2)]: B });
  const second = await run(ws, timeline, {}, deps(fixed.fetch, { now: () => later }));
  assert.equal(second.ok, true);
  assert.equal(second.projects[0].resumed, true);
  assert.equal(second.projects[0].name, "剧_EP01_20260923_110000");
  assert.equal(fixed.count(urlOf(1)), 0, "上一次已经下好的不重下");
  assert.equal(fixed.count(urlOf(2)), 1);
  const out = path.join(ws, "产出", "剪映工程");
  assert.deepEqual(await fs.readdir(out), ["剧_EP01_20260923_110000"]);
  const final = path.join(out, "剧_EP01_20260923_110000");
  assert.deepEqual((await fs.readdir(path.join(final, "assets", "video"))).length, 2);
  assert.equal((await fs.readdir(final)).includes(".scenemint-jianying.json"), false);
});

test("文件系统不支持硬链接：退回复制，结果一样，回包提醒多占了一份磁盘", async (t) => {
  const ws = await workspace(t);
  const link = fs.link;
  fs.link = async () => {
    throw Object.assign(new Error("not supported"), { code: "EPERM" });
  };
  t.after(() => {
    fs.link = link;
  });
  const cdn = fakeFetch({ [urlOf(1)]: A });
  const result = await run(
    ws,
    { title: "剧", clips: [clip("a", "ep01 a", 1), clip("b", "ep02 a", 1)] },
    {},
    deps(cdn.fetch),
  );
  assert.equal(result.ok, true);
  assert.equal(cdn.count(urlOf(1)), 1);
  assert.match(result.warnings.join("\n"), /硬链接.*复制/);
  const files = await Promise.all(
    result.projects.map(async (p) => {
      const video = path.join(p.absoluteDir, "assets", "video");
      return fs.stat(path.join(video, (await fs.readdir(video))[0]));
    }),
  );
  assert.notEqual(files[0].ino, files[1].ino);
  assert.equal(files[0].size, A.length);
});

test("--dry-run：已存在的同名目录、可复用的素材、可续传的 .partial 都报出来，一样东西都不写", async (t) => {
  const ws = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A, [urlOf(2)]: B });
  const timeline = {
    title: "剧",
    clips: [clip("a", "ep01 a", 1), clip("b", "ep02 b", 2)],
    droppedInvalid: 1,
  };
  await run(ws, { ...timeline, clips: [timeline.clips[0]] }, {}, deps(cdn.fetch));
  const before = await fs.readdir(path.join(ws, "产出", "剪映工程"));
  const plan = await run(ws, timeline, { "dry-run": true }, deps(cdn.fetch));
  assert.equal(plan.dryRun, true);
  assert.deepEqual(
    plan.projects.map((p) => [p.episode, p.exists, p.bytes]),
    [
      ["EP01", true, A.length],
      ["EP02", false, B.length],
    ],
  );
  assert.equal(plan.reusableBytes, A.length);
  assert.equal(plan.downloadBytes, B.length);
  assert.match(plan.warnings.join("\n"), /已经存在/);
  assert.match(plan.warnings.join("\n"), /历史脏数据/);
  assert.deepEqual(await fs.readdir(path.join(ws, "产出", "剪映工程")), before);
});

test("草稿里的路径是 out-dir 的绝对路径；--out-dir 可以换，逐级建出来", async (t) => {
  const ws = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A });
  const result = await run(
    ws,
    { title: "", clips: [clip("a", "MV 主镜", 1)] },
    { "out-dir": "交付/剪映", name: "品牌片" },
    deps(cdn.fetch),
  );
  assert.equal(result.layout, "single");
  assert.equal(result.projects[0].name, "品牌片_20260923_101500");
  const draft = JSON.parse(
    await fs.readFile(
      path.join(ws, "交付", "剪映", "品牌片_20260923_101500", "draft_content.json"),
      "utf8",
    ),
  );
  assert.equal(
    draft.materials.videos[0].path,
    path.join(
      ws,
      "交付",
      "剪映",
      "品牌片_20260923_101500",
      "assets",
      "video",
      draft.materials.videos[0].material_name,
    ),
  );
  // 没有剧名、没有画布标题：与页面导出同一个兜底名。
  const unnamed = await run(
    ws,
    { title: "", clips: [clip("a", "MV", 1)] },
    { "out-dir": "交付/无名" },
    deps(cdn.fetch),
  );
  assert.equal(unnamed.projects[0].name, "剪映工程_20260923_101500");
});

test("发布时暂存目录改名一直失败（Windows 上被杀毒 / 索引占着）：工程标 partial、暂存目录留着续传标记，下一次接着发布", async (t) => {
  const ws = await workspace(t);
  const rename = fs.rename;
  let blocked = 0;
  fs.rename = async (from, to) => {
    if (String(from).endsWith(".partial") && !String(to).endsWith(".partial")) {
      blocked += 1;
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    }
    return rename(from, to);
  };
  t.after(() => {
    fs.rename = rename;
  });
  const cdn = fakeFetch({ [urlOf(1)]: A });
  const timeline = { title: "剧", clips: [clip("a", "片子", 1)] };
  const first = await run(ws, timeline, {}, deps(cdn.fetch));
  assert.equal(first.ok, false);
  assert.equal(first.projects[0].status, "partial");
  assert.equal(first.projects[0].errors[0].code, "write_failed");
  assert.equal(blocked, 6, "按退避重试到上限才放弃");
  const staged = first.projects[0].absoluteDir;
  assert.match(path.basename(staged), /\.partial$/);
  assert.equal((await fs.readdir(staged)).includes(".scenemint-jianying.json"), true);

  fs.rename = rename;
  const later = new Date(2026, 8, 23, 12, 0, 0);
  const second = await run(ws, timeline, {}, deps(cdn.fetch, { now: () => later }));
  assert.equal(second.ok, true);
  assert.equal(second.projects[0].resumed, true);
  assert.equal(cdn.count(urlOf(1)), 1, "素材在第一次就下好了");
  assert.deepEqual(await fs.readdir(path.join(ws, "产出", "剪映工程")), ["剧_20260923_120000"]);
});

test("--episode 没指定 --layout：按整条时间线判断组织方式（与浏览器分集页一致）", async (t) => {
  const ws = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A, [urlOf(2)]: B });
  // 短剧：单导「其他」那一组，照样按集组织、工程名带 _其他_。
  const drama = await run(
    ws,
    { title: "剧", clips: [clip("a", "ep01 a", 1), clip("b", "片尾", 2)] },
    { episode: "其他" },
    deps(cdn.fetch),
  );
  assert.equal(drama.layout, "episodes");
  assert.equal(drama.projects[0].name, "剧_其他_20260923_101500");
  // 广告片 / MV：整条都没有集号，「其他」就是全部，单工程、不带标签。
  const mv = await run(
    ws,
    { title: "品牌片", clips: [clip("a", "开场", 1), clip("b", "结尾", 2)] },
    { episode: "其他" },
    deps(cdn.fetch),
  );
  assert.equal(mv.layout, "single");
  assert.equal(mv.projects[0].name, "品牌片_20260923_101500");
});

test("同一时刻叠在一起的字幕超过 4 条：工程照常写好，多出的不进草稿，回包 warnings 说清楚丢了几条", async (t) => {
  const ws = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A });
  const subtitles = ["一", "二", "三", "四", "五"].map((text, i) => ({
    text,
    startMs: i * 100,
    endMs: 1500,
  }));
  const result = await run(
    ws,
    { title: "剧", clips: [clip("a", "片子", 1, { outMs: 2000, subtitles })] },
    {},
    deps(cdn.fetch),
  );
  assert.equal(result.ok, true);
  assert.equal(result.projects[0].status, "ok");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /「剧_20260923_101500」.*超过 4 条.*多出的 1 条.*「五」/);
  const draft = JSON.parse(
    await fs.readFile(path.join(result.projects[0].absoluteDir, "draft_content.json"), "utf8"),
  );
  assert.equal(draft.tracks.filter((track) => track.type === "text").length, 4);
  assert.equal(draft.materials.texts.length, 4);
});

/* ── workspace 边界：工程内部的每一级目录（写之前逐级复查，碰到符号链接整个导出停下）───── */

/** 建一个指向 `target` 的目录链接；这台机器建不了（例如 Windows 没有权限）就跳过这条测试。 */
async function linkOrSkip(t, target, at) {
  try {
    await fs.symlink(target, at, "junction");
    return true;
  } catch {
    t.skip("这台机器建不了符号链接");
    return false;
  }
}

test("续传暂存目录里预放了指向 workspace 外的 assets 符号链接：报 workspace_boundary 并停下，外面一个字节都不写、一个请求都不发", async (t) => {
  const ws = await workspace(t);
  const outside = await workspace(t);
  const timeline = { title: "剧", clips: [clip("a", "片子", 1)] };
  const down = fakeFetch({ [urlOf(1)]: () => new Response("x", { status: 503 }) });
  const first = await run(ws, timeline, {}, deps(down.fetch));
  assert.equal(first.projects[0].status, "partial");
  const staged = first.projects[0].absoluteDir;
  await fs.rm(path.join(staged, "assets"), { recursive: true });
  if (!(await linkOrSkip(t, outside, path.join(staged, "assets")))) return;

  const cdn = fakeFetch({ [urlOf(1)]: A });
  const later = new Date(2026, 8, 23, 11, 0, 0);
  await assert.rejects(run(ws, timeline, {}, deps(cdn.fetch, { now: () => later })), (error) => {
    assert.equal(error.code, "workspace_boundary");
    // 接上的暂存目录已按这次的名字改过名；拦在它的 assets 这一级。
    assert.equal(error.extra.path, "产出/剪映工程/.剧_20260923_110000.partial/assets");
    assert.match(error.message, /符号链接/);
    return true;
  });
  assert.deepEqual(await fs.readdir(outside), [], "workspace 外面什么都没建、没写");
  assert.equal(cdn.calls.length, 0, "停在下载之前");
});

test("--overwrite 写进已有的同名工程、它的 assets 已被换成符号链接：同样报 workspace_boundary，外面不写", async (t) => {
  const ws = await workspace(t);
  const outside = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A });
  const timeline = { title: "剧", clips: [clip("a", "片子", 1)] };
  const first = await run(ws, timeline, {}, deps(cdn.fetch));
  assert.equal(first.ok, true);
  const dir = first.projects[0].absoluteDir;
  await fs.rm(path.join(dir, "assets"), { recursive: true });
  if (!(await linkOrSkip(t, outside, path.join(dir, "assets")))) return;

  await assert.rejects(run(ws, timeline, { overwrite: true }, deps(cdn.fetch)), (error) => {
    assert.equal(error.code, "workspace_boundary");
    assert.equal(error.extra.path, `产出/剪映工程/${first.projects[0].name}/assets`);
    return true;
  });
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(cdn.calls.length, 1, "第二次一个请求都没发");
});

test("--out-dir 半路一级是符号链接 / 是文件、同名工程目录的位置上是符号链接：报错带 error.path 指出是哪一级，一个请求都不发", async (t) => {
  const ws = await workspace(t);
  const outside = await workspace(t);
  const cdn = fakeFetch({ [urlOf(1)]: A });
  const timeline = { title: "剧", clips: [clip("a", "片子", 1)] };
  await fs.mkdir(path.join(ws, "real"));
  if (!(await linkOrSkip(t, path.join(ws, "real"), path.join(ws, "linked")))) return;
  await assert.rejects(
    run(ws, timeline, { "out-dir": "linked/剪映" }, deps(cdn.fetch)),
    (error) => {
      assert.equal(error.code, "workspace_boundary");
      assert.equal(error.extra.path, "linked");
      return true;
    },
  );
  await fs.writeFile(path.join(ws, "file"), "x");
  await assert.rejects(run(ws, timeline, { "out-dir": "file/剪映" }, deps(cdn.fetch)), (error) => {
    assert.equal(error.code, "invalid_path");
    assert.equal(error.extra.path, "file");
    return true;
  });
  // 正式工程目录的位置上是一个指向 workspace 外的链接：--overwrite 也不往里写。
  const name = "剧_20260923_101500";
  await fs.mkdir(path.join(ws, "产出", "剪映工程"), { recursive: true });
  if (!(await linkOrSkip(t, outside, path.join(ws, "产出", "剪映工程", name)))) return;
  await assert.rejects(run(ws, timeline, { overwrite: true }, deps(cdn.fetch)), (error) => {
    assert.equal(error.code, "workspace_boundary");
    assert.equal(error.extra.path, `产出/剪映工程/${name}`);
    return true;
  });
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(cdn.calls.length, 0);
});

test("下载途中 assets/video 被换成指向 workspace 外的符号链接：开 .part 之前复查拦下，外面没有文件，也不重试", async (t) => {
  const ws = await workspace(t);
  const outside = await workspace(t);
  if (!(await linkOrSkip(t, outside, path.join(ws, "探针")))) return;
  await fs.unlink(path.join(ws, "探针"));
  const video = path.join(ws, "产出", "剪映工程", ".剧_20260923_101500.partial", "assets", "video");
  const cdn = fakeFetch({
    [urlOf(1)]: async () => {
      await fs.rename(video, `${video}.moved`);
      await fs.symlink(outside, video, "junction");
      return new Response(A, { status: 200, headers: { "content-length": String(A.length) } });
    },
  });
  await assert.rejects(
    run(ws, { title: "剧", clips: [clip("a", "片子", 1)] }, {}, deps(cdn.fetch)),
    (error) => {
      assert.equal(error.code, "workspace_boundary");
      assert.equal(error.extra.path, "产出/剪映工程/.剧_20260923_101500.partial/assets/video");
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(outside), []);
  assert.deepEqual(await fs.readdir(`${video}.moved`), [], "原来的目录里也没留下半截文件");
  assert.equal(cdn.count(urlOf(1)), 1, "越界不重试");
});

test("两个工程共用一个素材，第二个工程的 assets/video 在下载途中被换成链接：硬链接之前复查拦下，整个导出停下", async (t) => {
  const ws = await workspace(t);
  const outside = await workspace(t);
  if (!(await linkOrSkip(t, outside, path.join(ws, "探针")))) return;
  await fs.unlink(path.join(ws, "探针"));
  const out = path.join(ws, "产出", "剪映工程");
  const ep02Video = path.join(out, ".剧_EP02_20260923_101500.partial", "assets", "video");
  const cdn = fakeFetch({
    [urlOf(1)]: async () => {
      await fs.rename(ep02Video, `${ep02Video}.moved`);
      await fs.symlink(outside, ep02Video, "junction");
      return new Response(A, { status: 200, headers: { "content-length": String(A.length) } });
    },
  });
  await assert.rejects(
    run(
      ws,
      { title: "剧", clips: [clip("a", "ep01 a", 1), clip("b", "ep02 a", 1)] },
      {},
      deps(cdn.fetch),
    ),
    (error) => {
      assert.equal(error.code, "workspace_boundary");
      assert.equal(error.extra.path, "产出/剪映工程/.剧_EP02_20260923_101500.partial/assets/video");
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(outside), []);
  // 停下之后没有发布任何工程（发布在所有素材之后）。
  assert.deepEqual(
    (await fs.readdir(out)).filter((name) => !name.startsWith(".")),
    [],
  );
});
