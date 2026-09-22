import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cli, fixture, request } from "./helpers.mjs";
import { enforceRequestPolicy, PROTOCOL_VERSION } from "../src/policy.mjs";

const rpcInput = (method, params = {}, requestId = randomUUID()) => ({
  requestId,
  method,
  params,
  turnId: `turn-${requestId}`,
});
const edit = (nodeId = "n") => ({
  commands: [{ type: "move_node", nodeId, position: { x: 1, y: 2 } }],
});
async function delegate(f, name = "Worker") {
  const workspace = path.join(f.root, randomUUID());
  await fs.mkdir(workspace);
  const result = await f.cli(["delegate", "--name", name, "--workspace", workspace]);
  assert.equal(result.code, 0, result.stdout);
  const info = result.result;
  const recordPath = path.join(f.home, "sessions", `${info.sessionId}.json`);
  const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
  return {
    info,
    record,
    recordPath,
    workspace,
    cli: (args, input) => cli([...args, "--session", info.sessionId], f.env, input),
    raw: (route, body) =>
      request(f.info.endpoint, route, {
        headers: { Authorization: `Bearer ${record.cliToken}` },
        body,
      }),
    rpc: (input) =>
      request(f.info.endpoint, "/v1/call", {
        headers: { Authorization: `Bearer ${record.cliToken}` },
        body: input,
      }),
  };
}

test("protocol 2 rejects unversioned and old pages without consuming the pair code", async (t) => {
  const f = await fixture(t);
  assert.equal(f.info.protocolVersion, PROTOCOL_VERSION);
  for (const protocolVersion of [undefined, 1, 3, "2"]) {
    const result = await f.raw("/v1/pair", {
      headers: { Origin: f.info.origin },
      body: {
        code: f.info.pairCode,
        canvasId: "canvas-a",
        projectId: "project-a",
        protocolVersion,
      },
    });
    assert.equal(result.status, 409);
    assert.equal(result.result.error.code, "protocol_mismatch");
  }
  assert.equal((await f.pair()).protocolVersion, 2);
});

test("main raw runs require an explicit target approval and cannot inject roles; approval is fingerprinted", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  await f.pump((rpc) => {
    seen.push(rpc);
    return { ok: true };
  });
  for (const approval of [
    undefined,
    true,
    {},
    { userApprovedNodeIds: [] },
    { userApprovedNodeIds: ["other"] },
    { userApprovedNodeIds: ["n"], role: "main" },
  ]) {
    const result = await f.rpc(
      rpcInput("run_node", { nodeId: "n", ...(approval === undefined ? {} : { approval }) }),
    );
    assert.equal(result.result.error.code, "approval_required");
  }
  for (const field of [
    "role",
    "actor",
    "scope",
    "agentId",
    "canvasId",
    "sessionId",
    "parentSessionId",
  ]) {
    assert.equal(
      (await f.rpc(rpcInput("read", { paths: ["n"], [field]: "main" }))).result.error.code,
      "invalid_request",
    );
  }
  assert.equal(
    (await f.rpc({ ...rpcInput("read", { paths: ["n"] }), role: "main" })).result.error.code,
    "invalid_request",
  );
  assert.equal(seen.length, 0);
  const run = rpcInput("run_node", { nodeId: "n", approval: { userApprovedNodeIds: ["n"] } });
  assert.equal((await f.rpc(run)).result.ok, true);
  assert.equal(seen[0].role, "main");
  assert.deepEqual(seen[0].params.approval, { userApprovedNodeIds: ["n"] });
  assert.equal(
    (
      await f.rpc({
        ...run,
        params: { nodeId: "n", approval: { userApprovedNodeIds: ["n", "other"] } },
      })
    ).result.error.code,
    "request_id_conflict",
  );
});

test("delegate has separate private credentials and workspace but shares the parent canvas and Agent identity", async (t) => {
  const f = await fixture(t);
  const unpaired = await f.cli(["delegate", "--name", "Worker", "--workspace", f.workspace]);
  assert.equal(unpaired.result.error.code, "not_connected");
  await f.pair();
  const child = await delegate(f);
  assert.equal(child.info.role, "worker");
  assert.equal(child.info.parentSessionId, f.info.sessionId);
  assert.equal(child.info.agentId, f.info.agentId);
  assert.equal(child.info.endpoint, f.info.endpoint);
  assert.equal(child.info.canvasId, "canvas-a");
  assert.equal(child.info.protocolVersion, 2);
  assert.equal(child.info.cliToken, undefined);
  assert.equal(child.info.browserToken, undefined);
  assert.equal(child.record.parentSessionId, f.info.sessionId);
  assert.equal(child.record.role, "worker");
  assert.notEqual(child.record.cliToken, f.record.cliToken);
  assert.equal((await fs.stat(child.recordPath)).mode & 0o777, 0o600);
  assert.equal((await child.cli(["status"])).result.workspace, await fs.realpath(child.workspace));
  await fs.writeFile(path.join(f.workspace, "parent-only.json"), JSON.stringify(edit()));
  const deniedFile = await child.cli([
    "apply",
    "--file",
    path.join(f.workspace, "parent-only.json"),
  ]);
  assert.equal(deniedFile.result.error.code, "workspace_boundary");
  assert.equal(
    (await child.raw("/v1/delegate", { name: "Nested", workspace: child.workspace })).result.error
      .code,
    "worker_forbidden",
  );
  assert.equal(
    (await child.raw("/v1/revoke", { sessionId: f.info.sessionId })).result.error.code,
    "worker_forbidden",
  );
  assert.equal(
    (await child.raw("/v1/stop", { sessionId: f.info.sessionId })).result.error.code,
    "invalid_request",
  );
  assert.equal((await f.cli(["status"])).result.connected, true);
});

test("worker allowlist is enforced by the raw daemon for reads, edits, every denied method and whole batches", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const child = await delegate(f);
  const seen = [];
  await f.pump((rpc) => {
    seen.push(rpc);
    return { ok: true };
  });
  const reads = [
    "list_canvases",
    "snapshot",
    "ls",
    "read",
    "grep",
    "resources",
    "model_catalog",
    "changes",
    "end_turn",
    "media_info",
    "media_chunk",
  ];
  for (const method of reads)
    assert.equal((await child.rpc(rpcInput(method))).result.ok, true, method);
  assert.equal((await child.rpc(rpcInput("apply", edit()))).result.ok, true);
  assert.ok(seen.every((r) => r.role === "worker"));
  const before = seen.length;
  for (const method of [
    "run_node",
    "run_nodes",
    "cancel_batch",
    "cancel_node",
    "undo",
    "redo",
    "operations",
    "timeline",
  ]) {
    const result = await child.rpc(
      rpcInput(
        method,
        method === "run_node"
          ? { nodeId: "n", approval: { userApprovedNodeIds: ["n"] } }
          : method === "run_nodes"
            ? { nodeIds: ["n"], approval: { userApprovedNodeIds: ["n"] } }
            : { op: "list" },
      ),
    );
    assert.equal(result.result.error.code, "worker_forbidden", method);
  }
  for (const type of ["upload_asset", "export_output"]) {
    const result = await child.rpc(
      rpcInput("apply", { commands: [...edit().commands, { type, nodeId: "n" }] }),
    );
    assert.equal(result.result.error.code, "worker_forbidden");
  }
  for (const commands of [
    [{ type: "apply", commands: [{ type: "export_output", nodeId: "n" }] }],
    [{ type: "future_command" }],
    [{ type: "add_node", commands: [{ type: "upload_asset" }] }],
    [{ type: "add_node", draft: { inputs: { commands: [{ type: "export_output" }] } } }],
  ])
    assert.equal(
      (await child.rpc(rpcInput("apply", { commands }))).result.error.code,
      "invalid_request",
    );
  assert.equal(seen.length, before);
  // A worker may edit its local file, but role authority stays in the daemon.
  await fs.writeFile(child.recordPath, JSON.stringify({ ...child.record, role: "main" }));
  const forged = await child.cli(["run", "n", "--approved"]);
  assert.equal(forged.result.error.code, "worker_forbidden");
  assert.equal(seen.length, before);
});

test("request IDs cannot expose pending or cached results across parent and sibling callers", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const child = await delegate(f, "one");
  const sibling = await delegate(f, "two");
  const childInput = rpcInput("read", { paths: ["child-owned"] });
  const pending = child.rpc(childInput);
  const next = await f.browser("/v1/next");
  assert.equal(next.result.requestId, childInput.requestId);
  for (const rpc of [f.rpc, sibling.rpc])
    assert.equal((await rpc(childInput)).result.error.code, "request_id_conflict");
  await f.browser("/v1/reply", {
    requestId: childInput.requestId,
    result: { ok: true, privateResult: "caller-only" },
  });
  assert.equal((await pending).result.privateResult, "caller-only");
  assert.equal((await child.rpc(childInput)).result.privateResult, "caller-only");
  for (const rpc of [f.rpc, sibling.rpc]) {
    const result = await rpc(childInput);
    assert.equal(result.result.error.code, "request_id_conflict");
    assert.equal(JSON.stringify(result).includes("caller-only"), false);
  }
  const parentInput = rpcInput("read", { paths: ["parent-owned"] });
  const parentPending = f.rpc(parentInput);
  await f.browser("/v1/next");
  await f.browser("/v1/reply", {
    requestId: parentInput.requestId,
    result: { ok: true, parentOnly: "private" },
  });
  await parentPending;
  assert.equal((await child.rpc(parentInput)).result.error.code, "request_id_conflict");
});

test("revocation cancels queued worker calls, reports delivered edits unknown and holds serialization until the page replies", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const child = await delegate(f);
  const deliveredInput = rpcInput("apply", edit("delivered"));
  const delivered = child.rpc(deliveredInput);
  assert.equal((await f.browser("/v1/next")).result.requestId, deliveredInput.requestId);
  const queuedInput = rpcInput("apply", edit("queued"));
  const queued = child.rpc(queuedInput);
  const parentInput = rpcInput("apply", edit("parent"));
  const parentPending = f.rpc(parentInput);
  // Ensure all calls were admitted, rather than racing revocation against HTTP setup.
  for (let i = 0; i < 50; i++) {
    if ((await f.cli(["status"])).result.pending === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const revoked = await f.cli(["revoke", "--delegate", child.info.sessionId]);
  assert.equal(revoked.result.revoked, true);
  assert.equal(revoked.result.deliveredRequests, 1);
  assert.equal((await delivered).result.error.code, "unknown_outcome");
  assert.equal((await queued).result.error.code, "delegate_revoked");
  await assert.rejects(fs.stat(child.recordPath), { code: "ENOENT" });
  assert.equal((await child.rpc(rpcInput("read"))).status, 401);
  let advanced = false;
  const next = f.browser("/v1/next").then((r) => {
    advanced = true;
    return r;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(advanced, false);
  const invalidReply = await f.browser("/v1/reply", { requestId: deliveredInput.requestId });
  assert.equal(invalidReply.result.error.code, "invalid_request");
  assert.equal(advanced, false);
  await f.browser("/v1/reply", { requestId: deliveredInput.requestId, result: { ok: true } });
  assert.equal((await next).result.requestId, parentInput.requestId);
  await f.browser("/v1/reply", { requestId: parentInput.requestId, result: { ok: true } });
  assert.equal((await parentPending).result.ok, true);
  assert.equal((await f.cli(["status"])).result.connected, true);
});

test("worker disconnect only revokes itself; parent page disconnect revokes all other worker credentials", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const child = await delegate(f);
  const sibling = await delegate(f);
  assert.equal((await child.cli(["disconnect"])).result.stopped, true);
  assert.equal((await f.cli(["status"])).result.connected, true);
  assert.equal((await sibling.cli(["status"])).result.connected, true);
  assert.equal((await child.rpc(rpcInput("read"))).status, 401);
  await f.browser("/v1/disconnect");
  await assert.rejects(fs.stat(sibling.recordPath), { code: "ENOENT" });
  assert.equal((await sibling.rpc(rpcInput("read"))).status, 401);
  assert.equal((await f.cli(["status"])).result.state, "disconnected");
});

test("parent stop removes all worker session files and terminates their shared daemon", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const child = await delegate(f);
  assert.equal((await f.cli(["disconnect"])).result.stopped, true);
  for (let i = 0; i < 100; i++) {
    try {
      await fs.stat(child.recordPath);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await assert.rejects(fs.stat(child.recordPath), { code: "ENOENT" });
  await assert.rejects(fs.stat(f.recordPath), { code: "ENOENT" });
});

test("worker media reads publish only inside the delegated workspace", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const child = await delegate(f);
  await f.pump((rpc) => {
    assert.equal(rpc.role, "worker");
    assert.equal(rpc.method, "media_info");
    return { content: "ok", size: 2, fileName: "read.md", mimeType: "text/markdown" };
  });
  const output = await child.cli(["download", "n", "--out", "read.md"]);
  assert.equal(output.code, 0);
  assert.equal(await fs.readFile(path.join(child.workspace, "read.md"), "utf8"), "ok");
  const outside = await child.cli(["download", "n", "--out", path.join(f.workspace, "read.md")]);
  assert.equal(outside.result.error.code, "workspace_boundary");
});

test("browser lease loss suspends the session; only an expired resume window revokes delegates", async (t) => {
  const f = await fixture(t, { lease: 400, resume: 900 });
  await f.pair();
  const child = await delegate(f);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const suspended = (await f.cli(["status"])).result;
  assert.equal(suspended.state, "reconnecting");
  assert.ok(suspended.resumeExpiresAt);
  // Workers keep their credentials while the page may come back.
  await fs.stat(child.recordPath);
  assert.equal(
    (await cli(["status", "--session", child.info.sessionId], f.env)).result.state,
    "reconnecting",
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await f.cli(["status"])).result.state, "disconnected");
  await assert.rejects(fs.stat(child.recordPath), { code: "ENOENT" });
  assert.equal((await child.rpc(rpcInput("read"))).status, 401);
});

test("a page that resumes after lease loss receives queued calls; delivered work is retired unknown", async (t) => {
  const f = await fixture(t, { lease: 300, resume: 5000 });
  const paired = await f.pair();
  const delivered = f.rpc(rpcInput("apply", edit()));
  await f.browser("/v1/next");
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal((await f.cli(["status"])).result.state, "reconnecting");
  assert.equal((await delivered).result.error.code, "unknown_outcome");
  // A call issued while reconnecting is queued, not refused.
  const queued = f.cli(["read", "node"]);
  const resumed = await f.resume();
  assert.equal(resumed.status, 200);
  assert.notEqual(resumed.result.browserToken, paired.browserToken);
  assert.equal(resumed.result.pageEpoch, 2);
  const pump = await f.pump(() => ({ nodes: [] }));
  assert.deepEqual((await queued).result, { nodes: [] });
  await pump.stop();
  assert.equal((await f.cli(["status"])).result.state, "connected");
});

test("revoked delivered edit keeps its original timeout and cannot strand the main mutation queue", async (t) => {
  const f = await fixture(t, { timeout: 700 });
  await f.pair();
  const child = await delegate(f);
  const input = rpcInput("apply", edit());
  const delivered = child.rpc(input);
  await f.browser("/v1/next");
  const mainInput = rpcInput("apply", edit("main"));
  const pending = f.rpc(mainInput);
  await f.cli(["revoke", "--delegate", child.info.sessionId]);
  assert.equal((await delivered).result.error.code, "unknown_outcome");
  // The delivered edit holds the mutation slot until the page answers it; that
  // answer releases the slot and the main edit is delivered instead of the
  // session dying.
  await f.browser("/v1/reply", { requestId: input.requestId, result: { ok: true } });
  const next = await f.browser("/v1/next");
  assert.equal(next.result.requestId, mainInput.requestId);
  await f.browser("/v1/reply", { requestId: mainInput.requestId, result: { ok: true } });
  assert.deepEqual((await pending).result, { ok: true });
  assert.equal((await f.cli(["status"])).result.state, "connected");
});

test("pure browser-compatible policy rejects unknown roles and nested commands without interpreting prose", () => {
  for (const role of [undefined, "root", "MAIN", {}, null])
    assert.throws(() => enforceRequestPolicy(role, "read", {}), { code: "invalid_role" });
  assert.throws(() => enforceRequestPolicy("main", "future", {}), { code: "method_not_allowed" });
  // `clearCandidates`（run --fresh）在两个运行方法上都只收布尔值。
  const approval = { userApprovedNodeIds: ["n1"] };
  assert.throws(
    () =>
      enforceRequestPolicy("main", "run_node", { nodeId: "n1", approval, clearCandidates: "yes" }),
    { code: "invalid_request" },
  );
  assert.throws(
    () =>
      enforceRequestPolicy("main", "run_nodes", { nodeIds: ["n1"], approval, clearCandidates: 1 }),
    { code: "invalid_request" },
  );
  enforceRequestPolicy("main", "run_node", { nodeId: "n1", approval, clearCandidates: true });
  enforceRequestPolicy("main", "run_nodes", { nodeIds: ["n1"], approval, clearCandidates: false });
  assert.throws(
    () =>
      enforceRequestPolicy("worker", "apply", {
        commands: [{ type: "add_node", draft: { data: { type: "upload_asset" } } }],
      }),
    { code: "worker_forbidden" },
  );
  assert.doesNotThrow(() =>
    enforceRequestPolicy("worker", "apply", {
      commands: [{ type: "add_node", draft: { prompt: '{"commands":[{"type":"upload_asset"}]}' } }],
    }),
  );
});

test("B-4: a policy rejection surfaces its own code, not connection_failed", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const { call } = await import("../src/client.mjs");
  const session = {
    endpoint: f.info.endpoint,
    cliToken: f.record.cliToken,
    role: "main",
    workspace: f.workspace,
    callTimeoutMs: 8000,
  };
  const reserved = await call(session, "ls", { canvasId: "x" });
  assert.equal(reserved.ok, false);
  assert.equal(reserved.error.code, "invalid_request");
  const unknown = await call(session, "nope", {});
  assert.equal(unknown.error.code, "method_not_allowed");
});
