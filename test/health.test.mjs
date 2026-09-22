import test from "node:test";
import assert from "node:assert/strict";
import {
  decorate,
  execute,
  formatHealthReport,
  HEALTH_KIND_TITLES,
  parseArgs,
} from "../src/cli.mjs";
import { COMMAND_SPEC } from "../src/spec.mjs";
import { enforceRequestPolicy, RequestPolicyError } from "../src/policy.mjs";
import { CANVAS_CONTRACT } from "../src/contract.mjs";
import { injectSession } from "../src/host-argv.mjs";
import { fixture } from "./helpers.mjs";

const SESSION_ID = "11111111-2222-3333-4444-555555555555";

/**
 * A5 `health` 的 CLI 一侧。守的是三件事，每一件都有案底形状：
 *  ① `--limit` 真的映射成 `maxIssues`（snapshot 的 `--limit → maxNodes` 当年没写进
 *    help，Agent 只能读源码才知道有这个参数）；
 *  ② 守护进程对参数「多给即报错」，不静默丢弃 —— 丢掉一个 `maxIssues` 意味着
 *    Agent 以为自己把明细表调大了、实际拿回默认条数，然后照着半张表下结论；
 *  ③ 文本报告真的接在 `execute` 的出口上。渲染函数单测过、却没接到 `decorate` 上，
 *    正是 `tidied` 整段走丢的那一档故障。
 */

const policyError = (re) => (error) =>
  error instanceof RequestPolicyError && error.code === "invalid_request" && re.test(error.message);

test("health --limit 就是 maxIssues，且这条命令不收别的 flag", async () => {
  assert.equal(COMMAND_SPEC.health.method, "health");
  assert.equal(parseArgs(["health", "--limit", "500"]).options.limit, "500");
  await assert.rejects(
    execute(["health", "--glob", "*"]),
    (error) =>
      error.code === "invalid_argument" && /--glob is not an option of health/.test(error.message),
  );
  // usage 必须写明 `--limit` 映射到什么 —— 不写的话 Agent 只能靠猜。
  assert.match(COMMAND_SPEC.health.usage, /maxIssues/);
});

test("守护进程对 health 的参数多给即报错，maxIssues 有上下界", () => {
  const ok = (params) => enforceRequestPolicy("main", "health", params);
  assert.doesNotThrow(() => ok({}));
  assert.doesNotThrow(() => ok({ maxIssues: 1 }));
  assert.doesNotThrow(() => ok({ maxIssues: 1000, groupMinMembers: 2 }));
  assert.throws(() => ok({ limit: 10 }), policyError(/Unexpected health field: limit/));
  assert.throws(() => ok({ maxIssues: 0 }), policyError(/maxIssues must be an integer/));
  assert.throws(() => ok({ maxIssues: 1001 }), policyError(/maxIssues must be an integer/));
  assert.throws(() => ok({ maxIssues: 2.5 }), policyError(/maxIssues must be an integer/));
  assert.throws(
    () => ok({ groupMinMembers: -1 }),
    policyError(/groupMinMembers must be a non-negative integer/),
  );
  // 只读方法：delegate 出来的 worker 也能体检（读路径一律开放）。
  assert.doesNotThrow(() => enforceRequestPolicy("worker", "health", {}));
  // 上下界与契约那一份是同一个数。
  assert.equal(CANVAS_CONTRACT.limits["health.maxIssues"].max, 1000);
});

const REPLY = {
  canvasId: "c-1",
  rev: 42,
  seq: 7,
  scanned: { nodes: 2400, groups: 40, edges: 120 },
  counts: {
    dangling_mention: 1,
    member_escaped: 4,
    group_frame_oversize: 0,
    stray_over_frame: 0,
    group_overlap: 0,
    node_overlap: 0,
    group_empty: 0,
    group_undersized: 0,
  },
  totalIssues: 5,
  issues: [
    { kind: "dangling_mention", nodeId: "n-1", otherId: "n-gone", message: "n-1 @ 了 n-gone。" },
    {
      kind: "member_escaped",
      nodeId: "n-2",
      groupId: "g-1",
      message: "n-2 跑到 g-1 框外。",
      fix: ["tidy", "--scope", "selection", "--groups", "g-1", "--fit-frames"],
    },
    { kind: "member_escaped", nodeId: "n-3", groupId: "g-1", message: "n-3 跑到 g-1 框外。" },
    { kind: "member_escaped", nodeId: "n-4", groupId: "g-1", message: "n-4 跑到 g-1 框外。" },
    { kind: "member_escaped", nodeId: "n-5", groupId: "g-1", message: "n-5 跑到 g-1 框外。" },
  ],
  healthy: false,
};

test("文本报告：先给规模和分类计数，再给每类前三条明细和可直接粘贴的修复命令", () => {
  const report = formatHealthReport(REPLY);
  assert.match(report, /扫了 2400 个节点 \/ 40 个组/);
  assert.match(report, /共 5 条问题/);
  // 计数行按类给出，0 的类别不刷屏。
  assert.match(report, /member_escaped\s+4/);
  assert.ok(!report.includes("group_overlap"), "计数为 0 的类别不该出现");
  // 修复命令带上可执行的二进制名；会话怎么补由报告里那一句统一说（见下一条用例）。
  assert.match(report, /修复：scenemint-canvas tidy --scope selection --groups g-1 --fit-frames/);
  // 每类最多三条明细：第四条成员出框不列出来，靠计数说话。
  assert.ok(report.includes("n-2") && report.includes("n-4"));
  assert.equal(report.includes("n-5"), false, "第四条明细不该被列出来");
  assert.match(report, /全部 4 条，下面 3 条/);
});

/**
 * 顶部那句 `omittedIssues` 是**全体**的合计。一张「2000 个节点堆在同一处」的画布上
 * `node_overlap` 会有 49 万条，而顶部只说「还有 N 条没列出来」—— 弱模型据此推不出
 * 「这一类有多离谱」，也就不知道该先跟用户说话还是继续 `--limit`。所以每一类的
 * 抬头自己也要报数。
 */
test("每一类的抬头自己说清「这一类还有几条没列出来」", () => {
  const report = formatHealthReport({
    ...REPLY,
    counts: { member_escaped: 1, node_overlap: 498_222 },
    totalIssues: 498_223,
    truncated: true,
    omittedIssues: 498_123,
    issues: [
      { kind: "member_escaped", nodeId: "n-1", groupId: "g-1", message: "n-1 跑到 g-1 框外。" },
      ...Array.from({ length: 99 }, (_, i) => ({
        kind: "node_overlap",
        nodeId: `n-${i}`,
        otherId: `m-${i}`,
        message: `n-${i} 和 m-${i} 叠在一起。`,
      })),
    ],
  });
  assert.match(report, /node_overlap（全部 498222 条，下面 3 条，这一类还有 498219 条没列出来）/);
  // 一条不落地列完的那一类不许多嘴。
  assert.match(report, /member_escaped（全部 1 条，下面 1 条）/);
});

/**
 * 截断这件事必须在报告的**开头**说清楚。案底：snapshot 被 clamp 之后
 * `truncated:true` 是一个容易漏掉的键，一张 600 节点画布的体检因此被读成
 * 「这里很干净」。半张画布的结论比没有结论更糟。
 */
test("明细被截时，报告顶部显式写「没列全」，并告诉怎么看全", () => {
  const report = formatHealthReport({ ...REPLY, truncated: true, omittedIssues: 137 });
  const head = report.split("\n").slice(0, 2).join("\n");
  assert.match(head, /明细只列了 5 条，还有 137 条没列出来/);
  assert.match(head, /分类计数是全量的/);
  assert.match(report, /--limit 1000/);
});

test("干净的画布回一句话，不是一张空表", () => {
  const report = formatHealthReport({
    canvasId: "c-1",
    rev: 42,
    scanned: { nodes: 12, groups: 1, edges: 0 },
    counts: {},
    totalIssues: 0,
    issues: [],
    healthy: true,
  });
  assert.match(report, /没发现几何\/引用问题/);
});

/**
 * 修复行必须自带 `--session`。案底：报告宣称「可以原样粘贴」，而渲染出来的 argv
 * 里没有 `--session` —— 模型照抄之后拿到的是 `not_connected`（退出码 3），然后
 * 开始猜画布出了什么事。拿不到会话 id 时退回一个**一眼要填空**的占位符，不留
 * 一条跑得起来却一定失败的命令。
 */
test("报告自己说清「这些修复行怎么跑」，并且不把 --session 塞进 argv", () => {
  const withSession = formatHealthReport(REPLY, "11111111-2222-3333-4444-555555555555");
  // 会话 id 原字写出来，shell 那一侧不用自己去翻。
  assert.match(withSession, /加 --session 11111111-2222-3333-4444-555555555555。/);
  // argv 本身保持契约里那一份：宿主的 injectSession 对 argv 里任何位置的
  // --session 都是 SESSION_NOT_ALLOWED，塞进去等于把今天能原样粘贴的一行变成硬错。
  assert.match(
    withSession,
    /修复：scenemint-canvas tidy --scope selection --groups g-1 --fit-frames$/m,
  );
  assert.throws(
    () => injectSession(["tidy", "--scope", "selection", "--session", "x"], SESSION_ID),
    (error) => error.code === "SESSION_NOT_ALLOWED",
  );
  // 拿不到 id 时说的仍然是同一件事，只是留个占位。
  assert.match(formatHealthReport(REPLY), /加 --session <本次会话 UUID>。/);
  // decorate 这一层也要把 id 传下去，别在中间掉了。
  assert.match(decorate("health", REPLY, "abc-123").report, /加 --session abc-123。/);
});

/**
 * 抬头表与契约的 `health.issueKinds` 一一对应。没有这条闸的话，加第九类违例时
 * 文本报告会**静默**退化成只有机器名、没有中文抬头 —— 而这份报告存在的全部理由
 * 就是让弱模型不必自己翻译 `node_overlap`。反向也要钉：抬头表里多出一个契约里
 * 没有的 kind，说明某一类被改名了而报告还留着旧名。
 */
test("HEALTH_KIND_TITLES 与契约的 issueKinds 一一对应", () => {
  assert.deepEqual(
    Object.keys(HEALTH_KIND_TITLES).sort(),
    [...CANVAS_CONTRACT.health.issueKinds].sort(),
  );
  for (const kind of CANVAS_CONTRACT.health.issueKinds)
    assert.ok(
      typeof HEALTH_KIND_TITLES[kind] === "string" && HEALTH_KIND_TITLES[kind].length > 4,
      `${kind} 没有中文抬头`,
    );
});

test("报告真的接在出口上（decorate），而且只接 health、只接成功的回包", () => {
  const decorated = decorate("health", REPLY);
  assert.equal(typeof decorated.report, "string");
  assert.match(decorated.report, /共 5 条问题/);
  // 原始字段一个不少地留着。
  assert.deepEqual(decorated.issues, REPLY.issues);
  assert.deepEqual(decorated.counts, REPLY.counts);
  // 失败回包不长出 report（错误里没有 issues 可渲染）。
  const failed = { ok: false, error: { code: "page_away", message: "gone" } };
  assert.deepEqual(decorate("health", failed), failed);
  // 别的命令不蹭这个渲染。
  assert.equal(decorate("snapshot", REPLY).report, undefined);
});

/**
 * 端到端：argv → 线上方法名与参数 → 回包装饰。前面那些都是纯函数单测，接不上
 * 真实那条路的话照样全绿 —— `tidied` 那次就是渲染函数单测过、没接到 execute 上。
 */
test("真实守护进程：health --limit 7 发出的就是 method:health / maxIssues:7，回包带 report", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const pump = await f.pump((req) => {
    seen.push({ method: req.method, params: req.params });
    return REPLY;
  });
  t.after(() => pump.stop());
  const run = await f.cli(["health", "--limit", "7"]);
  assert.equal(run.code, 0);
  assert.deepEqual(seen, [{ method: "health", params: { maxIssues: 7 } }]);
  assert.match(run.result.report, /共 5 条问题/);
  // 端到端才证明得了「会话 id 一路传到了渲染里」：纯函数单测传什么都对。
  assert.ok(
    run.result.report.includes(`加 --session ${f.info.sessionId}。`),
    `报告没把本次会话的 id 说出来：\n${run.result.report}`,
  );
  assert.equal(run.result.issues.length, REPLY.issues.length);
  // 裸 health 不编一个参数出来（默认条数由页面定，不由 CLI 悄悄塞）。
  seen.length = 0;
  await f.cli(["health"]);
  assert.deepEqual(seen, [{ method: "health", params: {} }]);
});
