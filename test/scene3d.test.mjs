import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execute, oldPeerHint, parseArgs, runShotParams, runStillsParams } from "../src/cli.mjs";
import { METHODS, MUTATIONS } from "../src/common.mjs";
import { awaitSeconds } from "../src/run-await.mjs";
import { COMMAND_SPEC } from "../src/spec.mjs";
import { formatScene3dChecks, formatScene3dScene } from "../src/contract.mjs";
import {
  enforceRequestPolicy,
  MAIN_METHODS,
  RequestPolicyError,
  RUN_NODE_FIELDS,
  RUN_NODES_FIELDS,
  RUN_STILLS_FIELDS,
  RUN_STILLS_SHOTS_MAX,
  SCENE3D_ACTION_FIELDS,
  SCENE3D_ACTIONS_MAX,
  SCENE3D_STILL_FRAMES,
} from "../src/policy.mjs";
import { fixture, packageRoot } from "./helpers.mjs";

/**
 * scene3d@1 —— 三维导演台的 CLI 操作面（0.16.2）：`scene3d_apply` 在守护进程这一层只守「认不认识」
 * （op 与这个 op 的字段、动作条数）；取值、CAS、依赖场景的校验全在页面侧 reducer 判。
 * `run --shot` 挑三维节点出哪一镜，`run_node` 的参数面从此多给即报错。
 * 0.17.0（未 tag 起点）：三个 act op、镜头 start / via / follow / shake、run_node 的
 * shotIds / allShots / render / sheetFrames；run_nodes 的参数面也多给即报错。
 */

const policyError = (code, re) => (error) =>
  error instanceof RequestPolicyError && error.code === code && (!re || re.test(error.message));
const apply = (command, role = "main") =>
  enforceRequestPolicy(role, "apply", { commands: [command] });
const scene3d = (actions, extra = {}) => ({
  type: "scene3d_apply",
  nodeId: "desk",
  baseDigest: "new",
  actions,
  ...extra,
});

test("scene3d_apply：合法批通过，worker 也能发（含 remove / remove_shot）", () => {
  const actions = [
    { op: "add_object", id: "boss", role: "figure", kind: "human", bodyType: "tall" },
    { op: "transform", id: "boss", rotation: { x: 0, y: 90, z: 0 } },
    { op: "set_axis", ends: ["boss", "clerk"] },
    { op: "add_shot", id: "s1", cam: { x: 0, y: 1.5, z: 3 }, look: "boss", focal: 85 },
    { op: "update_shot", id: "s1", fovTo: null },
    { op: "remove", id: "boss" },
    { op: "remove_shot", id: "s1" },
  ];
  assert.doesNotThrow(() => apply(scene3d(actions)));
  assert.doesNotThrow(() => apply(scene3d(actions), "worker"));
  // 与别的命令同批。
  assert.doesNotThrow(() =>
    enforceRequestPolicy("main", "apply", {
      commands: [
        { type: "add_node", id: "desk", kind: "scene-3d", position: { x: 0, y: 0 } },
        scene3d([{ op: "set_scene", aspectRatio: "16:9" }]),
        { type: "update_node", nodeId: "desk", draft: { assetTags: ["待审"] } },
      ],
    }),
  );
});

test("0.17.0：act 三个 op 与镜头新字段在守护进程放行（取值与未实现通道由页面判）；remove_act 是破坏性的", () => {
  assert.deepEqual(SCENE3D_ACTION_FIELDS.add_act, [
    "id",
    "who",
    "at",
    "dur",
    "to",
    "via",
    "gait",
    "pose",
    "arms",
    "armL",
    "armR",
    "facing",
    "gaze",
    "hold",
    "hand",
    "gesture",
    "note",
    // 0.18.2（A102 ⑧）：进场 / 离场（取值与「进场只收 to / facing」由页面判）
    "do",
  ]);
  assert.deepEqual(SCENE3D_ACTION_FIELDS.update_act, SCENE3D_ACTION_FIELDS.add_act);
  assert.deepEqual(SCENE3D_ACTION_FIELDS.remove_act, ["id"]);
  for (const op of ["add_shot", "update_shot"])
    for (const key of ["start", "via", "follow", "shake"])
      assert.ok(SCENE3D_ACTION_FIELDS[op].includes(key), `${op}.${key}`);
  assert.doesNotThrow(() =>
    apply(
      scene3d([
        { op: "add_act", who: "boss", at: 0, dur: 2, to: { x: 1, z: 2 }, gait: "walk" },
        { op: "update_act", id: "a1", hold: "@drop", note: null },
        { op: "add_shot", id: "s2", look: "boss", fov: 40, cam: { x: 0, y: 1, z: 3 }, start: 4 },
        { op: "remove_act", id: "a1" },
      ]),
      "worker",
    ),
  );
  assert.throws(
    () => apply(scene3d([{ op: "remove_act", id: "a1", who: "boss" }])),
    policyError("invalid_request", /Unexpected scene3d remove_act field: who/),
  );
  assert.throws(
    () => apply(scene3d([{ op: "add_act", who: "boss", at: 0, speed: 2 }])),
    policyError("invalid_request", /Unexpected scene3d add_act field: speed/),
  );
});

test("scene3d_apply：多给的顶层键、未知 op、动作多余键、空批、超上限、嵌 commands 一律 invalid_request", () => {
  const ok = [{ op: "set_scene", gridSize: 20 }];
  assert.throws(
    () => apply(scene3d(ok, { force: true })),
    policyError("invalid_request", /Unexpected scene3d_apply field: force/),
  );
  assert.throws(
    () => apply(scene3d([{ op: "teleport", id: "a" }])),
    policyError("invalid_request", /Unknown scene3d action op/),
  );
  for (const bad of [null, "set_scene", ["set_scene"], { gridSize: 20 }, { op: 3 }])
    assert.throws(
      () => apply(scene3d([bad])),
      policyError("invalid_request", /Unknown scene3d action op/),
    );
  assert.throws(
    () => apply(scene3d([{ op: "transform", id: "a", position: { x: 1, y: 0, z: 0 }, pos: 1 }])),
    policyError("invalid_request", /Unexpected scene3d transform field: pos/),
  );
  // 另一个 op 的字段也不行：`newId` 只属于 duplicate。
  assert.throws(
    () => apply(scene3d([{ op: "remove", id: "a", newId: "b" }])),
    policyError("invalid_request", /Unexpected scene3d remove field: newId/),
  );
  for (const actions of [
    [],
    undefined,
    "set_scene",
    Array.from({ length: SCENE3D_ACTIONS_MAX + 1 }, () => ({ op: "set_scene", gridSize: 10 })),
  ])
    assert.throws(
      () => apply(scene3d(actions)),
      policyError("invalid_request", /scene3d_apply requires 1\.\.200 actions/),
    );
  assert.doesNotThrow(() =>
    apply(
      scene3d(
        Array.from({ length: SCENE3D_ACTIONS_MAX }, () => ({ op: "set_scene", gridSize: 10 })),
      ),
    ),
  );
  // 动作里嵌 `commands`：先按字段表拒；藏在字段值里的也照样被嵌套检查拒。
  assert.throws(
    () => apply(scene3d([{ op: "set_scene", commands: [] }])),
    policyError("invalid_request"),
  );
  assert.throws(
    () =>
      apply(
        scene3d([
          { op: "add_object", role: "prop", kind: "box", transform: { commands: [{ type: "x" }] } },
        ]),
      ),
    policyError("invalid_request", /Nested or unsafe command field: commands/),
  );
});

test("run_node：shotId / frame 通过；陌生字段拒，但缺 / 错 approval 仍先答 approval_required", () => {
  assert.deepEqual(RUN_NODE_FIELDS, [
    "nodeId",
    "approval",
    "clearCandidates",
    "shotId",
    "shotIds",
    "allShots",
    "render",
    "sheetFrames",
    "frame",
  ]);
  const approval = { userApprovedNodeIds: ["n"] };
  const run = (params) => enforceRequestPolicy("main", "run_node", params);
  assert.doesNotThrow(() => run({ nodeId: "n", approval }));
  assert.doesNotThrow(() => run({ nodeId: "n", approval, clearCandidates: true, shotId: "s1" }));
  assert.doesNotThrow(() => run({ nodeId: "n", approval, shotId: "s".repeat(128) }));
  // 0.17.0：多镜 / 产物。形状在这里挡；镜头存在、三选一、render / sheetFrames 的枚举在页面
  assert.doesNotThrow(() => run({ nodeId: "n", approval, shotIds: ["a", "b"], render: "video" }));
  assert.doesNotThrow(() =>
    run({ nodeId: "n", approval, allShots: true, render: "sheet", sheetFrames: 5 }),
  );
  assert.doesNotThrow(() =>
    run({ nodeId: "n", approval, shotIds: Array.from({ length: 60 }, (_, i) => `s${i}`) }),
  );
  for (const shotIds of [
    [],
    ["a", "a"],
    [""],
    ["   "],
    [7],
    ["s".repeat(129)],
    Array.from({ length: 61 }, (_, i) => `s${i}`),
    "a",
    null,
  ])
    assert.throws(
      () => run({ nodeId: "n", approval, shotIds }),
      policyError("invalid_request", /shotIds must be 1\.\.60 distinct/),
    );
  for (const allShots of [false, "true", 1, null])
    assert.throws(
      () => run({ nodeId: "n", approval, allShots }),
      policyError("invalid_request", /allShots must be true/),
    );
  assert.throws(
    () => run({ nodeId: "n", approval, render: 1 }),
    policyError("invalid_request", /render must be a string/),
  );
  for (const sheetFrames of [2.5, "5", null])
    assert.throws(
      () => run({ nodeId: "n", approval, sheetFrames }),
      policyError("invalid_request", /sheetFrames must be an integer/),
    );
  assert.throws(
    () => run({ nodeId: "n", approval, foo: 1 }),
    policyError("invalid_request", /Unexpected run_node field: foo/),
  );
  // 顺序不能反：白名单先跑，这一条就成了「Unexpected run_node field: approved」。
  assert.throws(() => run({ nodeId: "n", approved: true }), policyError("approval_required"));
  assert.throws(() => run({ nodeId: "n", foo: 1 }), policyError("approval_required"));
  for (const shotId of ["", "   ", "s".repeat(129), 7, null])
    assert.throws(
      () => run({ nodeId: "n", approval, shotId }),
      policyError("invalid_request", /shotId must be a non-empty string of at most 128/),
    );
  // 0.16.2 镜尾帧：frame 只收词表里的两个值（与契约 SCENE3D.enums.frame 同一个数组）。
  assert.deepEqual(SCENE3D_STILL_FRAMES, ["start", "end"]);
  for (const frame of SCENE3D_STILL_FRAMES)
    assert.doesNotThrow(() => run({ nodeId: "n", approval, shotId: "s1", frame }));
  for (const frame of ["middle", "", "END", 1, null, ["end"]])
    assert.throws(
      () => run({ nodeId: "n", approval, frame }),
      policyError("invalid_request", /^frame must be start or end$/),
    );
});

test("--frame 是 run 的 flag（取值原样进 run_node.frame），别的命令不收", async () => {
  assert.ok(COMMAND_SPEC.run.flags.includes("frame"));
  assert.match(COMMAND_SPEC.run.usage, /\[--frame start\|end\]/);
  assert.equal(parseArgs(["run", "n1", "--frame", "end", "--approved"]).options.frame, "end");
  await assert.rejects(
    execute(["apply", "--frame", "end"]),
    (error) =>
      error.code === "invalid_argument" && /^--frame is not an option of apply/.test(error.message),
  );
});

test("run_nodes：0.17.0 起参数面多给即报错，不收三维参数；缺 approval 仍先答 approval_required", () => {
  assert.deepEqual(RUN_NODES_FIELDS, [
    "nodeIds",
    "groupId",
    "concurrency",
    "rerunSucceeded",
    "clearCandidates",
    "approval",
  ]);
  const approval = { userApprovedNodeIds: ["n"] };
  const batch = (params) => enforceRequestPolicy("main", "run_nodes", params);
  assert.doesNotThrow(() =>
    batch({
      nodeIds: ["n"],
      approval,
      concurrency: 2,
      rerunSucceeded: true,
      clearCandidates: true,
    }),
  );
  assert.doesNotThrow(() => batch({ groupId: "g", nodeIds: ["n"], approval }));
  for (const key of ["allShots", "render", "shotIds", "foo"])
    assert.throws(
      () => batch({ nodeIds: ["n"], approval, [key]: true }),
      policyError("invalid_request", new RegExp(`Unexpected run_nodes field: ${key}`)),
    );
  assert.throws(() => batch({ nodeIds: ["n"], foo: 1 }), policyError("approval_required"));
});

test("--shot 是 run 的 flag，别的命令不收（报错点名命令，不说成 Unknown option）", async () => {
  assert.ok(COMMAND_SPEC.run.flags.includes("shot"));
  assert.match(COMMAND_SPEC.run.usage, /\[--shot SHOT-ID \| --shots all\|a,b\]/);
  assert.equal(parseArgs(["run", "n1", "--shot", "s1", "--approved"]).options.shot, "s1");
  await assert.rejects(
    execute(["apply", "--shot", "s1"]),
    (error) =>
      error.code === "invalid_argument" && /^--shot is not an option of apply/.test(error.message),
  );
});

test("真实守护进程：run --shot 原样进 run_node.shotId；空的 --shot 在守护进程就被拒", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const pump = await f.pump((req) => {
    seen.push({ method: req.method, params: req.params });
    return { ok: true, submitted: true };
  });
  t.after(() => pump.stop());
  const run = await f.cli(["run", "desk", "--shot", "s1", "--approved"]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(seen, [
    {
      method: "run_node",
      params: { nodeId: "desk", approval: { userApprovedNodeIds: ["desk"] }, shotId: "s1" },
    },
  ]);
  const empty = await f.cli(["run", "desk", "--shot", "", "--approved"]);
  assert.equal(empty.result.error.code, "invalid_request");
  assert.equal(seen.length, 1, "被拒的 run 不该送到页面");
  // 镜尾帧：--frame 原样进 run_node.frame；词表外的值在守护进程就被拒、送不到页面。
  const end = await f.cli(["run", "desk", "--shot", "s1", "--frame", "end", "--approved"]);
  assert.equal(end.code, 0, end.stdout);
  assert.deepEqual(seen[1], {
    method: "run_node",
    params: {
      nodeId: "desk",
      approval: { userApprovedNodeIds: ["desk"] },
      shotId: "s1",
      frame: "end",
    },
  });
  const middle = await f.cli(["run", "desk", "--frame", "middle", "--approved"]);
  assert.equal(middle.code, 1);
  assert.equal(middle.result.error.code, "invalid_request");
  assert.equal(middle.result.error.message, "frame must be start or end");
  assert.equal(seen.length, 2, "被拒的 run 不该送到页面");
});

test("老页面 / 老守护进程不认 scene3d_apply：回包提示先刷新、再换守护进程；别的批不带", async (t) => {
  const f = await fixture(t);
  await f.pair();
  // 老页面自带老 policy，认不出的 apply 命令一律这一句。
  const refused = {
    ok: false,
    error: { code: "invalid_request", message: "Unknown or nested apply command" },
  };
  const pump = await f.pump(() => refused);
  t.after(() => pump.stop());
  const stale = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [scene3d([{ op: "set_scene", gridSize: 20 }])] }),
  ]);
  assert.equal(stale.code, 1);
  assert.deepEqual(stale.result.error, refused.error);
  assert.match(stale.result.hint, /刷新画布标签页/);
  // 升级包时还活着的会话仍是老守护进程，拒收的是它，刷新页面救不了：提示得同时点明换进程。
  assert.match(stale.result.hint, /`disconnect` 后重新 `connect`/);
  const other = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [{ type: "move_node", nodeId: "a", position: { x: 0, y: 0 } }] }),
  ]);
  assert.equal(other.result.hint, undefined);
});

/* ───────────── 0.16.2 run-stills：一场的站位图逐张落成独立图片节点 ───────────── */

test("run_stills：只有主会话；先答 approval，再按字段表与形状拒", () => {
  assert.deepEqual(RUN_STILLS_FIELDS, ["nodeId", "shotIds", "frames", "force", "approval"]);
  assert.ok(MAIN_METHODS.has("run_stills"));
  assert.ok(METHODS.has("run_stills") && MUTATIONS.has("run_stills"));
  const approval = { userApprovedNodeIds: ["s"] };
  const stills = (params, role = "main") => enforceRequestPolicy(role, "run_stills", params);
  assert.doesNotThrow(() => stills({ nodeId: "s", approval }));
  assert.doesNotThrow(() =>
    stills({
      nodeId: "s",
      approval,
      shotIds: Array.from({ length: RUN_STILLS_SHOTS_MAX }, (_, i) => `shot-${i}`),
      frames: ["start", "end"],
    }),
  );
  assert.throws(() => stills({ nodeId: "s", approval }, "worker"), policyError("worker_forbidden"));
  // approval 排在字段表之前：错写成 approved 仍然是 approval_required。
  for (const params of [
    { nodeId: "s" },
    { nodeId: "s", approved: true },
    { nodeId: "s", approval: { userApprovedNodeIds: ["other"] } },
    { nodeId: "s", approval: { userApprovedNodeIds: ["s"], extra: 1 } },
  ])
    assert.throws(() => stills(params), policyError("approval_required"));
  assert.throws(
    () => stills({ nodeId: "s", approval, shots: "all" }),
    policyError("invalid_request", /^Unexpected run_stills field: shots$/),
  );
  for (const shotIds of [
    [],
    "shot-1",
    [""],
    ["s".repeat(129)],
    [7],
    Array.from({ length: RUN_STILLS_SHOTS_MAX + 1 }, (_, i) => `shot-${i}`),
  ])
    assert.throws(
      () => stills({ nodeId: "s", approval, shotIds }),
      policyError("invalid_request", /^shotIds must be 1\.\.60 non-empty strings of at most 128/),
    );
  assert.throws(
    () => stills({ nodeId: "s", approval, shotIds: ["a", "a"] }),
    policyError("invalid_request", /^shotIds must not repeat a shot$/),
  );
  for (const frames of [[], ["middle"], ["end", "end"], ["start", "end", "start"], "both", null])
    assert.throws(
      () => stills({ nodeId: "s", approval, frames }),
      policyError("invalid_request", /^frames must be 1\.\.2 of start, end, without repeats$/),
    );
  // force（0.16.2 续跑）：只收布尔；给了 true 就连「已是最新」的也重出。
  assert.doesNotThrow(() => stills({ nodeId: "s", approval, force: true }));
  assert.doesNotThrow(() => stills({ nodeId: "s", approval, force: false }));
  for (const force of ["yes", 1, null])
    assert.throws(
      () => stills({ nodeId: "s", approval, force }),
      policyError("invalid_request", /^force must be a boolean$/),
    );
  // approval 只收在要它的方法上：run_stills 进了那张表。
  assert.throws(
    () => enforceRequestPolicy("main", "read", { paths: ["s"], approval }),
    policyError("invalid_request", /approval is only accepted/),
  );
});

test("run-stills 的 CLI：--shots all|a,b、--frames start|end|both、--force，缺 --approved 退出 2；别的命令不收这三个 flag", async () => {
  const spec = COMMAND_SPEC["run-stills"];
  assert.equal(spec.method, "run_stills");
  for (const flag of ["shots", "frames", "force", "approved"])
    assert.ok(spec.flags.includes(flag), flag);
  assert.match(spec.usage, /\[--shots all\|SHOT-ID,SHOT-ID…\]/);
  assert.match(spec.usage, /\[--frames start\|end\|both\]/);
  assert.match(spec.usage, /\[--force\]/);
  // --force 是布尔开关：不带就不送 force（页面按「已是最新就跳过」续跑）。
  assert.deepEqual(runStillsParams({ approved: true, force: true }, ["s"]), {
    nodeId: "s",
    force: true,
    approval: { userApprovedNodeIds: ["s"] },
  });
  assert.equal(parseArgs(["run-stills", "s", "--force", "--approved"]).options.force, true);
  await assert.rejects(
    execute(["run", "n1", "--force", "--approved"]),
    (error) =>
      error.code === "invalid_argument" && /^--force is not an option of run/.test(error.message),
  );
  assert.deepEqual(runStillsParams({ approved: true }, ["s"]), {
    nodeId: "s",
    approval: { userApprovedNodeIds: ["s"] },
  });
  assert.deepEqual(
    runStillsParams({ approved: true, shots: " shot-1, shot-3 ", frames: "end" }, ["s"]),
    {
      nodeId: "s",
      shotIds: ["shot-1", "shot-3"],
      frames: ["end"],
      approval: { userApprovedNodeIds: ["s"] },
    },
  );
  assert.deepEqual(runStillsParams({ approved: true, shots: "all", frames: "both" }, ["s"]), {
    nodeId: "s",
    frames: ["start", "end"],
    approval: { userApprovedNodeIds: ["s"] },
  });
  // 词表外的帧原样送给守护进程判（invalid_request），与 run --frame 同一个口径。
  assert.deepEqual(runStillsParams({ approved: true, frames: "middle" }, ["s"]).frames, ["middle"]);
  assert.throws(
    () => runStillsParams({ approved: true, shots: " , " }, ["s"]),
    (error) => error.code === "invalid_argument" && /--shots listed no shot ID/.test(error.message),
  );
  assert.throws(
    () => runStillsParams({}, ["s"]),
    (error) =>
      error.code === "approval_required" && /run-stills requires --approved/.test(error.message),
  );
  assert.throws(
    () => runStillsParams({ approved: true }, []),
    (error) =>
      error.code === "invalid_argument" && /run-stills requires a node ID/.test(error.message),
  );
  // run 也收 --shots（0.17.0 多镜：all|a,b → allShots / shotIds），与 run-stills 同一个写法。
  assert.deepEqual(runShotParams({ shots: "all" }), { allShots: true });
});

test("A71 修订：换过图的站位图由 --force 覆盖 —— run_stills 不再收 overwriteReplaced（多给即 invalid_request），CLI 不认 --overwrite-replaced", () => {
  const approval = { userApprovedNodeIds: ["s"] };
  const stills = (params) => enforceRequestPolicy("main", "run_stills", params);
  assert.throws(
    () => stills({ nodeId: "s", approval, overwriteReplaced: true }),
    policyError("invalid_request", /^Unexpected run_stills field: overwriteReplaced$/),
  );
  assert.doesNotThrow(() => stills({ nodeId: "s", approval, force: true }));
  const spec = COMMAND_SPEC["run-stills"];
  assert.equal(spec.flags.includes("overwrite-replaced"), false);
  assert.doesNotMatch(spec.usage, /overwrite-replaced/);
  assert.match(spec.usage, /\[--force\] --approved/);
  assert.deepEqual(runStillsParams({ approved: true, force: true }, ["s"]), {
    nodeId: "s",
    force: true,
    approval,
  });
  assert.throws(
    () => parseArgs(["run-stills", "s", "--overwrite-replaced", "--approved"]),
    (error) =>
      error.code === "invalid_argument" &&
      /^Unknown option --overwrite-replaced$/.test(error.message),
  );
});

test("真实守护进程：run-stills 原样进 run_stills；页面的回包原样回（退出码按 ok）；非法参数送不到页面", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const reply = {
    ok: true,
    nodeId: "desk",
    sceneDigest: "7aecea79327fa7cc",
    stills: [
      {
        shotId: "shot-1",
        frame: "end",
        nodeId: "media-1",
        url: "https://cdn.example/1.png",
        created: true,
        sceneDigest: "7aecea79327fa7cc",
      },
    ],
    failed: [],
    skipped: [],
    orphans: [],
    stillsSummary: "desk：出了 1 张站位图（新建 1 张，原地刷新 0 张）",
  };
  const pump = await f.pump((req) => {
    seen.push({ method: req.method, params: req.params });
    return reply;
  });
  t.after(() => pump.stop());
  const run = await f.cli([
    "run-stills",
    "desk",
    "--shots",
    "shot-1",
    "--frames",
    "end",
    "--approved",
  ]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(run.result, reply);
  assert.deepEqual(seen, [
    {
      method: "run_stills",
      params: {
        nodeId: "desk",
        shotIds: ["shot-1"],
        frames: ["end"],
        approval: { userApprovedNodeIds: ["desk"] },
      },
    },
  ]);
  const forced = await f.cli(["run-stills", "desk", "--force", "--approved"]);
  assert.equal(forced.code, 0, forced.stdout);
  assert.deepEqual(seen[1], {
    method: "run_stills",
    params: { nodeId: "desk", force: true, approval: { userApprovedNodeIds: ["desk"] } },
  });
  // A71 修订：换过图的由 --force 覆盖，--overwrite-replaced 没了 —— 本地就拒（退出码 2），送不到页面。
  const gone = await f.cli(["run-stills", "desk", "--overwrite-replaced", "--approved"]);
  assert.equal(gone.code, 2, gone.stdout);
  assert.equal(gone.result.error.code, "invalid_argument");
  const bad = await f.cli(["run-stills", "desk", "--frames", "middle", "--approved"]);
  assert.equal(bad.code, 1);
  assert.equal(bad.result.error.code, "invalid_request");
  const unapproved = await f.cli(["run-stills", "desk"]);
  assert.equal(unapproved.code, 2);
  assert.equal(unapproved.result.error.code, "approval_required");
  assert.equal(seen.length, 2, "被拒的 run-stills 不该送到页面");
});

test("本地预检拒收补 error.path（第一处）与顶层 hint；原文不改", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const pump = await f.pump((req) => {
    seen.push(req.method);
    return { ok: true };
  });
  t.after(() => pump.stop());
  const badOp = await f.cli([
    "apply",
    "--json",
    JSON.stringify({
      commands: [
        { type: "move_node", nodeId: "a", position: { x: 0, y: 0 } },
        scene3d([
          { op: "set_scene", gridSize: 20 },
          { op: "teleport", id: "a1" },
        ]),
      ],
    }),
  ]);
  assert.equal(badOp.code, 1);
  assert.equal(badOp.result.error.message, "Unknown scene3d action op");
  assert.equal(badOp.result.error.path, "commands[1].actions[1].op");
  assert.match(badOp.result.hint, /"teleport"/);
  assert.match(
    badOp.result.hint,
    /合法 op：add_object .*remove_shot add_act update_act remove_act$/,
  );
  assert.doesNotMatch(badOp.result.hint, /0\.16\.x/);
  const badField = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [scene3d([{ op: "add_shot", id: "s1", segmentBy: "shot" }])] }),
  ]);
  assert.equal(badField.result.error.message, "Unexpected scene3d add_shot field: segmentBy");
  assert.equal(badField.result.error.path, "commands[0].actions[0].segmentBy");
  assert.match(badField.result.hint, /add_shot 收：id .* start via follow shake$/);
  // 本地 0.17.0 自己拒的，名字恰好也是 0.17.0 新词（add_act / start / via / follow）：不许说成「对端旧了」。
  const typoAfterAct = await f.cli([
    "apply",
    "--json",
    JSON.stringify({
      commands: [
        scene3d([
          { op: "add_act", who: "boss", at: 0, pose: "sit" },
          { op: "teleport", id: "a1" },
        ]),
      ],
    }),
  ]);
  assert.equal(typoAfterAct.result.error.path, "commands[0].actions[1].op");
  assert.match(typoAfterAct.result.hint, /"teleport"/);
  assert.doesNotMatch(typoAfterAct.result.hint, /0\.16\.x/);
  for (const [action, key] of [
    [{ op: "add_act", who: "boss", at: 0, start: 1 }, "start"],
    [{ op: "transform", id: "boss", via: [{ x: 1, z: 1 }] }, "via"],
    [{ op: "add_object", prefab: "table", follow: "boss" }, "follow"],
  ]) {
    const r = await f.cli(["apply", "--json", JSON.stringify({ commands: [scene3d([action])] })]);
    assert.equal(r.result.error.path, `commands[0].actions[0].${key}`);
    assert.match(r.result.hint, new RegExp(`${action.op} 不收 ${key}；${action.op} 收：`));
    assert.doesNotMatch(r.result.hint, /0\.16\.x/);
  }
  const multi = await f.cli([
    "run",
    "desk",
    "--approved",
    "--json",
    JSON.stringify({ segmentBy: "shot" }),
  ]);
  assert.equal(multi.result.error.message, "Unexpected run_node field: segmentBy");
  assert.equal(multi.result.error.path, "run_node.segmentBy");
  assert.match(multi.result.hint, /run 不收 segmentBy（收：.* \/ sheetFrames \/ frame）/);
  assert.deepEqual(seen, [], "本地预检拒收的不该送到页面");
});

test("0.17.0：本地放行的多镜 / 动画写法被对端拒收时，守护进程报得出 0.17.0 → 旧的是页面，只点刷新（D-81）", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  // 0.16.x 的页面 / 守护进程带的是老 policy：同一句拒收原文。
  const pump = await f.pump((req) => {
    seen.push(req.method);
    return req.method === "run_node"
      ? {
          ok: false,
          error: { code: "invalid_request", message: "Unexpected run_node field: allShots" },
        }
      : { ok: false, error: { code: "invalid_request", message: "Unknown scene3d action op" } };
  });
  t.after(() => pump.stop());
  const run = await f.cli([
    "run",
    "desk",
    "--approved",
    "--json",
    JSON.stringify({ allShots: true, render: "video" }),
  ]);
  assert.equal(run.result.error.path, "run_node.allShots");
  // 本测试的守护进程就是本包这一版（0.18.2，status.packageVersion），收 0.17.0 写法：拒收的只能是 0.16.x 页面，
  // 不再支去换守护进程。
  assert.match(
    run.result.hint,
    /^allShots：这是 0\.17\.0 的多镜 \/ 动画写法，本机守护进程已是 0\.18\.2，.*刷新画布标签页/,
  );
  assert.doesNotMatch(run.result.hint, /disconnect/);
  const act = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [scene3d([{ op: "add_act", who: "boss", at: 0, pose: "sit" }])] }),
  ]);
  assert.equal(act.result.error.path, "commands[0].actions[0].op");
  assert.match(act.result.hint, /^add_act：这是 0\.17\.0 的多镜 \/ 动画写法.*刷新画布标签页/);
  assert.deepEqual(seen, ["run_node", "apply"], "0.17.0 的本地预检放行，拒收来自对端");
});

test("旧对端提示按守护进程版本分三句：≥ 0.17.0 只点刷新；status 答了却没有 packageVersion（0.16.x 守护进程）先 disconnect / connect；status 没查到两条出路都写", () => {
  // 0.17.0 是这一档的下界（守护进程收 0.17.0 写法），0.18.2 是本包这一版：都只点刷新。
  for (const version of ["0.17.0", "0.18.2"])
    assert.match(
      oldPeerHint("render", version),
      new RegExp(`^render：.*本机守护进程已是 ${version.replace(/\./g, "\\.")}.*刷新画布标签页`),
    );
  assert.match(oldPeerHint("render", "1.0.0"), /本机守护进程已是 1\.0\.0/);
  // 0.16.x 守护进程的 policy 在页面之前就拒（页面什么都收不到）：刷新没用，先换守护进程。
  for (const version of [null, "0.16.1"]) {
    const hint = oldPeerHint("via", version);
    assert.match(
      hint,
      /^via：.*守护进程还是 0\.16\.x.*`disconnect` 后重新 `connect`.*刷新画布标签页/,
    );
    assert.ok(hint.indexOf("disconnect") < hint.indexOf("刷新"), hint);
  }
  for (const version of [undefined, ""]) {
    const hint = oldPeerHint("via", version);
    // 版本不明：句式与 0.17.0 起点（上面「老页面 / 老守护进程」那条）一致，先刷新，再 disconnect / connect。
    assert.match(
      hint,
      /^via：这是 0\.17\.0 的多镜 \/ 动画写法.*刷新画布标签页.*`disconnect` 后重新 `connect`/,
    );
  }
});

test("0.16.2 才有的（run --frame、run-stills、docs read --if-version）被 0.16.1 对端拒收：同样点明出路，不自相矛盾（B10）", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  // 0.16.1 的页面（合流前没刷新的）：policy 的原话。
  const pump = await f.pump((req) => {
    seen.push(req.method);
    if (req.method === "run_node")
      return {
        ok: false,
        error: { code: "invalid_request", message: "Unexpected run_node field: frame" },
      };
    if (req.method === "run_stills")
      return { ok: false, error: { code: "method_not_allowed", message: "Unknown canvas method" } };
    return {
      ok: false,
      error: { code: "invalid_request", message: "Unexpected documents_get field: ifVersion" },
    };
  });
  t.after(() => pump.stop());
  const page =
    /^\S+：这是 0\.16\.2 起才有的写法.*本机守护进程已是 0\.18\.2，拒收的是还没刷新的画布页面/;
  const frame = await f.cli(["run", "desk", "--shot", "s1", "--frame", "end", "--approved"]);
  assert.equal(frame.result.error.path, "run_node.frame");
  assert.match(frame.result.hint, page);
  assert.doesNotMatch(frame.result.hint, /不收 frame/);
  const stills = await f.cli(["run-stills", "desk", "--approved"]);
  assert.equal(stills.result.error.code, "method_not_allowed");
  assert.match(stills.result.hint, /^run-stills：/);
  assert.match(stills.result.hint, page);
  const doc = await f.cli(["docs", "read", "doc-1", "--if-version", "3"]);
  assert.equal(doc.result.error.path, "documents_get.ifVersion");
  assert.match(doc.result.hint, /^ifVersion：/);
  assert.match(doc.result.hint, page);
  assert.deepEqual(seen, ["run_node", "run_stills", "documents_get"]);
});

test("0.16.2 那一档的旧对端提示：0.16.x 守护进程（没有 packageVersion）先 disconnect / connect；版本不明两条都写", () => {
  const daemon = oldPeerHint("run-stills", null, "0.16.2");
  assert.match(
    daemon,
    /^run-stills：这是 0\.16\.2 起才有的写法.*守护进程还是 0\.16\.x.*`disconnect`/,
  );
  assert.ok(daemon.indexOf("disconnect") < daemon.indexOf("刷新"), daemon);
  assert.match(
    oldPeerHint("frame", undefined, "0.16.2"),
    /^frame：这是 0\.16\.2 起才有的写法.*拒收的对端还是 0\.16\.1：先请用户刷新画布标签页.*`disconnect`/,
  );
  // 缺省仍是 0.17.0 那一档，原有措辞不变。
  assert.match(oldPeerHint("via", undefined), /^via：这是 0\.17\.0 的多镜 \/ 动画写法/);
});

test("0.16.1 的守护进程不认 run_stills（invalid_request「supported method」）：补 0.16.2 的旧对端提示", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const pump = await f.pump(() => ({
    ok: false,
    error: {
      code: "invalid_request",
      message: "Expected requestId UUID, supported method, params object, and turnId",
    },
  }));
  t.after(() => pump.stop());
  const stills = await f.cli(["run-stills", "desk", "--approved"]);
  assert.match(stills.result.hint, /^run-stills：这是 0\.16\.2 起才有的写法/);
});

test("0.18.2 的在场模型（add_act / update_act 的 do、set_figure 的 offstage）被 0.18.1 对端拒收：补旧对端提示，不自相矛盾（A102 ⑧）", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  // 0.18.1 的页面（没刷新的）带的是老 policy：同一句拒收原文。
  const pump = await f.pump((req) => {
    const action = req.params.commands[0].actions[0];
    seen.push(action.op);
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: `Unexpected scene3d ${action.op} field: ${action.op === "set_figure" ? "offstage" : "do"}`,
      },
    };
  });
  t.after(() => pump.stop());
  for (const [action, key] of [
    [{ op: "add_act", who: "bing", at: 3, do: "@enter", to: { x: 1, y: 0, z: 0 } }, "do"],
    [{ op: "update_act", id: "a1", do: "@offstage" }, "do"],
    [{ op: "set_figure", id: "bing", offstage: true }, "offstage"],
  ]) {
    const r = await f.cli(["apply", "--json", JSON.stringify({ commands: [scene3d([action])] })]);
    assert.equal(r.result.error.path, `commands[0].actions[0].${key}`);
    // 本测试的守护进程就是本包这一版（报得出 ≥ 0.18.2）：拒收的只能是还没刷新的页面
    assert.match(
      r.result.hint,
      new RegExp(
        `^${key}：这是 0\\.18\\.2 起才有的写法（在场模型.*本机守护进程已是 0\\.18\\.2，拒收的是还没刷新的画布页面`,
      ),
    );
    // 站点退路：旧站点没有在场模型，去掉 do / offstage
    assert.match(r.result.hint, /部署的还是 0\.18\.1 或更早.*去掉 do \/ offstage/);
    assert.doesNotMatch(r.result.hint, /不收/);
  }
  assert.deepEqual(seen, ["add_act", "update_act", "set_figure"], "本地预检放行，拒收来自对端");
  // 守护进程报 0.18.1（或 0.16.x 没有版本号）：是它的 policy 拒收的，先 disconnect / connect
  for (const version of ["0.18.1", null]) {
    const daemon = oldPeerHint("do", version, "0.18.2");
    assert.match(daemon, /^do：这是 0\.18\.2 起才有的写法.*`disconnect` 后重新 `connect`/);
    assert.ok(daemon.indexOf("disconnect") < daemon.indexOf("刷新"), daemon);
    if (version) assert.match(daemon, /本机守护进程还是 0\.18\.1/);
  }
  // 版本不明：两条出路都写
  assert.match(
    oldPeerHint("offstage", undefined, "0.18.2"),
    /^offstage：这是 0\.18\.2 起才有的写法.*刷新画布标签页.*`disconnect` 后重新 `connect`/,
  );
});

test("run-batch 不收的字段补 path 与 hint：指去逐节点 run --shots / --render", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const run = await f.cli([
    "run-batch",
    "--nodes",
    "a,b",
    "--json",
    JSON.stringify({ render: "video" }),
    "--approved",
  ]);
  assert.equal(run.code, 1, run.stdout);
  assert.equal(run.result.error.message, "Unexpected run_nodes field: render");
  assert.equal(run.result.error.path, "run_nodes.render");
  assert.match(
    run.result.hint,
    /^run-batch 不收 render（收：nodeIds \/ groupId.*run NODE --shots … --render …/,
  );
});

test("真实守护进程：status 与 connect 回包带 packageVersion（= package.json）", async (t) => {
  const f = await fixture(t);
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(f.info.packageVersion, pkg.version);
  const status = await f.cli(["status"]);
  assert.equal(status.result.packageVersion, pkg.version);
});

test("run 的 0.17.0 flag：--shots / --render / --frames 拼成 run_node 参数，组合错误在本地就拒", () => {
  assert.deepEqual(runShotParams({ shots: "all", render: "video" }), {
    allShots: true,
    render: "video",
  });
  assert.deepEqual(runShotParams({ shots: " s1, s2 ,," }), { shotIds: ["s1", "s2"] });
  assert.deepEqual(runShotParams({ render: "sheet", frames: "5" }), {
    render: "sheet",
    sheetFrames: 5,
  });
  assert.deepEqual(runShotParams({}), {});
  const invalid = (re) => (error) => error.code === "invalid_argument" && re.test(error.message);
  assert.throws(() => runShotParams({ shot: "s1", shots: "s2" }), invalid(/either --shot/));
  assert.throws(() => runShotParams({ shots: " , " }), invalid(/--shots needs/));
  assert.throws(() => runShotParams({ render: "gif" }), invalid(/still\|video\|sheet/));
  assert.throws(() => runShotParams({ frames: "5" }), invalid(/only goes with --render sheet/));
  assert.throws(() => runShotParams({ render: "sheet", frames: "4" }), invalid(/3\|5\|9/));
  // --await：整数秒 0–240；像毫秒的数一样拒。
  assert.equal(awaitSeconds(undefined), 0);
  assert.equal(awaitSeconds("180"), 180);
  for (const raw of ["-1", "241", "1.5", "90000", "abc"])
    assert.throws(() => awaitSeconds(raw), invalid(/--await 的单位是秒，0–240/));
});

test("真实守护进程：run --shots / --render / --frames 进 run_node；snapshot --edges 进 edges；run … --wait 90 本地拒", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const pump = await f.pump((req) => {
    seen.push({ method: req.method, params: req.params });
    return { ok: true, submitted: true, local: true, outputs: [], pending: [], failed: [] };
  });
  t.after(() => pump.stop());
  const run = await f.cli([
    "run",
    "--shots",
    "s1,s2",
    "desk",
    "--render",
    "sheet",
    "--frames",
    "9",
    "--approved",
  ]);
  assert.equal(run.code, 0, run.stdout);
  const snap = await f.cli(["snapshot", "--edges", "touching"]);
  assert.equal(snap.code, 0, snap.stdout);
  assert.deepEqual(seen, [
    {
      method: "run_node",
      params: {
        nodeId: "desk",
        approval: { userApprovedNodeIds: ["desk"] },
        shotIds: ["s1", "s2"],
        render: "sheet",
        sheetFrames: 9,
      },
    },
    { method: "snapshot", params: { edges: "touching" } },
  ]);
  // A-12：`--wait` 是布尔（页面不在时排队等），90 不是它的值。
  const wait = await f.cli(["run", "desk", "--render", "video", "--wait", "90", "--approved"]);
  assert.equal(wait.code, 2);
  assert.equal(wait.result.error.code, "invalid_argument");
  assert.equal(wait.result.hint, "要等出片请用 --await <秒>；--wait 是页面不在时的排队等待");
  const both = await f.cli(["run", "desk", "--shot", "s1", "--shots", "all", "--approved"]);
  assert.equal(both.result.error.code, "invalid_argument");
  const ms = await f.cli(["run", "desk", "--await", "90000", "--approved"]);
  assert.equal(ms.result.error.message, "--await 的单位是秒，0–240");
  assert.equal(seen.length, 2, "本地拒掉的不该送到页面");
});

test("formatScene3dScene：一对象 / 机位 / 镜 / 动作一行；14 对象 6 镜 ≤ 3 KB（M6）", () => {
  const fixtureScene = JSON.parse(
    readFileSync(path.join(packageRoot, "test/fixtures/host-text/read-node-scene.json"), "utf8"),
  ).nodes[0].scene;
  const text = formatScene3dScene(fixtureScene);
  const lines = text.split("\n");
  assert.equal(
    lines[0],
    "画幅 16:9；对象 4 个，机位 1 台（当前 cam-default），镜头 3 个，调度动作 0 条；轴线 boss↔off",
  );
  assert.ok(
    lines.includes("- off「人物」 human @(0.4,0,1.2) 转60° pose stand arms hold gaze boss"),
  );
  assert.ok(lines.includes("- chair prop box/chair @(1.5,0.45,0.5) 缩放(0.5,0.9,0.5)"));
  assert.ok(
    lines.includes(
      "- 镜2 shot-2 中景：环绕 (-0.4,1.4,-0.3) r2.4 -110°→-20° 高1.5，看 boss，fov 22.9，5 s",
    ),
  );
  assert.equal(lines.filter((line) => line.startsWith("- ")).length, 4 + 1 + 3);
  // M6 量级：14 对象（一半人物）6 镜（via / follow / shake / start 都用上）；另加 12 条动作只数行。
  const v = (x, y, z) => ({ x, y, z });
  const big = {
    aspectRatio: "16:9",
    activeCameraId: "cam-1",
    axis: ["fig-1", "fig-2"],
    objects: Array.from({ length: 14 }, (_, i) => ({
      id: i < 7 ? `fig-${i + 1}` : `prop-${i}`,
      name: i < 7 ? `人物${i + 1}` : `道具${i}`,
      role: i < 7 ? "figure" : "set",
      kind: i < 7 ? "human" : "box",
      ...(i < 7 ? {} : { prefab: "table" }),
      transform: {
        position: v(i * 0.37, 0, -i * 0.41),
        rotation: v(0, i * 15, 0),
        scale: v(1, 1, 1),
      },
      ...(i < 7
        ? { human: { bodyType: "tall" }, figure: { pose: "stand", arms: "down", facing: "fig-1" } }
        : {}),
    })),
    cameras: [{ id: "cam-1", name: "机位1", position: v(0, 3, 8), target: v(0, 1, 0), fov: 45 }],
    shots: Array.from({ length: 6 }, (_, i) => ({
      id: `shot-${i + 1}`,
      n: i + 1,
      framing: "中近景",
      cam: v(1.25, 1.55, 2.75),
      to: v(1.5, 1.6, 2.5),
      via: [{ t: 0.5, cam: v(1.35, 1.6, 2.6) }],
      look: "fig-1",
      fov: 23.4,
      dur: 3.5,
      start: i * 3.5,
      follow: "fig-2",
      shake: "light",
    })),
    blocking: Array.from({ length: 12 }, (_, i) => ({
      id: `act-${i + 1}`,
      who: `fig-${(i % 7) + 1}`,
      at: i * 1.5,
      to: v(i * 0.5, 0, 1.25),
      gait: "walk",
      gesture: "wave",
    })),
  };
  const sceneText = formatScene3dScene({ ...big, blocking: undefined });
  assert.ok(Buffer.byteLength(sceneText) <= 3072, `${Buffer.byteLength(sceneText)} B`);
  const bigText = formatScene3dScene(big);
  assert.equal(bigText.split("\n").filter((line) => line.startsWith("- ")).length, 14 + 1 + 6 + 12);
  assert.ok(bigText.includes("- act-12 fig-5 @16.5 s：走到 (5.5,0,1.25)，gait walk，gesture wave"));
  // 认不出的形状不抛：缺的值写 ?。
  assert.equal(
    formatScene3dScene({}),
    "画幅 ?；对象 0 个，机位 0 台（当前 ?），镜头 0 个，调度动作 0 条",
  );
});

test("formatScene3dScene：并行线 0.16.3 的字段——前倾写度数、镜头的起止状态、子镜头各一行（B12 复核）", () => {
  const v = (x, y, z) => ({ x, y, z });
  const text = formatScene3dScene({
    aspectRatio: "16:9",
    activeCameraId: "c1",
    objects: [
      {
        id: "f1",
        name: "甲",
        role: "figure",
        kind: "human",
        transform: { position: v(0, 0, 0) },
        figure: { pose: "sit", seat: "chair", lean: 15, heldR: "cup" },
      },
    ],
    cameras: [],
    shots: [
      {
        id: "s1",
        n: 1,
        cam: v(0, 1.6, 4),
        look: "f1",
        fov: 40,
        dur: 6,
        states: [
          { who: "f1", from: { pose: "stand" }, to: { pose: "sit", seat: "chair", heldR: null } },
        ],
        cuts: [
          { id: "a", n: 1, dur: 2, framing: "WS", cam: v(0, 1.6, 6), look: "f1", fov: 50 },
          { id: "b", n: 2, dur: 4, framing: "CU", cam: v(1, 1.5, 1), look: "f1", fov: 25 },
        ],
      },
    ],
  });
  const lines = text.split("\n");
  assert.ok(
    lines.includes("- f1「甲」 human @(0,0,0) pose sit seat chair lean 15 heldR cup"),
    text,
  );
  assert.ok(
    lines.includes(
      "- 镜1 s1：机位 (0,1.6,4)，看 f1，fov 40，6 s，起止 f1 pose stand→sit seat ·→chair heldR ·→清掉，分 2 个子镜头（见下）",
    ),
    text,
  );
  assert.ok(lines.includes("- 子镜头1 a WS：机位 (0,1.6,6)，看 f1，fov 50，2 s"), text);
  assert.ok(lines.includes("- 子镜头2 b CU：机位 (1,1.5,1)，看 f1，fov 25，4 s"), text);
});

test("formatScene3dChecks：结论行 + 每条原话（health / 越轴 / 切点 / 取景 / 动作）", () => {
  const checks = {
    health: [
      { level: "block", code: "shot_missing_cam", message: "镜 2 没有机位", path: "shots[1]" },
      { level: "warn", code: "act_conflict", message: "a2 与 a1 的手臂重叠" },
    ],
    axis: { applicable: true, ok: true, offside: [], message: "没有越轴" },
    cuts: [
      { fromId: "s1", toId: "s2", from: 1, to: 2, angle: 12.25, jump: true, message: "低于 30°" },
      {
        fromId: "s2",
        toId: "s3",
        from: 2,
        to: 3,
        angle: 20,
        jump: false,
        exempt: "resize",
        message: "景别跨档",
      },
    ],
    framing: [{ level: "warn", code: "head_out", shotId: "s1", t: [0, 1.25], message: "头出画" }],
    motion: [{ level: "info", code: "move_while_posed", message: "插入起身 1 s" }],
  };
  assert.equal(
    formatScene3dChecks(checks),
    [
      "自检：1 处拦下，1 处提醒；取景提醒 1 处；动作提醒 1 处",
      "- [block] shot_missing_cam：镜 2 没有机位（shots[1]）",
      "- [warn] act_conflict：a2 与 a1 的手臂重叠",
      "越轴：没有越轴",
      "切 镜1→镜2 12.25° 跳切：低于 30°",
      "切 镜2→镜3 20°（豁免：景别跨档）：景别跨档",
      "- 取景 s1 [head_out] 0–1.25 s：头出画",
      "- 动作 [info] move_while_posed：插入起身 1 s",
    ].join("\n"),
  );
  // 0.16.x 形状（没有 framing / motion 键）：结论行不提这两段。
  assert.equal(
    formatScene3dChecks({ health: [], axis: checks.axis, cuts: [] }),
    "自检：0 处拦下，0 处提醒\n越轴：没有越轴",
  );
});
