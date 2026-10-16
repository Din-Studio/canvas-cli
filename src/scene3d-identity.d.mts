/** Identity palette: `[hex, Chinese colour name]` by index; the order is part of the name → colour rule. */
export const IDENTITY_PALETTE: readonly (readonly [string, string])[];
/** Every set piece (role `set`) gets this grey. */
export const IDENTITY_SET_COLOR: "#697681";
/** 0.18.0 — the 12 nameable colours for figures, in allocation order (`[hex, Chinese name]`); the first 8 are the palette. */
export const IDENTITY_NAMED: readonly (readonly [string, string])[];
/** 0.18.0 — the white / light-grey blocks every prop uses. */
export const IDENTITY_PROP_COLORS: readonly (readonly [string, string])[];
/** 0.18.0 — the grey one-off extras share once an episode has more than 12 figures. */
export const IDENTITY_EXTRAS: readonly [string, string];
/** Name of the name → palette index rule (`SCENE3D.identity.hash`). */
export const IDENTITY_HASH: "fnv1a32-nfkc-trim-lower";
/** Name → colour: NFKC, trim, lower case, 32-bit FNV-1a over code points, modulo the palette; sets are grey. */
export function scene3dIdentityColor(role: string, identity: string): string;
/** Names the page stores for an object created without one (by kind); they do not count as a name. */
export const IDENTITY_DEFAULT_NAMES: Readonly<{
  human: "人物";
  box: "立方体";
  cylinder: "圆柱";
  plane: "平面";
  backdrop: "背景板";
}>;
/** The string an object's identity colour is hashed from: its `name`, or its `id` when the name is missing or the kind's default. */
export function scene3dObjectIdentity(object: {
  id?: string;
  kind?: string;
  name?: string;
}): string;
/** The colour the page gives a stored object without `color`: `scene3dIdentityColor(role, scene3dObjectIdentity(object))`. */
export function scene3dDefaultColor(object: {
  id?: string;
  kind?: string;
  name?: string;
  role?: string;
}): string;
/**
 * Whether the page could have given this colour as an identity colour: a palette colour, the set grey, or one
 * of the golden-angle colours used once the palette runs out (0.17.0). The page avoids clashes within a scene,
 * so a stored identity colour is not always `scene3dDefaultColor(object)`; hosts use this to leave identity
 * colours out of compact projections.
 */
export function scene3dIsIdentityColor(color: unknown): boolean;
/**
 * Chinese name of a palette colour (and, 0.18.0, of the 12 nameable colours, the two prop colours and the extras
 * grey); `色号#rrggbb` for any other colour (echo-gated: one line, ≤ 32 code points).
 */
export function scene3dColorLabel(color: string): string;
/** Colours for a scene's names without collisions: kept ones stay, new ones hash, clash → first free colour. */
export function allocateIdentityColors(
  previous: Record<string, string>,
  identities: readonly string[],
): Record<string, string>;
/** One subject of an episode for {@link allocateEpisodeIdentityColors} (0.18.0). */
export interface EpisodeIdentitySubject {
  /** The identity across scenes (an asset id); one colour per id. */
  readonly id: string;
  readonly role: "figure" | "prop" | "set";
  /** A main character: coloured first. */
  readonly main?: boolean;
  /** A one-off extra: shares the extras grey once the episode has more than 12 figures. */
  readonly extra?: boolean;
  /** The scenes it appears in (props in one scene get different colours where possible). */
  readonly scenes?: readonly string[];
}
/**
 * Colours for one episode (0.18.0, A87 ④ / A88 ①): figures get the 12 nameable colours (mains first, then in order;
 * past 12 figures the extras share the grey and any figure still over 12 is grey and in `overflow`), props alternate
 * white / light grey (fewest in the same scene first), `previous` (`{id: colour}`) is kept. Never touches a scene.
 */
export function allocateEpisodeIdentityColors(
  subjects: readonly EpisodeIdentitySubject[],
  previous?: Record<string, string>,
): {
  colors: Record<string, string>;
  labels: Record<string, string>;
  extras: string[];
  overflow: string[];
};
/** One problem {@link checkEpisodeIdentityColors} reports. */
export type EpisodeIdentityIssue =
  | { code: "color_drift"; id: string; colors: Record<string, string> }
  | { code: "color_shared"; scene: string; color: string; ids: string[] };
/**
 * Checks an episode's colours (0.18.0): one id in two colours across scenes is `color_drift`; two figures of one
 * scene on the same nameable colour is `color_shared` (the extras grey and the prop colours are shared on purpose).
 */
export function checkEpisodeIdentityColors(
  scenes: ReadonlyArray<{
    scene: string;
    objects: ReadonlyArray<{ id: string; role?: string; color?: string }>;
  }>,
): EpisodeIdentityIssue[];
