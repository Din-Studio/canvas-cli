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

/**
 * `apply.scene3d[]` rendered as text — the same string the page puts in `apply.scene3dSummary`
 * (implementation and shapes in `./scene3d-text.mjs`; re-exported here like `formatTidySummary`).
 */
export { formatScene3dChecks, formatScene3dScene, formatScene3dSummary } from "./scene3d-text.mjs";
/**
 * Identity colours of a 3D scene (0.16.4): the page colours an object without `color` with
 * `scene3dIdentityColor(role, name)`; data in `SCENE3D.identity`, implementation in `./scene3d-identity.mjs`.
 */
export {
  allocateEpisodeIdentityColors,
  allocateIdentityColors,
  checkEpisodeIdentityColors,
  scene3dColorLabel,
  scene3dDefaultColor,
  scene3dIdentityColor,
  scene3dIsIdentityColor,
  scene3dObjectIdentity,
} from "./scene3d-identity.mjs";
export type {
  Scene3dApplied,
  Scene3dApplyReport,
  Scene3dAxisReport,
  Scene3dChecks,
  Scene3dCutReport,
  Scene3dFramingIssue,
  Scene3dHealthIssue,
  Scene3dMotionIssue,
  Scene3dShotFraming,
} from "./scene3d-text.mjs";

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
  /** Character cap on a string param (`run_node.shotId`, `run_tool.*`). */
  readonly maxLength?: number;
  /** Key cap on an object param (`run_tool.metadata`). */
  readonly maxKeys?: number;
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
    "contentUrl",
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
  /** 50,000 since 0.16.2 (1,000,000 before). */
  readonly contentMaxChars: 50000;
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
    /** 0.16.2: one novel upload splits into at most this many chapters (split larger novels into volumes). */
    readonly uploadChapters: 2000;
  };
  readonly contentShaAlgorithm: "fnv1a64-utf16-lf";
  /**
   * A folder's id: the `<docType>:<4-char key>` prefix shared by the documents created in it
   * (`novel:k3x9` for `novel:k3x9:0001`…). `docs ls --folders` lists it; `docs read --folder` accepts it.
   */
  readonly folderIdPattern: string;
  /** A canvas copy of a document carries the node tag `doc:<id>@<version>`. */
  readonly nodeTagPrefix: "doc:";
  /**
   * `uploadFailed` / `contentUnavailable` (0.16.2): the text file could not be stored / fetched — HTTP 502, retry as-is.
   * `quotaExceeded` (0.16.2): the write would push the project's current texts past 50 MB — HTTP 400, nothing written,
   * carries `usedBytes` (the total before the write) and `limitBytes`; delete documents or shorten this one.
   * `tooLarge` (0.16.2): one text over `contentMaxChars` — `chars` / `limitChars`, the same code and fields from the
   * CLI's own check, the daemon's and the page's policy, and the server (HTTP 413); split it into several documents.
   */
  readonly errors: {
    readonly conflict: "doc_conflict";
    readonly notFound: "doc_not_found";
    readonly uploadFailed: "upload_failed";
    readonly contentUnavailable: "content_unavailable";
    readonly quotaExceeded: "quota_exceeded";
    readonly tooLarge: "too_large";
  };
};

/**
 * `run_tool`'s local tools — the kinds that run entirely in the browser, never reach
 * the gateway and are not billed generations (`billable:false` in `read`'s `tools[]`). Still main-session
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

/** One `scene3d_apply` action op: every field it accepts (besides `op`), and the required ones. */
export interface CanvasContractScene3dOp {
  /** The page reducer and the daemon both reject any other field (`invalid_request`). */
  readonly fields: readonly string[];
  readonly required: readonly string[];
}

/**
 * scene3d@1 — the 3D director desk (`scene-3d` node) as `scene3d_apply` sees it: the 13 action
 * ops with their fields, the closed vocabularies, the 24 prefabs with their metric footprints,
 * the numeric ranges and caps, the id syntax, unit tokens, the `sceneDigest` algorithm, the
 * constants and codes of the three self-checks (health, framing, motion) and the shot-size ladder.
 * The page's reducer (shared by the desk and the bridge) validates against this very object, so read the values from here instead of copying.
 * Angles on the wire are degrees (stored as radians); `fov` is the VERTICAL angle in degrees and
 * `focal` is millimetres on a 36 mm long edge. `prefab` is an open string: a word outside
 * `enums.prefab` is kept, drawn by its `kind`, and reported as `unknown_prefab`.
 */
export declare const SCENE3D: {
  readonly convention: "scene3d@1";
  readonly ops: {
    /**
     * Required: `role` only. `kind` may be omitted when a known `prefab` (or alias) or `role:"figure"`
     * implies it (explicit wins; the page echoes an inferred one as `applied[].kind`). `transform`'s
     * `position` / `rotation` / `scale` may carry any subset of x / y / z; no `position.y` = on the ground.
     */
    readonly add_object: CanvasContractScene3dOp;
    /**
     * `position` / `rotation` / `scale` may carry any subset of x / y / z, merged per component. On a
     * figure with `facing`, a `rotation.y` that differs from the stored one (at `units.wireDecimals`)
     * drops `facing` and the page reports `applied[].cleared: ["facing"]`. `color` (B14) recolours the
     * object — the fix an `identity_color_clash` warning spells out.
     */
    readonly transform: CanvasContractScene3dOp;
    readonly remove: CanvasContractScene3dOp;
    readonly duplicate: CanvasContractScene3dOp;
    /** Camera points (`position` / `target`, like shots' `cam` / `to` / `orbit.center`) need all of x / y / z. */
    readonly set_camera: CanvasContractScene3dOp;
    readonly set_scene: CanvasContractScene3dOp;
    readonly set_figure: CanvasContractScene3dOp;
    readonly set_axis: CanvasContractScene3dOp;
    readonly set_focus: CanvasContractScene3dOp;
    readonly add_shot: CanvasContractScene3dOp;
    readonly update_shot: CanvasContractScene3dOp;
    readonly reorder_shots: CanvasContractScene3dOp;
    readonly remove_shot: CanvasContractScene3dOp;
    /**
     * 0.17.0 — a blocking act: `who` moves / poses / looks from story second `at`. Required `who`, `at`;
     * the page generates and echoes `id` when omitted. `to` / `via` points may omit `y` (on the ground).
     */
    readonly add_act: CanvasContractScene3dOp;
    /** `null` deletes a field; "drop / freeze facing / look ahead" are the words `@drop` / `@keep` / `@none`. */
    readonly update_act: CanvasContractScene3dOp;
    readonly remove_act: CanvasContractScene3dOp;
  };
  readonly enums: {
    readonly role: readonly ["figure", "prop", "set"];
    readonly kind: readonly ["human", "box", "cylinder", "plane", "backdrop"];
    readonly bodyType: readonly ["standard", "tall", "short", "strong", "child"];
    readonly pose: readonly ["stand", "sit", "kneel", "crouch", "lie", "prone"];
    readonly arms: readonly ["down", "forward", "hold", "up", "cross", "back", "akimbo", "point"];
    readonly focusShape: readonly ["disc", "box", "ball", "stick"];
    readonly moveEase: readonly ["linear", "out"];
    readonly aspectRatio: readonly ["1:1", "16:9", "9:16", "4:3", "3:4"];
    /** Act `gait` (0.17.0). */
    readonly gait: readonly ["walk", "run"];
    /** Shot `shake` — handheld camera (0.17.0); the head gesture is `shake_head`. */
    readonly shake: readonly ["light", "medium", "heavy"];
    /** Act `hand` (0.17.0). */
    readonly hand: readonly ["right", "left"];
    /** Act `gesture` overlays (0.17.0). */
    readonly gesture: readonly ["wave", "nod", "shake_head", "bow", "beckon", "point_at"];
    /** `run_node.render` (0.17.0; default `still`). */
    readonly render: readonly ["still", "video", "sheet"];
    /** `run_node.sheetFrames` with `render:"sheet"` (0.17.0; default 3). */
    readonly sheetFrames: readonly [3, 5, 9];
    /**
     * Act reserved words: put down / freeze facing / look ahead (0.17.0); enter / leave the stage (0.18.2, the two values
     * of `do`, see `presence`).
     */
    readonly actSentinels: readonly ["@keep", "@none", "@drop", "@enter", "@offstage"];
    /**
     * 0.16.2 — which moment of a shot a still shows (`run --frame`, the node's `renderedFrame`):
     * `start` = the shot's first frame, `end` = moves and camera move complete. The same array
     * as `SCENE3D_STILL_FRAMES` in `./policy`.
     */
    readonly frame: readonly ["start", "end"];
    readonly prefab: readonly [
      "wall",
      "floor",
      "door",
      "window",
      "pillar",
      "stairs",
      "platform",
      "counter",
      "table",
      "desk",
      "chair",
      "stool",
      "bench",
      "sofa",
      "bed",
      "shelf",
      "cabinet",
      "screen",
      "lamp",
      "plant",
      "tree",
      "rock",
      "car",
      "streetlamp",
    ];
    /** Alias → prefab name; `add_object` stores the resolved name. */
    readonly aliases: {
      readonly bar: "counter";
      readonly nightstand: "table";
      readonly armchair: "sofa";
      readonly couch: "sofa";
      readonly bookshelf: "shelf";
      readonly rack: "shelf";
      readonly wardrobe: "cabinet";
      readonly fridge: "cabinet";
      readonly tv: "screen";
      readonly monitor: "screen";
      readonly column: "pillar";
      readonly step: "platform";
      readonly stage: "platform";
      readonly bush: "plant";
      readonly truck: "car";
      readonly lamppost: "streetlamp";
    };
  };
  /** Each prefab's default `kind` and footprint in metres (`size.y` is the height). */
  readonly prefabs: {
    readonly wall: {
      readonly kind: "box";
      readonly size: { readonly x: 4; readonly y: 2.7; readonly z: 0.2 };
    };
    readonly floor: {
      readonly kind: "plane";
      readonly size: { readonly x: 6; readonly y: 1; readonly z: 6 };
    };
    readonly door: {
      readonly kind: "box";
      readonly size: { readonly x: 0.9; readonly y: 2.1; readonly z: 0.1 };
    };
    readonly window: {
      readonly kind: "box";
      readonly size: { readonly x: 1.2; readonly y: 1.2; readonly z: 0.1 };
    };
    readonly pillar: {
      readonly kind: "cylinder";
      readonly size: { readonly x: 0.4; readonly y: 2.7; readonly z: 0.4 };
    };
    readonly stairs: {
      readonly kind: "box";
      readonly size: { readonly x: 1.2; readonly y: 1; readonly z: 2 };
    };
    readonly platform: {
      readonly kind: "box";
      readonly size: { readonly x: 2; readonly y: 0.3; readonly z: 2 };
    };
    readonly counter: {
      readonly kind: "box";
      readonly size: { readonly x: 2.4; readonly y: 1; readonly z: 0.6 };
    };
    readonly table: {
      readonly kind: "box";
      readonly size: { readonly x: 1.4; readonly y: 0.75; readonly z: 0.8 };
    };
    readonly desk: {
      readonly kind: "box";
      readonly size: { readonly x: 1.4; readonly y: 0.75; readonly z: 0.7 };
    };
    readonly chair: {
      readonly kind: "box";
      readonly size: { readonly x: 0.5; readonly y: 0.9; readonly z: 0.5 };
    };
    readonly stool: {
      readonly kind: "cylinder";
      readonly size: { readonly x: 0.4; readonly y: 0.45; readonly z: 0.4 };
    };
    readonly bench: {
      readonly kind: "box";
      readonly size: { readonly x: 1.6; readonly y: 0.45; readonly z: 0.4 };
    };
    readonly sofa: {
      readonly kind: "box";
      readonly size: { readonly x: 2; readonly y: 0.8; readonly z: 0.9 };
    };
    readonly bed: {
      readonly kind: "box";
      readonly size: { readonly x: 1.5; readonly y: 0.5; readonly z: 2 };
    };
    readonly shelf: {
      readonly kind: "box";
      readonly size: { readonly x: 1; readonly y: 2; readonly z: 0.35 };
    };
    readonly cabinet: {
      readonly kind: "box";
      readonly size: { readonly x: 1; readonly y: 1.8; readonly z: 0.5 };
    };
    readonly screen: {
      readonly kind: "box";
      readonly size: { readonly x: 1.6; readonly y: 0.9; readonly z: 0.05 };
    };
    readonly lamp: {
      readonly kind: "cylinder";
      readonly size: { readonly x: 0.3; readonly y: 1.6; readonly z: 0.3 };
    };
    readonly plant: {
      readonly kind: "cylinder";
      readonly size: { readonly x: 0.6; readonly y: 1.2; readonly z: 0.6 };
    };
    readonly tree: {
      readonly kind: "cylinder";
      readonly size: { readonly x: 1.5; readonly y: 5; readonly z: 1.5 };
    };
    readonly rock: {
      readonly kind: "box";
      readonly size: { readonly x: 1; readonly y: 0.6; readonly z: 0.8 };
    };
    /** Front of the car faces +x. */
    readonly car: {
      readonly kind: "box";
      readonly size: { readonly x: 4.5; readonly y: 1.5; readonly z: 1.8 };
    };
    readonly streetlamp: {
      readonly kind: "cylinder";
      readonly size: { readonly x: 0.2; readonly y: 4; readonly z: 0.2 };
    };
  };
  /** `fov` is the vertical angle in degrees and covers every `focal` on every aspect ratio. */
  readonly ranges: {
    readonly fov: { readonly min: 2; readonly max: 140 };
    readonly focal: { readonly min: 8; readonly max: 400 };
    readonly dur: { readonly min: 0; readonly max: 600 };
    readonly moveT: { readonly min: 0; readonly max: 1 };
    readonly orbitR: { readonly exclusiveMin: 0; readonly max: 1000 };
    readonly coordinate: { readonly min: -1000; readonly max: 1000 };
    readonly scale: { readonly exclusiveMin: 0; readonly max: 100 };
    readonly gridSize: { readonly min: 1; readonly max: 200; readonly integer: true };
    readonly n: { readonly min: 1; readonly integer: true };
    /** Act `at` in story seconds (0.17.0). */
    readonly at: { readonly min: 0; readonly max: 600 };
    /** Shot `start` in story seconds (0.17.0). */
    readonly start: { readonly min: 0; readonly max: 600 };
    /** Shot `via[].t`: progress inside the shot, both ends open (0.17.0). */
    readonly viaT: { readonly exclusiveMin: 0; readonly exclusiveMax: 1 };
  };
  readonly limits: {
    /** Same object as `CANVAS_CONTRACT.limits["scene3d_apply.actions"]`. */
    readonly actionsPerCommand: { readonly min: 1; readonly max: 200 };
    readonly objects: 100;
    readonly cameras: 12;
    readonly shots: 60;
    readonly movesPerShot: 20;
    readonly idMaxLength: 128;
    readonly textMaxLength: 500;
    readonly nameMaxLength: 60;
    readonly prefabMaxLength: 64;
    /** Blocking acts per scene (0.17.0). */
    readonly acts: 200;
    /** `via` points per shot / per act (0.17.0). */
    readonly viaPerShot: 8;
    readonly viaPerAct: 8;
    /** 0.16.2 — most stills one `run-stills` renders: `shots` × the two frames. */
    readonly stillsPerRun: 120;
    /**
     * 0.16.2 — how long the page spends on one `run-stills` before it answers (ms). The still in
     * flight at that moment is aborted; it and the ones never started come back in `skipped`
     * (reason `budget`), the finished ones are reported one by one. Within the daemon's 120 s call
     * timeout; each still also has its own 25 s budget.
     */
    readonly stillsBudgetMs: 90000;
    /**
     * 0.18.0 — the cap on one `run-shot-refs`'s page budget (ms). The budget is per shot — the two
     * stills 25 s each, the previz 15 s + 250 ms a frame — capped here (the `run --await` cap); the part
     * in flight at that moment is aborted, it and the ones never started come back `budget` and in
     * `remaining`. = `policy.RUN_SHOT_REFS_BUDGET_MS`.
     */
    readonly shotRefsBudgetMs: 240000;
    /**
     * 0.18.0 — how long the daemon and the CLI wait for one `run-shot-refs` answer (ms): the budget cap
     * + 15 s. Other methods keep the session's call timeout. = `policy.RUN_SHOT_REFS_CALL_MS`.
     */
    readonly shotRefsCallMs: number;
  };
  /** Object, camera and shot ids. */
  readonly idPattern: "^[A-Za-z0-9_.-]{1,128}$";
  /** Bindable tokens, not prose. */
  readonly units: {
    readonly length: "m";
    readonly up: "y";
    readonly ground: "y0";
    readonly figureFacing: "pz";
    readonly rotationWire: "deg";
    readonly rotationStored: "rad";
    readonly orbitAngleWire: "deg";
    readonly orbitAngleStored: "rad";
    readonly fov: "vertical-deg";
    readonly focal: "mm-long-edge-36";
    readonly wireDecimals: 4;
    /** `at` / `start` / `dur` (0.17.0). */
    readonly time: "s";
    /** `via[].t`: 0 = the shot's first frame, 1 = its last (0.17.0). */
    readonly shotProgress: "unit-interval";
  };
  /** `sceneDigest`; `baseDigest: newSentinel` only for a node an earlier `add_node` of the same batch created. */
  readonly digest: { readonly algorithm: "fnv1a64-utf16-sorted-json"; readonly newSentinel: "new" };
  readonly checks: {
    readonly constants: {
      readonly AXIS_ON_LINE_M: 0.15;
      readonly SUBJECT_CHANGE_M: 0.75;
      readonly JUMP_CUT_DEG: 30;
      readonly RESIZE_RATIO: 2;
    };
    readonly healthCodes: readonly [
      "body_penetration",
      "invalid_support",
      "held_conflict",
      "subshot_invalid",
      "missing_ref",
      "shot_missing_cam",
      "shot_missing_look",
      "shot_missing_fov",
      "axis_missing",
      "axis_invalid",
      "unknown_pose",
      "unknown_arms",
      "unknown_prefab",
      "untyped_objects",
      "duplicate_shot_n",
      "duplicate_id",
      "orbit_cam_ignored",
      "seat_unbound",
      "support_gap",
      "held_offset",
      "shot_missing_dur",
      "act_conflict",
      "hold_invalid",
      "object_below_ground",
      "identity_color_clash",
      "sunk_in_floor",
    ];
    readonly healthLevels: readonly ["block", "warn"];
    readonly cutExemptions: readonly ["moving", "resize", "subject"];
    /** How each exemption reads in prose (check messages and `scene3dSummary`); keyed by `cutExemptions`. */
    readonly cutExemptionLabels: {
      readonly moving: "运动镜";
      readonly resize: "景别跨档";
      readonly subject: "换主体";
    };
    /**
     * 0.17.0 — framing reminders; they never block a run. `cam_too_close` / `foreground_fill` are
     * reported only by the grid mode of `read NODE/framing`. The page may emit only a subset until
     * its framing checks are complete.
     */
    readonly framingCodes: readonly [
      "cam_inside",
      "cam_below_ground",
      "cam_too_close",
      "subject_out",
      "head_out",
      "subject_blocked",
      "foreground_fill",
      "framing_mismatch",
    ];
    /** Thresholds as fractions of frame height / of landmarks / of frame area, and metres. */
    readonly framingConstants: {
      readonly FULL_MIN_H: 0.45;
      readonly LONG_MIN_H: 0.15;
      readonly TOO_CLOSE_M: 0.3;
      readonly BLOCKED: 0.5;
      readonly FOREGROUND_FILL: 0.4;
    };
    /**
     * 0.17.0 — animation reminders; they never block a run. The page may emit only a subset until
     * its motion checks are complete.
     */
    readonly motionCodes: readonly [
      "axis_motion",
      "figure_collision",
      "speed",
      "move_while_posed",
      "prop_unsupported",
      "cut_jump",
      "screen_direction",
      "act_unseen",
    ];
    readonly motionLevels: readonly ["warn", "info"];
    /** "Sustained" = 2+ consecutive `SAMPLE_S` samples; `FRAME_JUMP_M` is per 24 fps frame. */
    readonly motionConstants: {
      readonly WALK_MAX_MPS: 2.5;
      readonly RUN_MAX_MPS: 8;
      readonly CAMERA_MOVE_MAX_MPS: 6;
      readonly CAMERA_TURN_MAX_DEG_S: 180;
      readonly FRAME_JUMP_M: 0.5;
      readonly CUT_JUMP_M: 0.3;
      readonly CUT_JUMP_DEG: 45;
      readonly SUPPORT_TOLERANCE_M: 0.05;
      readonly FIGURE_RADIUS_M: 0.25;
      readonly SAMPLE_S: 0.25;
      readonly SUSTAIN_S: 0.25;
    };
  };
  /**
   * 0.17.0 — the shot-size ladder (downstream s2v / seedance wording), close to far: the first
   * entry that fits wins. `cutMin` — the frame cuts the figure at this standing-equivalent height
   * fraction or higher (head top ≈ 1, feet 0); `heightMin` — the whole figure is in frame and its
   * projected height is at least this fraction of the frame height. `body` says it in body parts.
   */
  readonly framing: {
    readonly sizes: readonly [
      {
        readonly name: "大特写";
        readonly coarse: "特写";
        readonly cutMin: 0.87;
        readonly heightMin: null;
        readonly body: string;
      },
      {
        readonly name: "特写";
        readonly coarse: "特写";
        readonly cutMin: 0.83;
        readonly heightMin: null;
        readonly body: string;
      },
      {
        readonly name: "中近景";
        readonly coarse: "近景";
        readonly cutMin: 0.7;
        readonly heightMin: null;
        readonly body: string;
      },
      {
        readonly name: "中景";
        readonly coarse: "中景";
        readonly cutMin: 0.52;
        readonly heightMin: null;
        readonly body: string;
      },
      {
        readonly name: "七分身";
        readonly coarse: "中景";
        readonly cutMin: 0.36;
        readonly heightMin: null;
        readonly body: string;
      },
      {
        readonly name: "中全景";
        readonly coarse: "全景";
        readonly cutMin: 0;
        readonly heightMin: null;
        readonly body: string;
      },
      {
        readonly name: "全景";
        readonly coarse: "全景";
        readonly cutMin: null;
        readonly heightMin: 0.45;
        readonly body: string;
      },
      {
        readonly name: "远景";
        readonly coarse: "远景";
        readonly cutMin: null;
        readonly heightMin: 0.15;
        readonly body: string;
      },
      {
        readonly name: "大远景";
        readonly coarse: "远景";
        readonly cutMin: null;
        readonly heightMin: 0;
        readonly body: string;
      },
    ];
  };
  /** The ops that make something disappear; `tiers.applyCommands.scene3d_apply.destructiveOps`. */
  readonly destructiveOps: readonly ["remove", "remove_shot", "remove_act"];
  /**
   * 0.18.0 — the mark the director desk writes on objects / shots a human changed (`editedBy: "human"`, stored in the
   * scene). `approvalOps` against a marked one make the batch `approval_required` until resent with the scene node in
   * `approval.userApprovedNodeIds` (CLI `apply --approved`); against an unmarked one they just run.
   */
  readonly humanEdit: {
    readonly field: "editedBy";
    readonly value: "human";
    readonly approvalOps: readonly ["remove", "remove_shot"];
  };
  /**
   * 0.18.0 — what the page repairs after a `scene3d_apply` lands and before the self-checks (`scene3d[].repairs[]`):
   * only data that leaves who sits / stands / holds what as written, only what the batch touched and no human edited
   * in the desk. `grounded` (a box / cylinder below the ground), `held_to_hand` (a held object stored within
   * `HELD_SNAP_MAX_M` of its hand), `pushed_out` (a figure inside furniture / a wall that `PUSH_MAX_M` of horizontal
   * movement frees; deeper ones stay blocked, with the nearest free spot within `SUGGEST_MAX_M` in the message and
   * `fix`), `camera_merged` (a camera the batch created identical to an earlier one). 0.18.1 (A97 fix ③):
   * `figure_grounded` — a standing / crouching / kneeling figure whose soles are within `FIGURE_GROUND_MAX_M` above or
   * below the surface under its feet (ground, platform / step top, furniture top) is set on it (`transform.position.y`);
   * a larger gap is not fixed, `support_gap` still warns and now carries the grounded spot in its message and `fix`;
   * sitting, lying and prone figures are left alone.
   */
  readonly repairs: {
    readonly codes: readonly [
      "grounded",
      "figure_grounded",
      "held_to_hand",
      "pushed_out",
      "camera_merged",
    ];
    readonly constants: {
      readonly PUSH_MAX_M: 0.1;
      readonly HELD_SNAP_MAX_M: 0.3;
      readonly SUGGEST_MAX_M: 2;
      readonly FIGURE_GROUND_MAX_M: 0.1;
    };
  };
  /**
   * 0.18.2 (decision A102 ⑧) — who is on stage when: one scene node whose segments do not all have the same people.
   * `figureField`: a figure that is not there at the start (`set_figure {id, offstage:true}`, stored as
   * `figure.offstage`; `false` / `null` clears it). `actField` / `enter` / `exit`: `add_act {who, at, do:"@enter",
   * to?, facing?}` makes it appear at story second `at` at `to` (a point; its current position without one), facing
   * `facing` at once; `add_act {who, at, do:"@offstage"}` makes it leave at `at`. Figures only; an enter act takes
   * only `enterFields` besides id / who / at / do / note, a leave act only note. Walking in, sitting down, picking up
   * are separate acts (not before the entrance); acts while off stage still evaluate. Before its entrance / after its
   * exit a figure is, for that moment (`notOnStage`): not rendered (shot stills, station stills, previz, sheets, desk
   * playback), not contact-checked, not framed (station framing, framing reminders), left out of axis / cut / motion
   * reminders; the desk still draws it while editing (not playing) so it can be selected. `endFrameExclusive`: a
   * shot's end frame (k = 1, the same story second as the next shot's start) does not count an entrance / exit at
   * exactly that second — write entrances and exits at the start of the shot they belong to. Replies: `run-stills` /
   * `run-shot-refs` notes 「镜 n：未出场：丙（S02 进场）」, and a `run-shot-refs` row carries `offstage:{start, end}` (the
   * off-stage figure ids of its two stills, stored order) when someone is off stage — list only those on stage in the
   * stills' colour legend. read → apply round-trips `figure.offstage` and `do` as stored. A scene with neither renders
   * and checks exactly as in 0.18.1.
   */
  readonly presence: {
    readonly figureField: "offstage";
    readonly actField: "do";
    readonly enter: "@enter";
    readonly exit: "@offstage";
    readonly enterFields: readonly ["to", "facing"];
    readonly notOnStage: readonly ["render", "contact", "framing", "axis", "cuts", "motion"];
    readonly endFrameExclusive: true;
  };
  /**
   * 0.18.2 (decision A102 ④) — what the contact checks say and suggest. A blocking `body_penetration` message carries
   * the **depth** (`depthDecimals` places, metres: "…穿入 <object> 的<part> 0.12 m"): over every penetrating pair of a
   * body segment (pelvis→spine→neck→head, hip→knee→ankle — the blocking geometry) and a part box of the object
   * (furniture parts shrunk by 2 %, cylinders as cylinders), the smallest distance that separates them, deepest pair
   * wins; a depth that rounds to 0 (under 0.005 m) reads "不足 0.01 m" and still blocks. Below the ankle is not sampled,
   * so a figure standing in a 0.2 m platform reads about 0.07 m.
   * `constants.SEAT_FACING_MAX_DEG`: a figure sitting on a seat with a front (chair / sofa / bed) and facing more than
   * this away from the seat's front (+z turned by its rotation.y) gets "朝向偏离座面正面 N°" when it penetrates that seat,
   * with a `fix` turning the seat to the figure's facing (`{op:"transform", id:<seat>, rotation:{y:<deg>}}`; a
   * suggestion only — the seat is the director's choice). `constants.ACT_Y_MAX_M`: a penetration that only happens in
   * the scheduled frames names the act that walked the figure there (id, start second, destination) and, when the
   * walk's end / via point lies on the penetrated object whose top there is at most this high (or the object is a floor
   * slab, a platform or stairs), a `fix` writing that top as the y (`{op:"update_act", id, to?, via?}`). An enter act
   * (`presence.enter`) is named the same way ("进场，出现在 …"); a figure off stage at the start whose enter act has no
   * `to` appears on its stored spot, and the message names that enter act and the stored spot — the standing
   * suggestion is given only when the figure does appear on its stored spot.
   * `floorSlab`: a level box (no x / z rotation) whose `prefab` is in `prefabs` (any height), or whose role is in
   * `plainRoles`, prefab absent or in `plainPrefabs`, and height at most `plainMaxHeightM`. Its top is a support: a
   * standing figure sunk into it (however deep) is measured against its top (support_gap / figure_grounded);
   * furniture / props sunk into it (centre above it) are set on its top by the `grounded` repair, or warned by
   * `sunk_in_floor` (with the lift as `fix`) when not repaired; a seated figure whose legs enter it because its seat is
   * sunk in it gets that said and the seat's lift as `fix`. A slab whose top is not below y 0 may sit partly below the
   * ground on purpose (its top is the ground): not grounded, no object_below_ground. `fixes`: the four forms of `fix`.
   * `read NODE` (with `NODE/scene`, `NODE/checks`), apply replies and the `checks` of `run-stills` / `run-shot-refs`
   * replies carry the same checks for the same scene — the same messages and the same `fix`es.
   */
  readonly contact: {
    readonly depthDecimals: 2;
    readonly constants: { readonly SEAT_FACING_MAX_DEG: 25; readonly ACT_Y_MAX_M: 0.5 };
    readonly floorSlab: {
      readonly prefabs: readonly ["floor"];
      readonly plainRoles: readonly ["set"];
      readonly plainPrefabs: readonly ["platform"];
      readonly plainMaxHeightM: 0.3;
    };
    readonly fixes: {
      readonly standPosition: {
        readonly op: "transform";
        readonly fields: readonly ["position"];
        readonly target: "figure";
      };
      readonly seatRotation: {
        readonly op: "transform";
        readonly fields: readonly ["rotation"];
        readonly target: "seat";
      };
      readonly furnitureLift: {
        readonly op: "transform";
        readonly fields: readonly ["position"];
        readonly target: "furniture";
      };
      readonly actY: {
        readonly op: "update_act";
        readonly fields: readonly ["to", "via"];
        readonly target: "act";
      };
    };
  };
  /** `baseDigest` no longer matches the node's `sceneDigest`: re-read and re-plan, never resend. */
  readonly conflictCode: "scene3d_conflict";
  /**
   * 0.16.2 — `run-stills` reply `skipped[].reason`: why that still was not rendered — the total
   * budget ran out or the canvas page went away (both listed again in the reply's `remaining`:
   * sending the same command again carries on with only those), a `cancel` stopped the run or the
   * 3D node was deleted, `replaced`: a human or an Agent swapped the picture of its still node
   * (the entry carries that `nodeId`; `--force` renders it again in place and clears the mark —
   * decision A71 as revised), or `up_to_date`: a still node for it already exists and was rendered
   * from the current scene (the entry carries that `nodeId`; `--force` renders it again).
   */
  readonly stillSkipReasons: readonly [
    "budget",
    "cancelled",
    "page_away",
    "replaced",
    "up_to_date",
  ];
  /**
   * 0.18.0 — the three references `run-shot-refs` makes for each shot, in the order it makes them:
   * the start still, the end still, the previz (`epXX-PYY-SZZ运镜预演`). Its reply `shots[]` has one
   * row per shot `{shotId, n, start, end, previz, created, skipped, failed}` — `start` / `end`
   * `{nodeId, url}`, `previz` `{nodeId, url, durationS}` (null when neither made nor already there),
   * `created` the parts newly created this time, `skipped[]` `{part, reason, nodeId?}` (reason from
   * `stillSkipReasons`), `failed[]` `{part, message}`; `remaining:[{shotId, part}]` lists what the
   * budget or a page leaving cut off — the same command again carries on with only those.
   */
  readonly shotRefParts: readonly ["start", "end", "previz"];
  /**
   * 0.18.0 — the overhead station still (decisions A86 ② / A88 ③; framed closer and fixed to 16:9 in
   * 0.18.1, A96): a product scene's (`embedded`) start / end stills are not framed by the shot's
   * camera but by a three-quarter overhead one that only shows where the figures and props are.
   * `camera.front`: the horizontal direction from the active camera's (`activeCameraId`, else the
   * first one) target to its position — `+z` for the default camera at (0, 3, 8) looking at
   * (0, 1, 0) — and `+z` without a camera or with one looking straight down; the camera turns
   * `yawRightDeg` to the viewer's right of the front, looks down `pitchDownDeg` at the centre of
   * this shot's box with a vertical `fovDeg`, and backs off just enough to fit the box's 8 corners
   * inside a station frame (`aspectRatio`) less `bounds.marginRatio` on every side; when everyone
   * whole in frame (`figureMarginRatio`) needs it, it backs off further and slides in the image plane
   * (target with it, same direction) to centre the figures.
   * `directionPerScene`: every shot of a scene looks the same way (target and distance may differ);
   * `sharedPerShot`: a shot's start and end stills share one camera.
   * `bounds`: only this shot's subjects (`subjects`: figures, and props — role `prop` boxes /
   * cylinders without a prefab; furniture and sets are drawn but never framed), over its start (k 0)
   * and end (k 1) (`frames`) and every cut's start / end (`cuts`): figures by their skeleton joints
   * (padded), props by their transformed box (a held one in the hand). A subject is in the shot when
   * it shows in the shot's own camera (scene aspect; start, end, cut edges and quarter points) or is
   * named by its look / lookTo / follow; with none, every figure / prop of the scene. A horizontal
   * span under `minSpanM` is widened about the centre and the ground is always inside;
   * `excludeKinds` / `excludePrefabs` (walls, floors, backdrops) only size the ground grid.
   * `figureMarginRatio` / `minFigureFraction`: every figure of the shot is in the frame whole first —
   * feet and held objects included, each figure's box at least `figureMarginRatio` (5 %) of the frame
   * height away from every edge, never touching or leaving it; under that, the camera moves in along
   * the same direction until the tallest figure in each still reaches `minFigureFraction` (1/3) of the
   * frame height. That share is a target, not a floor: when the figures spread too wide to reach it
   * without one touching an edge, everyone in frame wins and the reply's `notes[]` says
   * 「镜 n：本镜人物分布宽，人偶约占画面高 X%」. `aspectRatio` / `stillSize` / `previzSize`: stills
   * and a product scene's previz (`run --render video`, `run-shot-refs`) are always 16:9, whatever the
   * scene's aspect (video nodes keep the project's); the desk's own shot-camera stills keep it.
   * `grid`: a 1 m ground grid is drawn; `labels`: no name labels — figures and blocks carry only
   * their stored `color`. `productDefault`: product scenes' `run-stills` (and the desk's stills for
   * them) use it by default; other 3D nodes keep the shot camera.
   */
  readonly overview: {
    readonly camera: {
      readonly front: "activeCamera";
      readonly fallbackFront: "+z";
      readonly yawRightDeg: 30;
      readonly pitchDownDeg: 45;
      readonly fovDeg: 35;
      readonly directionPerScene: true;
      readonly sharedPerShot: true;
    };
    readonly bounds: {
      readonly frames: readonly ["start", "end"];
      readonly cuts: true;
      readonly subjects: readonly ["figure", "prop"];
      readonly excludeKinds: readonly ["plane", "backdrop"];
      readonly excludePrefabs: readonly [
        "wall",
        "floor",
        "door",
        "window",
        "pillar",
        "stairs",
        "platform",
      ];
      readonly marginRatio: 0.1;
      readonly minSpanM: 3;
    };
    readonly minFigureFraction: number;
    readonly figureMarginRatio: 0.05;
    readonly aspectRatio: "16:9";
    readonly stillSize: { readonly width: 1920; readonly height: 1080 };
    readonly previzSize: { readonly width: 1920; readonly height: 1080 };
    readonly grid: true;
    readonly labels: false;
    readonly productDefault: true;
    /**
     * 0.18.2 (decisions A100 as revised, A102 ⑨) — when walls hide the figures, turn first, move in second, cut last;
     * chosen once per scene and shared by every shot. ① `candidates` directions `stepDeg` apart starting from the
     * default (`camera.yawRightDeg` right of the front), at `camera.pitchDownDeg`, tried nearest-to-default first (two
     * equally near: the side with an `openingPrefabs` door / window or with no occluder at all first, then the right
     * one); each shot is framed as usual and a sight line is cast to every sample of its subjects (figure joints, head
     * top, soles at start and end; prop box centre and corners) — when more than `maxBlockedShare` of one subject's
     * samples hit an occluder the shot is blocked; the first direction no shot is blocked from wins. Occluders:
     * `occluderPrefabs`, or a box / cylinder / backdrop whose role is in `occluderRoles` and which is taller than
     * `occluderMinHeightM` (screens, tall cabinets, flats, a large display wall; doors and windows by their frames — you
     * see through the opening). `screen` is the TV / monitor prefab (`tv` / `monitor`), not a folding screen: it is not
     * in `occluderPrefabs`, so a TV on a table in front of the camera neither turns the view nor is cut away. ② all blocked: the camera
     * moves into the room — no farther from the frame centre than `insideMarginM` short of the first occluder along the
     * direction — at each of `insidePitchDeg` in turn (60° at most), directions in the same order; the first where
     * every shot frames everyone whole (`figureMarginRatio`) unblocked wins. ③ still not: the default direction, with the
     * occluders in front of the camera not drawn in the stills (`cutaway`; shot stills and previz keep them). An unmoved
     * default renders exactly as in 0.18.1; any other outcome adds 「本场俯视方向：…」 (what and why) to `run-stills` /
     * `run-shot-refs` `notes[]`.
     */
    readonly direction: {
      readonly candidates: 8;
      readonly stepDeg: 45;
      readonly sharedPerScene: true;
      readonly occluderPrefabs: readonly ["wall", "door", "window", "pillar"];
      readonly occluderRoles: readonly ["set"];
      readonly occluderMinHeightM: 1.2;
      readonly maxBlockedShare: 0.25;
      readonly openingPrefabs: readonly ["door", "window"];
      readonly insidePitchDeg: readonly [45, 50, 55, 60];
      readonly insideMarginM: 0.3;
    };
    /** 0.18.2 — level ③ of `direction`: occluders in front of the camera are hidden in station stills only. */
    readonly cutaway: { readonly mode: "hide"; readonly stationOnly: true };
  };
  /**
   * 0.16.4 — product scenes: a `scene-3d` node whose id matches `new RegExp(idPattern, idFlags)`
   * (`s3d-ep01-P02`) is script-to-video's per-scene backing data for its shots' three references
   * (two stills and a previz). Only the id and the kind decide. Since 0.18.1 (decision A95, which
   * reverses 0.16.4's hiding) its card is drawn and takes its place like any 3D node — marquee,
   * minimap, outline — with an unstored dashed ownership line to every still / previz card it made
   * (derived from `stillOf` / `previzOf`: not an edge, never in `graph.edges` or `mentionCandidates`),
   * and each such card says "出自 <card title> · S01 开始"; the outline still lists its director
   * entry while a shot of it lacks a still, and both its stills and its previz cards open it from
   * their toolbar ("3D导演台"; a previz card opens at the start of its shot). The rule only
   * decides how a product scene's stills are framed, how its stills and previz land as a triple, that
   * `run` makes no stills / sheets for it and that `run-batch` skips it. Agents see it in `ls` /
   * `read` / `snapshot` as before.
   */
  readonly embedded: {
    readonly idPattern: "^s3d-ep[0-9]{2,4}-p[0-9]{2,4}$";
    readonly idFlags: "i";
  };
  /**
   * 0.16.4 — identity colours: one name, one colour, for every figure and prop without a `color` of
   * its own (the page has coloured them so since 0.16.3). `colors` / `labels` pair by index and their
   * order is part of the rule; set pieces are `setColor`; `hash` names the rule (NFKC, trim, lower
   * case, 32-bit FNV-1a over code points, modulo the palette) applied to the object's `name` (an
   * `add_object` without one uses its `prefab`), else its `id`. The functions are re-exported from
   * this module: `scene3dIdentityColor`, `scene3dColorLabel`, `allocateIdentityColors`.
   * 0.17.0 — `defaultNames`: the name the page stores for an object created without one (by kind); a
   * stored name equal to it is no name, the colour comes from the `id`. `scene3dObjectIdentity` /
   * `scene3dDefaultColor` recompute the page's colour from a stored object.
   */
  readonly identity: {
    readonly colors: readonly [
      "#e85d5d",
      "#36b89a",
      "#4c91ed",
      "#edb443",
      "#a475df",
      "#ef86ba",
      "#ef8945",
      "#43b7cb",
    ];
    readonly labels: readonly ["红色", "绿色", "蓝色", "黄色", "紫色", "粉色", "橙色", "青色"];
    readonly setColor: "#697681";
    readonly hash: "fnv1a32-nfkc-trim-lower";
    readonly defaultNames: {
      readonly human: "人物";
      readonly box: "立方体";
      readonly cylinder: "圆柱";
      readonly plane: "平面";
      readonly backdrop: "背景板";
    };
    /**
     * 0.18.0 — per-episode colours (A87 ④ / A88 ①): the 12 nameable colours for figures in allocation order (the first 8
     * are `colors`), the white / light-grey prop blocks and the grey shared by one-off extras once a episode has more
     * than 12 figures. Products write them explicitly (`allocateEpisodeIdentityColors`); the page keeps stored colours.
     */
    readonly namedColors: readonly [
      "#e85d5d",
      "#4c91ed",
      "#edb443",
      "#36b89a",
      "#a475df",
      "#ef8945",
      "#ef86ba",
      "#43b7cb",
      "#a0623a",
      "#b5d334",
      "#3a7d44",
      "#c3b091",
    ];
    readonly namedLabels: readonly [
      "红色",
      "蓝色",
      "黄色",
      "绿色",
      "紫色",
      "橙色",
      "粉色",
      "青色",
      "棕色",
      "黄绿色",
      "墨绿色",
      "卡其色",
    ];
    readonly propColors: readonly ["#f2f2f2", "#b9bec4"];
    readonly propLabels: readonly ["白色", "浅灰色"];
    readonly extrasColor: "#9097a0";
    readonly extrasLabel: "灰色";
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
   * The kinds that run locally and are not billed generations; a host need not ask the user to confirm a charge
   * for them. `run-tool`: tool kinds (`LOCAL_TOOLS.kinds`, the same array). `run` (0.16.2): node
   * kinds — `["scene-3d"]`, a 3D node renders its still in the browser. Every other kind is billed.
   */
  readonly localKinds?: typeof LOCAL_TOOLS.kinds | CanvasContractRunLocalNodeKinds;
  /**
   * `run-stills` (0.16.2) and `run-shot-refs` (0.18.0) only: the whole command renders in the browser and is not a billed generation, the
   * same precedent as `localKinds`. A host need not ask the user to confirm a charge; `--approved`
   * is still required (command shape, not a paid-generation approval).
   */
  readonly billable?: false;
}

/**
 * `tiers.run.localKinds` — NODE kinds (not tool kinds): a `run` on such a node renders in the
 * browser, goes through no gateway and is not a billed generation. `run NODE` does not say the node's kind and a
 * host must not guess it from an id prefix: use its own index / the last `read` or `ls --long`,
 * else send one `read NODE` (L0) and check `nodes[0].kind`. A `run-batch` made only of local
 * kinds needs no charge confirmation; a mixed one asks only about the non-local nodes.
 */
export type CanvasContractRunLocalNodeKinds = readonly ["scene-3d"];

/**
 * One `CANVAS_CONTRACT.hostText` entry. Paths use dot syntax, `[]` = every array item, a
 * leading `[]` = the reply itself is an array. A path absent from one reply is not checked
 * there; "readers ignore fields they do not know" does NOT apply to these: a host's
 * rendering layer must surface them.
 */
export interface CanvasContractHostTextEntry {
  /** Prose fields pasted word for word (a uniform per-line prefix such as `- ` is allowed). */
  readonly verbatim: readonly string[];
  /** Structured fields whose VALUE must be findable in the rendered text. */
  readonly visible: readonly string[];
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

/** One of the 30 apply commands inside a batch. */
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
  /**
   * Only destructive when an action of the command uses one of these ops —
   * `scene3d_apply` removing an object, a shot or an act (`SCENE3D.destructiveOps`, the same array).
   * Since 0.18.0 `remove` / `remove_shot` need the user's approval only against what a human changed in the
   * desk (`SCENE3D.humanEdit`); unmarked ones run without asking.
   */
  readonly destructiveOps?: readonly string[];
}

/**
 * Keyed by CLI subcommand name (the 43 of them; the doc@1 ones are two words such as
 * `docs ls` — `parseArgs` returns that same two-word key as `command`), plus
 * `applyCommands` keyed by apply command `type` (the 30 of them). Read this instead of re-deriving "is
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
  /** The package version this contract ships in (= `package.json` `version` = the CLI's `VERSION`). */
  readonly packageVersion: "0.18.3";
  readonly layout: { readonly version: number; readonly nodeGapX: number; readonly nodeGapY: number; readonly groupGapX: number; readonly groupGapY: number; readonly groupPadding: number; readonly fitFrames: boolean; readonly boundsKind: "body" };
  readonly bridgeVersion: 3;
  readonly protocolVersion: 2;
  /** The 30 `AgentCommand` verbs, keyed by `type`. */
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
      "undo_restored",
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
  /** `run_tool`'s local tools (not billed generations); same object as the `LOCAL_TOOLS` export. */
  readonly localTools: typeof LOCAL_TOOLS;
  /** scene3d@1 — the 3D director desk's action surface; same object as the `SCENE3D` export. */
  readonly scene3d: typeof SCENE3D;
  /** Per-command level, wire method, worker/approval gates and timeout tier. */
  readonly tiers: CanvasContractTiers;
  /**
   * What a host must surface when it turns a reply into text for a model, keyed by CLI
   * subcommand; `"*"` applies to every failed reply (including the top-level `hint`).
   */
  readonly hostText: Readonly<Record<string, CanvasContractHostTextEntry>>;
};
