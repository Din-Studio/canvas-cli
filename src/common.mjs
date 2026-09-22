import { randomBytes, timingSafeEqual } from "node:crypto";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_BODY = 36 * 1024 * 1024;
export const UPLOAD_LIMIT = 25 * 1024 * 1024;
export const MEDIA_LIMIT = 256 * 1024 * 1024;
export const METHODS = new Set([
  "list_canvases",
  "snapshot",
  "health",
  "ls",
  "read",
  "resources",
  "model_catalog",
  "grep",
  "apply",
  "run_node",
  "run_nodes",
  "run_tool",
  "cancel_batch",
  "cancel_node",
  "undo",
  "redo",
  "operations",
  "changes",
  "timeline",
  "end_turn",
  "media_info",
  "media_chunk",
  "tasks",
]);
export const MUTATIONS = new Set([
  "apply",
  "run_node",
  "run_nodes",
  "run_tool",
  "cancel_batch",
  "cancel_node",
  "undo",
  "redo",
  "end_turn",
]);
export const token = () => randomBytes(32).toString("base64url");

export class CliError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}
export function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}
export function errorResult(error) {
  return failure(error.code || "internal_error", error.message || String(error), error.extra);
}
export function secureEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
export function assertJson(value, depth = 0) {
  if (depth > 40) throw new CliError("invalid_request", "JSON nesting exceeds 40 levels");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((v) => assertJson(v, depth + 1));
    return;
  }
  if (!plainObject(value))
    throw new CliError(
      "invalid_request",
      "Only JSON objects, arrays, and scalar values are accepted",
    );
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new CliError("invalid_request", `Forbidden JSON key: ${key}`);
    assertJson(item, depth + 1);
  }
}
export function parseObject(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError("invalid_json", "Expected valid JSON");
  }
  assertJson(value);
  if (!plainObject(value)) throw new CliError("invalid_request", "Expected a JSON object");
  return value;
}
export function validateOrigin(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new CliError(
      "invalid_origin",
      "Use an exact https origin, or loopback http for local development",
    );
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.origin !== input ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new CliError(
      "invalid_origin",
      "Use an exact https origin without a path, or loopback http for local development",
    );
  }
  return url.origin;
}
/** Opaque host attestation: printable ASCII, no whitespace, bounded. */
export const HOST_ATTESTATION_MAX = 4096;
export function validateHostAttestation(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > HOST_ATTESTATION_MAX || !/^[\x21-\x7e]+$/.test(text))
    throw new CliError(
      "invalid_argument",
      "hostAttestation must be printable ASCII without whitespace, at most 4096 characters",
    );
  return text;
}
export function isMutation(method, params) {
  return MUTATIONS.has(method) || (method === "timeline" && params.op !== "list");
}
