import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { outputFileName } from "../src/run-await.mjs";
import { fixture } from "./helpers.mjs";

/**
 * `run --await SECONDS` / `run --out-dir DIR`（0.17.0，00-contract §6.2 / §7）：都在 CLI 本地。真守护进程 +
 * 假页面（pump）答 `run_node` 与 `read NODE/renders`；`--out-dir` 的字节也由假页面（media_info / media_chunk）给。
 */

const PENDING_NOTE = "镜 2 仍在渲（预计 ≤ 40 s），等一会儿 read desk/renders 取，不要重发 run";
const still = {
  nodeId: "s3i-1",
  outputId: "entry-11111111aa",
  shotId: "s1",
  n: 1,
  title: "ep01 · 镜1 · 预演",
  mediaType: "video",
  output: "video",
  url: "https://cdn.example.test/s1.mp4",
  result: "created",
  created: true,
  reused: false,
};
const runReply = (extra = {}) => ({
  ok: true,
  submitted: true,
  local: true,
  renderedDigest: "d1",
  outputs: [still],
  pending: ["s2"],
  failed: [],
  timings: { perShot: {} },
  notes: [PENDING_NOTE],
  ...extra,
});
const row = (state, extra = {}) => ({
  shotId: "s2",
  n: 2,
  output: "video",
  nodeId: "s3v-2",
  title: "ep01 · 镜2 · 预演",
  mediaType: "video",
  outputId: null,
  url: null,
  stale: false,
  state,
  ...extra,
});
const landed = row("landed", {
  outputId: "entry-22222222bb",
  url: "https://cdn.example.test/s2.mp4",
  posterUrl: "https://cdn.example.test/s2.png",
  durationMs: 4000,
});
// 页面 `read` 的真回包形状：成功时只有 {rev, nodes}，没有 `ok`（以前夹具多带了 ok:true，盖住了
// 「轮询把每个真回包都当失败丢掉」的缺陷——experience bugs[0]）。
const readReply = (renders) => ({ rev: 1, nodes: [{ nodeId: "desk", renders }] });

test("--await：每 3 s 读一次 NODE/renders，落地的并进 outputs[]（同卡重渲记 rerendered），pending 清空、旧 note 换掉", async (t) => {
  const f = await fixture(t, { timeout: 15000 });
  await f.pair();
  const reads = [];
  const pump = await f.pump((req) => {
    if (req.method === "run_node") return runReply();
    reads.push(req.params);
    // 第一次：新的一条还在渲，同卡上已有上一次落地的旧片 → 同卡重渲；第二次：落地。
    return reads.length === 1
      ? readReply([landed, row("rendering")].map((r) => ({ ...r, stale: true })))
      : readReply([landed]);
  });
  t.after(() => pump.stop());
  const started = Date.now();
  const run = await f.cli([
    "run",
    "desk",
    "--shots",
    "all",
    "--render",
    "video",
    "--await",
    "20",
    "--approved",
  ]);
  assert.equal(run.code, 0, run.stdout);
  assert.ok(Date.now() - started < 15000);
  assert.deepEqual(reads, [{ paths: ["desk/renders"] }, { paths: ["desk/renders"] }]);
  assert.deepEqual(run.result.pending, []);
  assert.deepEqual(run.result.outputs, [
    still,
    {
      nodeId: "s3v-2",
      outputId: "entry-22222222bb",
      shotId: "s2",
      n: 2,
      title: "ep01 · 镜2 · 预演",
      mediaType: "video",
      output: "video",
      url: "https://cdn.example.test/s2.mp4",
      posterUrl: "https://cdn.example.test/s2.png",
      durationMs: 4000,
      result: "rerendered",
      created: false,
      reused: false,
    },
  ]);
  assert.deepEqual(
    run.result.notes,
    ["镜 2 是 --await 轮询收到的：timings.perShot 里没有它的用时"],
    "页面那句「仍在渲」已经不成立；轮询并进来的镜说明没有用时（B9-FX-55）",
  );
  assert.equal(run.result.renderedDigest, "d1");
});

test("--await 到点：没完的留在 pending[]，notes[] 写「N 镜仍在渲 … 不要重发 run」，仍是 ok:true", async (t) => {
  const f = await fixture(t, { timeout: 15000 });
  await f.pair();
  const pump = await f.pump((req) =>
    req.method === "run_node" ? runReply() : readReply([row("rendering")]),
  );
  t.after(() => pump.stop());
  const started = Date.now();
  const run = await f.cli(["run", "desk", "--render", "video", "--await", "4", "--approved"]);
  const elapsed = Date.now() - started;
  assert.equal(run.code, 0, run.stdout);
  assert.ok(elapsed < 4000 + 3000, `--await 4 用了 ${elapsed} ms`);
  assert.equal(run.result.ok, true);
  assert.deepEqual(run.result.pending, ["s2"]);
  assert.deepEqual(run.result.notes, [
    "1 镜仍在渲（镜 2，--await 到点），等一会儿 read desk/renders 取，不要重发 run",
  ]);
});

test("--await：只剩过期（stale）的旧片不算本次落地——在飞行没了（标签页刷新）时镜头留在 pending[]", async (t) => {
  const f = await fixture(t, { timeout: 15000 });
  await f.pair();
  const pump = await f.pump((req) =>
    req.method === "run_node"
      ? runReply()
      : readReply([
          row("landed", {
            nodeId: "s3v-old",
            outputId: "OLDOLD11aa",
            url: "https://cdn.example.test/old-take.mp4",
            stale: true,
          }),
        ]),
  );
  t.after(() => pump.stop());
  const run = await f.cli(["run", "desk", "--render", "video", "--await", "4", "--approved"]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(run.result.outputs, [still], "旧片不能当成这次的 created");
  assert.deepEqual(run.result.pending, ["s2"]);
  assert.deepEqual(run.result.failed, []);
});

test("--await：页面回了 pendingOutputIds 时，outputId 换了的落地行就是这次的（出片途中场景改过、stale:true 也算），notes 说明（B9-FX-23）", async (t) => {
  const f = await fixture(t, { timeout: 15000 });
  await f.pair();
  const pump = await f.pump((req) =>
    req.method === "run_node"
      ? runReply({ pendingOutputIds: { s2: "OLDOLD11aa" } })
      : readReply([
          row("landed", {
            nodeId: "s3v-2",
            outputId: "NEWNEW22bb",
            url: "https://cdn.example.test/new-take.mp4",
            lastFrameUrl: "https://cdn.example.test/new-take-last.png",
            stale: true,
          }),
        ]),
  );
  t.after(() => pump.stop());
  const run = await f.cli(["run", "desk", "--render", "video", "--await", "4", "--approved"]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(run.result.pending, []);
  assert.equal(run.result.outputs[1].outputId, "NEWNEW22bb");
  assert.equal(run.result.outputs[1].result, "rerendered");
  assert.equal(run.result.outputs[1].lastFrameUrl, "https://cdn.example.test/new-take-last.png");
  assert.ok(run.result.notes.some((n) => n.includes("出片途中场景又改过")));
  assert.ok(run.result.notes.some((n) => n.includes("timings.perShot 里没有它的用时")));
  assert.equal(run.result.pendingOutputIds, undefined);
});

test("--await：pendingOutputIds 里的 outputId 没换、行又过期 → 还是开批前的旧片，留在 pending[]（B9-FX-23）", async (t) => {
  const f = await fixture(t, { timeout: 15000 });
  await f.pair();
  const pump = await f.pump((req) =>
    req.method === "run_node"
      ? runReply({ pendingOutputIds: { s2: "OLDOLD11aa" } })
      : readReply([
          row("landed", {
            nodeId: "s3v-2",
            outputId: "OLDOLD11aa",
            url: "https://cdn.example.test/old-take.mp4",
            stale: true,
          }),
        ]),
  );
  t.after(() => pump.stop());
  const run = await f.cli(["run", "desk", "--render", "video", "--await", "4", "--approved"]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(run.result.outputs, [still]);
  assert.deepEqual(run.result.pending, ["s2"]);
  assert.equal(run.result.pendingOutputIds, undefined);
});

test("--await：静帧按 frame 认卡——run --frame end 认镜尾那张，开头那张不算；反过来也一样（B11-int 复核）", async (t) => {
  const startCard = (state, extra = {}) => ({
    shotId: "s1",
    n: 1,
    output: "still",
    nodeId: "s3i-start",
    title: "ep · 镜1 · 静帧",
    mediaType: "image",
    outputId: state === "landed" ? "entry-START000aa" : null,
    url: state === "landed" ? "https://cdn.example.test/start.png" : null,
    stale: false,
    state,
    ...extra,
  });
  const endCard = (state) => ({
    ...startCard(state),
    frame: "end",
    nodeId: "s3i-end",
    title: "ep · 镜1 · 镜尾",
    outputId: state === "landed" ? "entry-END00000bb" : null,
    url: state === "landed" ? "https://cdn.example.test/end.png" : null,
  });
  const runOnce = async (frame, polls, seconds = "12") => {
    const f = await fixture(t, { timeout: 15000 });
    await f.pair();
    let reads = 0;
    const pump = await f.pump((req) =>
      req.method === "run_node"
        ? {
            ...runReply({ outputs: [], pending: ["s1"], pendingOutputIds: { s1: null } }),
            shotId: "s1",
            ...(frame ? { frame } : {}),
          }
        : readReply(polls[Math.min(reads++, polls.length - 1)]),
    );
    t.after(() => pump.stop());
    return f.cli([
      "run",
      "desk",
      "--shot",
      "s1",
      ...(frame ? ["--frame", frame] : []),
      "--await",
      seconds,
      "--approved",
    ]);
  };
  // 镜尾第一次出：开头那张早就落着（行序在前），不算这次的、也不让镜尾成了「重渲」
  const end = await runOnce("end", [
    [startCard("landed"), endCard("rendering")],
    [startCard("landed"), endCard("landed")],
  ]);
  assert.equal(end.code, 0, end.stdout);
  assert.equal(end.result.outputs.length, 1);
  assert.equal(end.result.outputs[0].nodeId, "s3i-end");
  assert.equal(end.result.outputs[0].result, "created");
  // 开头那张的在飞行没了（刷新）、镜尾卡还落着：不拿镜尾那张充数，留在 pending[]
  const start = await runOnce(undefined, [[endCard("landed")]], "4");
  assert.equal(start.code, 0, start.stdout);
  assert.deepEqual(start.result.outputs, []);
  assert.deepEqual(start.result.pending, ["s1"]);
});

test("--await 是整条命令的墙钟预算：页面迟迟不答 read 时，到点照样出 JSON（套接字按剩余预算截断）", async (t) => {
  // 守护进程的 callTimeoutMs = 15 s：不截断套接字，这条 run 要等 ~15 s 才回。
  const f = await fixture(t, { timeout: 15000 });
  await f.pair();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const pump = await f.pump(async (req) => {
    if (req.method === "run_node") return runReply();
    await held;
    return readReply([landed]);
  });
  const started = Date.now();
  const run = await f.cli(["run", "desk", "--render", "video", "--await", "4", "--approved"]);
  const elapsed = Date.now() - started;
  release();
  await pump.stop();
  assert.equal(run.code, 0, run.stdout);
  assert.ok(elapsed < 4000 + 2500, `--await 4 用了 ${elapsed} ms`);
  assert.deepEqual(run.result.pending, ["s2"]);
  assert.match(run.result.notes[0], /--await 到点.*不要重发 run/);
});

test("--await：失败行进 failed[]；请求的镜头全失败 → ok:false，顶层 error 取第一个", async (t) => {
  const f = await fixture(t, { timeout: 15000 });
  await f.pair();
  const error = { code: "render_interrupted", retryable: true, message: "渲染被打断", next: [] };
  const pump = await f.pump((req) =>
    req.method === "run_node"
      ? runReply({ outputs: [], notes: undefined })
      : readReply([row("failed", { error })]),
  );
  t.after(() => pump.stop());
  const run = await f.cli(["run", "desk", "--render", "video", "--await", "10", "--approved"]);
  assert.equal(run.code, 1, run.stdout);
  assert.equal(run.result.ok, false);
  assert.deepEqual(run.result.failed, [{ shotId: "s2", error }]);
  assert.deepEqual(run.result.error, error);
  assert.deepEqual(run.result.pending, []);
});

/** 假页面的 media_info / media_chunk：`bytes` 里有的卡给字节，没有的回页面代理的拒收。 */
function pageMedia(rpc, bytes, seen) {
  if (rpc.method === "media_info") {
    seen.push(rpc.params.nodeId);
    const body = bytes[rpc.params.nodeId];
    if (!body)
      return { ok: false, error: { code: "media_failed", message: "Media download failed (400)" } };
    return {
      mediaId: `m-${rpc.params.nodeId}`,
      size: body.length,
      mimeType: "video/mp4",
      fileName: "x.mp4",
    };
  }
  if (rpc.method === "media_chunk") {
    const body = bytes[rpc.params.mediaId.slice(2)];
    const part = body.subarray(rpc.params.offset, rpc.params.offset + rpc.params.length);
    return {
      base64: part.toString("base64"),
      offset: rpc.params.offset,
      eof: rpc.params.offset + part.length === body.length,
    };
  }
  return undefined;
}

test("--out-dir：经页面下载到 workspace 里的目录（可已存在），每项加 path；失败项加 pathError、run 仍成功；同名已在就跳过", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const outputs = [
    { ...still, nodeId: "s3v-1" },
    { ...still, nodeId: "s3v-2", shotId: "s2", n: 2, outputId: "entry-33333333cc" },
  ];
  const seen = [];
  const bytes = { "s3v-1": Buffer.from("fake-mp4-bytes") };
  const pump = await f.pump(
    (rpc) => pageMedia(rpc, bytes, seen) ?? runReply({ outputs, pending: [], notes: undefined }),
  );
  t.after(() => pump.stop());
  await fs.mkdir(path.join(f.workspace, "预演"));
  const run = await f.cli(["run", "desk", "--render", "video", "--out-dir", "预演", "--approved"]);
  assert.equal(run.code, 0, run.stdout);
  assert.equal(run.result.ok, true);
  const [ok, bad] = run.result.outputs;
  const realWorkspace = await fs.realpath(f.workspace);
  assert.equal(ok.path, path.join(realWorkspace, "预演", "ep01_·_镜1_·_预演-entry-11.mp4"));
  assert.equal(await fs.readFile(ok.path, "utf8"), "fake-mp4-bytes");
  assert.equal(ok.pathError, undefined);
  assert.deepEqual(bad.pathError, {
    code: "media_failed",
    message: "Media download failed (400)",
  });
  assert.equal(bad.path, undefined);
  // 再跑一次：同名文件已在 → 不再下载，照样回 path。
  const again = await f.cli(["run", "desk", "--out-dir", "预演", "--approved"]);
  assert.equal(again.result.outputs[0].path, ok.path);
  assert.deepEqual(seen, ["s3v-1", "s3v-2", "s3v-2"]);
  // 目录不在就建出来；越出 workspace 的目录是该项的 pathError，不是整条 run 失败。
  const fresh = await f.cli(["run", "desk", "--out-dir", "新/子目录", "--approved"]);
  assert.match(fresh.result.outputs[0].path, /新\/子目录\/ep01_·_镜1_·_预演-entry-11\.mp4$/);
  const outside = await f.cli(["run", "desk", "--out-dir", "../外面", "--approved"]);
  assert.equal(outside.code, 0);
  assert.equal(outside.result.outputs[0].pathError.code, "workspace_boundary");
});

test("--out-dir 不从 Agent 主机直连画布给的 url（B9-FX-07）：指向回环 / 元数据地址的卡一次都不被 CLI 取，字节只来自页面", async (t) => {
  const hits = [];
  const imds = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === "/hop") {
      res.writeHead(302, { Location: "/latest/meta-data/iam/security-credentials/role" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end('{"AccessKeyId":"AKIAPROBE","SecretAccessKey":"s3cr3t-from-imds"}');
  });
  await new Promise((resolve) => imds.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => imds.close(resolve)));
  const base = `http://127.0.0.1:${imds.address().port}`;
  const f = await fixture(t);
  await f.pair();
  const card = { ...still, mediaType: "image", output: "still", result: "reused" };
  const outputs = [
    { ...card, nodeId: "s3i-1", url: `${base}/latest/meta-data/iam/security-credentials/role` },
    { ...card, nodeId: "s3i-2", outputId: "entry-44444444dd", url: `${base}/hop` },
  ];
  // 页面代理按主机策略拒收这两个 url（safeFetch：回环 / 非 https / 不在白名单）。
  const seen = [];
  const pump = await f.pump(
    (rpc) => pageMedia(rpc, {}, seen) ?? runReply({ outputs, pending: [], notes: undefined }),
  );
  t.after(() => pump.stop());
  const run = await f.cli(["run", "desk", "--out-dir", "out", "--approved"]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(hits, []);
  assert.deepEqual(seen, ["s3i-1", "s3i-2"]);
  for (const item of run.result.outputs) {
    assert.equal(item.path, undefined);
    assert.equal(item.pathError.code, "media_failed");
  }
  const written = await fs.readdir(path.join(f.workspace, "out")).catch(() => []);
  assert.deepEqual(
    written.filter((name) => !name.startsWith(".")),
    [],
  );
});

test("--out-dir 的文件名：标题规整 + outputId 前 8 位；静帧（outputId:null）用 url 摘要；扩展名先看 url 再看 mediaType", () => {
  assert.equal(
    outputFileName({ title: "a/b: c?", outputId: "entry-xyz", url: "https://x/y.webp" }),
    "a_b_c-entry-xy.webp",
  );
  const stillName = outputFileName({
    title: "茶馆",
    outputId: null,
    mediaType: "image",
    url: "https://x/files/abc",
  });
  assert.match(stillName, /^茶馆-[0-9a-f]{8}\.png$/);
  assert.notEqual(
    stillName,
    outputFileName({
      title: "茶馆",
      outputId: null,
      mediaType: "image",
      url: "https://x/files/abd",
    }),
  );
  assert.equal(
    outputFileName({ title: "", outputId: "e1", mediaType: "video", url: "https://x/v" }),
    "output-e1.mp4",
  );
});
