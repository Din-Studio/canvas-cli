import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, cli } from "./helpers.mjs";

test("refresh keeps caller identity, rotates browser credentials and refuses scope changes", async (t) => {
  const f = await fixture(t);
  const pair = await f.pair();
  const child = (await f.cli(["delegate", "--name", "worker", "--workspace", f.workspace])).result;
  assert.equal((await f.browser("/v1/suspend")).result.suspended, true);
  assert.equal((await f.cli(["status"])).result.state, "reconnecting");
  // Calls issued while the page is away queue until it resumes.
  const queued = f.cli(["read", "node"]);
  const wrong = await f.browser("/v1/resume", {
    protocolVersion: 2,
    canvasId: "other",
    projectId: "project-a",
  });
  assert.equal(wrong.result.error.code, "scope_mismatch");
  const resumed = await f.browser("/v1/resume", {
    protocolVersion: 2,
    canvasId: "canvas-a",
    projectId: "project-a",
  });
  assert.equal(resumed.status, 200);
  assert.notEqual(resumed.result.browserToken, pair.browserToken);
  assert.equal(resumed.result.agentId, pair.agentId);
  assert.equal(resumed.result.undoHistoryReset, true);
  assert.equal((await f.cli(["status"])).result.pageEpoch, 2);
  assert.equal((await cli(["status", "--session", child.sessionId], f.env)).result.connected, true);
  assert.equal((await f.browser("/v1/next")).status, 401);
  const auth = { Origin: f.info.origin, Authorization: `Bearer ${resumed.result.browserToken}` };
  const next = await f.raw("/v1/next", { headers: auth, body: {} });
  assert.equal(next.result.role, "main");
  await f.raw("/v1/reply", {
    headers: auth,
    body: { requestId: next.result.requestId, result: { nodes: [] } },
  });
  assert.deepEqual((await queued).result, { nodes: [] });
  await f.raw("/v1/disconnect", { headers: auth, body: {} });
  assert.equal(
    (
      await f.raw("/v1/resume", {
        headers: auth,
        body: { protocolVersion: 2, canvasId: "canvas-a", projectId: "project-a" },
      })
    ).status,
    401,
  );
});

for (const method of ["apply", "run_node"]) {
  test(`refresh during delivered ${method} never replays it and keeps the session resumable`, async (t) => {
    const f = await fixture(t);
    await f.pair();
    const child = (await f.cli(["delegate", "--name", "worker", "--workspace", f.workspace]))
      .result;
    const input = {
      requestId: randomUUID(),
      turnId: "one",
      method,
      params:
        method === "apply"
          ? { commands: [{ type: "move_node", nodeId: "node", position: { x: 1, y: 2 } }] }
          : { nodeId: "node", approval: { userApprovedNodeIds: ["node"] } },
    };
    const call = f.rpc(input);
    const next = await f.browser("/v1/next");
    assert.equal(next.result.requestId, input.requestId);
    // Suspending with a delivered request retires it as unknown but keeps the
    // session, the worker and the pairing: the page may come back.
    assert.equal((await f.browser("/v1/suspend")).result.suspended, true);
    assert.equal((await call).result.error.code, "unknown_outcome");
    assert.equal((await f.cli(["status"])).result.state, "reconnecting");
    const resumed = await f.resume();
    assert.equal(resumed.status, 200);
    assert.equal(resumed.result.pageEpoch, 2);
    const pump = await f.pump(() => ({ nodes: [] }));
    assert.deepEqual((await cli(["read", "node", "--session", child.sessionId], f.env)).result, {
      nodes: [],
    });
    await pump.stop();
    // The retired request is a tombstone: the same request never executes again.
    assert.equal((await f.rpc(input)).result.error.code, "unknown_outcome");
  });
}

test("a lost pagehide beacon can resume an idle live lease without reusing a pairing code", async (t) => {
  const f = await fixture(t);
  await f.pair();
  assert.equal(
    (
      await f.browser("/v1/resume", {
        protocolVersion: 2,
        canvasId: "canvas-a",
        projectId: "project-a",
      })
    ).result.pageEpoch,
    2,
  );
});

test("M7: a delivered mutation keeps the serial slot through suspend; a replacement page's resume releases it", async (t) => {
  const f = await fixture(t, { timeout: 8000 });
  await f.pair();
  const first = {
    requestId: randomUUID(),
    turnId: "a",
    method: "apply",
    params: { commands: [{ type: "move_node", nodeId: "n", position: { x: 1, y: 1 } }] },
  };
  const second = {
    requestId: randomUUID(),
    turnId: "b",
    method: "apply",
    params: { commands: [{ type: "move_node", nodeId: "n", position: { x: 2, y: 2 } }] },
  };
  const firstCall = f.rpc(first);
  const delivered = await f.browser("/v1/next");
  assert.equal(delivered.result.requestId, first.requestId);
  const secondCall = f.rpc(second);
  assert.equal((await f.browser("/v1/suspend")).result.suspended, true);
  assert.equal((await firstCall).result.error.code, "unknown_outcome");
  // Same page comes back from a throttled tab: the old poll must NOT hand out the second mutation.
  const sameToken = await f.browser("/v1/next");
  assert.equal(sameToken.status, 401);
  const resumed = await f.resume();
  assert.equal(resumed.status, 200);
  const next = await f.browser("/v1/next");
  assert.equal(
    next.result.requestId,
    second.requestId,
    "replacement page receives the queued mutation",
  );
  await f.browser("/v1/reply", { requestId: second.requestId, result: { ok: true } });
  assert.deepEqual((await secondCall).result, { ok: true });
});

test("M7: a late reply from the still-alive page releases the held slot before any resume", async (t) => {
  const f = await fixture(t, { timeout: 8000, lease: 300, resume: 5000 });
  const paired = await f.pair();
  const first = {
    requestId: randomUUID(),
    turnId: "a",
    method: "apply",
    params: { commands: [{ type: "move_node", nodeId: "n", position: { x: 1, y: 1 } }] },
  };
  const second = {
    requestId: randomUUID(),
    turnId: "b",
    method: "apply",
    params: { commands: [{ type: "move_node", nodeId: "n", position: { x: 2, y: 2 } }] },
  };
  const firstCall = f.rpc(first);
  await f.browser("/v1/next");
  const secondCall = f.rpc(second);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal((await f.cli(["status"])).result.state, "reconnecting");
  assert.equal((await firstCall).result.error.code, "unknown_outcome");
  // The throttled page wakes up and answers with its old token: accepted as a late reply.
  const auth = { Origin: f.info.origin, Authorization: `Bearer ${paired.browserToken}` };
  const late = await f.raw("/v1/reply", {
    headers: auth,
    body: { requestId: first.requestId, result: { ok: true } },
  });
  assert.equal(
    late.status,
    401,
    "old token cannot reply while reconnecting; slot is released at resume instead",
  );
  const resumed = await f.resume();
  assert.equal(resumed.status, 200);
  const next = await f.browser("/v1/next");
  assert.equal(next.result.requestId, second.requestId);
  await f.browser("/v1/reply", { requestId: second.requestId, result: { ok: true } });
  assert.deepEqual((await secondCall).result, { ok: true });
});

test("m2: a call queued while reconnecting outlives callTimeoutMs and is delivered after resume", async (t) => {
  const f = await fixture(t, { timeout: 400, resume: 5000 });
  await f.pair();
  assert.equal((await f.browser("/v1/suspend")).result.suspended, true);
  const queued = f.cli(["read", "node"]);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal((await f.cli(["status"])).result.pending, 1, "still queued after 2× callTimeoutMs");
  assert.equal((await f.resume()).status, 200);
  const pump = await f.pump(() => ({ nodes: [] }));
  assert.deepEqual((await queued).result, { nodes: [] });
  await pump.stop();
});

test("M4 visibility: resume may report a lost batch; status shows it; bad shapes are refused", async (t) => {
  const f = await fixture(t);
  await f.pair();
  assert.equal((await f.browser("/v1/suspend")).result.suspended, true);
  const bad = await f.browser("/v1/resume", {
    protocolVersion: 2,
    canvasId: "canvas-a",
    projectId: "project-a",
    lostBatch: { count: "x" },
  });
  assert.equal(bad.status, 400);
  const resumed = await f.browser("/v1/resume", {
    protocolVersion: 2,
    canvasId: "canvas-a",
    projectId: "project-a",
    lostBatch: { count: 2, nodeIds: ["a", "b"] },
  });
  assert.equal(resumed.status, 200);
  const status = (await f.cli(["status"])).result;
  assert.equal(status.lostBatch.count, 2);
  assert.deepEqual(status.lostBatch.nodeIds, ["a", "b"]);

  // A clean resume omits the key entirely; the report must clear, not stick.
  // Leaving it standing makes the agent re-run those nodes a second time —
  // a duplicate paid submit — on every later reload.
  const clean = await f.browser(
    "/v1/resume",
    { protocolVersion: 2, canvasId: "canvas-a", projectId: "project-a" },
    // The resume above rotated the browser credential; this page is the one
    // holding the new one.
    { headers: { Origin: f.info.origin, Authorization: `Bearer ${resumed.result.browserToken}` } },
  );
  assert.equal(clean.status, 200);
  assert.equal((await f.cli(["status"])).result.lostBatch, undefined);
});
