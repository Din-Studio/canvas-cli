import test from "node:test";
import assert from "node:assert/strict";
import { formatTasksTable, parseArgs, tasksParams } from "../src/cli.mjs";
import { enforceRequestPolicy, TASKS_FIELDS } from "../src/policy.mjs";
import { CANVAS_CONTRACT } from "../src/contract.mjs";

/**
 * `tasks`（0.8.1）：Agent 回答「这批是谁跑的 / 我提交的完成了没」的唯一依据。
 * argv → params 翻错一个 flag 就会把别人的任务报成自己的，所以这里逐条钉。
 */

test("tasks：--node / --status 可重复也可逗号分隔，裸 positional 也是节点 id", () => {
  const parsed = parseArgs([
    "tasks",
    "n-3",
    "--node",
    "n-1",
    "--node",
    "n-2,n-4",
    "--status",
    "failed",
    "--status",
    "running,queued",
  ]);
  assert.deepEqual(parsed.options.node, ["n-1", "n-2,n-4"]);
  assert.deepEqual(parsed.options.status, ["failed", "running,queued"]);
  assert.deepEqual(tasksParams(parsed.options, parsed.positionals), {
    nodeIds: ["n-1", "n-2", "n-4", "n-3"],
    status: ["failed", "running", "queued"],
  });
  // 其它命令里 --node 仍是单值：重复即报错，行为不变。
  assert.throws(() => parseArgs(["read", "--node", "a", "--node", "b"]), /Duplicate option --node/);
});

test("tasks：submitter / scope / since / limit / after 逐个落到参数上，坏值退 2", () => {
  assert.deepEqual(
    tasksParams({
      submitter: "me",
      scope: "all",
      since: "2026-09-10T00:00:00Z",
      limit: "50",
      after: "cursor-1",
    }),
    {
      submitter: "me",
      scope: "all",
      since: "2026-09-10T00:00:00.000Z",
      limit: 50,
      after: "cursor-1",
    },
  );
  assert.deepEqual(tasksParams({}), {});
  for (const bad of [
    { submitter: "them" },
    { scope: "universe" },
    { since: "yesterday" },
    { limit: "0" },
    { limit: "2.5" },
    { limit: "many" },
  ]) {
    assert.throws(
      () => tasksParams(bad),
      (error) => error.code === "invalid_argument",
      JSON.stringify(bad),
    );
  }
});

test("tasks 是只读方法：worker 也能调；参数面就是 TASKS_FIELDS，多给即拒", () => {
  for (const role of ["main", "worker"]) {
    enforceRequestPolicy(role, "tasks", {});
    enforceRequestPolicy(role, "tasks", {
      scope: "project",
      nodeIds: ["a"],
      status: ["failed", "running"],
      submitter: "me",
      since: "2026-09-10T00:00:00.000Z",
      limit: 500,
      after: "c",
    });
  }
  assert.deepEqual([...TASKS_FIELDS].sort(), [
    "after",
    "limit",
    "nodeIds",
    "scope",
    "since",
    "status",
    "submitter",
  ]);
  const rejects = (params, re) =>
    assert.throws(
      () => enforceRequestPolicy("main", "tasks", params),
      (error) => error.code === "invalid_request" && re.test(error.message),
      JSON.stringify(params),
    );
  rejects({ canvasIds: ["x"] }, /Unexpected tasks field: canvasIds/);
  rejects({ scope: "everything" }, /scope/);
  rejects({ nodeIds: [] }, /nodeIds/);
  rejects({ nodeIds: Array.from({ length: 201 }, (_, i) => `n${i}`) }, /nodeIds/);
  rejects({ status: ["done"] }, /status/);
  rejects({ submitter: "them" }, /submitter/);
  rejects({ since: "yesterday" }, /since/);
  rejects({ limit: 501 }, /limit/);
  rejects({ limit: 0 }, /limit/);
  rejects({ after: "" }, /after/);
  // 身份字段仍由会话控制。
  rejects({ agentId: "x" }, /controlled by the authenticated session/);
  // 契约里的上限就是这里挡的数字。
  assert.deepEqual(CANVAS_CONTRACT.limits["tasks.limit"], {
    min: 1,
    max: 500,
    default: 100,
    integer: true,
  });
  assert.deepEqual(CANVAS_CONTRACT.limits["tasks.nodeIds"], {
    min: 1,
    max: 200,
    itemMaxLength: 1024,
  });
});

test("tasks 的文本表：一行一个任务，me / agent:名字 / human / ?，别的画布多一列「在哪」", () => {
  const local = formatTasksTable([
    {
      taskId: "gw-1",
      mediaTaskId: "m-1",
      nodeId: "n-1",
      nodeTitle: "S01 全景",
      kind: "image",
      status: "running",
      submittedAt: "2026-09-10T00:00:01.000Z",
      submitter: { kind: "agent", sessionId: "scenemint-cli:me", name: "我", isMe: true },
    },
    {
      taskId: null,
      mediaTaskId: "m-2",
      nodeId: "n-2",
      kind: "video",
      status: "queued",
      submittedAt: "2026-09-10T00:00:02.000Z",
      submitter: { kind: "agent", sessionId: "scenemint-cli:x", name: "别的助手", isMe: false },
    },
    {
      taskId: "gw-3",
      mediaTaskId: "m-3",
      nodeId: "n-3",
      kind: "image",
      status: "succeeded",
      submittedAt: "2026-09-10T00:00:03.000Z",
      finishedAt: "2026-09-10T00:01:03.000Z",
      submitter: { kind: "human", isMe: false },
    },
    {
      taskId: "gw-4",
      mediaTaskId: "m-4",
      nodeId: null,
      kind: "image",
      status: "failed",
      submittedAt: "2026-09-10T00:00:04.000Z",
      submitter: { kind: "unknown", isMe: false },
      error: "quota",
    },
  ]);
  const lines = local.split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^status\s+kind\s+submitter\s+submittedAt\s+finishedAt\s+node\s+taskId$/);
  assert.match(
    lines[1],
    /^running\s+image\s+me\s+2026-09-10T00:00:01\.000Z\s+-\s+S01 全景 \(n-1\)\s+gw-1$/,
  );
  assert.match(lines[2], /queued\s+video\s+agent:别的助手\s+.*\s+n-2\s+\(pending\)$/);
  assert.match(
    lines[3],
    /succeeded\s+image\s+human\s+2026-09-10T00:00:03\.000Z\s+2026-09-10T00:01:03\.000Z\s+n-3\s+gw-3$/,
  );
  assert.match(lines[4], /failed\s+image\s+\?\s+.*\s+-\s+gw-4$/);

  const elsewhere = formatTasksTable([
    {
      taskId: "gw-9",
      mediaTaskId: "m-9",
      nodeId: "far",
      kind: "video",
      status: "running",
      submittedAt: "2026-09-10T00:00:09.000Z",
      submitter: { kind: "human", isMe: false },
      canvasId: "c-2",
      canvasName: "另一张画布",
      projectId: "p-2",
      projectName: "项目二",
    },
  ]);
  assert.match(elsewhere.split("\n")[0], /\s+where$/);
  assert.match(elsewhere.split("\n")[1], /项目二 \/ 另一张画布$/);
  assert.equal(formatTasksTable([]).split("\n").length, 1);
});
