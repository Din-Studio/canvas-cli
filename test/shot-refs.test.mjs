import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execute, oldPeerHint, parseArgs, runShotRefsParams } from "../src/cli.mjs";
import { callDeadlineMs } from "../src/client.mjs";
import { METHODS, MUTATIONS } from "../src/common.mjs";
import { CANVAS_CONTRACT, SCENE3D } from "../src/contract.mjs";
import {
  enforceRequestPolicy,
  MAIN_METHODS,
  methodCallTimeoutMs,
  RequestPolicyError,
  RUN_SHOT_REFS_BUDGET_MS,
  RUN_SHOT_REFS_CALL_MS,
  RUN_SHOT_REFS_FIELDS,
  RUN_STILLS_SHOTS_MAX,
} from "../src/policy.mjs";
import { COMMAND_SPEC } from "../src/spec.mjs";
import { fixture, packageRoot } from "./helpers.mjs";

/**
 * 0.18.0 T3 —— 一条命令出齐每镜三样参考（`run-shot-refs`，线协议 `run_shot_refs`）：每镜按序出开始站位图 →
 * 结束站位图 → 预演，页面单渲染槽串行，总预算按镜数算（每镜 15 s + 每帧 250 ms + 两张各 25 s），封顶
 * `SCENE3D.limits.shotRefsBudgetMs`；守护进程与 CLI 等这一条答复放宽到 `shotRefsCallMs`。这里钉 CLI / 守护进程 / 契约
 * 这一侧；页面侧（计划、续跑、page_away、回包）在 tests/studio/scene3d-shot-refs.test.ts。
 */

const policyError = (code, re) => (error) =>
  error instanceof RequestPolicyError && error.code === code && (!re || re.test(error.message));
const approval = { userApprovedNodeIds: ["s"] };
const refs = (params, role = "main") => enforceRequestPolicy(role, "run_shot_refs", params);

test("run_shot_refs：只有主会话；先答 approval，再按字段表与形状拒", () => {
  assert.deepEqual(RUN_SHOT_REFS_FIELDS, ["nodeId", "shotIds", "force", "approval"]);
  assert.ok(MAIN_METHODS.has("run_shot_refs"));
  assert.ok(METHODS.has("run_shot_refs") && MUTATIONS.has("run_shot_refs"));
  assert.doesNotThrow(() => refs({ nodeId: "s", approval }));
  assert.doesNotThrow(() =>
    refs({
      nodeId: "s",
      approval,
      shotIds: Array.from({ length: RUN_STILLS_SHOTS_MAX }, (_, i) => `S${i}`),
      force: true,
    }),
  );
  assert.throws(() => refs({ nodeId: "s", approval }, "worker"), policyError("worker_forbidden"));
  for (const params of [
    { nodeId: "s" },
    { nodeId: "s", approved: true },
    { nodeId: "s", approval: { userApprovedNodeIds: ["other"] } },
    { nodeId: "s", approval: { userApprovedNodeIds: ["s"], extra: 1 } },
  ])
    assert.throws(() => refs(params), policyError("approval_required"));
  // 帧没有选项（每镜三样都出），多给即报错
  for (const key of ["frames", "render", "shots", "previz"])
    assert.throws(
      () => refs({ nodeId: "s", approval, [key]: true }),
      policyError("invalid_request", new RegExp(`^Unexpected run_shot_refs field: ${key}$`)),
    );
  for (const shotIds of [
    [],
    "S01",
    [""],
    ["s".repeat(129)],
    [7],
    Array.from({ length: RUN_STILLS_SHOTS_MAX + 1 }, (_, i) => `S${i}`),
  ])
    assert.throws(
      () => refs({ nodeId: "s", approval, shotIds }),
      policyError("invalid_request", /^shotIds must be 1\.\.60 non-empty strings of at most 128/),
    );
  assert.throws(
    () => refs({ nodeId: "s", approval, shotIds: ["a", "a"] }),
    policyError("invalid_request", /^shotIds must not repeat a shot$/),
  );
  for (const force of ["yes", 1, null])
    assert.throws(
      () => refs({ nodeId: "s", approval, force }),
      policyError("invalid_request", /^force must be a boolean$/),
    );
});

test("run-shot-refs 的 CLI：--shots all|a,b、--force（都是已有旗标，不加新布尔旗标），缺 --approved 退出 2", async () => {
  const spec = COMMAND_SPEC["run-shot-refs"];
  assert.equal(spec.method, "run_shot_refs");
  assert.deepEqual(
    spec.flags.filter(
      (flag) =>
        !["session", "json", "file", "request-id", "wait", "wait-ms", "turn"].includes(flag),
    ),
    ["node", "shots", "force", "approved"],
  );
  assert.match(spec.usage, /^<node-id> \[--shots all\|SHOT-ID,SHOT-ID…\] \[--force\] --approved/);
  assert.deepEqual(runShotRefsParams({ approved: true }, ["s"]), { nodeId: "s", approval });
  assert.deepEqual(runShotRefsParams({ approved: true, shots: " S01, S03 ", force: true }, ["s"]), {
    nodeId: "s",
    shotIds: ["S01", "S03"],
    force: true,
    approval,
  });
  assert.deepEqual(runShotRefsParams({ approved: true, shots: "all" }, ["s"]), {
    nodeId: "s",
    approval,
  });
  assert.equal(parseArgs(["run-shot-refs", "s", "--force", "--approved"]).options.force, true);
  assert.throws(
    () => runShotRefsParams({}, ["s"]),
    (error) =>
      error.code === "approval_required" &&
      /^run-shot-refs requires --approved/.test(error.message),
  );
  assert.throws(
    () => runShotRefsParams({ approved: true }, []),
    (error) =>
      error.code === "invalid_argument" && /run-shot-refs requires a node ID/.test(error.message),
  );
  assert.throws(
    () => runShotRefsParams({ approved: true, shots: " , " }, ["s"]),
    (error) => error.code === "invalid_argument" && /--shots listed no shot ID/.test(error.message),
  );
  // --frames 不是它的旗标（每镜三样都出）
  await assert.rejects(
    execute(["run-shot-refs", "s", "--frames", "end", "--approved"]),
    (error) =>
      error.code === "invalid_argument" &&
      /^--frames is not an option of run-shot-refs/.test(error.message),
  );
});

test("契约：分级 L2、不是生成扣费项、只有主会话；三样的顺序；上限：镜头数、总预算封顶与调用等待，与 policy 同一个数", () => {
  assert.deepEqual(CANVAS_CONTRACT.tiers["run-shot-refs"], {
    level: "L2",
    method: "run_shot_refs",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
    billable: false,
  });
  assert.deepEqual(SCENE3D.shotRefParts, ["start", "end", "previz"]);
  assert.deepEqual(CANVAS_CONTRACT.limits["run_shot_refs.shotIds"], {
    min: 1,
    max: SCENE3D.limits.shots,
    itemMaxLength: 128,
  });
  assert.equal(SCENE3D.limits.shotRefsBudgetMs, RUN_SHOT_REFS_BUDGET_MS);
  assert.equal(SCENE3D.limits.shotRefsCallMs, RUN_SHOT_REFS_CALL_MS);
  // 封顶 240 s（与 run --await 的上限同一个数：整条命令 ≈ 255 s，低于两宿主写档的 300 s）；等待 = 封顶 + 15 s 收尾
  assert.equal(RUN_SHOT_REFS_BUDGET_MS, 240_000);
  assert.equal(RUN_SHOT_REFS_CALL_MS, RUN_SHOT_REFS_BUDGET_MS + 15_000);
  assert.ok(RUN_SHOT_REFS_CALL_MS + 30_000 + 5_000 < 300_000);
});

test("守护进程与 CLI 等这一条答复按方法放宽：run_shot_refs 至少等到 预算封顶 + 15 s；别的方法照旧是会话的 callTimeoutMs", () => {
  assert.equal(methodCallTimeoutMs("run_shot_refs", 120_000), RUN_SHOT_REFS_CALL_MS);
  assert.equal(methodCallTimeoutMs("run_shot_refs", 400_000), 400_000);
  for (const method of ["run_stills", "run_node", "read", "apply"])
    assert.equal(methodCallTimeoutMs(method, 120_000), 120_000);
  const session = { callTimeoutMs: 120_000 };
  assert.equal(
    callDeadlineMs(session, { method: "run_shot_refs" }),
    RUN_SHOT_REFS_CALL_MS + 30_000 + 5_000,
  );
  assert.equal(callDeadlineMs(session, { method: "run_stills" }), 120_000 + 30_000 + 5_000);
  // 守护进程的计时器用的是同一个函数（送达时、恢复时、建记录时）
  const daemon = readFileSync(path.join(packageRoot, "src", "daemon.mjs"), "utf8");
  assert.equal(daemon.match(/armTimer\(record, callTimeoutMs\)/g), null);
  assert.ok((daemon.match(/armTimer\(record, callTimeoutFor\(record\)\)/g) ?? []).length >= 3);
});

test("真实守护进程：run-shot-refs 原样进 run_shot_refs；页面的回包原样回（退出码按 ok）；非法参数送不到页面", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const reply = {
    ok: true,
    nodeId: "desk",
    sceneDigest: "7aecea79327fa7cc",
    shots: [
      {
        shotId: "S01",
        n: 1,
        start: { nodeId: "media-1", url: "https://cdn.example/1.png" },
        end: { nodeId: "media-2", url: "https://cdn.example/2.png" },
        previz: { nodeId: "s3v-0123456789", url: "https://cdn.example/3.mp4", durationS: 4 },
        created: ["start", "end", "previz"],
        skipped: [],
        failed: [],
      },
    ],
    orphans: [],
    shotRefsSummary: "desk：1 镜出齐三样参考",
  };
  const pump = await f.pump((req) => {
    seen.push({ method: req.method, params: req.params });
    return reply;
  });
  t.after(() => pump.stop());
  const run = await f.cli(["run-shot-refs", "desk", "--shots", "S01", "--approved"]);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(run.result, reply);
  const forced = await f.cli(["run-shot-refs", "desk", "--force", "--approved"]);
  assert.equal(forced.code, 0, forced.stdout);
  assert.deepEqual(seen, [
    {
      method: "run_shot_refs",
      params: { nodeId: "desk", shotIds: ["S01"], approval: { userApprovedNodeIds: ["desk"] } },
    },
    {
      method: "run_shot_refs",
      params: { nodeId: "desk", force: true, approval: { userApprovedNodeIds: ["desk"] } },
    },
  ]);
  const unapproved = await f.cli(["run-shot-refs", "desk"]);
  assert.equal(unapproved.code, 2);
  assert.equal(unapproved.result.error.code, "approval_required");
  assert.equal(seen.length, 2, "被拒的 run-shot-refs 不该送到页面");
});

test("0.17.0 的对端不认 run_shot_refs：补 0.18.0 的旧对端提示（页面旧 → 刷新；守护进程旧 → 重连），站点退路只给 run-stills（剧本转视频建的场景出不了预演）", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const pump = await f.pump(() => ({
    ok: false,
    error: { code: "method_not_allowed", message: "Unknown canvas method" },
  }));
  t.after(() => pump.stop());
  const run = await f.cli(["run-shot-refs", "desk", "--approved"]);
  assert.equal(run.result.error.code, "method_not_allowed");
  assert.match(run.result.hint, /^run-shot-refs：这是 0\.18\.0 起才有的写法/);
  // 本机守护进程报得出 ≥ 0.18.0（与 CLI 同包）：旧的是页面
  const page = oldPeerHint("run-shot-refs", "0.18.0", "0.18.0");
  assert.match(page, /本机守护进程已是 0\.18\.0，拒收的是还没刷新的画布页面/);
  // 站点退路：旧站点（0.17.0）对剧本转视频建的场景拒收 run --render video，只给 run-stills（A 线验收建议 4）
  assert.match(page, /只能 run-stills <nodeId> 出每镜开始 \/ 结束站位图/);
  assert.match(page, /剧本转视频建的场景[^；]*出不了预演（run --render video 会被拒/);
  assert.doesNotMatch(page, /分两步/);
  // 守护进程报 0.17.0（或 0.16.x 没有版本号）：是它拒收的，先 disconnect / connect
  for (const version of ["0.17.0", null]) {
    const daemon = oldPeerHint("run-shot-refs", version, "0.18.0");
    assert.match(
      daemon,
      /^run-shot-refs：这是 0\.18\.0 起才有的写法.*`disconnect` 后重新 `connect`/,
    );
    assert.ok(daemon.indexOf("disconnect") < daemon.indexOf("刷新"), daemon);
    if (version) assert.match(daemon, /本机守护进程还是 0\.17\.0/);
  }
  // 版本不明：两条出路都写
  assert.match(
    oldPeerHint("run-shot-refs", undefined, "0.18.0"),
    /^run-shot-refs：这是 0\.18\.0 起才有的写法.*刷新画布标签页.*`disconnect` 后重新 `connect`/,
  );
});
