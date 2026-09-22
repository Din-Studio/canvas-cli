/** Node kinds the canvas graph has. Kept as literals so indexing `DRAFT_KEYS`
 *  with the app's own `CanvasNode["kind"]` fails the typecheck when a kind is
 *  added there and not here — that gap is how a draft key gets silently dropped. */
export type CanvasContractNodeKind =
  | "gen"
  | "media-upload"
  | "scene-3d"
  | "group"
  | "image-gen"
  | "video-gen";

export declare const DRAFT_KEYS: Readonly<Record<CanvasContractNodeKind, readonly string[]>>;

/** One `apply.tidied[]` / `tidy.tidied[]` entry. */
export interface CanvasTidyRun {
  readonly command: number;
  readonly moved: number;
  readonly resized: number;
  readonly strays: readonly string[];
}

/**
 * `tidied[]` rendered as one text line per entry, strays named — the same
 * string the page puts in `apply.tidySummary` on BOTH the `apply` and the
 * `tidy` path. A host that surfaces prose rather than JSON should paste this
 * instead of re-implementing the wording: "applied 1 command" with no numbers
 * in it is the failure this exists to prevent.
 */
export declare function formatTidySummary(tidied: readonly CanvasTidyRun[]): string;

export interface CanvasContractCommand {
  /** Every field this command accepts; anything else is `invalid_request`. */
  readonly fields: readonly string[];
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

/** Only the keys a given entry actually declares are present. */
export interface CanvasContractRange {
  readonly min?: number;
  readonly max?: number;
  /** "must be greater than" — `focus_node.fill` rejects 0. */
  readonly exclusiveMin?: number;
  readonly default?: number;
  readonly integer?: boolean;
  /** `align.nodeIds` under `distribute_x` / `distribute_y`. */
  readonly minForDistribute?: number;
  /** `upload_asset.bytesBase64` after decoding. */
  readonly maxDecodedBytes?: number;
  /** Per-item character cap on an id list. */
  readonly itemMaxLength?: number;
}

/**
 * Every name on the `page_away` path — the error code, the four `status` fields,
 * the error payload's fields, the two `outcome` values, the exit code and the two
 * timing constants. Reference these instead of copying the strings: a rename
 * upstream then breaks a consumer's typecheck instead of silently reading
 * `undefined` and treating "the page is gone" as "everything is fine".
 */
export declare const PAGE_AWAY: {
  readonly code: "page_away";
  readonly statusFields: {
    readonly away: "pageAway";
    readonly queued: "queuedCommands";
    readonly lastSeen: "pageLastSeenAt";
    readonly expires: "resumeExpiresAt";
  };
  readonly errorFields: {
    readonly retryable: "retryable";
    readonly queued: "queued";
    readonly outcome: "outcome";
    readonly requestId: "requestId";
    readonly state: "state";
    readonly expires: "resumeExpiresAt";
    readonly lastSeen: "pageLastSeenAt";
    readonly pending: "pending";
  };
  readonly outcomes: { readonly queued: "queued"; readonly notSent: "not_sent" };
  readonly exitCode: 3;
  readonly readAnswerMs: number;
  readonly defaultWaitMs: number;
};

export declare const CANVAS_CONTRACT: {
  readonly bridgeVersion: 3;
  readonly protocolVersion: 2;
  /** The 20 `AgentCommand` verbs, keyed by `type`. */
  readonly commands: Readonly<Record<string, CanvasContractCommand>>;
  readonly draftKeys: Readonly<Record<CanvasContractNodeKind, readonly string[]>>;
  /** `<command>.<field>` → closed value set. */
  readonly enums: Readonly<Record<string, readonly string[]>>;
  /** `<command>.<field>` → numeric bounds and defaults. */
  readonly ranges: Readonly<Record<string, CanvasContractRange>>;
  /**
   * `<rpc method>.<field>` → request-level hard caps. A few entries are a bare
   * NUMBER, not a range object (`group_nodes.minMembers`, `group.oversizeRatio`):
   * their consumers read the value with `Number(v)`, which an object turns into
   * `NaN` — so the scalar shape is part of the contract, not an oversight.
   */
  readonly limits: Readonly<Record<string, CanvasContractRange | number>>;
  /**
   * Codes the **page bridge** returns, with "could the same payload still succeed".
   * Not every `error.code` a caller sees: the CLI and its daemon put a second set
   * of codes in that same field (`not_connected`, `invalid_argument`, …) and those
   * have no `retryable` — index defensively and fall back to `cliExitCodes`.
   */
  readonly bridgeErrors: Readonly<Record<string, { readonly retryable: boolean }>>;
  /**
   * `error.code` → CLI process exit code, across both namespaces: 2 arguments or
   * file boundary, 3 connection/authentication, 4 unknown outcome. Any code absent
   * here exits 1 (business failure).
   */
  readonly cliExitCodes: Readonly<Record<string, 2 | 3 | 4>>;
  /**
   * The closed value sets of a `changes` reply. `truncatedReason` is the one to
   * read first: `truncated:true` with `feed_restarted` means the caller's cursor
   * does not belong to this feed — indistinguishable from "nothing happened"
   * without it. `actors` includes `page`, the page's own automatic writes, which
   * must never be reported to a user as something they did.
   */
  readonly changes: {
    readonly actors: readonly ["human", "remote", "page"];
    readonly kinds: readonly ["add", "update", "delete", "move", "batch"];
    readonly notes: readonly [
      "run_timeout",
      "batch_lost",
      "quota_stop",
      "frame_strays",
      "frame_escaped",
      "bulk_change",
    ];
    readonly truncatedReasons: readonly ["buffer_dropped", "feed_restarted"];
    /**
     * The cursor is TWO values, not one. A bare `seq` cannot be proven to belong
     * to this feed — the feed lives in the page and a reload restarts it at 0 —
     * so every reply carries `epoch` as well, and a resuming caller sends both
     * back. Omitting `sinceEpoch` answers `truncated` / `feed_restarted` rather
     * than guess.
     */
    readonly cursor: {
      readonly seq: "seq";
      readonly epoch: "epoch";
      readonly sinceSeq: "sinceSeq";
      readonly sinceEpoch: "sinceEpoch";
      readonly flags: readonly ["--since-seq", "--since-epoch"];
    };
    readonly cap: number;
  };
  /**
   * The closed value set of a `health` reply — the conclusion surface of the
   * canvas check. `issueKinds` is in SEVERITY order, which is the order the
   * detail list is sorted by, so a truncated list keeps the worst rows. Branch
   * on `kind`; never on `message`, whose wording is not a contract.
   * `scanIsWholeCanvas` is the promise that `truncated` / `omittedIssues` can
   * only ever mean "the detail list was cut", never "the canvas was not fully
   * examined" — `counts` stays the complete per-kind tally either way.
   */
  readonly health: {
    readonly issueKinds: readonly [
      "dangling_mention",
      "member_escaped",
      "group_frame_oversize",
      "stray_over_frame",
      "group_overlap",
      "node_overlap",
      "group_empty",
      "group_undersized",
    ];
    readonly scanIsWholeCanvas: true;
  };
  /**
   * The closed value set of `ApplyResult.focused[].reason` — why a `focus_node`
   * did NOT move the human's camera. `focus_node` is the one command whose
   * effect lives outside the document, so the batch's `ok` proves nothing about
   * it: read `focused[].framed`. `unmeasured` is per-node and can succeed later
   * (the page has no geometry for it yet); `no_camera` means this host wired no
   * camera at all and no `focus_node` will ever work in it.
   */
  readonly focus: {
    readonly unframedReasons: readonly ["unmeasured", "no_camera"];
  };
  /** The `page_away` names, same object as the `PAGE_AWAY` export. */
  readonly pageAway: typeof PAGE_AWAY;
};
