import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cli, fixture, request } from "./helpers.mjs";
import { sessionRequest } from "../src/client.mjs";

const exec = promisify(execFile);

test("real daemon: explicit session, private credentials, one-use pairing, Origin/Host/token isolation and PNA preflight", async (t) => {
  const f = await fixture(t);
  assert.equal(f.info.cliToken, undefined);
  assert.equal(f.info.browserToken, undefined);
  assert.ok(f.info.pairCode.length >= 22);
  assert.equal((await fs.stat(f.recordPath)).mode & 0o777, 0o600);
  assert.equal((await f.cli(["status"])).result.state, "awaiting_pair");
  assert.equal((await f.cli(["ls"])).result.error.code, "not_connected");
  assert.equal((await cli(["ls"], f.env)).code, 2);
  const wrongOrigin = await f.raw("/v1/pair", {
    headers: { Origin: "https://evil.example" },
    body: { code: f.info.pairCode, canvasId: "c", projectId: "p" },
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers["access-control-allow-origin"], undefined);
  const wrongHost = await f.raw("/v1/status", {
    headers: {
      Host: `localhost:${new URL(f.info.endpoint).port}`,
      Authorization: `Bearer ${f.record.cliToken}`,
    },
  });
  assert.equal(wrongHost.status, 403);
  const preflight = await f.raw("/v1/next", {
    method: "OPTIONS",
    headers: {
      Origin: f.info.origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type, authorization",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], f.info.origin);
  assert.equal(preflight.headers["access-control-allow-private-network"], "true");
  const badHeaders = await f.raw("/v1/next", {
    method: "OPTIONS",
    headers: {
      Origin: f.info.origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-untrusted",
    },
  });
  assert.equal(badHeaders.status, 403);
  const paired = await f.pair();
  const repeated = await f.browser("/v1/pair", {
    protocolVersion: 2,
    code: f.info.pairCode,
    canvasId: "canvas-a",
    projectId: "project-a",
  });
  assert.equal(repeated.status, 401);
  assert.equal(
    (await f.raw("/v1/status", { headers: { Authorization: `Bearer ${paired.browserToken}` } }))
      .status,
    401,
  );
  assert.equal(
    (
      await f.raw("/v1/status", {
        headers: { Origin: f.info.origin, Authorization: `Bearer ${f.record.cliToken}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.raw("/v1/next", {
        headers: { Origin: f.info.origin, Authorization: `Bearer ${f.record.cliToken}` },
        body: {},
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.raw("/v1/next", {
        headers: { Authorization: `Bearer ${paired.browserToken}` },
        body: {},
      })
    ).status,
    403,
  );
  const a = await f.cli(["status"]),
    b = await f.cli(["status"]);
  assert.equal(a.result.agentId, paired.agentId);
  assert.equal(b.result.agentId, paired.agentId);
  assert.equal(a.result.canvasId, "canvas-a");
  const badScope = await f.rpc({
    requestId: randomUUID(),
    method: "apply",
    turnId: "one",
    params: { canvasId: "other", commands: [] },
  });
  assert.equal(badScope.result.error.code, "invalid_request");
  const badMethod = await f.rpc({
    requestId: randomUUID(),
    method: "eval",
    turnId: "one",
    params: { code: "alert(1)" },
  });
  assert.equal(badMethod.result.error.code, "invalid_request");
});

test("two concurrent task daemons never share ports, identities, tokens, or credentials", async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  const ap = await a.pair(),
    bp = await b.pair();
  assert.notEqual(a.info.endpoint, b.info.endpoint);
  assert.notEqual(ap.agentId, bp.agentId);
  assert.notEqual(a.info.sessionId, b.info.sessionId);
  assert.equal(
    (
      await request(b.info.endpoint, "/v1/status", {
        headers: { Authorization: `Bearer ${a.record.cliToken}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(b.info.endpoint, "/v1/next", {
        headers: { Origin: b.info.origin, Authorization: `Bearer ${ap.browserToken}` },
        body: {},
      })
    ).status,
    401,
  );
  const stopped = await a.cli(["disconnect"]);
  assert.equal(stopped.result.stopped, true);
  assert.equal((await b.cli(["status"])).result.connected, true);
});

test("full reads, batched edits, JSON stdin, long text files, generation authorization, stable business result passthrough", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const longText = "中文 long prompt with `backticks` and $(not-executed)\n".repeat(10000);
  await fs.writeFile(path.join(f.workspace, "prompt.md"), longText);
  const seen = [];
  const pump = await f.pump((rpc) => {
    seen.push(rpc);
    if (rpc.method === "read")
      return { rev: 9, nodes: [{ nodeId: "n1", prompt: longText, promptSha: "sha-before" }] };
    return { ok: true, created: [], written: [{ sha: "sha-after" }], rev: 10, undoDepth: 1 };
  });
  const read = await f.cli(["read", "n1"]);
  assert.equal(read.result.nodes[0].prompt.length, longText.length);
  assert.deepEqual(seen[0].params, { paths: ["n1"] });
  const textEdit = await f.cli([
    "apply",
    "--node",
    "n1",
    "--text-file",
    "prompt.md",
    "--expect-sha",
    "sha-before",
  ]);
  assert.equal(textEdit.code, 0);
  assert.equal(seen[1].params.commands[0].draft.prompt, longText);
  assert.deepEqual(seen[1].params.commands[0].expect, { promptSha: "sha-before" });
  assert.equal(textEdit.result.rev, 10);
  assert.equal(textEdit.result.result, undefined);
  const batch = {
    label: "Two simultaneous edits",
    commands: [
      { type: "move_node", nodeId: "a", position: { x: 10, y: 20 } },
      { type: "move_node", nodeId: "b", position: { x: 30, y: 40 } },
    ],
  };
  const edited = await f.cli(
    ["apply", "--file", "-", "--turn", "review-round"],
    JSON.stringify(batch),
  );
  assert.equal(edited.code, 0);
  assert.deepEqual(seen[2].params, batch);
  assert.equal(seen[2].turnId, "review-round");
  assert.notEqual(seen[0].turnId, seen[1].turnId);
  const denied = await f.cli(["run", "n1"]);
  assert.equal(denied.result.error.code, "approval_required");
  const allowed = await f.cli(["run", "n1", "--approved"]);
  assert.equal(allowed.code, 0);
  assert.equal(seen.at(-1).method, "run_node");
  assert.deepEqual(seen.at(-1).params, { nodeId: "n1", approval: { userApprovedNodeIds: ["n1"] } });
  // 重跑默认保留旧候选；--fresh 才带 clearCandidates 让页面清空同类型旧候选。
  const fresh = await f.cli(["run", "n1", "--fresh", "--approved"]);
  assert.equal(fresh.code, 0, fresh.stdout);
  assert.deepEqual(seen.at(-1).params, {
    nodeId: "n1",
    approval: { userApprovedNodeIds: ["n1"] },
    clearCandidates: true,
  });
  // 批量运行：--nodes 自动替这些 id 声明授权；清单缺一个整批拒；--group 需要显式全量清单。
  const batchDenied = await f.cli(["run-batch", "--nodes", "a,b"]);
  assert.equal(batchDenied.result.error.code, "approval_required");
  const partial = await f.cli([
    "run-batch",
    "--json",
    JSON.stringify({ nodeIds: ["a", "b"], approval: { userApprovedNodeIds: ["a"] } }),
    "--approved",
  ]);
  assert.equal(partial.result.error.code, "approval_required");
  const groupBare = await f.cli(["run-batch", "--group", "g1", "--approved"]);
  assert.equal(groupBare.result.error.code, "approval_required");
  const badConcurrency = await f.cli([
    "run-batch",
    "--nodes",
    "a",
    "--concurrency",
    "999",
    "--approved",
  ]);
  assert.equal(badConcurrency.result.error.code, "invalid_request");
  const sentBefore = seen.length;
  const batchOk = await f.cli([
    "run-batch",
    "--nodes",
    "a,b",
    "--concurrency",
    "2",
    "--rerun-succeeded",
    "--fresh",
    "--approved",
  ]);
  assert.equal(batchOk.code, 0, batchOk.stdout);
  assert.equal(seen.length, sentBefore + 1);
  assert.equal(seen.at(-1).method, "run_nodes");
  assert.deepEqual(seen.at(-1).params, {
    nodeIds: ["a", "b"],
    concurrency: 2,
    rerunSucceeded: true,
    clearCandidates: true,
    approval: { userApprovedNodeIds: ["a", "b"] },
  });
  // run-tool（节点工具条上的工具）和 run 同一道 --approved，且 --kind 必填。
  // 两条都在 CLI 层挡掉 —— **一次网络都不发**，和 run / run-batch 同一个形状。
  const toolBefore = seen.length;
  const toolDenied = await f.cli(["run-tool", "n1", "--kind", "separate-vocal"]);
  assert.equal(toolDenied.result.error.code, "approval_required");
  const toolNoKind = await f.cli(["run-tool", "n1", "--approved"]);
  assert.equal(toolNoKind.result.error.code, "invalid_argument");
  assert.equal(seen.length, toolBefore, "被 CLI 挡下的 run-tool 不该发出任何请求");
  const toolOk = await f.cli(["run-tool", "n1", "--kind", "separate-vocal", "--approved"]);
  assert.equal(toolOk.code, 0, toolOk.stdout);
  assert.equal(seen.at(-1).method, "run_tool");
  assert.deepEqual(seen.at(-1).params, {
    nodeId: "n1",
    kind: "separate-vocal",
    approval: { userApprovedNodeIds: ["n1"] },
  });
  // 带提示词 / 档位的工具（重绘、超清）原样透传。
  const toolPrompt = await f.cli([
    "run-tool",
    "n2",
    "--kind",
    "image-inpaint",
    "--prompt",
    "把背景换成夜景街道",
    "--resolution",
    "2k",
    "--approved",
  ]);
  assert.equal(toolPrompt.code, 0, toolPrompt.stdout);
  assert.deepEqual(seen.at(-1).params, {
    nodeId: "n2",
    kind: "image-inpaint",
    prompt: "把背景换成夜景街道",
    resolution: "2k",
    approval: { userApprovedNodeIds: ["n2"] },
  });
  await pump.stop();
});

test("request IDs deduplicate pending and completed writes and reject payload substitution", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const input = {
    requestId: randomUUID(),
    method: "apply",
    params: {
      label: "batch",
      commands: [{ type: "move_node", nodeId: "n", position: { x: 1, y: 2 } }],
    },
    turnId: "same",
  };
  const first = f.rpc(input),
    repeat = f.rpc(input);
  const next = await f.browser("/v1/next");
  assert.equal(next.result.requestId, input.requestId);
  await f.browser("/v1/reply", {
    requestId: input.requestId,
    result: { ok: true, marker: "single-execution" },
  });
  assert.deepEqual((await first).result, (await repeat).result);
  assert.equal((await f.rpc(input)).result.marker, "single-execution");
  const changed = await f.rpc({ ...input, params: { ...input.params, label: "different" } });
  assert.equal(changed.status, 409);
  assert.equal(changed.result.error.code, "request_id_conflict");
});

test("evicted results retain request-ID tombstones and never replay an old mutation", async (t) => {
  const f = await fixture(t);
  await f.pair();
  let writes = 0;
  const pump = await f.pump((rpc) => {
    if (rpc.method === "apply") writes++;
    return { ok: true };
  });
  const first = {
    requestId: randomUUID(),
    method: "apply",
    params: { commands: [{ type: "delete_node", nodeId: "n" }] },
    turnId: "retained",
  };
  assert.equal((await f.rpc(first)).result.ok, true);
  for (let i = 0; i < 260; i++)
    await f.rpc({ requestId: randomUUID(), method: "snapshot", params: {}, turnId: "read" });
  assert.equal((await f.rpc(first)).result.error.code, "result_expired");
  assert.equal(writes, 1);
  await pump.stop();
});

test("mutations serialize while reads may run beside an in-flight edit", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const mk = (method) => ({
    requestId: randomUUID(),
    method,
    params: method === "apply" ? { commands: [{ type: "delete_node", nodeId: "n" }] } : {},
    turnId: randomUUID(),
  });
  const one = mk("apply"),
    two = mk("apply"),
    read = mk("snapshot");
  const p1 = f.rpc(one);
  assert.equal((await f.browser("/v1/next")).result.requestId, one.requestId);
  const p2 = f.rpc(two),
    pr = f.rpc(read);
  const readRequest = await f.browser("/v1/next");
  assert.equal(readRequest.result.requestId, read.requestId);
  await f.browser("/v1/reply", {
    requestId: read.requestId,
    result: { canvasId: "canvas-a", nodes: [] },
  });
  await pr;
  await f.browser("/v1/reply", { requestId: one.requestId, result: { ok: true } });
  assert.equal((await f.browser("/v1/next")).result.requestId, two.requestId);
  await f.browser("/v1/reply", { requestId: two.requestId, result: { ok: true } });
  assert.equal((await p1).result.ok, true);
  assert.equal((await p2).result.ok, true);
});

test("browser disconnect marks delivered requests unknown, queued requests not-sent, and revokes browser token", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const input = {
    requestId: randomUUID(),
    method: "apply",
    params: { commands: [{ type: "delete_node", nodeId: "n" }] },
    turnId: "uncertain",
  };
  const delivered = f.rpc(input);
  await f.browser("/v1/next");
  const queued = f.rpc({ ...input, requestId: randomUUID() });
  // status crosses the same server and confirms both calls reached it.
  for (let i = 0; i < 10; i++) {
    const s = await f.cli(["status"]);
    if (s.result.pending === 2) break;
  }
  await f.browser("/v1/disconnect");
  const result = (await delivered).result;
  assert.equal(result.error.code, "unknown_outcome");
  assert.equal(result.error.outcome, "unknown");
  assert.equal((await queued).result.error.outcome, "not_sent");
  assert.deepEqual((await f.rpc(input)).result, result);
  assert.equal((await f.browser("/v1/next")).status, 401);
  assert.equal((await f.cli(["status"])).result.connected, false);
});

test("delivered timeout returns unknown with no replay; browser lease loss suspends the session", async (t) => {
  const f = await fixture(t, { timeout: 300, lease: 30000 });
  await f.pair();
  const id = randomUUID();
  const command = f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [{ type: "delete_node", nodeId: "n" }] }),
    "--request-id",
    id,
  ]);
  const next = await f.browser("/v1/next");
  assert.equal(next.result.requestId, id);
  const result = await command;
  assert.equal(result.code, 4);
  assert.equal(result.result.error.code, "unknown_outcome");
  const repeat = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [{ type: "delete_node", nodeId: "n" }] }),
    "--request-id",
    id,
  ]);
  assert.deepEqual(repeat.result, result.result);
  const g = await fixture(t, { timeout: 5000, lease: 120 });
  await g.pair();
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Lease loss no longer ends the session: the daemon waits for the page.
  assert.equal((await g.cli(["status"])).result.state, "reconnecting");
  const resumed = await g.resume();
  assert.equal(resumed.status, 200);
  assert.equal(resumed.result.pageEpoch, 2);
  // Keep a poll outstanding: with a 120 ms lease the session would otherwise
  // lapse again before `status` reads it.
  const pump = await g.pump(() => ({ ok: true }));
  assert.equal((await g.cli(["status"])).result.state, "connected");
  await pump.stop();
});

test("page away: reads answer page_away within 5 s and never queue; mutations queue, ack after --wait-ms, run exactly once at resume; --wait blocks", async (t) => {
  const f = await fixture(t, { timeout: 8000, lease: 120 });
  await f.pair();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const away = await f.cli(["status"]);
  assert.equal(away.result.state, "reconnecting");
  assert.equal(away.result.pageAway, true);
  assert.equal(away.result.queuedCommands, 0);
  assert.equal(typeof away.result.resumeExpiresAt, "string");
  assert.equal(typeof away.result.pageLastSeenAt, "string");
  assert.equal(typeof away.result.daemonPid, "number");
  // A read: told within 5 s, nothing queued, retryable.
  const started = Date.now();
  const read = await f.cli(["ls", "/"]);
  assert.ok(Date.now() - started < 7000, `read blocked ${Date.now() - started} ms`);
  assert.equal(read.code, 3);
  assert.equal(read.result.error.code, "page_away");
  assert.equal(read.result.error.retryable, true);
  assert.equal(read.result.error.queued, false);
  assert.equal(read.result.error.outcome, "not_sent");
  assert.equal(typeof read.result.error.resumeExpiresAt, "string");
  assert.equal(read.result.error.pending, 0);
  assert.equal((await f.cli(["status"])).result.queuedCommands, 0);
  // A mutation: queued, acked with its id after --wait-ms.
  const id = randomUUID();
  const batch = JSON.stringify({ commands: [{ type: "delete_node", nodeId: "n" }] });
  const queued = await f.cli(["apply", "--json", batch, "--request-id", id, "--wait-ms", "200"]);
  assert.equal(queued.code, 3);
  assert.equal(queued.result.error.code, "page_away");
  assert.equal(queued.result.error.queued, true);
  assert.equal(queued.result.error.requestId, id);
  assert.equal(queued.result.error.outcome, "queued");
  assert.match(queued.result.error.message, /命令已排队/);
  const status = await f.cli(["status"]);
  assert.equal(status.result.queuedCommands, 1);
  assert.equal(status.result.pending, 1);
  // --wait / --wait-ms are transport hints, not payload: the same id attaches
  // to the queued record and blocks for the whole window.
  const waiting = f.cli(["apply", "--json", batch, "--request-id", id, "--wait"]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  let writes = 0;
  assert.equal((await f.resume()).status, 200);
  const pump = await f.pump((rpc) => {
    if (rpc.method === "apply" && rpc.params.commands[0].nodeId === "n") writes++;
    return { ok: true, marker: "once" };
  });
  const landed = await waiting;
  assert.equal(landed.code, 0, landed.stdout);
  assert.equal(landed.result.marker, "once");
  // The caller that was told `queued` fetches the result by id — no re-execution.
  const fetched = await f.cli(["apply", "--json", batch, "--request-id", id]);
  assert.equal(fetched.result.marker, "once");
  assert.equal(writes, 1);
  assert.equal((await f.cli(["status"])).result.pageAway, false);
  await pump.stop();
  // A read issued while connected that is stranded by a lease lapse gets the
  // same answer instead of waiting out the recovery window.
  const pending = f.cli(["ls", "/"]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const stranded = await pending;
  assert.equal(stranded.result.error.code, "page_away");
  const bad = await f.cli(["ls", "/", "--wait", "--wait-ms", "5"]);
  assert.equal(bad.result.error.code, "invalid_argument");
});

/**
 * 案底：0.8.1 实测 `tidy --all --wait` 回 `invalid_argument: --wait is not an option
 * of tidy`，而随包手册把「写命令可以 `--wait` 一直等」写成页面不在时的唯一正解。
 * `spec.test.mjs` 那两条闸看的是 flag 表，这一条是**真跑**：真守护进程 + 页面不在，
 * 两条命令都必须走到 `page_away` + `queued:true`（退出码 3），而不是被参数校验挡回来
 * （退出码 2）。表对了而运行时仍然拒，正是这个仓「闸绿着、跑起来坏」的老形态。
 */
test("page away: tidy 与 upload 真的收 --wait / --wait-ms（真守护进程，退出码 3 而不是 2）", async (t) => {
  const f = await fixture(t, { timeout: 8000, lease: 120 });
  await f.pair();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await f.cli(["status"])).result.pageAway, true);
  await fs.writeFile(path.join(f.workspace, "shot.png"), Buffer.alloc(64, 0x37));

  const ids = { tidy: randomUUID(), upload: randomUUID() };
  for (const [name, argv] of [
    ["tidy", ["tidy", "--all", "--wait-ms", "200", "--request-id", ids.tidy]],
    ["upload", ["upload", "shot.png", "--wait-ms", "200", "--request-id", ids.upload]],
  ]) {
    const queued = await f.cli(argv);
    assert.notEqual(
      queued.result.error?.code,
      "invalid_argument",
      `${name} 被 flag 校验拒了：${queued.result.error?.message}`,
    );
    assert.equal(queued.code, 3, queued.stdout);
    assert.equal(queued.result.error.code, "page_away");
    assert.equal(queued.result.error.queued, true, `${name} 没有排队`);
    assert.equal(queued.result.error.outcome, "queued");
    assert.equal(queued.result.error.requestId, ids[name]);
  }
  assert.equal((await f.cli(["status"])).result.queuedCommands, 2);

  // `--wait` 阻塞到页面回来为止，然后命令**恰好执行一次**。
  const waiting = f.cli(["tidy", "--all", "--wait", "--request-id", ids.tidy]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const seen = [];
  assert.equal((await f.resume()).status, 200);
  const pump = await f.pump((rpc) => {
    seen.push(rpc.params.commands[0].type);
    return { ok: true, marker: rpc.params.commands[0].type };
  });
  const landed = await waiting;
  assert.equal(landed.code, 0, landed.stdout);
  assert.equal(landed.result.marker, "tidy");
  assert.deepEqual(seen.sort(), ["tidy", "upload_asset"]);
  await pump.stop();
});

test("connect --session reuses a live session and replaces a dead or long-away one without disconnect", async (t) => {
  const f = await fixture(t, { lease: 120 });
  const args = [
    "connect",
    "--origin",
    "https://canvas.example.test",
    "--name",
    "Research collaborator",
    "--workspace",
    f.workspace,
    "--session",
    f.info.sessionId,
  ];
  /** Stop a daemon `connect` minted inside this test (the fixture only knows its own). */
  const stopMinted = async (home, info) => {
    const record = JSON.parse(
      await fs.readFile(path.join(home, "sessions", `${info.sessionId}.json`), "utf8"),
    );
    await request(info.endpoint, "/v1/stop", {
      headers: { Authorization: `Bearer ${record.cliToken}` },
      body: {},
    });
  };
  // Never paired: the one-use code is gone from status, so it is replaced.
  const unpaired = await cli(args, f.env);
  assert.equal(unpaired.result.reused, false);
  assert.equal(unpaired.result.replaced.reason, "awaiting_pair");
  assert.notEqual(unpaired.result.sessionId, f.info.sessionId);
  await assert.rejects(fs.access(f.recordPath));
  await stopMinted(f.home, unpaired.result);
  const g = await fixture(t, { lease: 120 });
  await g.pair();
  const pump = await g.pump(() => ({ ok: true }));
  const live = await cli([...args.slice(0, -1), g.info.sessionId], g.env);
  assert.equal(live.result.reused, true);
  assert.equal(live.result.sessionId, g.info.sessionId);
  assert.equal(live.result.state, "connected");
  assert.equal(live.result.connectionCode, undefined);
  await pump.stop();
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Briefly away (page seen < 60 s ago): still worth waiting for.
  const briefly = await cli([...args.slice(0, -1), g.info.sessionId], g.env);
  assert.equal(briefly.result.reused, true);
  assert.equal(briefly.result.state, "reconnecting");
  // Daemon process gone (the host restarted): replaced in one call, file removed.
  process.kill(g.record.pid, "SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const dead = await g.cli(["status"]);
  assert.equal(dead.result.error.code, "connection_failed");
  assert.equal(dead.result.error.daemonAlive, false);
  assert.equal(dead.result.error.daemonPid, g.record.pid);
  const replaced = await cli([...args.slice(0, -1), g.info.sessionId], g.env);
  assert.equal(replaced.code, 0, replaced.stdout);
  assert.equal(replaced.result.reused, false);
  assert.deepEqual(replaced.result.replaced, {
    sessionId: g.info.sessionId,
    reason: "daemon_exited",
  });
  assert.equal(typeof replaced.result.connectionCode, "string");
  await assert.rejects(fs.access(g.recordPath));
  await stopMinted(g.home, replaced.result);
});

test("workspace files reject symlinks, hardlinks, traversal, outside JSON, and preserve existing downloads", async (t) => {
  const f = await fixture(t);
  await f.pair();
  await fs.writeFile(path.join(f.root, "outside.png"), "outside");
  await fs.writeFile(path.join(f.workspace, "inside.png"), "inside");
  await fs.symlink(path.join(f.root, "outside.png"), path.join(f.workspace, "symlink.png"));
  await fs.link(path.join(f.workspace, "inside.png"), path.join(f.workspace, "hardlink.png"));
  for (const input of [
    "../outside.png",
    path.join(f.root, "outside.png"),
    "symlink.png",
    "hardlink.png",
  ]) {
    const result = await f.cli(["upload", input]);
    assert.equal(result.code, 2);
    assert.equal(result.result.error.code, "workspace_boundary");
  }
  const badJson = await f.cli(["apply", "--file", "../outside.png"]);
  assert.equal(badJson.result.error.code, "workspace_boundary");
  await fs.writeFile(path.join(f.workspace, "keep.txt"), "human file");
  const kept = await f.cli(["download", "n", "--out", "keep.txt"]);
  assert.equal(kept.result.error.code, "file_exists");
  assert.equal(await fs.readFile(path.join(f.workspace, "keep.txt"), "utf8"), "human file");
  const invalid = await f.cli(["apply", "--json", '{"commands":[],"__proto__":{"x":true}}']);
  assert.equal(invalid.result.error.code, "invalid_request");
});

test("upload uses actual bytesBase64 wire contract; media download streams scoped chunks and text atomically", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const bytes = Buffer.alloc(700000, 0x6a);
  await fs.writeFile(path.join(f.workspace, "picture.png"), bytes.subarray(0, 100));
  let uploaded,
    chunkCalls = 0;
  const pump = await f.pump((rpc) => {
    if (rpc.method === "apply") {
      uploaded = rpc.params.commands[0];
      return { ok: true, created: [{ command: 0, id: "media-node" }], undoDepth: 1 };
    }
    if (rpc.method === "media_info") {
      if (rpc.params.nodeId === "text")
        return { size: 9, mimeType: "text/plain", fileName: "text.txt", content: "台词\nOK" };
      return {
        mediaId: "scoped-random-id",
        size: bytes.length,
        mimeType: "image/png",
        fileName: "picture.png",
      };
    }
    assert.equal(rpc.method, "media_chunk");
    assert.equal(rpc.params.mediaId, "scoped-random-id");
    assert.ok(rpc.params.length <= 262144);
    const part = bytes.subarray(rpc.params.offset, rpc.params.offset + rpc.params.length);
    chunkCalls++;
    return {
      base64: part.toString("base64"),
      offset: rpc.params.offset,
      eof: rpc.params.offset + part.length === bytes.length,
    };
  });
  assert.equal((await f.cli(["upload", "picture.png", "--x", "30", "--y", "40"])).code, 0);
  assert.equal(uploaded.path, "picture.png");
  assert.equal(uploaded.bytesBase64, bytes.subarray(0, 100).toString("base64"));
  assert.equal(uploaded.mimeType, "image/png");
  assert.deepEqual(uploaded.position, { x: 30, y: 40 });
  const downloaded = await f.cli(["download", "media-node", "--out", "saved.png"]);
  assert.equal(downloaded.code, 0);
  assert.deepEqual(await fs.readFile(path.join(f.workspace, "saved.png")), bytes);
  assert.equal(chunkCalls, 3);
  assert.equal(
    (await fs.readdir(f.workspace)).some((name) => name.endsWith(".part")),
    false,
  );
  assert.equal((await f.cli(["download", "text", "--out", "text.txt"])).code, 0);
  assert.equal(await fs.readFile(path.join(f.workspace, "text.txt"), "utf8"), "台词\nOK");
  await pump.stop();
});

test("truncated binary media never publishes a partial output", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const pump = await f.pump((rpc) =>
    rpc.method === "media_info"
      ? { mediaId: "one", size: 10, mimeType: "video/mp4", fileName: "clip.mp4" }
      : { offset: 0, base64: Buffer.from("short").toString("base64"), eof: true },
  );
  const result = await f.cli(["download", "video", "--out", "clip.mp4"]);
  assert.equal(result.result.error.code, "invalid_media");
  assert.deepEqual(await fs.readdir(f.workspace), []);
  await pump.stop();
});

test("resource inventory and selection reach the page; metadata inspection does not request download bytes", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const id = "r1:reference:voice:media";
  const seen = [];
  const pump = await f.pump((rpc) => {
    seen.push(rpc);
    if (rpc.method === "resources")
      return {
        nodeId: "n",
        resources: [{ resourceId: id, source: "reference", kind: "audio" }],
        nextOffset: 7,
      };
    assert.equal(rpc.method, "media_info");
    if (rpc.params.resourceId === "missing")
      return { ok: false, error: { code: "resource_not_found", message: "Resource was removed" } };
    const metadata = { resourceId: id, mimeType: "text/markdown", fileName: "reference.md" };
    return rpc.params.metadataOnly
      ? { ...metadata, size: null, downloaded: false }
      : { ...metadata, size: 8, content: "selected" };
  });
  const listed = await f.cli(["resources", "n", "--limit", "2", "--offset", "3"]);
  assert.equal(listed.code, 0);
  assert.deepEqual(seen[0].params, { nodeId: "n", limit: 2, offset: 3 });
  assert.equal(listed.result.resources[0].resourceId, id);
  const meta = await f.cli(["inspect-media", "n", "--resource", id]);
  assert.equal(meta.code, 0);
  assert.equal(meta.result.size, null);
  assert.equal(meta.result.downloaded, false);
  assert.deepEqual(seen[1].params, { nodeId: "n", resourceId: id, metadataOnly: true });
  const saved = await f.cli(["download", "n", "--resource", id, "--out", "selected.md"]);
  assert.equal(saved.code, 0);
  assert.equal(saved.result.resourceId, id);
  assert.deepEqual(seen[2].params, { nodeId: "n", resourceId: id });
  assert.equal(await fs.readFile(path.join(f.workspace, "selected.md"), "utf8"), "selected");
  const absent = await f.cli(["download", "n", "--resource", "missing", "--out", "missing.md"]);
  assert.equal(absent.result.error.code, "resource_not_found");
  await assert.rejects(fs.access(path.join(f.workspace, "missing.md")));
  await pump.stop();
});

/**
 * `changes` 的游标是 **seq + epoch 两个值**：feed 住在页面里，刷新一次就从 0 重建，
 * 光靠序号分不出「什么都没发生」和「你错过了刷新前后一整段」。`--since-epoch` 必须
 * 真的走到线上去 —— flag 白名单、spec、参数映射任何一处漏掉，Agent 都只能发出裸
 * 序号，然后被页面一律判成 feed_restarted（或者更早的版本：被静默骗过）。
 */
test("changes 的游标两个值都上线：--since-seq 与 --since-epoch 原样进 params", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const pump = await f.pump((rpc) => {
    seen.push(rpc);
    return {
      seq: 80,
      epoch: "epoch-2",
      entries: [],
      truncated: true,
      truncatedReason: "feed_restarted",
    };
  });
  const first = await f.cli(["changes"]);
  assert.equal(first.code, 0);
  assert.deepEqual(seen[0].params, {});
  // 回包里的 epoch 原样回给调用方：它就是下一次续读要带的那半个游标。
  assert.equal(first.result.epoch, "epoch-2");

  const resumed = await f.cli(["changes", "--since-seq", "57", "--since-epoch", "epoch-1"]);
  assert.equal(resumed.code, 0);
  assert.deepEqual(seen[1].params, { sinceSeq: 57, sinceEpoch: "epoch-1" });
  assert.equal(resumed.result.truncatedReason, "feed_restarted");
  await pump.stop();
});

test("malformed responses after a mutation remain unknown outcomes", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(502);
    res.end("proxy failed after delivery");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const result = await sessionRequest(
    {
      endpoint: `http://127.0.0.1:${server.address().port}`,
      cliToken: "test",
      callTimeoutMs: 1000,
    },
    "/v1/call",
    {},
    { mutation: true, requestId: "retained" },
  );
  assert.equal(result.error.code, "unknown_outcome");
  assert.equal(result.error.requestId, "retained");
});

test("installed ffmpeg/ffprobe produce actual frame files and metadata from scoped video bytes", async (t) => {
  try {
    await exec("ffmpeg", ["-version"]);
    await exec("ffprobe", ["-version"]);
  } catch {
    t.skip("Optional ffmpeg/ffprobe are not installed");
    return;
  }
  const f = await fixture(t);
  await f.pair();
  const source = path.join(f.workspace, "source.mp4");
  await exec("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=32x32:d=1:r=4",
    "-an",
    "-c:v",
    "mpeg4",
    "-q:v",
    "5",
    source,
  ]);
  const bytes = await fs.readFile(source);
  const pump = await f.pump((rpc) => {
    if (rpc.method === "media_info") {
      assert.equal(rpc.params.resourceId, "r1:candidate:1234567890abcdef:media");
      assert.equal(rpc.params.metadataOnly, undefined);
      return {
        mediaId: "local-test-video",
        resourceId: rpc.params.resourceId,
        size: bytes.length,
        mimeType: "video/mp4",
        fileName: "source.mp4",
      };
    }
    const chunk = bytes.subarray(rpc.params.offset, rpc.params.offset + rpc.params.length);
    return {
      base64: chunk.toString("base64"),
      offset: rpc.params.offset,
      eof: rpc.params.offset + chunk.length === bytes.length,
    };
  });
  const sampled = await f.cli([
    "frames",
    "video",
    "--resource",
    "r1:candidate:1234567890abcdef:media",
    "--out-dir",
    "samples",
    "--every",
    "0.5",
    "--count",
    "2",
  ]);
  assert.equal(sampled.code, 0, sampled.result.error?.message);
  assert.equal(sampled.result.count, 2);
  for (const file of sampled.result.paths)
    assert.equal((await fs.readFile(file)).subarray(0, 2).toString("hex"), "ffd8");
  assert.deepEqual((await fs.readdir(path.join(f.workspace, "samples"))).sort(), [
    "frame-001.jpg",
    "frame-002.jpg",
  ]);
  const inspected = await f.cli([
    "inspect-media",
    "video",
    "--resource",
    "r1:candidate:1234567890abcdef:media",
    "--out",
    "probe.mp4",
    "--probe",
  ]);
  assert.equal(inspected.code, 0, inspected.result.error?.message);
  assert.equal(inspected.result.probe.streams[0].width, 32);
  assert.equal(inspected.result.probe.streams[0].height, 32);
  await pump.stop();
});

test("resume retries return one rotation and old credentials cannot act after the new page polls", async (t) => {
  const f = await fixture(t);
  const first = await f.pair();
  assert.equal(first.resumeIdempotent, true);
  const input = {
    protocolVersion: 2,
    canvasId: "canvas-a",
    projectId: "project-a",
    resumeRequestId: randomUUID(),
  };
  const resumed = await f.browser("/v1/resume", input);
  assert.equal(resumed.status, 200);
  const repeats = await Promise.all([
    f.browser("/v1/resume", input),
    f.browser("/v1/resume", input),
  ]);
  for (const repeated of repeats) {
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.result, resumed.result);
  }
  assert.equal(
    (await f.browser("/v1/resume", { ...input, resumeRequestId: randomUUID() })).status,
    401,
  );
  assert.equal(
    (await f.browser("/v1/resume", { ...input, canvasId: "other" })).result.error.code,
    "scope_mismatch",
  );
  for (const route of ["/v1/next", "/v1/reply", "/v1/suspend", "/v1/disconnect"])
    assert.equal((await f.browser(route)).status, 401);
  const headers = { Origin: f.info.origin, Authorization: `Bearer ${resumed.result.browserToken}` };
  // Suspend and retry the unacknowledged operation (e.g. another refresh while /verify is slow).
  assert.equal((await f.raw("/v1/suspend", { headers, body: {} })).status, 200);
  assert.deepEqual((await f.browser("/v1/resume", input)).result, resumed.result);
  const requestId = randomUUID();
  const read = f.rpc({ requestId, method: "snapshot", params: {}, turnId: "resume-ack" });
  const next = await f.raw("/v1/next", { headers, body: {} });
  assert.equal(next.status, 200);
  assert.equal(next.result.requestId, requestId);
  assert.equal((await f.browser("/v1/resume", input)).status, 401);
  await f.raw("/v1/reply", { headers, body: { requestId, result: { ok: true } } });
  await read;
  // A later rotation also fences the previous current credential.
  const later = await f.raw("/v1/resume", {
    headers,
    body: { ...input, resumeRequestId: randomUUID() },
  });
  assert.equal(later.result.pageEpoch, resumed.result.pageEpoch + 1);
  assert.equal((await f.browser("/v1/resume", input)).status, 401);
});

test("an unacknowledged resume retry expires and cannot revive a disconnected session", async (t) => {
  const f = await fixture(t, { resume: 100 });
  await f.pair();
  const input = {
    protocolVersion: 2,
    canvasId: "canvas-a",
    projectId: "project-a",
    resumeRequestId: randomUUID(),
  };
  assert.equal(
    (await f.browser("/v1/resume", { ...input, resumeRequestId: "bad" })).result.error.code,
    "invalid_request",
  );
  assert.equal((await f.browser("/v1/resume", input)).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await f.browser("/v1/resume", input)).status, 401);
  const g = await fixture(t);
  await g.pair();
  const resumed = await g.browser("/v1/resume", input);
  await g.raw("/v1/disconnect", {
    headers: { Origin: g.info.origin, Authorization: `Bearer ${resumed.result.browserToken}` },
    body: {},
  });
  assert.equal((await g.browser("/v1/resume", input)).status, 401);
});
