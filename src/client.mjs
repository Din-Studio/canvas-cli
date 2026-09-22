import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CliError,
  errorResult,
  isMutation,
  token,
  validateHostAttestation,
  validateOrigin,
} from "./common.mjs";
import { readSession, sessionPath, workspaceRoot } from "./session.mjs";
import { enforceRequestPolicy } from "./policy.mjs";
import { promises as fs } from "node:fs";

/** Default `--wait-ms`: how long a mutation waits for an absent page before `page_away`. */
export const DEFAULT_WAIT_MS = 30000;
/** A `reconnecting` daemon whose page has been silent this long is not worth reusing. */
export const STALE_PAGE_MS = 60000;

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Is this session still worth talking to? The incident this answers: a host
 * kept a `canvas-session.json` whose daemon had died with the host process,
 * and `connect` kept replying "already connected (reconnecting)" from that
 * stale file. Liveness is decided here, from the daemon itself — pid, then
 * `/v1/status` — never from the record alone.
 */
export async function probeSession(sessionId, { staleAfterMs = STALE_PAGE_MS } = {}) {
  let record;
  try {
    record = await readSession(sessionId);
  } catch (error) {
    return { alive: false, reason: error?.code || "session_not_found" };
  }
  if (record.role !== "main") return { alive: false, reason: "not_main", record };
  if (!processAlive(record.pid)) return { alive: false, reason: "daemon_exited", record };
  const status = await sessionRequest(record, "/v1/status", undefined, { timeoutMs: 3000 });
  if (status?.ok !== true)
    return { alive: false, reason: status?.error?.code || "unreachable", record };
  if (status.state === "connected") return { alive: true, status, record };
  if (status.state === "reconnecting") {
    const seen = Date.parse(status.pageLastSeenAt || "");
    if (Number.isFinite(seen) && Date.now() - seen < staleAfterMs)
      return { alive: true, status, record };
    return { alive: false, reason: "page_away_too_long", status, record };
  }
  // awaiting_pair: the one-use code was printed once and is not in status;
  // a caller that lost it needs a new session anyway. disconnected: terminal.
  return { alive: false, reason: status.state, status, record };
}

export async function connect(options) {
  const origin = validateOrigin(options.origin);
  if (typeof options.name !== "string" || !options.name.trim() || options.name.length > 120)
    throw new CliError("invalid_argument", "--name must contain 1–120 characters");
  if (!options.workspace) throw new CliError("invalid_workspace", "--workspace is required");
  // `connect --session ID`: reuse the session when its daemon is alive and its
  // page is here (or only briefly away); otherwise retire it and mint a new one
  // in the same call — the host never has to `disconnect` a corpse first.
  let replaced;
  if (options.session !== undefined) {
    const probe = await probeSession(options.session);
    if (probe.alive) return { ...probe.status, reused: true };
    if (probe.record) {
      if (probe.reason !== "daemon_exited")
        await sessionRequest(probe.record, "/v1/stop", {}, { timeoutMs: 3000 }).catch(() => {});
      await fs.unlink(sessionPath(probe.record.sessionId)).catch(() => {});
    }
    replaced = { sessionId: options.session, reason: probe.reason };
  }
  const config = {
    sessionId: randomUUID(),
    cliToken: token(),
    origin,
    name: options.name.trim(),
    workspace: await workspaceRoot(options.workspace),
  };
  // Host attestation (0.6): a signed-in desktop host may vouch for this session
  // so the page can tell a built-in agent from an external one. The callback
  // receives the session id (the attestation is bound to it); a failure means
  // "no attestation", never a failed connect — the page decides what that means.
  if (options.attest !== undefined) {
    if (typeof options.attest !== "function")
      throw new CliError(
        "invalid_argument",
        "attest must be a function (sessionId) => Promise<string>",
      );
    try {
      const value = await options.attest(config.sessionId);
      if (typeof value === "string" && value.trim())
        config.hostAttestation = validateHostAttestation(value);
    } catch {
      /* no attestation */
    }
  }
  // Test-only overrides also make timeout semantics testable with real processes.
  if (process.env.SCENEMINT_CANVAS_TEST_TIMEOUT_MS && process.env.NODE_ENV === "test")
    config.callTimeoutMs = Number(process.env.SCENEMINT_CANVAS_TEST_TIMEOUT_MS);
  if (process.env.SCENEMINT_CANVAS_TEST_LEASE_MS && process.env.NODE_ENV === "test")
    config.leaseMs = Number(process.env.SCENEMINT_CANVAS_TEST_LEASE_MS);
  if (process.env.SCENEMINT_CANVAS_TEST_RESUME_MS && process.env.NODE_ENV === "test")
    config.resumeMs = Number(process.env.SCENEMINT_CANVAS_TEST_RESUME_MS);
  const child = fork(fileURLToPath(new URL("./daemon.mjs", import.meta.url)), [], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new CliError("connect_failed", "Local session did not start within 10 seconds"));
    }, 10000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new CliError("connect_failed", error.message));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new CliError("connect_failed", "Local session exited during startup"));
    });
    child.once("message", (message) => {
      clearTimeout(timer);
      child.disconnect();
      child.unref();
      if (message.error)
        reject(new CliError(message.error.error.code, message.error.error.message));
      else resolve({ ...message.ready, reused: false, ...(replaced ? { replaced } : {}) });
    });
    child.send(config);
  });
}

/** How long the CLI socket waits on `/v1/call`: the daemon's own clocks plus slack. */
export function callDeadlineMs(session, input) {
  const away =
    input?.wait === true
      ? session.resumeMs || 600000
      : Math.max(input?.waitMs ?? DEFAULT_WAIT_MS, 5000);
  return (session.callTimeoutMs || 120000) + away + 5000;
}

export async function sessionRequest(
  session,
  route,
  input,
  { mutation = false, requestId, timeoutMs } = {},
) {
  try {
    const response = await fetch(`${session.endpoint}${route}`, {
      method: input === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${session.cliToken}`,
        ...(input === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      // /v1/call sits on the socket for the daemon's clocks: callTimeoutMs while
      // the page is here, plus — page away — `waitMs` for a mutation (then the
      // daemon answers `page_away`, queued) or the whole recovery window with
      // `wait:true`. Cutting it shorter than the daemon turned a navigation
      // into `connection_failed`, i.e. "nothing was sent" — the one thing that
      // was not true.
      signal: AbortSignal.timeout(
        timeoutMs ??
          (route === "/v1/call"
            ? callDeadlineMs(session, input)
            : (session.callTimeoutMs || 120000) + 5000),
      ),
      redirect: "error",
    });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new CliError("invalid_response", "Local session returned a non-JSON response");
    }
    if (!response.ok && result?.ok !== false)
      throw new CliError("connection_failed", `Local session returned HTTP ${response.status}`);
    return result;
  } catch (error) {
    // 策略拒绝（RequestPolicyError）不是 CliError，但它是明确的参数错误，不能报成「连不上」。
    if ((error instanceof CliError || typeof error?.code === "string") && !mutation)
      return errorResult(error);
    return errorResult(
      new CliError(
        mutation ? "unknown_outcome" : "connection_failed",
        mutation
          ? "The command may have reached the page. Do not repeat it automatically; inspect status and canvas state before proceeding."
          : "Cannot reach the local session. Check that the session and paired page remain open.",
        { ...(requestId ? { requestId } : {}), ...(mutation ? { outcome: "unknown" } : {}) },
      ),
    );
  }
}

export async function call(
  session,
  method,
  params,
  { requestId = randomUUID(), turnId = requestId, wait, waitMs } = {},
) {
  // 策略拒绝在这里就回成 {ok:false,error}，和守护进程的拒绝同一个形状（B-4：以前是往上抛，
  // 调用方一律当「连不上」）。
  try {
    enforceRequestPolicy(session.role, method, params);
  } catch (error) {
    return errorResult(error);
  }
  return sessionRequest(
    session,
    "/v1/call",
    {
      requestId,
      method,
      params,
      turnId,
      ...(wait === true ? { wait: true } : {}),
      ...(waitMs !== undefined ? { waitMs } : {}),
    },
    {
      // 单一真相源：守护进程用同一个判定决定要不要占串行槽（common.mjs MUTATIONS），
      // 这里再维护一份清单就漏掉了 run_nodes / cancel_batch —— 回包丢失时会报成
      // connection_failed（「没发出去」），Agent 据此重发整批付费生成。
      mutation: isMutation(method, params),
      requestId,
    },
  );
}
export function requireSuccess(result) {
  if (result?.ok === false)
    throw new CliError(
      result.error?.code || "request_failed",
      result.error?.message || "Canvas command failed",
      Object.fromEntries(
        Object.entries(result.error || {}).filter(([key]) => !["code", "message"].includes(key)),
      ),
    );
  return result;
}
