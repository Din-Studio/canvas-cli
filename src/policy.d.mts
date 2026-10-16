export type LocalAgentRole = "main" | "worker";
export declare const PROTOCOL_VERSION: 2;
/** Every field each apply command accepts; `contract.mjs` builds its command
 *  table from this one, so the enforced list and the published one are the same. */
export declare const COMMAND_FIELDS: Readonly<Record<string, readonly string[]>>;
/** v3 §12 — every param the read-only `tasks` method accepts. */
export declare const TASKS_FIELDS: readonly string[];
/** Every `timeline` op, and every param the `timeline` method accepts
 *  (op ↔ field pairing is validated page-side). */
export declare const TIMELINE_OPS: readonly string[];
export declare const TIMELINE_FIELDS: readonly string[];
/** scene3d@1 — every field each `scene3d_apply` action `op` accepts (besides `op`); the page's
 *  3D reducer reads this same table through `CANVAS_CONTRACT.scene3d.ops`. */
export declare const SCENE3D_ACTION_FIELDS: Readonly<Record<string, readonly string[]>>;
/** The label the CLI gives an `apply` without `--label`; the page lists such a step in `operations`
 *  under the summary it derives from the commands instead (B14). */
export declare const CLI_APPLY_DEFAULT_LABEL: "CLI canvas edit";
/** Most actions one `scene3d_apply` takes (at least 1). */
export declare const SCENE3D_ACTIONS_MAX: 200;
/** 0.16.2 — which moment of a shot a 3D still shows: `start` (the shot's first frame, k = 0)
 *  or `end` (moves and camera move complete, k = 1). `CANVAS_CONTRACT.scene3d.enums.frame`
 *  is this same array. */
export declare const SCENE3D_STILL_FRAMES: readonly ["start", "end"];
/** Every param `run_node` accepts; any other is `invalid_request` (checked after `approval`).
 *  On a 3D scene node `shotId` (CLI `run --shot`) / `shotIds` / `allShots` pick the shots,
 *  `render` / `sheetFrames` the product (0.17.0) and `frame` (CLI `run --frame`, 0.16.2) a still's
 *  start or end; the policy checks shapes only (and `frame` against `SCENE3D_STILL_FRAMES`). */
export declare const RUN_NODE_FIELDS: readonly string[];
/** Every param `run_nodes` (CLI `run-batch`) accepts since 0.17.0; any other is `invalid_request`
 *  (checked after `approval`). No 3D params: a batch renders 3D nodes as `allShots` + still. */
export declare const RUN_NODES_FIELDS: readonly string[];
/** 0.16.2 — every param `run_stills` accepts (CLI `run-stills`): `nodeId`, optional `shotIds`
 *  (default: every shot, in shot-list order), `frames` (default: `start` and `end`), boolean
 *  `force` (CLI `--force`: render every still again — those already up to date and those whose
 *  picture a human or an Agent swapped, which are otherwise skipped; decision A71 as revised), and the
 *  mandatory `approval`. Any other is `invalid_request` (checked after `approval`). */
export declare const RUN_STILLS_FIELDS: readonly string[];
/** Most `run_stills.shotIds`: a scene's shot cap, `CANVAS_CONTRACT.scene3d.limits.shots`. */
export declare const RUN_STILLS_SHOTS_MAX: 60;
/** 0.18.0 — every param `run_shot_refs` accepts (CLI `run-shot-refs`): `nodeId`, optional `shotIds`
 *  (1..60, no repeats) and `force` (boolean), `approval`. More is `invalid_request`. */
export declare const RUN_SHOT_REFS_FIELDS: readonly string[];
/** 0.18.0 — the page's total budget cap for one `run_shot_refs` (ms); `SCENE3D.limits.shotRefsBudgetMs`. */
export declare const RUN_SHOT_REFS_BUDGET_MS: 240000;
/** 0.18.0 — how long the daemon and the CLI wait for a `run_shot_refs` answer (ms); `SCENE3D.limits.shotRefsCallMs`. */
export declare const RUN_SHOT_REFS_CALL_MS: number;
/** How long one call may wait (ms): the session's `base`, widened to `RUN_SHOT_REFS_CALL_MS` for `run_shot_refs`. */
export declare function methodCallTimeoutMs(method: string | undefined, base: number): number;
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
/** The apply commands a worker may not send, not even nested inside a batch
 *  (off-canvas file moves, and the delete / recover kind the main session owns).
 *  Mirrored by `CANVAS_CONTRACT.tiers.applyCommands[*].workerAllowed` (negated). */
export declare const WORKER_BLOCKED_COMMANDS: ReadonlySet<string>;
/** doc@1 — every param `documents_list` accepts (`docs ls`). */
export declare const DOCUMENTS_LIST_FIELDS: readonly string[];
/** doc@1 — every param `documents_get` accepts (`docs read`). */
export declare const DOCUMENTS_GET_FIELDS: readonly string[];
/** doc@1 — every param `documents_folders` accepts (`docs ls --folders`, `docs read --folder`). Read; workers allowed. */
export declare const DOCUMENTS_FOLDERS_FIELDS: readonly string[];
/** doc@1 — every param `documents_put` accepts (`docs create` / `docs update`). Main only. */
export declare const DOCUMENTS_PUT_FIELDS: readonly string[];
/** doc@1 — every param `documents_delete` accepts (`docs delete`). Main only; `approval` required. */
export declare const DOCUMENTS_DELETE_FIELDS: readonly string[];
/** Every param `jianying_roots_touch` accepts (remember one Jianying draft folder). Main only;
 *  `jianying_roots_list` takes no params and is main only as well. */
export declare const JIANYING_ROOTS_TOUCH_FIELDS: readonly string[];
/** Longest document id: `doc:<id>@<version>` must still fit one 30-character node tag. */
export declare const DOCUMENT_ID_MAX_LENGTH: 20;
/** Longest document body, counted as a JS string length (UTF-16 code units) after LF normalization.
 *  50,000 since 0.16.2 (1,000,000 before); over it is `too_large` with `chars` / `limitChars`. */
export declare const DOCUMENT_CONTENT_MAX_CHARS: 50000;
/** Upper bound of `documents_list.limit`. */
export declare const DOCUMENTS_LIST_MAX_LIMIT: 200;
export declare class RequestPolicyError extends Error {
  readonly code: string;
  /** Fields besides `code` / `message` (`too_large` from `documents_put`: `chars`, `limitChars`). */
  readonly extra: Readonly<Record<string, unknown>>;
  constructor(code: string, message: string, extra?: Record<string, unknown>);
  toError(): { code: string; message: string } & Record<string, unknown>;
}
export declare function enforceRequestPolicy(role: unknown, method: string, params: unknown): void;
