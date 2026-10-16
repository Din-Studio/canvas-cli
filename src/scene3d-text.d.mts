/** One `scene3d[].applied[]` entry of an `apply` reply: what an action did. */
export interface Scene3dApplied {
  readonly op: string;
  readonly id?: string;
  /** The id the action asked for, when the page had to rename it (taken). */
  readonly requestedId?: string;
  readonly created?: true;
  /** `add_object` only: the kind the page inferred (from the prefab or `role:"figure"`). */
  readonly kind?: string;
  /** A figure's `rotation.y` overrode its stored `facing`. */
  readonly cleared?: readonly "facing"[];
  /** `add_shot` without `start` in a scene with blocking: the story start the page pinned (0.17.0). */
  readonly start?: number;
  /** `add_act` / `update_act` without `dur`: the duration the page derived (not stored; 0.17.0). */
  readonly dur?: number;
  /** `add_act` / `update_act` with a walk: the resolved end foot point (`y` filled; 0.17.0). */
  readonly to?: { readonly x: number; readonly y: number; readonly z: number };
  /** A walk-to-sit at a seat: the seat's id (`to` is the stand point in front of it; 0.17.0). */
  readonly seat?: string;
  /** `set_figure`: the fields the action gave; `transform`: the groups it gave (0.17.0). */
  readonly fields?: readonly string[];
}

/** One data-health finding (`SCENE3D.checks.healthCodes`); `block` stops a still. */
export interface Scene3dHealthIssue {
  readonly level: "block" | "warn";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  /**
   * 0.18.0: a ready-to-send action that fixes it — an `apply` reply's `body_penetration` the page could not push out
   * (the nearest free spot, `SCENE3D.repairs`), and since 0.18.1 its stored-scene `support_gap` (the figure set on the
   * surface under its feet). 0.18.2 (`SCENE3D.contact.fixes`): `read` carries the same fixes as `apply`, plus a seat
   * turned to its sideways sitter (`rotation`), a seat / piece of furniture lifted onto the floor slab it sinks into
   * (`position`, also on `sunk_in_floor`), and the act that walked a figure into something given that top as its
   * `to` / `via` y (`update_act`).
   */
  readonly fix?:
    | {
        readonly op: "transform";
        readonly id: string;
        readonly position: { readonly x: number; readonly y: number; readonly z: number };
      }
    | { readonly op: "transform"; readonly id: string; readonly rotation: { readonly y: number } }
    | {
        readonly op: "update_act";
        readonly id: string;
        readonly to?: { readonly x: number; readonly y: number; readonly z: number };
        readonly via?: readonly { readonly x: number; readonly y: number; readonly z: number }[];
      };
}

/** One `scene3d[].repairs[]` entry (0.18.0, `SCENE3D.repairs`): data the page fixed after the batch landed. */
export interface Scene3dRepair {
  /** `SCENE3D.repairs.codes`. */
  readonly code: "grounded" | "figure_grounded" | "held_to_hand" | "pushed_out" | "camera_merged";
  /** The object or camera. */
  readonly id: string;
  /** Stored path of what changed (`transform.position.y`, `transform.position`, `cameras`). */
  readonly field: string;
  readonly from: number | string | { readonly x: number; readonly y: number; readonly z: number };
  readonly to: number | string | { readonly x: number; readonly y: number; readonly z: number };
  /** Why, in the page's words. */
  readonly reason: string;
}

/** The 180° rule verdict; `applicable:false` when no axis is declared. */
export interface Scene3dAxisReport {
  readonly applicable: boolean;
  readonly ok: boolean;
  readonly message: string;
  readonly offside: readonly { readonly id: string; readonly n: number }[];
  readonly tie?: true;
}

/** One cut between consecutive shots; only `jump:true` counts as a jump cut. */
export interface Scene3dCutReport {
  readonly fromId: string;
  readonly toId: string;
  readonly from: number;
  readonly to: number;
  readonly angle: number;
  readonly jump: boolean;
  /** Key of `SCENE3D.checks.cutExemptionLabels`. */
  readonly exempt?: "moving" | "resize" | "subject";
  readonly message: string;
}

/** One framing reminder (`SCENE3D.checks.framingCodes`); framing never blocks. */
export interface Scene3dFramingIssue {
  readonly level: "warn";
  readonly code: string;
  /** null = the active camera of a scene without shots. */
  readonly shotId: string | null;
  readonly objectId?: string;
  /** Seconds inside the shot, first to last hit. */
  readonly t?: readonly [number, number];
  readonly message: string;
}

/** One motion reminder (`SCENE3D.checks.motionCodes`, levels `motionLevels`); motion never blocks (0.17.0). */
export interface Scene3dMotionIssue {
  readonly level: "warn" | "info";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

/** The self-checks as the page reports them (`scene3d[].checks`, `read NODE`). */
export interface Scene3dChecks {
  readonly health: readonly Scene3dHealthIssue[];
  readonly axis: Scene3dAxisReport;
  readonly cuts: readonly Scene3dCutReport[];
  /**
   * 0.17.0 framing reminders. In an `apply` reply only for the shots that batch added or updated
   * (absent when it touched none); in `read NODE` / `NODE/scene` / `NODE/checks` for every shot.
   */
  readonly framing?: readonly Scene3dFramingIssue[];
  /** 0.17.0 motion reminders; only on scenes with a blocking table. */
  readonly motion?: readonly Scene3dMotionIssue[];
}

/** One framing fact row (`apply.scene3d[].framing[]`): what the shot frames at time k. */
export interface Scene3dShotFraming {
  readonly shotId: string | null;
  readonly n: number | null;
  readonly k: number;
  readonly t?: number;
  readonly cam: { readonly x: number; readonly y: number; readonly z: number };
  readonly look: { readonly x: number; readonly y: number; readonly z: number };
  readonly fov: number;
  readonly hfov: number;
  readonly subject: string | null;
  /** `SCENE3D.framing.sizes[].name`, or 局部 / 出画 when the subject's eye is out of frame. */
  readonly size?: string;
  readonly coarse?: string;
  readonly cut?: number;
  readonly cutAt?: string;
  readonly view?: string;
  readonly elevationDeg?: number;
  readonly distance?: number;
  readonly eyeAt?: readonly [number, number];
}

/** One `apply.scene3d[]` entry: a landed `scene3d_apply` command. */
export interface Scene3dApplyReport {
  /** Index of the command in the batch. */
  readonly command: number;
  readonly nodeId: string;
  /** Digest after the batch: the next batch's `baseDigest`. */
  readonly sceneDigest: string;
  readonly applied: readonly Scene3dApplied[];
  /** 0.18.0: the data the page repaired after the actions landed (only when it repaired something). */
  readonly repairs?: readonly Scene3dRepair[];
  readonly checks: Scene3dChecks;
  /** Story timeline (`read NODE/timeline` shape); only when the scene has blocking (0.17.0). */
  readonly timeline?: Scene3dStoryTimeline;
  /** The node's shot cards (ids) split by whether this batch left them stale; only when it has cards (0.17.0). */
  readonly renders?: { readonly stale: readonly string[]; readonly fresh: readonly string[] };
  /** Framing fact rows of the shots this batch added / updated: first frame, plus the last one for a moving shot (0.17.0). */
  readonly framing?: readonly Scene3dShotFraming[];
  /** The batch changed nothing: not written, no undo step, digest unchanged (0.17.0, B9-FX-51). */
  readonly unchanged?: true;
}

/** Shot windows on the story axis and the derived act windows; `total` = Σ shot dur (3 s when missing). */
export interface Scene3dStoryTimeline {
  readonly total: number;
  readonly shots: readonly {
    readonly id: string;
    readonly start: number;
    readonly end: number;
    readonly editStart: number;
  }[];
  readonly acts: readonly {
    readonly id: string;
    readonly who: string;
    readonly start: number;
    readonly end: number;
    readonly note?: string;
  }[];
}

/**
 * `scene3d[]` rendered as text, one line per report (plus a `拦下：…` line when something blocks):
 * the next `baseDigest`, renames, block / warn messages, axis, jump cuts and exemptions, cleared
 * `facing`, inferred kinds. The page puts exactly this string in `apply.scene3dSummary`; a host
 * that renders its own text calls this instead of re-implementing the wording.
 */
export declare function formatScene3dSummary(reports: readonly Scene3dApplyReport[]): string;

/**
 * A `read NODE/scene` scene (wire shape, degrees) as compact text: a summary line, then one line per
 * object (id, name, role, kind / prefab, foot point, turn, scale, body type, figure pose), camera,
 * shot (number, framing, cam or orbit, via, to, look, fov, dur, start, follow, shake, moves) and
 * blocking act. Unknown fields are left out, missing values print `?` (0.17.0).
 */
export declare function formatScene3dScene(scene: unknown): string;

/**
 * Self-checks as text: one verdict line, then every health issue, the axis verdict, every cut and
 * the framing / motion reminders when present, each in the page's own words (0.17.0).
 */
export declare function formatScene3dChecks(checks: Scene3dChecks): string;

export {
  ID_UNAVAILABLE,
  LINE_BREAK,
  URL_UNAVAILABLE,
  echoId,
  echoMessage,
  echoProse,
  echoShotN,
  echoText,
  echoUrl,
} from "./echo.mjs";

/** One `NODE/renders` row as {@link formatScene3dRenders} reads it. */
export interface Scene3dRenderLine {
  shotId: string | null;
  n: number | null;
  output: "still" | "video" | "sheet";
  frame?: "end";
  nodeId: string;
  url: string | null;
  stale: boolean;
  state: "landed" | "rendering" | "failed";
  error?: { code: string; message: string; next?: ReadonlyArray<{ command: string }> };
}

/**
 * `read NODE/renders` as text (`rendersSummary`, hostText verbatim): one line per output, built from
 * the structured rows with {@link echoId} / {@link echoUrl}; the page builds it and the CLI rebuilds
 * it from the same `renders[]` (B11-F2-1).
 */
export declare function formatScene3dRenders(rows: ReadonlyArray<Scene3dRenderLine>): string;
