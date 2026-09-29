/**
 * F059-B — 节点与画布级 apply 命令在 CLI / 守护进程这一侧的面：
 *  · worker 的分级（删除类、恢复类按主会话处理）；
 *  · `apply` 上可选的 `approval`（批量删除的同意）—— 形状、worker 不能带；
 *  · `apply --approved` 替批里每条 delete_node 的目标声明授权；
 *  · `upload --into` 拼出 `upload_asset.targetNodeId`，并拒绝与之矛盾的参数。
 * 页面侧的行为（真的删 / 拆 / 清空 / 恢复）在 tests/studio/canvas-agent-apply-ops.test.ts。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fixture, packageRoot } from "./helpers.mjs";
import { enforceRequestPolicy, WORKER_BLOCKED_COMMANDS } from "../src/policy.mjs";
import { deleteApproval } from "../src/cli.mjs";
import { CANVAS_CONTRACT } from "../src/contract.mjs";
import { existsSync, readFileSync } from "node:fs";

const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code;
  }
};

test("删除类 / 恢复类的新命令 worker 不能发，连嵌在批里都不行；安全编辑照常放行", () => {
  for (const type of ["delete_output", "clear_output", "recover_deleted"]) {
    assert.ok(WORKER_BLOCKED_COMMANDS.has(type), `${type} 应当按主会话处理`);
    const minimal =
      type === "delete_output"
        ? { type, nodeId: "n1", outputId: "o1" }
        : type === "clear_output"
          ? { type, nodeId: "n1" }
          : { type };
    assert.equal(
      codeOf(() => enforceRequestPolicy("worker", "apply", { commands: [minimal] })),
      "worker_forbidden",
    );
    assert.equal(
      codeOf(() => enforceRequestPolicy("main", "apply", { commands: [minimal] })),
      null,
    );
  }
  for (const command of [
    { type: "split_output", nodeId: "n1", outputId: "o1" },
    { type: "reset_status", nodeId: "n1" },
    { type: "add_to_group", groupId: "g1", nodeIds: ["n1"] },
    { type: "remove_from_group", nodeId: "n1" },
    { type: "duplicate_nodes", nodeIds: ["n1"], offset: { x: 1, y: 2 } },
    { type: "select", nodeIds: [] },
    { type: "focus_node", all: true },
    { type: "focus_node", nodeIds: ["a", "b"], fill: 0.4 },
  ])
    assert.equal(
      codeOf(() => enforceRequestPolicy("worker", "apply", { commands: [command] })),
      null,
      `${command.type} 是安全编辑，worker 应当能发`,
    );
  // 多给即报错的老规矩对新命令一样成立。
  assert.equal(
    codeOf(() =>
      enforceRequestPolicy("main", "apply", {
        commands: [{ type: "reset_status", nodeId: "n1", force: true }],
      }),
    ),
    "invalid_request",
  );
});

test("apply 的 approval：主会话可带、形状要对；worker 带就是 worker_forbidden；别的方法照旧拒", () => {
  const commands = [{ type: "delete_node", nodeId: "g1" }];
  assert.equal(
    codeOf(() =>
      enforceRequestPolicy("main", "apply", {
        commands,
        approval: { userApprovedNodeIds: ["g1"] },
      }),
    ),
    null,
  );
  for (const approval of [
    {},
    { userApprovedNodeIds: [] },
    { userApprovedNodeIds: [""] },
    { userApprovedNodeIds: ["g1"], extra: 1 },
    ["g1"],
  ])
    assert.equal(
      codeOf(() => enforceRequestPolicy("main", "apply", { commands, approval })),
      "invalid_request",
      JSON.stringify(approval),
    );
  assert.equal(
    codeOf(() =>
      enforceRequestPolicy("worker", "apply", {
        commands,
        approval: { userApprovedNodeIds: ["g1"] },
      }),
    ),
    "worker_forbidden",
  );
  assert.equal(
    codeOf(() =>
      enforceRequestPolicy("main", "snapshot", { approval: { userApprovedNodeIds: ["g1"] } }),
    ),
    "invalid_request",
  );
});

test("deleteApproval：只收 delete_node 的目标（去重）；批里没有删除时报错而不是静默忽略", () => {
  assert.deepEqual(
    deleteApproval([
      { type: "delete_node", nodeId: "a" },
      { type: "move_node", nodeId: "b", position: { x: 0, y: 0 } },
      { type: "delete_node", nodeId: "a" },
      { type: "delete_node", nodeId: "g" },
    ]),
    { userApprovedNodeIds: ["a", "g"] },
  );
  assert.throws(
    () => deleteApproval([{ type: "delete_output", nodeId: "a", outputId: "o" }]),
    (err) => err.code === "invalid_argument",
  );
});

const appSources = path.resolve(packageRoot, "../../apps/web");
test("契约：批量删除门槛与 selection-delete.ts 同一个数；select 的未显示原因与页面同一个字面量", {
  skip: !existsSync(appSources),
}, () => {
  const src = readFileSync(
    path.join(packageRoot, "../../apps/web/libs/canvas/selection-delete.ts"),
    "utf8",
  );
  const hit = /BULK_DELETE_CONFIRM_THRESHOLD = (\d+);/.exec(src);
  assert.ok(hit, "selection-delete.ts 的门槛常量形状变了");
  assert.equal(CANVAS_CONTRACT.limits["apply.bulkDeleteThreshold"], Number(hit[1]));
  const canvasSrc = readFileSync(
    path.join(packageRoot, "../../apps/web/libs/canvas/agent-bridge/canvas.ts"),
    "utf8",
  );
  for (const reason of CANVAS_CONTRACT.focus.unshownReasons)
    assert.match(canvasSrc, new RegExp(`reason: "${reason}"`));
  const typesSrc = readFileSync(
    path.join(packageRoot, "../../apps/web/libs/canvas/agent-bridge/types.ts"),
    "utf8",
  );
  assert.match(typesSrc, /reason\?: "no_selection";/);
});

test("apply --approved 与 upload --into 真的上线（真守护进程）", async (t) => {
  const f = await fixture(t);
  await f.pair();
  await fs.writeFile(path.join(f.workspace, "new.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const seen = [];
  const pump = await f.pump((rpc) => {
    seen.push(rpc);
    return { ok: true, created: [], undoDepth: 1 };
  });
  const batch = JSON.stringify({
    commands: [
      { type: "delete_node", nodeId: "g1" },
      { type: "delete_node", nodeId: "n2" },
    ],
  });
  const approved = await f.cli(["apply", "--approved", "--json", batch]);
  assert.equal(approved.code, 0, approved.stdout);
  assert.deepEqual(seen.at(-1).params.approval, { userApprovedNodeIds: ["g1", "n2"] });
  const plain = await f.cli(["apply", "--json", batch]);
  assert.equal(plain.code, 0, plain.stdout);
  assert.equal(seen.at(-1).params.approval, undefined, "不加 --approved 就不许替用户点头");
  const nothingToApprove = await f.cli([
    "apply",
    "--approved",
    "--json",
    JSON.stringify({ commands: [{ type: "reset_status", nodeId: "n1" }] }),
  ]);
  assert.equal(nothingToApprove.code, 2);
  assert.equal(nothingToApprove.result.error.code, "invalid_argument");

  const into = await f.cli(["upload", "new.png", "--into", "media-1"]);
  assert.equal(into.code, 0, into.stdout);
  const command = seen.at(-1).params.commands[0];
  assert.equal(command.type, "upload_asset");
  assert.equal(command.targetNodeId, "media-1");
  assert.equal(command.position, undefined);
  assert.equal(command.title, undefined);
  const contradictory = await f.cli(["upload", "new.png", "--into", "media-1", "--x", "3"]);
  assert.equal(contradictory.code, 2);
  assert.equal(contradictory.result.error.code, "invalid_argument");
  await pump.stop();
});
