export type LocalAgentRole = "main" | "worker";
export declare const PROTOCOL_VERSION: 2;
/** Every field each apply command accepts; `contract.mjs` builds its command
 *  table from this one, so the enforced list and the published one are the same. */
export declare const COMMAND_FIELDS: Readonly<Record<string, readonly string[]>>;
/** v3 §12 — every param the read-only `tasks` method accepts. */
export declare const TASKS_FIELDS: readonly string[];
/** A5 — every param the read-only `health` method accepts. */
export declare const HEALTH_FIELDS: readonly string[];
/** Every param `run_tool` accepts. `approval` is mandatory: a tool costs money
 *  exactly like `run_node`, so the same user-authorization declaration applies. */
export declare const RUN_TOOL_FIELDS: readonly string[];
/** The read-only wire methods. A worker may call every one of them; none of them
 *  enters the undo stack or costs anything. `CANVAS_CONTRACT.tiers` calls this L0. */
export declare const READ_METHODS: ReadonlySet<string>;
/** The wire methods only a `main` role may call; a worker gets `worker_forbidden`.
 *  Mirrored by `CANVAS_CONTRACT.tiers[*].mainOnly`. */
export declare const MAIN_METHODS: ReadonlySet<string>;
/** The two apply commands a worker may not send, not even nested inside a batch.
 *  Mirrored by `CANVAS_CONTRACT.tiers.applyCommands[*].workerAllowed` (negated). */
export declare const WORKER_BLOCKED_COMMANDS: ReadonlySet<string>;
export declare class RequestPolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
  toError(): { code: string; message: string };
}
export declare function enforceRequestPolicy(role: unknown, method: string, params: unknown): void;
