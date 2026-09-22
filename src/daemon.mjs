import http from "node:http";
import { createConnectionCode } from "./connection-code.mjs";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  CliError,
  MAX_BODY,
  METHODS,
  UUID,
  assertJson,
  errorResult,
  failure,
  isMutation,
  parseObject,
  secureEqual,
  token,
  validateHostAttestation,
  validateOrigin,
} from "./common.mjs";
import { saveSession, sessionPath, workspaceRoot } from "./session.mjs";
import { enforceRequestPolicy, PROTOCOL_VERSION } from "./policy.mjs";

const BROWSER_ROUTES = new Set([
  "/v1/pair",
  "/v1/next",
  "/v1/reply",
  "/v1/disconnect",
  "/v1/suspend",
  "/v1/resume",
]);
const CLI_ROUTES = new Set(["/v1/status", "/v1/call", "/v1/stop", "/v1/delegate", "/v1/revoke"]);
const MAX_PENDING = 64;
const MAX_IDS = 10000;
/**
 * How long a daemon lingers after it can no longer be paired. Long enough that
 * `status` still explains why the session ended, short enough that a browser tab
 * the user simply closed does not leave a process and a loopback port behind.
 */
const TERMINAL_EXIT_MS = 5 * 60 * 1000;
const MAX_CACHED_BYTES = 16 * 1024 * 1024;
const MAX_CACHED_RESULTS = 256;
const MAX_DELEGATES = 64;
/**
 * How long a call waits for an absent page before the caller is told so.
 * A read never queues: past this it is dropped and answered `page_away`
 * (retryable, nothing happened). A mutation stays queued — its id and
 * tombstone are kept, the page will execute it exactly once when it resumes —
 * but the caller gets a `page_away` + `queued:true` ack after its own
 * `waitMs` (default 30 s) instead of sitting on a silent socket for the
 * whole ten-minute recovery window. `wait:true` restores the blocking form.
 */
const PAGE_AWAY_READ_MS = 5000;
const DEFAULT_MUTATION_WAIT_MS = 30000;
const PAGE_AWAY_MESSAGE =
  "画布页面暂时离线（可能正在刷新/升级），命令已排队，10 分钟内页面回来会自动执行；可用 status 查看，用 --request-id 取结果";
const PAGE_AWAY_READ_MESSAGE =
  "画布页面暂时离线（可能正在刷新/升级），只读命令不排队、什么都没发生；请用户把画布页面切到前台后重试。可用 status 查看";

function send(res, value, status = 200) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json"))
    throw new CliError("invalid_request", "Content-Type must be application/json");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new CliError("too_large", "Request body exceeds 36 MiB");
    chunks.push(chunk);
  }
  return parseObject(Buffer.concat(chunks).toString("utf8"));
}
function keys(object, allowed) {
  for (const key of Object.keys(object))
    if (!allowed.includes(key)) throw new CliError("invalid_request", `Unexpected field: ${key}`);
}

/** One process, identity, canvas, and credential scope per task. */
export async function startDaemon(config) {
  validateOrigin(config.origin);
  if (!UUID.test(config.sessionId) || typeof config.cliToken !== "string")
    throw new CliError("invalid_session", "Invalid daemon session");
  // Optional host attestation: opaque to the daemon, handed to the page at pair
  // and resume so it can ask its own server who vouched for this session.
  const hostAttestation =
    config.hostAttestation === undefined
      ? undefined
      : validateHostAttestation(config.hostAttestation);
  const pairCode = token();
  const pairExpiresAt = Date.now() + 10 * 60 * 1000;
  let browserToken = token();
  // One unacknowledged rotation. Only the original resume operation may use
  // its old credential, until the replacement page polls or this record expires.
  let pendingResume = null;
  const agentId = `scenemint-cli:${config.sessionId}`;
  const mainCaller = { ...config, role: "main", active: true };
  const callers = new Map([[config.sessionId, mainCaller]]);
  let paired = null;
  let state = "awaiting_pair";
  let reason;
  let resumeDeadline = 0;
  let pageEpoch = 1;
  // The daemon is the authority on whether a session is alive. A page that
  // stops polling (reload, navigation, throttled tab, transient network error)
  // moves the session to `reconnecting` for this window; only an explicit
  // browser disconnect, a CLI stop, or an expired window ends it.
  const resumeMs = config.resumeMs || 600000;
  /** 0 until the page first pairs: `status.pageLastSeenAt` is null, not "now". */
  let lastBrowserContact = 0;
  /** M4 visibility: batch nodes the previous page never submitted (reported at resume). */
  let lostBatch = null;
  let poll = null;
  let activeMutation = null;
  const requests = new Map();
  const cached = new Map();
  /** Finished read ids, oldest first — kept only as far back as MAX_IDS. */
  const doneReads = [];
  /** Self-exit timer for the two dead ends (see armExit). */
  let exitTimer;
  /** Mutations seen this session: the only ids that need a permanent tombstone. */
  let mutatingIds = 0;
  let cachedBytes = 0;
  let stopping = false;
  let endpoint;
  const callTimeoutMs = config.callTimeoutMs || 120000;
  const leaseMs = config.leaseMs || 45000;

  const queuedCommands = () => [...requests.values()].filter((r) => !r.done && !r.delivered).length;
  const pageLastSeenAt = () =>
    lastBrowserContact ? new Date(lastBrowserContact).toISOString() : null;
  const status = (caller) => ({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    sessionId: caller.sessionId,
    role: caller.role,
    ...(caller.parentSessionId ? { parentSessionId: caller.parentSessionId } : {}),
    name: caller.name,
    endpoint,
    daemonPid: process.pid,
    state,
    connected: state === "connected",
    // The three facts an Agent needs when a command came back `page_away`:
    // is the page gone, what is still waiting for it, when did we last hear it.
    pageAway: state === "reconnecting",
    queuedCommands: queuedCommands(),
    pageLastSeenAt: pageLastSeenAt(),
    pageEpoch,
    ...(pageEpoch > 1 ? { undoHistoryReset: true } : {}),
    ...(state === "reconnecting"
      ? { resumeExpiresAt: new Date(resumeDeadline).toISOString(), reason }
      : {}),
    resumeMs,
    hostAttested: Boolean(hostAttestation),
    ...(lostBatch ? { lostBatch } : {}),
    agentId,
    agentName: config.name,
    origin: config.origin,
    workspace: caller.workspace,
    canvasId: paired?.canvasId ?? null,
    projectId: paired?.projectId ?? null,
    pending: [...requests.values()].filter(
      (r) => !r.done && (caller.role === "main" || r.ownerId === caller.sessionId),
    ).length,
    ...(caller.role === "main"
      ? {
          delegates: [...callers.values()]
            .filter((c) => c.role === "worker")
            .map((c) => ({ sessionId: c.sessionId, name: c.name, active: c.active })),
        }
      : {}),
    ...(reason ? { reason } : {}),
    ...(state === "awaiting_pair" ? { pairExpiresAt: new Date(pairExpiresAt).toISOString() } : {}),
  });
  /** Timeout bookkeeping (m2): a queued request waits without a clock while the
   *  page is away; the clock starts at creation while connected and restarts at
   *  delivery. A delivered request that is retired but still holds the mutation
   *  slot releases it when its own clock runs out. */
  function armTimer(record, ms) {
    clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      if (record.done) {
        if (record.awaitingReply) releaseHeld(record);
        return;
      }
      if (record.delivered)
        finish(
          record,
          failure(
            "unknown_outcome",
            "The page did not answer this delivered request in time. Inspect the canvas before issuing any new mutation; this request will not be re-executed.",
            { requestId: record.id, outcome: "unknown" },
          ),
        );
      else
        finish(
          record,
          failure("request_timeout", "Request timed out before delivery", {
            requestId: record.id,
            outcome: "not_sent",
          }),
        );
    }, ms);
  }
  /** The structured answer a caller gets instead of a silent wait (see PAGE_AWAY_READ_MS). */
  function pageAwayFailure(record) {
    return failure("page_away", record.mutating ? PAGE_AWAY_MESSAGE : PAGE_AWAY_READ_MESSAGE, {
      retryable: true,
      queued: record.mutating,
      ...(record.mutating ? { requestId: record.id, outcome: "queued" } : { outcome: "not_sent" }),
      state,
      resumeExpiresAt: new Date(resumeDeadline).toISOString(),
      pageLastSeenAt: pageLastSeenAt(),
      pending: queuedCommands(),
    });
  }
  /**
   * Page away and this call not yet delivered: promise the caller an answer.
   * Reads are dropped (never executed, so no tombstone is owed); mutations keep
   * their queue slot, id and fingerprint — only the waiting socket is released.
   */
  function armPageAway(record) {
    clearTimeout(record.pageAwayTimer);
    if (record.wait || record.done || record.delivered || state !== "reconnecting") return;
    record.pageAwayTimer = setTimeout(
      () => {
        if (record.done || record.delivered || state !== "reconnecting") return;
        // Dropped before `pending` is counted: a read reports what is still queued, not itself.
        if (!record.mutating) requests.delete(record.id);
        const answer = pageAwayFailure(record);
        for (const response of record.responses)
          send(response, answer, record.mutating ? 202 : 503);
        record.responses.clear();
      },
      record.mutating ? record.waitMs : PAGE_AWAY_READ_MS,
    );
  }
  function releaseHeld(record) {
    if (!record.awaitingReply) return;
    clearTimeout(record.timer);
    record.awaitingReply = false;
    if (activeMutation === record.id) activeMutation = null;
    flush();
  }
  function finish(record, result, { holdMutation = false } = {}) {
    if (record.done) return;
    record.done = true;
    clearTimeout(record.pageAwayTimer);
    if (!holdMutation) clearTimeout(record.timer);
    record.awaitingReply = holdMutation;
    if (!holdMutation && activeMutation === record.id) activeMutation = null;
    for (const response of record.responses) send(response, result);
    record.responses.clear();
    // Retain IDs (and fingerprints) even after result eviction: never execute a
    // previously seen mutation again because a large media reply evicted it.
    const encoded = JSON.stringify(result);
    const bytes = Buffer.byteLength(encoded);
    if (bytes <= MAX_CACHED_BYTES) {
      cached.set(record.id, { result, bytes });
      cachedBytes += bytes;
    }
    while (cached.size > MAX_CACHED_RESULTS || cachedBytes > MAX_CACHED_BYTES) {
      const id = cached.keys().next().value;
      cachedBytes -= cached.get(id).bytes;
      cached.delete(id);
    }
    delete record.params;
    // Only MUTATIONS need a PERMANENT tombstone — that is what the no-replay
    // guarantee is made of. A finished read is kept too (a retried id still
    // dedupes) but only as far back as the budget: a chunked media download
    // spends one request id per 256 KiB, so without this a few large reads
    // filled the session's 10 000 ids and the human had to re-pair.
    if (!holdMutation && !record.mutating) {
      doneReads.push(record.id);
      while (doneReads.length > MAX_IDS) {
        const id = doneReads.shift();
        requests.delete(id);
        const entry = cached.get(id);
        if (entry) {
          cachedBytes -= entry.bytes;
          cached.delete(id);
        }
      }
    }
    flush();
  }
  async function revokeCaller(caller, why) {
    if (!caller.active) return { deliveredRequests: 0, alreadyRevoked: true };
    caller.active = false;
    let deliveredRequests = 0;
    for (const record of requests.values()) {
      if (record.ownerId !== caller.sessionId || record.done) continue;
      if (record.delivered) deliveredRequests++;
      finish(
        record,
        failure(
          record.delivered ? "unknown_outcome" : "delegate_revoked",
          record.delivered
            ? "Delegation was revoked after delivery. The page may still complete this operation; inspect the canvas before issuing dependent mutations."
            : why,
          { requestId: record.id, outcome: record.delivered ? "unknown" : "not_sent" },
        ),
        // A delivered edit still owns the serialization slot until its actual
        // reply (or the existing request timeout). Revocation cannot undo it.
        { holdMutation: record.delivered && record.mutating },
      );
    }
    await fs.unlink(sessionPath(caller.sessionId)).catch(() => {});
    return { deliveredRequests, alreadyRevoked: false };
  }
  /** Poll lost or page suspended: keep credentials, identity, workers and
   *  queued (undelivered) requests; retire delivered requests as unknown. */
  function enterReconnecting(why) {
    if (state !== "connected") return;
    state = "reconnecting";
    reason = why;
    if (!resumeDeadline) resumeDeadline = Date.now() + resumeMs;
    if (poll) {
      clearTimeout(poll.timer);
      send(poll.res, { suspended: true });
      poll = null;
    }
    // The page may still be alive (a throttled tab that merely missed the
    // lease) and still executing the delivered mutation: keep the serial slot
    // until its own clock runs out, a late reply lands, or a replacement page
    // resumes (M7). Queued requests stop their clocks while we wait (m2).
    retireDelivered(
      "The page may have executed this request before it went away. Inspect the canvas before issuing any new mutation; this request will not be re-executed.",
      { hold: true },
    );
    for (const record of requests.values()) {
      if (!record.done && !record.delivered) {
        clearTimeout(record.timer);
        armPageAway(record);
      }
    }
  }
  /** A delivered request can never be answered by a replacement page, and is
   *  never replayed. It ends as unknown_outcome; with `hold` the mutation slot
   *  stays taken until the request's own clock, a late reply, or a resume. */
  function retireDelivered(message, { hold = false } = {}) {
    for (const record of requests.values()) {
      if (record.done || !record.delivered) continue;
      finish(
        record,
        failure("unknown_outcome", message, { requestId: record.id, outcome: "unknown" }),
        { holdMutation: hold && record.mutating },
      );
    }
    if (!hold) {
      for (const record of requests.values()) if (record.awaitingReply) releaseHeld(record);
      activeMutation = null;
    }
  }
  async function disconnect(why) {
    if (state === "disconnected") return;
    state = "disconnected";
    pendingResume = null;
    reason = why;
    if (poll) {
      clearTimeout(poll.timer);
      send(poll.res, failure("disconnected", why), 410);
      poll = null;
    }
    for (const record of requests.values()) {
      clearTimeout(record.timer);
      clearTimeout(record.pageAwayTimer);
      if (!record.done)
        finish(
          record,
          failure(
            record.delivered ? "unknown_outcome" : "disconnected",
            record.delivered
              ? "The page may have executed this request. Inspect the canvas before issuing any new mutation; this request will not be re-executed."
              : "Request was not sent to the page",
            { requestId: record.id, outcome: record.delivered ? "unknown" : "not_sent" },
          ),
        );
    }
    activeMutation = null;
    await Promise.all(
      [...callers.values()].filter((c) => c.role === "worker").map((c) => revokeCaller(c, why)),
    );
    // A disconnected session can never be paired again, so nothing will ever call
    // /v1/stop for it: without this the process, its loopback port and its session
    // file outlive the terminal that started them, forever. The grace window is
    // long enough that `status` can still report WHY it ended.
    armExit();
  }
  /**
   * Exit on our own once the session can no longer become useful. Two dead ends:
   * `disconnected` (terminal) and a pairing code nobody ever used.
   */
  function armExit(delay = TERMINAL_EXIT_MS) {
    clearTimeout(exitTimer);
    exitTimer = setTimeout(() => void shutdown(), delay);
    exitTimer.unref?.();
  }
  function flush() {
    if (!poll || state !== "connected") return;
    const record = [...requests.values()].find(
      (r) =>
        !r.done &&
        !r.delivered &&
        callers.get(r.ownerId)?.active &&
        (!r.mutating || !activeMutation),
    );
    if (!record) return;
    const waiter = poll;
    poll = null;
    clearTimeout(waiter.timer);
    record.delivered = true;
    clearTimeout(record.pageAwayTimer);
    if (record.mutating) activeMutation = record.id;
    armTimer(record, callTimeoutMs);
    send(waiter.res, {
      requestId: record.id,
      method: record.method,
      params: record.params,
      turnId: record.turnId,
      role: record.role,
    });
  }
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearTimeout(exitTimer);
    clearInterval(leaseTimer);
    await disconnect("Session stopped");
    await fs.unlink(sessionPath(config.sessionId)).catch(() => {});
    server.close();
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 100).unref();
  }

  const server = http.createServer(async (req, res) => {
    try {
      const expectedHost = new URL(endpoint).host;
      if (req.headers.host !== expectedHost) {
        send(res, failure("invalid_host", "Host does not match this loopback session"), 403);
        return;
      }
      const route = req.url;
      if (!BROWSER_ROUTES.has(route) && !CLI_ROUTES.has(route)) {
        send(res, failure("not_found", "Unknown route"), 404);
        return;
      }
      const browser = BROWSER_ROUTES.has(route);
      const pendingCredential = () =>
        route === "/v1/resume" &&
        pendingResume !== null &&
        Date.now() <= pendingResume.expiresAt &&
        secureEqual(req.headers.authorization, `Bearer ${pendingResume.previousToken}`);
      let caller;
      if (browser) {
        if (req.headers.origin !== config.origin) {
          send(res, failure("invalid_origin", "Origin is not paired with this session"), 403);
          return;
        }
        res.setHeader("Access-Control-Allow-Origin", config.origin);
        res.setHeader("Vary", "Origin");
        if (req.method === "OPTIONS") {
          const allowedHeaders = (req.headers["access-control-request-headers"] || "")
            .toLowerCase()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (
            req.headers["access-control-request-method"] !== "POST" ||
            allowedHeaders.some((h) => !["authorization", "content-type"].includes(h))
          ) {
            send(res, failure("invalid_request", "Unsupported preflight"), 403);
            return;
          }
          res.setHeader("Access-Control-Allow-Methods", "POST");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
          res.setHeader("Access-Control-Max-Age", "300");
          if (req.headers["access-control-request-private-network"] === "true")
            res.setHeader("Access-Control-Allow-Private-Network", "true");
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method !== "POST") {
          send(res, failure("method_not_allowed", "Browser routes require POST"), 405);
          return;
        }
        if (
          route !== "/v1/pair" &&
          ((!secureEqual(req.headers.authorization, `Bearer ${browserToken}`) &&
            !pendingCredential()) ||
            (state !== "connected" &&
              !(
                state === "reconnecting" &&
                ["/v1/resume", "/v1/disconnect", "/v1/suspend"].includes(route)
              )))
        ) {
          send(res, failure("unauthorized", "Browser session is not connected"), 401);
          return;
        }
      } else {
        caller = [...callers.values()].find(
          (candidate) =>
            candidate.active &&
            secureEqual(req.headers.authorization, `Bearer ${candidate.cliToken}`),
        );
        if (req.headers.origin !== undefined || !caller) {
          send(
            res,
            failure(
              "unauthorized",
              "CLI credentials are required and browser origins are forbidden",
            ),
            401,
          );
          return;
        }
        const requiredMethod = route === "/v1/status" ? "GET" : "POST";
        if (req.method !== requiredMethod) {
          send(res, failure("method_not_allowed", `Use ${requiredMethod}`), 405);
          return;
        }
      }
      if (route === "/v1/status") {
        send(res, status(caller));
        return;
      }
      const input = await body(req);
      if (browser && route !== "/v1/pair" && state === "disconnected") {
        send(res, failure("unauthorized", "Browser session is not connected"), 401);
        return;
      }
      if (
        browser &&
        route !== "/v1/pair" &&
        !secureEqual(req.headers.authorization, `Bearer ${browserToken}`) &&
        !(pendingCredential() && input.resumeRequestId === pendingResume.requestId)
      ) {
        send(
          res,
          failure("unauthorized", "Browser credential was replaced during this request"),
          401,
        );
        return;
      }
      if (!browser && !caller.active) {
        send(res, failure("unauthorized", "Delegated session was revoked"), 401);
        return;
      }
      if (route === "/v1/suspend" || route === "/v1/resume") {
        keys(
          input,
          route === "/v1/resume"
            ? ["protocolVersion", "canvasId", "projectId", "lostBatch", "resumeRequestId"]
            : [],
        );
        if (
          route === "/v1/resume" &&
          (input.protocolVersion !== PROTOCOL_VERSION ||
            input.canvasId !== paired?.canvasId ||
            input.projectId !== paired?.projectId)
        )
          throw new CliError(
            "scope_mismatch",
            "Resume must use the original protocol, project and canvas",
          );
        if (state === "reconnecting" && Date.now() > resumeDeadline) {
          await disconnect("Page refresh recovery expired; create a new connection");
          throw new CliError("resume_expired", "Refresh recovery expired; create a new connection");
        }
        if (route === "/v1/suspend") {
          enterReconnecting("Page suspended (reload or navigation)");
          send(res, {
            ok: true,
            suspended: true,
            resumeExpiresAt: new Date(resumeDeadline).toISOString(),
          });
          return;
        }
        if (input.resumeRequestId !== undefined && !UUID.test(input.resumeRequestId))
          throw new CliError("invalid_request", "resumeRequestId must be a UUID");
        if (
          pendingResume &&
          Date.now() <= pendingResume.expiresAt &&
          input.resumeRequestId === pendingResume.requestId
        ) {
          // Re-deliver the SAME rotation; never retire work or advance its epoch twice.
          if (state === "reconnecting") {
            state = "connected";
            reason = undefined;
            resumeDeadline = 0;
            lastBrowserContact = Date.now();
            for (const record of requests.values()) {
              if (!record.done && !record.delivered) {
                clearTimeout(record.pageAwayTimer);
                armTimer(record, callTimeoutMs);
              }
            }
          }
          send(res, pendingResume.response);
          return;
        }
        // Resume: the replacement page (or the same page after a lost poll)
        // takes over. Delivered-but-unanswered requests are retired as unknown
        // and never replayed; undelivered requests stay queued and are sent to
        // the new page. Workers keep their credentials.
        if (poll) {
          clearTimeout(poll.timer);
          send(poll.res, { suspended: true });
          poll = null;
        }
        retireDelivered(
          "The page was replaced while this request was delivered. Inspect the canvas before issuing any new mutation; this request will not be re-executed.",
        );
        for (const record of requests.values()) {
          if (!record.done && !record.delivered) {
            clearTimeout(record.pageAwayTimer);
            armTimer(record, callTimeoutMs);
          }
        }
        // M4 (visibility only): the replacement page reports batch nodes the
        // previous page never got to submit. Nothing is replayed.
        const lb = input.lostBatch;
        if (lb !== undefined) {
          if (
            !lb ||
            typeof lb !== "object" ||
            Array.isArray(lb) ||
            !Number.isInteger(lb.count) ||
            lb.count < 0 ||
            (lb.nodeIds !== undefined &&
              (!Array.isArray(lb.nodeIds) ||
                lb.nodeIds.length > 1000 ||
                lb.nodeIds.some((id) => typeof id !== "string" || !id || id.length > 1024)))
          )
            throw new CliError("invalid_request", "lostBatch must be { count, nodeIds? }");
        }
        // Every resume REPLACES the report, absent field included: the page omits
        // the key entirely on a clean resume, so only assigning when it is present
        // left the previous reload's lost nodes standing forever — and an agent
        // re-running them a second time is a duplicate paid submit.
        lostBatch =
          lb && lb.count > 0
            ? {
                count: lb.count,
                nodeIds: (lb.nodeIds ?? []).slice(0, 200),
                at: new Date().toISOString(),
              }
            : null;
        const previousToken = browserToken;
        browserToken = token();
        resumeDeadline = 0;
        reason = undefined;
        pageEpoch++;
        state = "connected";
        // Paired: this session is alive again, so cancel the unused-code exit.
        clearTimeout(exitTimer);
        lastBrowserContact = Date.now();
        const response = {
          protocolVersion: PROTOCOL_VERSION,
          browserToken,
          agentId,
          agentName: config.name,
          ...paired,
          resumeSupported: true,
          resumeIdempotent: true,
          resumeMs,
          pageEpoch,
          undoHistoryReset: true,
          ...(hostAttestation ? { hostAttestation } : {}),
        };
        pendingResume = input.resumeRequestId
          ? {
              requestId: input.resumeRequestId,
              previousToken,
              response,
              expiresAt: Date.now() + resumeMs,
            }
          : null;
        send(res, response);
        return;
      }
      if (route === "/v1/stop") {
        keys(input, []);
        if (caller.role === "worker") {
          const outcome = await revokeCaller(caller, "Worker session stopped before delivery");
          send(res, {
            ok: true,
            stopped: true,
            sessionId: caller.sessionId,
            role: "worker",
            ...outcome,
          });
        } else {
          send(res, { ok: true, stopped: true, sessionId: config.sessionId });
          await shutdown();
        }
        return;
      }
      if (route === "/v1/delegate" || route === "/v1/revoke") {
        if (caller.role !== "main")
          throw new CliError(
            "worker_forbidden",
            "Only the parent session may delegate or revoke workers",
          );
        if (route === "/v1/revoke") {
          keys(input, ["sessionId"]);
          const child = callers.get(input.sessionId);
          if (!child || child.role !== "worker")
            throw new CliError("delegate_not_found", "Unknown delegated session");
          const outcome = await revokeCaller(child, "Parent revoked the worker before delivery");
          send(res, { ok: true, revoked: true, sessionId: child.sessionId, ...outcome });
          return;
        }
        keys(input, ["name", "workspace"]);
        if (state !== "connected")
          throw new CliError("not_connected", "Pair the parent session before delegating");
        if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120)
          throw new CliError("invalid_argument", "Delegated name must contain 1–120 characters");
        if (typeof input.workspace !== "string" || !input.workspace)
          throw new CliError("invalid_workspace", "An existing worker workspace is required");
        if (callers.size > MAX_DELEGATES)
          throw new CliError(
            "session_limit",
            "Parent reached 64 delegated sessions; create a new parent session",
          );
        const workspace = await workspaceRoot(input.workspace);
        // Reserve identity before yielding to disk: concurrent delegations and
        // disconnects cannot bypass the per-parent limit or leak an active child.
        if (state !== "connected" || stopping)
          throw new CliError("disconnected", "Parent session disconnected while delegating");
        if (callers.size > MAX_DELEGATES)
          throw new CliError(
            "session_limit",
            "Parent reached 64 delegated sessions; create a new parent session",
          );
        const child = {
          sessionId: randomUUID(),
          cliToken: token(),
          role: "worker",
          parentSessionId: config.sessionId,
          name: input.name.trim(),
          workspace,
          active: true,
        };
        callers.set(child.sessionId, child);
        try {
          await saveSession({
            version: 2,
            protocolVersion: PROTOCOL_VERSION,
            ...child,
            endpoint,
            origin: config.origin,
            agentId,
            callTimeoutMs,
            pid: process.pid,
            createdAt: new Date().toISOString(),
          });
          if (!child.active || state !== "connected" || stopping) {
            await fs.unlink(sessionPath(child.sessionId)).catch(() => {});
            throw new CliError("disconnected", "Parent session disconnected while delegating");
          }
        } catch (error) {
          child.active = false;
          await fs.unlink(sessionPath(child.sessionId)).catch(() => {});
          throw error;
        }
        send(res, { ...status(child), parentSessionId: config.sessionId });
        return;
      }
      if (route === "/v1/pair") {
        keys(input, ["code", "canvasId", "projectId", "protocolVersion"]);
        if (input.protocolVersion !== PROTOCOL_VERSION) {
          send(
            res,
            failure(
              "protocol_mismatch",
              "CLI and page must both support canvas connection protocol 2; update both and reconnect",
            ),
            409,
          );
          return;
        }
        if (
          state !== "awaiting_pair" ||
          Date.now() > pairExpiresAt ||
          !secureEqual(input.code, pairCode)
        ) {
          send(
            res,
            failure("invalid_pair_code", "Pair code is invalid, expired, or already used"),
            401,
          );
          return;
        }
        if (
          typeof input.canvasId !== "string" ||
          !input.canvasId ||
          input.canvasId.length > 512 ||
          typeof input.projectId !== "string" ||
          !input.projectId ||
          input.projectId.length > 512
        )
          throw new CliError("invalid_request", "canvasId and projectId are required");
        paired = { canvasId: input.canvasId, projectId: input.projectId };
        state = "connected";
        // Paired: this session is alive again, so cancel the unused-code exit.
        clearTimeout(exitTimer);
        lastBrowserContact = Date.now();
        send(res, {
          protocolVersion: PROTOCOL_VERSION,
          browserToken,
          agentId,
          agentName: config.name,
          ...paired,
          resumeSupported: true,
          resumeIdempotent: true,
          resumeMs,
          pageEpoch,
          ...(hostAttestation ? { hostAttestation } : {}),
        });
        return;
      }
      if (browser) lastBrowserContact = Date.now();
      if (route === "/v1/next") {
        keys(input, []);
        // A current-credential poll acknowledges durable receipt by the page.
        pendingResume = null;
        if (poll) {
          send(res, failure("poll_in_progress", "Only one browser poll may be outstanding"), 409);
          return;
        }
        const waiter = {
          res,
          timer: setTimeout(() => {
            if (poll === waiter) {
              poll = null;
              send(res, { idle: true });
            }
          }, 20000),
        };
        poll = waiter;
        res.once("close", () => {
          if (poll === waiter) {
            clearTimeout(waiter.timer);
            poll = null;
          }
        });
        flush();
        return;
      }
      if (route === "/v1/reply") {
        keys(input, ["requestId", "result", "error"]);
        const record = requests.get(input.requestId);
        if (!record || !record.delivered)
          throw new CliError("invalid_request", "Reply does not belong to a delivered request");
        if (Object.hasOwn(input, "result") === Object.hasOwn(input, "error"))
          throw new CliError("invalid_request", "Provide exactly one of result or error");
        if (
          input.error &&
          (typeof input.error.code !== "string" || typeof input.error.message !== "string")
        )
          throw new CliError("invalid_request", "error requires code and message");
        if (record.done) {
          if (record.awaitingReply) releaseHeld(record);
          send(res, { ok: true, duplicate: true });
          return;
        }
        finish(record, input.error ? { ok: false, error: input.error } : input.result);
        send(res, { ok: true });
        return;
      }
      if (route === "/v1/disconnect") {
        keys(input, []);
        await disconnect("User disconnected the page");
        send(res, { ok: true, disconnected: true });
        return;
      }
      if (route === "/v1/call") {
        keys(input, ["requestId", "method", "params", "turnId", "wait", "waitMs"]);
        // Transport hints, not part of the request identity (fingerprint):
        // the same command re-issued with --wait must attach to its record.
        if (input.wait !== undefined && typeof input.wait !== "boolean")
          throw new CliError("invalid_request", "wait must be a boolean");
        if (
          input.waitMs !== undefined &&
          (!Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > resumeMs)
        )
          throw new CliError("invalid_request", `waitMs must be an integer of 0–${resumeMs}`);
        if (
          !UUID.test(input.requestId || "") ||
          !METHODS.has(input.method) ||
          typeof input.turnId !== "string" ||
          !input.turnId ||
          input.turnId.length > 256 ||
          !input.params ||
          Array.isArray(input.params) ||
          typeof input.params !== "object"
        )
          throw new CliError(
            "invalid_request",
            "Expected requestId UUID, supported method, params object, and turnId",
          );
        assertJson(input.params);
        enforceRequestPolicy(caller.role, input.method, input.params);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([caller.role, input.method, input.params, input.turnId]))
          .digest("hex");
        const prior = requests.get(input.requestId);
        if (prior) {
          if (prior.ownerId !== caller.sessionId) {
            send(
              res,
              failure("request_id_conflict", "requestId belongs to a different caller"),
              409,
            );
            return;
          }
          if (prior.fingerprint !== fingerprint) {
            send(
              res,
              failure("request_id_conflict", "requestId was already used with a different payload"),
              409,
            );
            return;
          }
          if (prior.done) {
            send(
              res,
              cached.get(prior.id)?.result ??
                failure(
                  "result_expired",
                  "Cached result expired; this request will not execute again",
                  { requestId: prior.id },
                ),
              cached.has(prior.id) ? 200 : 409,
            );
            return;
          }
          prior.responses.add(res);
          res.once("close", () => prior.responses.delete(res));
          // A caller that came back for a queued mutation (`--request-id`,
          // with or without --wait) is told again when the page is still away.
          if (input.wait === true) {
            prior.wait = true;
            clearTimeout(prior.pageAwayTimer);
          } else if (!prior.delivered) {
            if (input.waitMs !== undefined) prior.waitMs = input.waitMs;
            prior.wait = false;
            armPageAway(prior);
          }
          return;
        }
        // `reconnecting` keeps accepting calls: they queue undelivered until the
        // page resumes, and fail as not_sent on timeout or final disconnect.
        if (state !== "connected" && state !== "reconnecting") {
          send(
            res,
            failure(
              "not_connected",
              state === "disconnected"
                ? "This session has disconnected. Create a new connection and pair it; the old pairing code cannot be reused."
                : "Pair this task with the SceneMint page before calling canvas commands",
              { outcome: "not_sent", state, ...(reason ? { reason } : {}) },
            ),
            409,
          );
          return;
        }
        // The budget exists to bound PERMANENT tombstones, and only mutations get
        // one. Counting reads too meant a large media download — one request id
        // per 256 KiB chunk — could spend the whole session.
        if (mutatingIds >= MAX_IDS) {
          send(
            res,
            failure(
              "session_limit",
              "Session reached 10000 distinct requests; start and pair a new task session",
            ),
            429,
          );
          return;
        }
        if ([...requests.values()].filter((r) => !r.done).length >= MAX_PENDING) {
          send(res, failure("busy", "Session has 64 pending requests"), 429);
          return;
        }
        const record = {
          id: input.requestId,
          ownerId: caller.sessionId,
          role: caller.role,
          method: input.method,
          params: input.params,
          turnId: input.turnId,
          fingerprint,
          responses: new Set([res]),
          delivered: false,
          done: false,
          mutating: isMutation(input.method, input.params),
          wait: input.wait === true,
          waitMs: input.waitMs ?? DEFAULT_MUTATION_WAIT_MS,
        };
        if (record.mutating) mutatingIds++;
        // No clock while the page is away: a queued call waits for the resume
        // window (m2). The clock starts here when connected and restarts at delivery.
        if (state === "connected") armTimer(record, callTimeoutMs);
        requests.set(record.id, record);
        res.once("close", () => record.responses.delete(res));
        armPageAway(record);
        flush();
        return;
      }
    } catch (error) {
      send(res, errorResult(error), error.code === "too_large" ? 413 : 400);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 64;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  endpoint = `http://127.0.0.1:${server.address().port}`;
  const leaseTimer = setInterval(
    () => {
      if (state === "reconnecting" && Date.now() > resumeDeadline)
        void disconnect("Page refresh recovery expired; create a new connection");
      // An outstanding poll is the page's own open socket to us (its close
      // clears `poll`), so it is live contact even though the request itself
      // arrived a while ago.
      if (state === "connected" && !poll && Date.now() - lastBrowserContact > leaseMs)
        enterReconnecting("Browser stopped polling (reload, navigation, or a network error)");
    },
    Math.min(1000, leaseMs),
  );
  leaseTimer.unref();
  // A code nobody ever pastes is the other dead end: /v1/pair refuses it past
  // pairExpiresAt, so from that moment the process can only sit there.
  armExit(Math.max(1000, pairExpiresAt - Date.now()) + TERMINAL_EXIT_MS);
  try {
    await saveSession({
      version: 2,
      protocolVersion: PROTOCOL_VERSION,
      role: "main",
      sessionId: config.sessionId,
      endpoint,
      cliToken: config.cliToken,
      workspace: config.workspace,
      origin: config.origin,
      name: config.name,
      agentId,
      callTimeoutMs,
      // The CLI needs this to size its own deadline: a call issued while the page
      // is away has no clock until the page resumes, so the client must be willing
      // to wait out the recovery window instead of calling it a lost connection.
      resumeMs,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    clearInterval(leaseTimer);
    server.close();
    throw error;
  }
  const stopSignal = () => {
    void shutdown();
  };
  process.once("SIGINT", stopSignal);
  process.once("SIGTERM", stopSignal);
  return {
    publicInfo: {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      role: "main",
      sessionId: config.sessionId,
      endpoint,
      pairCode,
      connectionCode: createConnectionCode(endpoint, pairCode),
      pairExpiresAt: new Date(pairExpiresAt).toISOString(),
      agentId,
      agentName: config.name,
      origin: config.origin,
      workspace: config.workspace,
      state: "awaiting_pair",
    },
    shutdown,
  };
}

if (process.send) {
  process.once("message", async (config) => {
    try {
      const daemon = await startDaemon(config);
      process.send?.({ ready: daemon.publicInfo });
    } catch (error) {
      process.send?.({ error: errorResult(error) });
      process.exitCode = 1;
      process.disconnect?.();
    }
  });
}
