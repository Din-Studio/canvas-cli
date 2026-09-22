export type LocalAgentRole = "main" | "worker";
export declare const PROTOCOL_VERSION: 2;
/** Every field each apply command accepts; `contract.mjs` builds its command
 *  table from this one, so the enforced list and the published one are the same. */
export declare const COMMAND_FIELDS: Readonly<Record<string, readonly string[]>>;
/** v3 §12 — every param the read-only `tasks` method accepts. */
export declare const TASKS_FIELDS: readonly string[];
export declare class RequestPolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
  toError(): { code: string; message: string };
}
export declare function enforceRequestPolicy(role: unknown, method: string, params: unknown): void;
