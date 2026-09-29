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

/**
 * doc@1 — the one "document" shape every agent shares (scripts, outlines, the global
 * skeleton, character sheets, shot lists, shot-analysis reports, uploaded novels…),
 * stored per PROJECT. The project document library is the single source of truth:
 * no local mirror, no sync — read it, and update it in place with `expectVersion`.
 * The server validates against this very object, so read these values instead of
 * copying them: `sections` (the panel's two columns), `docTypes` (panel grouping
 * order), `fields`, `idPattern` (compile with the `u` flag), the length caps, and the
 * contentSha algorithm (the canvas `read` digest over the LF-normalized body).
 */
export declare const DOCUMENTS: {
  readonly convention: "doc@1";
  readonly sections: readonly ["reference", "script"];
  /** The only doc types the `script` section accepts (a `script` may also sit in `reference`). */
  readonly scriptSectionDocTypes: readonly ["script"];
  readonly docTypes: readonly [
    "skeleton",
    "outline",
    "characters",
    "bible",
    "breakdown",
    "script",
    "asset-list",
    "extras",
    "genre-strategy",
    "shotlist",
    "lap-ledger",
    "lap-report",
    "lap-outline",
    "novel",
    "note",
  ];
  readonly formats: readonly ["markdown", "srt", "json"];
  readonly fields: readonly [
    "id",
    "section",
    "folder",
    "docType",
    "series",
    "episode",
    "scene",
    "title",
    "format",
    "version",
    "contentSha",
    "sourceAgent",
    "source",
    "assetTags",
    "derivedFrom",
    "updatedAt",
    "summary",
  ];
  /** A `u`-flag regular expression source; the id must ALSO be at most `idMaxLength`. */
  readonly idPattern: string;
  readonly idMaxLength: 20;
  readonly contentMaxChars: 1000000;
  readonly listMaxLimit: 200;
  readonly limits: {
    readonly folder: 100;
    readonly series: 100;
    readonly title: 200;
    readonly scene: 40;
    readonly sourceAgent: 60;
    readonly source: 500;
    readonly summary: 500;
    readonly derivedFrom: 40;
    readonly episodeMax: 9999;
    readonly assetTags: 100;
    readonly assetTagLength: 60;
  };
  readonly contentShaAlgorithm: "fnv1a64-utf16-lf";
  /**
   * A folder's id: the `<docType>:<4-char key>` prefix shared by the documents created in it
   * (`novel:k3x9` for `novel:k3x9:0001`…). `docs ls --folders` lists it; `docs read --folder` accepts it.
   */
  readonly folderIdPattern: string;
  /** A canvas copy of a document carries the node tag `doc:<id>@<version>`. */
  readonly nodeTagPrefix: "doc:";
  readonly errors: { readonly conflict: "doc_conflict"; readonly notFound: "doc_not_found" };
};

/**
 * `run_tool`'s local free tools — the kinds that run entirely in the browser, never reach
 * the gateway and never charge (`billable:false` in `read`'s `tools[]`). Still main-session
 * only, and the CLI still wants `--approved` (command shape, not a payment consent). The page
 * imports this very object, so read the limits from here instead of copying them.
 */
export declare const LOCAL_TOOLS: {
  /**
   * Codes of the `{code, message}` entries in `outputs[i].meta.warnings` — the image was made but
   * may be off (the run is not refused): `floor_shadow_kept` = the light, low-saturation band under a
   * scale-lineup item (or a figure in an asset-sheet scale panel) may be measured wrong — it looks
   * like a floor shadow (wider than the feet, or flat) but is taller than
   * `scaleLineup.floorShadow.maxBandRatio`, so it was not cut; or it passed only one of those two
   * shape tests and was cut anyway (light soles or shoes would be cut too; the message says which);
   * `text_overflow` = an annotate-image text mark does not fit the image. (0.15.1 retired
   * `plan_aspect_mismatch`: the scene's plan is drawn by the art step inside the one picture.)
   */
  readonly warningCodes: readonly ["floor_shadow_kept", "text_overflow"];
  /** Every local kind; `tiers["run-tool"].localKinds` is the same array. */
  readonly kinds: readonly [
    "trim-audio",
    "trim-video",
    "capture-frame",
    "crop-image",
    "grid-split",
    "flip-image",
    "annotate-image",
    "asset-sheet",
    "scale-lineup",
  ];
  /** `annotate-image`: mark kinds and the `kind:"text"` limits. */
  readonly annotate: {
    readonly markKinds: readonly ["pen", "rect", "circle", "arrow", "text"];
    readonly maxMarks: 200;
    readonly text: {
      /** Characters (code points) per text mark. */
      readonly maxChars: 200;
      /** Lines per text mark (split on `\n`). */
      readonly maxLines: 10;
      /** Font size as a fraction of the image's long side. */
      readonly sizeDefault: 0.03;
      readonly sizeMax: 0.3;
      /** The anchor point is the text box's top-left / top-center / top-right. */
      readonly aligns: readonly ["left", "center", "right"];
    };
  };
  /**
   * `asset-sheet`: one asset composed into ONE reference image (the image the video model is
   * given). Third layout (decision A57, 0.15.1): the art step draws ONE picture per asset — run-tool's
   * NODE-ID — and the sheet never rearranges it, only adds beside / below it:
   * a character = the whole baseline setting sheet (face close-up on the left, three-view WITH heads on
   * the right; scaled to one row, not split) + a scale panel + the info block. The scale panel stands
   * the character's front view beside the front views of 1–2 in-story reference characters
   * (`metadata.scaleRefs`), all at one px/cm on one ground line, with a shared ruler and each one's
   * name and height below — no external reference objects; very different heights are still drawn to
   * scale and explained in `notes`. A front view is the FIRST figure of the three-view, found by the
   * column gaps (the same for reference characters; an old project's single full-body picture gives
   * its whole subject); when none can be found the run fails naming the picture.
   * A prop = the three-cell picture (front, back, held / beside by size) full width + an info block
   * with its size. A scene = the two-cell picture (scene, top-view plan or aerial view) full width + an
   * info block with its size and area. `fields` order is the info block's display order;
   * `derivedFields` are computed from `heightCm` / `sizeCm` / `sceneSize` and not accepted in
   * `metadata.fields`.
   */
  readonly assetSheet: {
    readonly assetKinds: readonly ["character", "scene", "prop"];
    /**
     * `primary` names run-tool's NODE-ID picture and `cells` what it holds left to right (the art step
     * draws it that way). A character may also name pictures in `metadata.panels`: `combined`
     * `baselineSheet` = the whole baseline sheet (may be NODE-ID itself; when it is another picture the
     * left part shows it and the scale panel takes the front view from NODE-ID — an old project's
     * full-body picture), or `extra` = an old project's separate face close-up and three-view (laid out
     * as 0.15.0's two panels). Props and scenes take no `metadata.panels`; 0.15.0's prop `backRef` /
     * `heldRef` and scene `panels.plan` are retired and refused with an explanation.
     */
    readonly panels: {
      readonly character: {
        readonly primary: "baselineSheet";
        readonly cells: readonly ["face", "threeView"];
        readonly extra: readonly ["face", "threeView"];
        readonly combined: { readonly baselineSheet: readonly ["face", "threeView"] };
      };
      readonly scene: {
        readonly primary: "sceneSheet";
        readonly cells: readonly ["scene", "plan"];
        readonly extra: readonly [];
      };
      readonly prop: {
        readonly primary: "propSheet";
        readonly cells: readonly ["front", "back", "held"];
        readonly extra: readonly [];
      };
    };
    readonly fields: {
      readonly character: readonly [
        "name",
        "aliases",
        "gender",
        "age",
        "height",
        "weight",
        "build",
        "species",
        "skinTone",
        "hair",
        "eyeColor",
        "features",
        "outfit",
        "props",
      ];
      readonly scene: readonly [
        "name",
        "setting",
        "area",
        "size",
        "ceilingHeight",
        "orientation",
        "keyObjects",
        "entrances",
        "era",
      ];
      readonly prop: readonly ["name", "size", "unit", "weight", "material", "color", "usage"];
    };
    readonly derivedFields: {
      readonly character: readonly ["height"];
      readonly scene: readonly ["size"];
      readonly prop: readonly ["size"];
    };
    /**
     * The geometry parameter each kind takes. `metadata.estimated` (decision A38③: numbers the
     * asset list estimated because the script did not say) lists some of these and of the kind's
     * non-derived field keys, each of which must carry a value; their info-block values get the
     * suffix "（估）" (English " (est.)"); a scene's estimated `sceneSize` marks the area derived
     * from it too.
     */
    readonly geometryKeys: {
      readonly character: readonly ["heightCm"];
      readonly scene: readonly ["sceneSize"];
      readonly prop: readonly ["sizeCm"];
    };
    /** Characters per info value. */
    readonly fieldMaxChars: 120;
    /**
     * Language of the text drawn on the sheet (default `zh`; the product passes `metadata.locale` by the
     * script's dominant dialogue language, decision A55): the info-block field names, the estimate
     * suffix, the prop's right-cell line and the scale panel's fallback self label follow it; values and
     * names are drawn as given.
     */
    readonly locales: readonly ["zh", "en"];
    /**
     * What the right cell of a prop's three-cell picture shows (decisions A57 and A46 supplement 2 —
     * never a story character): `handClose` a close-up of a hand holding it, `hand` held in both hands
     * from the chest down (no face), `beside` a plain figure seen from behind or the side standing
     * beside it or using it (no face). The product's art step draws it; the canvas only adds the info
     * block. `metadata.heldMode` defaults by the longest of `sizeCm`: ≤ `heldModeMaxCm.handClose` →
     * `handClose`, ≤ `heldModeMaxCm.hand` → `hand`, longer → `beside`. It only changes the wording
     * of the info block's line about the right-hand cell.
     */
    readonly heldModes: readonly ["handClose", "hand", "beside"];
    readonly heldModeMaxCm: { readonly handClose: 30; readonly hand: 60 };
    /**
     * A character's scale-panel reference characters: `metadata.scaleRefs` holds `min`–`max`
     * `{nodeId | fileId, heightCm, label}` (their baseline sheet, height, and the name drawn below them,
     * ≤ `labelMaxChars`); a missing height is `invalid_request` naming it. When the tallest is more
     * than `noteHeightRatio` times the shortest they are still drawn to one scale and `notes` says so.
     */
    readonly scaleRefs: {
      readonly min: 1;
      readonly max: 2;
      readonly labelMaxChars: 20;
      readonly noteHeightRatio: 4;
    };
    /**
     * The bottom info block is at most this share of the whole image height. `metadata.withInfo:false`
     * drops it, and the scale panel then keeps only the figures (`metadata.stripScaleText`, default
     * `!withInfo`: no names, heights, ruler, ticks, dashed height lines or ground line; `scale.stripped`).
     */
    readonly infoMaxHeightRatio: 0.15;
  };
  /**
   * `scale-lineup`: the production's height lineup (decision A40). `items`
   * (`{nodeId | fileId, heightCm | sizeCm + scaleAxis?, label, kind?}`: characters and creatures give
   * `heightCm`; a `kind:"prop"` item gives `sizeCm {l, w, h}` instead — the long side of its subject
   * box stands for the largest of l / w / h, or the one `scaleAxis` names, so a sword lying flat is
   * drawn 1 m long rather than 1 m tall) stand smallest to largest on one ground line with
   * a ruler at the left of each row and their name and height below; at most `perRow` per row
   * (default and cap `perRowMax`; more are split into balanced rows), `rowsPerImage` rows per image
   * (default `rowsPerImageDefault`, cap `rowsPerImageMax`; more make more images). Heights differing
   * by more than `maxHeightRatio` times never share an image (`notes` says why they were split);
   * neighbouring images within that ratio share one px/cm and ruler. `groups` (arrays of item
   * indexes, instead of `perRow`) sets the rows by hand. Each image is `width` × `height` (16:9).
   * Which part of an item's picture stands in the lineup (decision A57, 0.15.1, the same code as the
   * asset-sheet scale panel): a character item gives its baseline setting sheet and the FIRST figure of
   * the three-view is taken (found by the column gaps; none found fails the run naming the item), an
   * old project's single full-body picture still gives its whole subject; a creature item is treated
   * the same way (a creature's sheet is also a close-up plus a three-view; its front view may be up to
   * twice as wide as tall; a single creature picture gives its whole subject); a prop item's
   * three-cell picture gives its left cell (the first block by the gaps), a single prop picture its
   * whole subject. Characters and creatures also get a dashed line from the head top to the ruler,
   * labelled with their height (decision A57, supplement 2). That part is cropped to its non-white
   * subject box.
   */
  readonly scaleLineup: {
    readonly itemKinds: readonly ["character", "creature", "prop"];
    readonly maxItems: 48;
    readonly perRowMax: 6;
    readonly rowsPerImageDefault: 2;
    readonly rowsPerImageMax: 3;
    readonly maxHeightRatio: 25;
    readonly labelMaxChars: 20;
    readonly aspect: "16:9";
    readonly width: 2400;
    readonly height: 1350;
    /** Language of the title drawn on the image (`metadata.locale`, default `zh`). */
    readonly locales: readonly ["zh", "en"];
    /** Which of a prop item's `sizeCm` l / w / h its subject box's long side stands for (`scaleAxis`). */
    readonly scaleAxes: readonly ["l", "w", "h"];
    /**
     * Default thresholds for cutting the shadow under an item's feet off its subject box: a subject
     * pixel is "light, low-saturation" when its smallest channel is ≥ `minLevel` and max − min ≤
     * `maxChroma`; the bottom rows holding only such pixels are cut as a floor shadow only when the
     * band also looks like one — at least 1.25 times as wide as the feet right above it, or no taller
     * than a fifth of its width (either test is enough; a band that passes only one is still cut and
     * the reply warns `floor_shadow_kept`). Light shoes, boots or hems (about as wide as the legs, not
     * flat) are part of the subject: not cut, no warning. A shadow-like band taller than
     * `maxBandRatio` of the box is not cut either and the reply warns `floor_shadow_kept`.
     * `metadata.floorShadow` overrides any of the three thresholds, or `false` turns the cut off.
     */
    readonly floorShadow: {
      readonly minLevel: 180;
      readonly maxChroma: 24;
      readonly maxBandRatio: 0.08;
    };
  };
  /**
   * A picture the user uploaded themselves (decision A60), marked `userSheet: true` on an asset-sheet
   * `scaleRefs[i]` or a scale-lineup `items[i]` (asset-sheet refuses `metadata.userSheet: true` on
   * NODE-ID: an uploaded asset gets no composite). No model is used. The tool (1) takes the median
   * colour of a 2-px ring round the image; if at least `bgUniformity` of the ring is within
   * `bgTolerance` of it on every channel, flood-fills that background in from the edge — otherwise it
   * draws a silhouette (`complex_background`); (2) keeps the largest connected block that stands
   * like a whole person — height ÷ width within `figureAspect`, at least `minHeightRatio` of the image
   * height, bottom in the lower half; front, side or back all do — else a silhouette
   * (`no_full_body`); its floor shadow is cut like a product picture's (`scaleLineup.floorShadow`,
   * with "darker than the background, same hue" standing for light grey); (3) requires it whole —
   * top and bottom at least `edgeMarginRatio` clear of the image edges, nothing big pressing right on
   * its head, a round head narrower than the body — else a silhouette (`incomplete`). A silhouette is
   * a neutral grey (`silhouetteColor`) person scaled to `heightCm`, with name, height and dashed
   * height line like a figure; an uploaded prop is always a rounded box sized by `sizeCm`.
   * `metadata.userSheetBg: {tolerance?, uniformity?}` overrides the two background thresholds. The
   * reply's `meta.subjects` lists every subject a caller must handle alike — each uploaded one
   * (`userSheet: true`) and, in a lineup, each product picture with no usable front view that stands
   * in as a silhouette (no `userSheet`): `label`, `kind`, `nodeId` / `fileId`, `source`
   * (`"figure" | "silhouette"`) and `reason` (from `silhouetteReasons` for uploads; the failure code,
   * e.g. `loose_parts`, for product pictures).
   */
  readonly userSheet: {
    readonly bgTolerance: 24;
    readonly bgUniformity: 0.6;
    readonly figureAspect: { readonly min: 2; readonly max: 5 };
    readonly minHeightRatio: 0.4;
    readonly edgeMarginRatio: 0.01;
    readonly silhouetteReasons: readonly ["complex_background", "no_full_body", "incomplete"];
    readonly silhouetteColor: "#9AA0A6";
  };
};

/** L0 只读 / L1 可撤销的写 / L2 花钱 / L3 不可撤销的边界动作。 */
export type CanvasCommandLevel = "L0" | "L1" | "L2" | "L3";
/** `short` 秒级；`long` 媒体分片传输，宿主超时要放宽；`wait` 接受 `--wait` /
 *  `--wait-ms`，页面不在时排队，可能阻塞到恢复窗口结束。 */
export type CanvasCommandTimeoutTier = "short" | "long" | "wait";

/** One CLI subcommand that goes over the wire. */
export interface CanvasContractWireTier {
  readonly level: CanvasCommandLevel;
  /** The wire method name, one of `common.mjs`'s `METHODS`. */
  readonly method: string;
  /** Enters the undo stack / changes state — `MUTATIONS.has(method)`. */
  readonly mutation: boolean;
  /** A worker calling it gets `worker_forbidden` — `MAIN_METHODS.has(method)`. */
  readonly mainOnly: boolean;
  /** Requires `approval.userApprovedNodeIds`: the user already agreed to pay. */
  readonly approval: boolean;
  readonly timeoutTier: CanvasCommandTimeoutTier;
  /**
   * `run-tool` only: the kinds that run locally and never charge (`LOCAL_TOOLS.kinds`, the
   * same array). A host need not ask the user to confirm a charge for them.
   */
  readonly localKinds?: typeof LOCAL_TOOLS.kinds;
}

/**
 * The tier a flag moves a local command to — today only `export-jianying
 * --draft-root` (write straight into the user's Jianying draft folder).
 */
export interface CanvasContractFlagTier {
  readonly level: CanvasCommandLevel;
  /** A worker session gets `worker_forbidden` with this flag. */
  readonly mainOnly: boolean;
  /** The wire methods the command sends with this flag (main-only ones are counted in `MAIN_METHODS`). */
  readonly methods: readonly string[];
  /**
   * When the command also needs `--approved` (the user's declared consent — not a
   * paid-generation approval): `"unregistered_root"` = the draft folder is not one
   * of the user's registered Jianying draft folders.
   */
  readonly approvalWhen?: "unregistered_root";
}

/**
 * One CLI subcommand that never reaches the page: help, the session lifecycle,
 * the media transfers and `export-jianying` (one read-only `timeline_export`
 * call, then everything happens on this machine) all return inside the CLI.
 * `mutation` / `mainOnly` / `approval` have no wire truth to be checked against,
 * so they are absent rather than guessed. `flagTiers` names a flag that moves the
 * command to another tier (`export-jianying --draft-root`: L1, main only).
 */
export interface CanvasContractLocalTier {
  readonly level: CanvasCommandLevel;
  readonly local: true;
  readonly method: null;
  readonly timeoutTier: CanvasCommandTimeoutTier;
  readonly flagTiers?: Readonly<Record<string, CanvasContractFlagTier>>;
}

/** One of the 29 apply commands inside a batch. */
export interface CanvasContractApplyTier {
  /**
   * `false` for the ones a worker may not send even nested in a batch
   * (`WORKER_BLOCKED_COMMANDS`).
   */
  readonly workerAllowed: boolean;
  /** Something already on the canvas disappears; say so before sending it. */
  readonly destructive: boolean;
  /** Only catastrophic against this one node id — `delete_node` vs `doc-index`. */
  readonly destructiveWhen?: string;
}

/**
 * Keyed by CLI subcommand name (the 42 of them; the doc@1 ones are two words such as
 * `docs ls` — `parseArgs` returns that same two-word key as `command`), plus
 * `applyCommands` keyed by apply command `type` (the 29 of them). Read this instead of re-deriving "is
 * this command read-only / billable / main-only" from prose: the prose copies
 * have contradicted each other before.
 */
export interface CanvasContractTiers {
  readonly [command: string]:
    | CanvasContractWireTier
    | CanvasContractLocalTier
    | Readonly<Record<string, CanvasContractApplyTier>>;
}

export declare const CANVAS_CONTRACT: {
  readonly bridgeVersion: 3;
  readonly protocolVersion: 2;
  /** The 29 `AgentCommand` verbs, keyed by `type`. */
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
   * did NOT move the human's camera. `focus_node` and `select` are the only two
   * commands whose effect lives outside the document, so the batch's `ok` proves
   * nothing about them: read `focused[].framed` (and `selected[].shown`).
   * `unmeasured` is per-node and can succeed later (the page has no geometry for
   * it yet); `no_camera` means this host wired no camera at all and no
   * `focus_node` will ever work in it.
   */
  readonly focus: {
    readonly unframedReasons: readonly ["unmeasured", "no_camera"];
    /** `ApplyResult.selected[].reason` (`select` did not highlight anything):
     *  this host wired no editor selection. */
    readonly unshownReasons: readonly ["no_selection"];
  };
  /** The `page_away` names, same object as the `PAGE_AWAY` export. */
  readonly pageAway: typeof PAGE_AWAY;
  /** doc@1 — the project document library; same object as the `DOCUMENTS` export. */
  readonly documents: typeof DOCUMENTS;
  /** `run_tool`'s local free tools; same object as the `LOCAL_TOOLS` export. */
  readonly localTools: typeof LOCAL_TOOLS;
  /** Per-command level, wire method, worker/approval gates and timeout tier. */
  readonly tiers: CanvasContractTiers;
};
