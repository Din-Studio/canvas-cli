# Changelog

Versions are the only identity a downstream has for "which API surface is
installed". **A version number is never reused for two different trees**: if a
command, a field, an export or an `exports` subpath changes, the version changes
with it. `test/pack.test.mjs` enforces that — it pins the `exports` surface AND
the feature surface (methods, command fields, contract blocks) per version, and
fails when either drifts without a bump.

## 0.15.1

_2026-09-28 — F086, third sheet layout (decision A57): one picture per asset; a character sheet gains a scale panel._

Contract-only for the page's local tools. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, the
`exports` surface, CLI commands, flags, fields, wire methods and contract blocks are unchanged.
`localTools` changes in four places, pinned by `VERSION_FEATURES["0.15.1"]` in `test/pack.test.mjs`
(the `0.15.0` entry is unchanged): `assetSheet.panels` (below), `assetSheet.scaleRefs` added and
`assetSheet.planAspectTolerance` removed, `warningCodes` drops `plan_aspect_mismatch`, and the new
`userSheet` block (pictures the user uploaded, decision A60 — below).

### `run-tool --kind asset-sheet`: one picture per asset

The art step now draws **one** picture per asset, and that picture is run-tool's NODE-ID
(`localTools.assetSheet.panels[kind].primary`, holding `cells` left to right). The sheet never
rearranges it; it only adds beside / below it.

- Character: NODE-ID = the baseline sheet — face close-up on the left, three-view **with heads** on the
  right (`baselineSheet`, cells `face` / `threeView`). The composite = the whole sheet, scaled to one
  row and **not split** (0.15.0 split it at the first white gap; a real variant sheet whose flared cape
  nearly touched the face close-up could not be split, the product fell back to cutting it in half,
  and the face panel held half a person) + a **scale panel** + the info block. The scale panel stands
  the character's front view beside the front views of 1–2 in-story reference characters
  (`metadata.scaleRefs`: `{nodeId | fileId, heightCm, label}`, `localTools.assetSheet.scaleRefs`
  1–2, label ≤ 20 characters), all at one px/cm on one ground line, with a shared ruler on the right,
  a thin light dashed line from each one's head top across to the ruler with the height written on it
  at the ruler end (decision A57, supplement 2; it breaks where it passes another figure), and each
  one's name and height below — no external reference objects. A reference character
  without `heightCm` is `invalid_request` naming it. Heights that differ more than `noteHeightRatio`
  (4) times are still drawn to scale and `meta.notes` says so. `heightCm` is now required. Without
  `scaleRefs` the panel holds the character alone and `meta.notes` says so.
- Front view: the **first figure of the three-view**, found by the column gaps (a gap is now any run of
  empty columns at least 0.1 % of the width — 0.15.0 wanted 0.8 %, which merged a cape that nearly
  touches the face close-up into it). When the face close-up truly touches the first figure, the
  tool tries once more along the feet line of the other figures (the close-up is drawn down to the
  image bottom, the figures stand above it) and keeps the result only when its head and feet match
  theirs within 3 % of their height. A close-up that only looks split in two — a white chest or shirt
  near the background colour down its middle, its other half still drawn below the figures' ground
  line — is taken whole as the close-up and the three-view read again (kept only with exactly three
  figures and a front view that passes); when that fails too the error names both possibilities.
  Figures are measured like `scale-lineup` items (floor shadows cut with the `scaleLineup.floorShadow`
  defaults, `floor_shadow_kept` when unsure; small detached labels above or below a figure ignored);
  in the cropped figure only the background connected to the crop's edge turns white, so dark eyes or
  a black belt on a dark background stay as they are. No front view — no gap at all, a reversed sheet, a left part
  outside 12–65 % of the content, a figure shorter than 35 % of the sheet or wider than 1.2 × its
  height — fails the run (`run_failed`) naming the picture (`run-tool 的 NODE-ID（…）` or
  `metadata.scaleRefs[i]（label，…）`). A reference character given as an old project's single
  full-body picture is measured whole: a picture counts as a sheet only when it is landscape and holds at
  least three tall blocks, all but the close-up standing on one ground line (their bottoms within 3 % of
  the height) and the close-up not — so a portrait, one person, or a light single creature that the
  column gaps break into two or three blocks is measured whole, as in 0.15.0. Light, low-saturation clothes (a
  white dress with a soft grey outline, light grey trousers, silver armour) count as content where their
  light grey pixels span a long way down a column (≥ 10 % of the height — far more than a floor shadow),
  so a figure is not cut into strips; a figure's edge columns that hold only a short bit of such an
  outline are measured with it. A three-view with other than three figures, a front view narrower than
  0.15 × its height, or a front view with a loose part on each side at waist height (hands showing out
  of sleeves the colour of the background) also fail the run naming the picture. So does a front view
  whose box touches the top edge — an old (pre-A57) headless three-view drawn from the neck, or a head
  cut off by the edge — with 「设定图不带头，需按新口径重出」 (it would be drawn headless and stretched to
  the height). A left block much narrower than a face close-up is still used and `meta.notes` says
  so.
- `metadata.panels` (character only, optional): `{baselineSheet}` may be NODE-ID itself; when it is
  another picture the left part shows it and the front view comes from NODE-ID (an old project's
  derived full-body picture). `{face, threeView}` (an old project's two pictures) keeps 0.15.0's two
  panels (620 / 1088 px) on the left. Not both forms.
- Prop: NODE-ID = the three-cell picture (`propSheet`: front, back, and on the right a close-up hand /
  a faceless person holding it / a faceless plain figure beside it, by size); composite = that picture
  full width + the size info block. `heldMode` (default by the longest of `sizeCm`, ≤ 30 / ≤ 60 cm)
  still only words the info block's right-cell line. `backRef` / `heldRef` are retired: given, they are
  refused (`invalid_request`) with the new call shape.
- Scene: NODE-ID = the two-cell picture (`sceneSheet`: scene, top-view plan or aerial view);
  composite = that picture full width + the size / area info block. `panels.plan` is retired and
  refused with the new call shape; the canvas no longer draws dimension lines, so
  `plan_aspect_mismatch` and `planAspectTolerance` are gone.
- Prop and scene composites are 2400 px wide (the picture at full inner width, at most 2336 px tall);
  a character composite is one 1000 px row whose width follows the sheet's aspect and what the scale
  panel needs (420–1400 px).
- `metadata.stripScaleText` (boolean, new): the scale panel keeps only the figures — no names,
  heights, ruler, ticks, dashed height lines or ground line; each figure stays where and as large as
  it would be with them. It defaults to `!withInfo`, so the text-free version (`withInfo:false`) is
  clean in the scale panel too (the text there could otherwise be painted into the video); give
  `false` to keep them. `meta.scale.stripped` is `true` when they were left out. Props and scenes have
  no scale panel: accepted there and ignored.
- Reply `meta`: `panels` (`baselineSheet` or `face` / `threeView`; `propSheet`; `sceneSheet`),
  `heldMode` / `heldModeSource` (prop), `scale` (character: `pxPerCm`, `ruler {topCm, unit}`,
  `figures[{label, heightCm, nodeId, fileId?, source: "sheet" | "whole", box, rect, shadowCutPx?}]`),
  the info fields, `notes`, `warnings`, `url`, `fileId`, `font`. `baselineSplit`, `planImage` and
  `area` are gone. The new node links back to every picture on the canvas it used.

### `run-tool --kind scale-lineup`: character, creature and prop items from the new pictures

The same front-view code as the scale panel: a character item given a baseline sheet stands as the
first figure of its three-view; an old project's single full-body picture (portrait, or one block)
is still measured whole, exactly as in 0.15.0. A creature item is treated the same way — the new
creature sheet is also a close-up plus a three-view, so its front view is taken (up to twice as wide
as tall: four legs and wings are wider than a person), and a single creature picture is still measured
whole. A prop item given the three-cell picture stands as its left cell (the first block by the gaps;
a first block that looks like the left and middle cells run together — over half of the content and
at least 1.6 × as wide as the widest other block — counts as no front view), a single prop picture as
a whole. Every character or creature gets the same dashed height line from its head top to the ruler
on the left, labelled with its height (props do not: they are scaled by their long side); a lane
beside the ruler holds the labels. Each row item gains `source` (`sheet` | `panel` | `whole`). A
product picture with no usable front view (or no measurable subject) no longer fails the whole lineup
(decision A60: never stop to ask): that item stands in as a silhouette — a grey person, a grey box by
height for a creature, a grey box by `sizeCm` for a prop — its row says `source: "silhouette"` and
`reason` (the failure code, e.g. `loose_parts`, `headless`, `merged`, `blank`), the item is listed in
`meta.subjects` (like an uploaded subject, without `userSheet`), and `meta.notes` carries the message
that used to be the error. `asset-sheet` still fails the run when a character's own sheet — or a
product reference character's — gives no front view.

### Pictures the user uploaded: `userSheet` (decisions A60, A61)

An asset whose picture the user uploaded themselves gets **no composite**: that picture, whole, is its
video reference. `asset-sheet` refuses `metadata.userSheet: true` (NODE-ID is an uploaded picture) with
`invalid_request` 「自传资产不拼合成图」. Such a character still stands in other characters' scale
panels (`scaleRefs[i].userSheet: true`) and in the lineup (`items[i].userSheet: true`), measured by
local code only — no model, no charge (`localTools.userSheet`):

1. background: if at least `bgUniformity` (60 %) of a 2-px ring round the image is within
   `bgTolerance` (24) of the ring's median colour on every channel, that background is flood-filled
   in from the edge; otherwise the subject is drawn as a silhouette (`complex_background`);
2. the largest connected block that stands like a whole person — height ÷ width within
   `figureAspect` (2–5), at least `minHeightRatio` (40 %) of the image height, bottom in the lower
   half; front, side or back view — is the figure; none → silhouette (`no_full_body`). Its floor
   shadow is cut exactly as a product picture's (`scaleLineup.floorShadow`; on a coloured background
   "darker than the background, same hue" stands for light grey), `floor_shadow_kept` when unsure;
3. it must be whole — top and bottom at least `edgeMarginRatio` (1 %) clear of the edges, nothing big
   pressing right on its head (a figure cut by the cell above in a collage), a round head narrower
   than the body (no headless three-view) — else silhouette (`incomplete`).

The figure is cut out on its mask (the rest turns white) and stands at the same px/cm as the others.
A silhouette is a neutral grey (`silhouetteColor`) person scaled to `heightCm`, with its name, height
and dashed height line like any figure (it shows height only). A creature item is measured the same
way without the person-only tests (aspect, head); its stand-in is a grey box. An uploaded prop is
always a rounded grey box sized by `sizeCm` (length or width, whichever is larger, by height).
`metadata.userSheetBg: {tolerance?, uniformity?}` overrides the two background thresholds on either
tool. Replies list every uploaded subject in `meta.subjects` (`label`, `kind`, node or file,
`userSheet: true`, `source`: `figure` | `silhouette`, `reason`) — the same shape as a lineup's product
fallbacks, so a caller handles both alike — and mark its scale-panel figure / lineup row with
`userSheet: true`, `source` and `reason`; `meta.notes` says which ones fell back to a silhouette and
why. Product pictures are unaffected.

### Bundled skill

SKILL.md (「命令分级」's asset-sheet / scale-lineup line) and commands.md scene 6e are rewritten for
A57: one picture per asset, the call shapes above, the retired keys, and `userSheet` (A60).

## 0.15.0

_2026-09-27 — F086: local asset reference sheets, in-story height lineups and text annotations._

Additive. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, the `exports` surface is
unchanged, and no CLI command, flag, field or wire method changed: the new tools are `run-tool`
kinds the canvas page implements. The contract gains the `localTools` block (also exported as
`LOCAL_TOOLS`) and `tiers["run-tool"].localKinds`. `test/pack.test.mjs` pins the new surface in
`VERSION_FEATURES["0.15.0"]` — contract blocks, the local kinds, the annotate mark kinds, the
tier/contract link, the new kinds the bundled skill teaches, the asset-sheet panels, key set and
held-picture modes, and the scale-lineup block; the `0.14.0` entry is unchanged.

### `run-tool --kind asset-sheet` (local, free)

_Superseded by 0.15.1 (decision A57): the layouts below (A46) and the prop `backRef` / `heldRef`, the
scene `panels.plan` and the baseline-sheet split are withdrawn — see 0.15.1 above._

One asset's pictures composed into **one** reference image — the image the video model is
given (decision A28, revised). No sheet carries a size-comparison panel, reference object or scale
bar (decision A46): characters are compared by `scale-lineup`, and a prop's size shows in its held /
beside picture. `metadata` takes `kind` (`character` | `scene` | `prop`), `panels` (a character's or
scene's extra panel node ids), `heightCm` (character, optional), `sceneSize {lengthM, widthM}`
(scene, required), `sizeCm {l, w, h}` (prop, required), `backRef` and `heldRef` (prop, required —
each `{nodeId}` or `{fileId}`), `heldMode` (prop, optional: `handClose` | `hand` | `beside`),
`fields` (A30 values from the asset list), `estimated`, `locale` (`zh` | `en`) and `withInfo`; any
other key is `invalid_request`.

- Character: face close-up + headless three-view + headed full-body picture, each fitted whole into
  its panel (620 / 1088 / 580 px wide). NODE-ID = the headed, white-background full-body front
  view; plus either `panels.baselineSheet` — the art team's baseline setting sheet, one picture with
  the face close-up on the left and the headless three-view on the right (decision A38①) — or the
  two pictures `panels.face` and `panels.threeView` (not both forms). `heightCm` only feeds the info
  block's height line and may be left out.
- Scene: NODE-ID = the scene image; `panels.plan` = the top-view plan, drawn with length and width
  dimension lines along its top and left edges (the image edges are the walls) and the area below it
  (`fields.area`, else length × width). A plan whose aspect differs from `sceneSize` length ÷ width
  by more than 10 % (`localTools.assetSheet.planAspectTolerance`) is still drawn, with a
  `plan_aspect_mismatch` warning; plan text that does not fit its panel warns `text_overflow`.
- Prop (decision A46③④ and its supplements): NODE-ID = the front view; `backRef` = the back view;
  `heldRef` = a picture that shows how big the prop is — held in a close-up hand (`handClose`), held
  in both hands from the chest down (`hand`), or beside / in use by a plain figure seen from behind
  or the side (`beside`); the product's art step generates it with no story character in it, the
  canvas only lays the three out (720 / 720 / 848 px wide). Each ref is `{nodeId}` (an image node
  with output on this canvas) or `{fileId}` (an AssetHub file id, looked up on this canvas first and
  then in the project's media library). A missing ref is `invalid_request` naming it; the two refs
  cannot be the same picture or NODE-ID itself — node ids are checked before anything runs, and a
  file id that turns out to be NODE-ID or is found nowhere fails the run (`run_failed`, naming the
  ref and the file). `heldMode` defaults by the longest of `sizeCm`: ≤ 30 cm `handClose`, ≤ 60 cm
  `hand`, longer `beside` (`localTools.assetSheet.heldModes` / `heldModeMaxCm`); it only words the
  info block's line about the right-hand panel. Props take no `panels`.
- Panel nodes must be image nodes with output, distinct, and not NODE-ID itself — otherwise
  `invalid_request` before anything is fetched.
- Baseline sheet split: the tool finds the boundary itself — the first white gap (background =
  the median colour of the image border, so off-white works) from the left, or a thin vertical
  divider; it need not be centred, and the gaps between the three views are never taken for it.
  Each side is cropped to its content with a small margin. An unreliable split fails the run
  (`run_failed`, nothing landed): face touching the three-view (a deep valley in the left part's
  column profile), a left part outside 12–65 % of the content width / a right part under 25 %, or a
  reversed sheet — when the right part is split into several segments and the rightmost one is
  clearly the widest block of the sheet (1.15 times the left part and every other segment: a face
  close-up placed on the right). A front view wider than the face (a cape) is not taken for a
  reversal. Crop the sheet with `crop-image` and pass `face` / `threeView` instead. A left part much
  narrower than a face close-up (its content box under 0.45 as wide as it is tall — more like one
  headless figure, as in a reversed sheet whose face is only a little wider than the figures) is
  still split and drawn, and `meta.notes` says the sheet may be reversed.
  `meta.baselineSplit` reports `x`, `xRatio`, `method` (`gap` | `divider`), `faceRatio` and the two
  crops. The contract records the form as `localTools.assetSheet.panels.character.combined`.
- Info block: the A30 keys in the contract's order (character 14, scene 9, prop 7; height and sizes
  are derived from `heightCm` / `sizeCm` / `sceneSize` and refused in `fields`; a prop gets one more
  line about its right-hand panel after the size), fixed row height, wrapped with `measureText`,
  never taller than 15 % of the image (`infoMaxHeightRatio`); what does not fit ends in `…` and is
  listed in `meta.infoDroppedFields`.
- Estimates and language (decisions A38③④): `metadata.estimated` lists the numbers the asset list
  estimated — the kind's geometry key (`localTools.assetSheet.geometryKeys`: `heightCm`,
  `sceneSize`, `sizeCm`) or its field keys, each with a value — and their info-block values get
  "（估）"; a scene's estimated `sceneSize` marks the area computed from it too. `metadata.locale`
  (`zh` by default, or `en`; `localTools.assetSheet.locales`) switches the info-block field names,
  the plan's area label, the estimate suffix and the prop's right-panel line; values are drawn as
  given.
- The reply's `meta` carries `kind`, `width` / `height`, `panels` (the node behind each panel; a
  prop's back / held picture found only in the media library is `null`), `heldMode` and
  `heldModeSource` (`metadata` | `sizeCm`), `baselineSplit`, `planImage` / `area`, `infoRows`,
  `infoHeightRatio`, `infoTruncated`, `infoDroppedFields`, `notes` (the baseline-sheet reminder
  above), `warnings` (`[{code, message}]`, codes in `localTools.warningCodes`), `url`, `fileId` and
  `font`. The new node has a provenance edge back to every panel on the canvas.

### `run-tool --kind scale-lineup` (local, free)

The production's height lineup (decision A40). `metadata` takes `items` — 1–48
`{nodeId | fileId, label, kind?, heightCm | sizeCm + scaleAxis?}` — plus `perRow`, `rowsPerImage`,
`groups`, `floorShadow` and `locale`. `kind` is `character` (the default), `creature` or `prop`;
characters and creatures give their height `heightCm`, a prop gives `sizeCm {l, w, h}` (decision
A45①) and the long side of its subject box stands for the largest of l / w / h — or the one
`scaleAxis` (`localTools.scaleLineup.scaleAxes`) names — so a sword lying flat is drawn 1 m long
rather than 1 m tall and does not squash the row. Items stand smallest to largest (height, or a
prop's long side) on one ground line, each cropped to its non-white subject box, with a ruler at
the left of every row (its tick lines run across the row) and the name and size below each. At
most `perRow` per row (default and cap 6; more are split into balanced rows: 7 → 4 + 3, 13 → 5 + 4 +
4), `rowsPerImage` rows per image (default 2, cap 3; more make more images); `groups` (arrays of
item indexes, instead of `perRow`) sets the rows by hand. Sizes differing by more than
`maxHeightRatio` (25) times never share an image — they are split by scale and `notes` says why and
who went where; neighbouring images within that ratio share one px/cm and ruler. Each image is
2400 × 1350 (16:9); `locale` (`zh` / `en`) switches the title drawn on it. NODE-ID only decides
where the result lands. One image lands like the other image tools; several are all uploaded first
and then land together to the right of NODE-ID (a failed or cancelled upload lands none). Each
result links back to NODE-ID and to the canvas nodes drawn in it.

- Floor shadows: a light, low-saturation band under an item's feet (smallest channel ≥ 180, max −
  min ≤ 24; `localTools.scaleLineup.floorShadow`) is cut off before its subject box is measured —
  when the band also looks like a floor shadow: at least 1.25 times as wide as the feet right above
  it, or no taller than a fifth of its width — either is enough, so a shadow about as wide as the
  feet is cut too; a band that passes only one of the two is still cut and the reply warns
  `floor_shadow_kept` (light soles would be cut as well). Light shoes, boots or hems, about as wide
  as the legs and not flat, are part of the subject and are neither cut nor reported. A shadow-like
  band taller than 8 % of the box is kept (`meta.warnings`: `floor_shadow_kept`).
  `metadata.floorShadow` overrides the thresholds or, with `false`, turns the cut off.
- The reply's `meta` carries `sheet` / `of`, `width` / `height`, `pxPerCm`, `ruler`, `rows` (per
  item: `label`, `kind`, `heightCm` — or a prop's `sizeCm` and the `scaleAxis` used — `rect` and
  `shadowCutPx` when a shadow was cut), `notes`, `warnings`, `url`, `fileId` and `font`. A picture
  whose subject cannot be measured fails the run naming the item, and says whether it is blank or
  the subject is too thin / small (crop it with `crop-image` first).

### `annotate-image` text marks

`{kind:"text", text, points:[[x,y]], color?, size?, align?, background?}` beside the pen / rect /
circle / arrow strokes: one anchor point, `size` as a share of the image's long side (default
0.03, at most 0.3), `align` left / center / right, at most 200 characters and 10 lines, an optional
background (otherwise a contrasting halo). A text mark larger than the image is still drawn
(clipped) and the reply warns `text_overflow` naming the stroke. The UI annotate bench is unchanged.

### Chinese font

Text drawn by these tools uses a Noto Sans SC Medium subset (ASCII + GB 2312, OFL, about 1.1 MB) the
canvas ships and preloads with `FontFace`, so the same data draws the same image on every machine;
if it cannot load, the system font is used and `meta.font` says `fallback`.

### Contract: `localTools` and `tiers["run-tool"].localKinds`

`CANVAS_CONTRACT.localTools` lists every local `run-tool` kind (`trim-audio`, `trim-video`,
`capture-frame`, `crop-image`, `grid-split`, `flip-image`, `annotate-image`, `asset-sheet`,
`scale-lineup`), the warning codes (`floor_shadow_kept`, `plan_aspect_mismatch`,
`text_overflow`) and the metadata caps and value sets of `annotate-image`, `asset-sheet` (panels,
A30 fields, geometry keys, locales, held-picture modes and their size bounds, info-block and plan
tolerances) and `scale-lineup` (item kinds, row / image caps, size-ratio threshold, 16:9 size,
locales, prop scale axes, floor-shadow thresholds). The page imports this very object, so the limits
a product reads are the ones enforced. `tiers["run-tool"].localKinds` is the same array: a host can
tell which `run-tool` calls need no charge confirmation. `run-tool` itself stays L2, main only,
`--approved`.

## 0.14.0

_2026-09-24 — F059 A / B / D / F merged; F016's Jianying export rework rides in with F. The
project document library (doc@1) and the Jianying draft folders (`jianying-roots`,
`export-jianying --draft-root`) ship in the same version — 0.14.0 had not been published yet._

Additive. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, and the `exports`
surface is unchanged: `src/jianying/` ships inside `src/`, but `./jianying` is not a
published subpath. 42 CLI subcommands (`export-jianying`, the five `docs` subcommands and
`jianying-roots` added) and 29 apply commands (9 added); the contract gains the `documents`
block. `test/pack.test.mjs` pins the new surface in `VERSION_FEATURES["0.14.0"]` — contract
blocks, apply commands, CLI subcommands and their tiers (with
`flagTiers["draft-root"]`), `READ_METHODS` (with `timeline_export` and `documents_list` /
`documents_get` / `documents_folders`), `MAIN_METHODS` (with `documents_put` /
`documents_delete` / `jianying_roots_list` / `jianying_roots_touch`), `TIMELINE_OPS` /
`TIMELINE_FIELDS`, the four image tool kinds the bundled skill teaches, and the
`docs ls --folders`, `docs read --folder --out-dir` and `export-jianying --draft-root` flags
in the CLI's own usage.

### `run-tool` — four local image tools (F059-A)

The canvas build this pairs with knows **four more local free tools** for
`run-tool --kind`, all on image nodes (gen image mode and uploaded images):

- `crop-image` — `metadata` `{x,y,w,h}` (0..1) or `{aspect}` (`1:1` `3:2` `2:3`
  `4:3` `3:4` `16:9` `9:16`), optional `rotate` 0/90/180/270 (rotate first,
  then crop — same as the UI crop bench); output capped at 4096 px.
- `grid-split` — `{cols, rows}`, 1..4 each (1×1 allowed, as in the UI); one node
  per cell, tiled to the right of the source.
- `flip-image` — `{axis: "horizontal" | "vertical"}`.
- `annotate-image` — `{strokes:[{kind: pen|rect|circle|arrow, color?, width?,
points:[[x,y],…]}]}`, burned into the image.

They are the image toolbar's crop / grid / flip / annotate buttons: same pixel
code, same upload-then-land code, so the result is a new image node beside the
source (with a provenance edge) and the source is never touched. `read` lists them
with `billable:false`. Bad `metadata` comes back as `invalid_request` before any
work starts; a non-image node gets `tool_not_applicable`. `references/commands.md`
§6c documents the parameters and examples; SKILL.md points at it.

### Nine new apply commands, 20 → 29 (F059-B)

Each one goes through the same code as the matching human action — the pure
function behind the menu item or button a human uses, and for `select` the
editor's own click-selection — so an Agent can reach exactly the states a human
can. `add_to_group` has no menu item; the membership it writes has the same
shape as dropping a node into a frame.

- **`delete_output {nodeId, outputId, expectOutputId?}`** — the candidate
  picker's ✕ (`deleteNodeOutput`); gen candidates and media-upload
  image / video history. The displayed media-upload entry cannot be deleted.
- **`split_output {nodeId, outputId, position?}`** — the picker's 拆分
  (`splitGenOutput`): a new gen node holding one candidate; the source's
  content is untouched. When the source is a group member the new node joins
  that group (`childIds` + `parentId`: it moves and is deleted with the frame)
  and the frame grows, never shrinks, to cover it.
- **`clear_output {nodeId}`** — the node menu's 清空媒体
  (`clearNodeMediaInGraph`).
- **`reset_status {nodeId}`** — the failure bar's 重置状态 (`resetNodeStatus`).
- **`add_to_group {groupId, nodeIds}`** / **`remove_from_group {nodeId}`** —
  join an existing group without moving (frame grows to cover; members of
  another group are skipped, never stolen) / the node menu's 移出组
  (`dissolved[]` when the frame dissolves).
- **`duplicate_nodes {nodeIds, offset?}`** — copy + paste of a selection
  (`duplicateSelectionInGraph`): groups expand to members, edges between copies
  are remapped. Without `offset` the copies land in free space that is also
  clear of the source groups' frames (a copy is never a member). `duplicate_node`
  is unchanged.
- **`recover_deleted {nodeIds?}`** — the canvas bar's 恢复最近删除; reply
  `recovered[]`.
- **`select {nodeIds}`** — highlight nodes in the human's editor; reply
  `selected[]`.

### Changed commands (F059-B)

- `select_output` also takes a media-upload node's image / video history entry
  id; `resources` history rows now carry `outputId`.
- `focus_node` takes exactly one of `nodeId`, `nodeIds` or `all: true`
  (`nodeId` is no longer required); `focused[]` echoes the target form.
- `upload_asset.targetNodeId` / CLI `upload FILE --into NODE-ID` — replace the
  media of an existing media-upload node (keeps id, title, edges; records the new
  `mediaAssetId`) and, once the batch commits, drops the node's old local-file
  registration — the same landing and side effect as the node's own 替换文件.
- `delete_node` snapshots what it removed into the page's 最近删除 buffer, and a
  batch deleting **more than 5 nodes or any group with members** needs
  `approval.userApprovedNodeIds` naming every `delete_node` target (CLI
  `apply --approved`), else `approval_required` with nothing written — the same
  line as the editor's delete confirmation.

### Editor behaviour changes, user-visible (F059-B)

The menu items these commands share their implementation with changed for the
human too:

- **候选面板「拆分为独立节点」 on a node inside a group**: the new node is now a
  real member of that group — in its `childIds`, dragged and deleted with the
  frame, the frame growing to cover it — and one Ctrl+Z takes all of it back.
  Before, it copied the source's `parentId` without joining `childIds`: it rode
  along when the frame was dragged but was left behind, pointing at a group that
  no longer existed, when the group was deleted.
- **右键「清空媒体」 on a media-upload node** now also clears the node's asset
  identity (`mediaAssetId` / `mediaAssetUrl` — they named the file that is gone)
  and resets its `displaySize`, so the emptied node goes back to the empty
  node's default size instead of keeping the old media's box. The node's own ✕
  (清空节点) already reset `displaySize` and now clears the asset identity too.
  Gen nodes already reset `displaySize`; nothing else about clearing changed.

### Policy / contract (F059-B)

- `WORKER_BLOCKED_COMMANDS` adds `delete_output`, `clear_output`,
  `recover_deleted`; a worker cannot carry `approval` on `apply`.
- `apply` accepts an optional `approval` (`limits["apply.approval.userApprovedNodeIds"]`,
  `limits["apply.bulkDeleteThreshold"] = 5`); `tiers` still marks only
  `run` / `run-batch` / `run-tool` as approval-mandatory.
- `CANVAS_CONTRACT.focus.unshownReasons = ["no_selection"]`.

### `timeline` — editing ops and episode scope (F059-D)

- Four new ops, computed with the editor's own functions (drag-trim, split at
  playhead, I/O cut, undo) but **rejecting** instead of silently clamping:
  - `trim {clipId, inMs?, outMs?}` — change a clip's in/out without changing its id;
    `trim {clipId, reset:true}` / `trim {reset:true, episode?}` = "reset trim".
    `baseRevision` optional (the revision deliberately excludes trims).
  - `split {clipId, atMs}` — `atMs` is source time; returns `createdClipIds`.
  - `cut {inMs, outMs, episode?}` — remove a timeline-time range; returns `createdClipIds`.
  - `restore {previousClips}` — write a previous `previousClips` back verbatim (same ids).
    Clips no longer on the track are rebuilt from their source node's current output;
    URLs never come from the caller.
  - `split` / `cut` / `restore` require `baseRevision`.
- **Layout check** — every `timeline` reply now carries `layoutDigest`: a whole-track
  fingerprint of clip ids, order and each clip's `inMs` / `outMs` (plus the planned
  duration an open-ended clip is measured with). `revision` is unchanged and still
  excludes trims. `cut` **requires** `baseLayout` (the `layoutDigest` of the last reply)
  and `split`, `trim` and `restore` accept it optionally (checked when present); a
  mismatch is `timeline_conflict` with `error.path: "baseLayout"`, and the failure reply
  carries the current `clips` and `layoutDigest`. Without it, a human shortening an
  earlier clip after `list` made `cut` silently remove the wrong range (the next clip's)
  with no conflict, and `trim` / `restore` (which write in/out points by clip id) can
  silently overwrite a trim a human just made — after a human edit, `list` first and
  send `baseLayout`. Every other op rejects `baseLayout`.
- `episode` (`EP01` / `ep1` / `1` / `unknown` / `all`) on `list` (returns only that
  episode plus `episode` / `episodes[]`; `revision` stays whole-track), `clear`, `cut`
  and `trim reset`. Without it every op behaves as before. New CLI flag `--episode`.
- `append` gains `dedupeBySource` (skip reason `duplicate_source`); with `sort:"shot"`
  it is the editor's "import" (merge into each episode, re-sort the episode by shot,
  keep existing trims; `episode` limits it to one episode).
- `policy`: new exports `TIMELINE_OPS` / `TIMELINE_FIELDS` (`baseLayout` included); the
  daemon now rejects an unknown `timeline` field or op before dispatch.
- `restore` checks every clip's in/out structurally — a non-null `outMs` must be at least
  100 ms after `inMs` (`outMs: null` = to the end, not checked) — and rejects the whole
  batch, instead of letting the persist gate silently turn `outMs <= inMs` into `null`.
  It does **not** reject an in point by the planned duration: the page cannot measure the
  real length, the planned duration can be stale (a node re-run at a longer duration keeps
  the clip's old one), and the editor trims by the real length, so a clip the bridge itself
  returned in `previousClips` may start after "planned − 100 ms". Nor is the caller's
  `outMs` taken as the source length. The flip side: `restore` writes back in/out values
  `trim` would refuse — send it a reply's `previousClips` verbatim. A clip identical to the
  one still on the track is not re-checked. It restores ids, order and trims, not media: a
  clip whose source node was re-run in between gets the old trims on the new output
  (documented limitation, commands.md §17a).
- `cut` next to a clip of unknown length (before or overlapping the range) is still
  refused, but the message now points at `episode` / `split` instead of asking for a
  guessed `outMs`; `split` on such a clip likewise stops asking for one and points at
  measuring the real length (`inspect-media SOURCE --out FILE --probe`, then `trim` to
  the measured value) or splitting in the editor. §17a also spells out what "planned
  duration, not real length" costs: end-of-clip decisions and `cut` positions drift by
  `real - planned`, accumulated over the clips before the range.
- `TIMELINE_OPS` / `TIMELINE_FIELDS` are new `./policy` exports, pinned in
  `VERSION_FEATURES["0.14.0"]`.

### `export-jianying` — Jianying draft projects straight into the workspace (F059-F)

- **New local command** `export-jianying [--out-dir DIR] [--episode EP (repeatable)]
[--layout episodes|single] [--name NAME] [--dry-run] [--overwrite]`. It writes the
  timeline as Jianying (剪映专业版 5.9) draft projects into the session workspace —
  default `产出/剪映工程/`, one complete draft folder per episode
  (`<name>_EP01_<stamp>/`, clips without an episode number in `<name>_其他_<stamp>/`,
  or a single `<name>_<stamp>/` when no title carries `epNN`), whole source media under
  each project's `assets/video/`, clips recorded by `source_timerange` only. No zip, no
  browser download.
- **One implementation with the page.** `src/jianying/core.mjs` is the page's own
  `apps/web/libs/jianying/*.ts` bundled into one dependency-free ESM file by
  `tools/canvas-cli-jianying-core.mjs` (monorepo only; the file is generated, never
  edited). Project split, names, pre-flight gates, transitions / subtitle track / volume,
  asset file names (`assetDigest`) and the host allowlist are the page's code, so the
  folder is byte-identical to the unzipped browser export for the same draft root.
  `tests/studio/jianying-cli-core.test.ts` rebuilds the bundle and compares.
- **At most 4 subtitle tracks per project** (`JIANYING_MAX_SUBTITLE_TRACKS`, the page's
  builder): overlapping subtitles go one text track up and one line higher on screen, and
  subtitles that would need a fifth track are left out of the draft; `warnings` says how
  many and where the earliest one is. The browser export drops them the same way (the
  drafts stay byte-identical) but does not show the notice yet.
- **New read method `timeline_export`** (`READ_METHODS`; workers may call it): the
  timeline with each clip's `src`, `transitionOut`, `subtitles`, `volume` and `audioUrl`.
  It takes no parameters. `timeline` itself stays main-only. The CLI never shows it to
  the model; `spec.test.mjs` lists it next to `media_info` / `media_chunk` as an
  internal method.
- **Media** is downloaded directly from the clips' URLs — only `https` on the jianying
  export host allowlist, every redirect hop re-checked (a hop down to `http` is reported as
  a downgrade, "不允许降级到 http", not as an unlisted host), no cookies or credentials (the
  one place the CLI fetches a URL itself) — 4 at a time with the page's retry policy (3
  attempts, 1 s / 4 s, no retry on 4xx) and a 60 s stall abort. Width / height / duration
  come from a built-in MP4 / MOV box reader (`src/jianying/probe.mjs`) that computes them
  the way the page's mediabunny probe does, fragmented MP4 included; no ffprobe needed.
  It is wider than the page's probe: a video codec the page's exporter does not handle
  (anything but H.264 / H.265 / VP8 / VP9 / AV1 / ProRes — e.g. MPEG-4 Part 2 `mp4v` in a
  `.mov`, which the export button fails on) is not refused; the project is written and
  `warnings` names the clip, since only the real Jianying app can tell whether it plays.
- **Placement**: projects are assembled in `.<name>.partial/` and renamed into place when
  complete, `draft_meta_info.json` last; shared assets are downloaded once and
  hard-linked (copied where linking is impossible) — a hard-linked asset has a link count
  above 1, so the CLI's own `upload` refuses it like any hardlinked workspace file (by
  design; documented in the command reference); a rerun reuses assets already in the
  out-dir with the same identity and the same remote byte size; an existing project folder
  is `file_exists` (exit 2) unless `--overwrite`. Every folder it writes into (project,
  `.partial`, `assets/video/`) is checked component by component after it is created and
  before each write — no symlinks from the workspace root down, real path inside the
  workspace, the rule `download` uses — and a symlink stops the whole export with
  `workspace_boundary` (`error.path` names the folder; the `--out-dir` components and an
  existing project folder carry it too). Failed projects are `status:"partial"`
  and the reply is `ok:false` / `export_partial` with `failedNodeIds` and a `retry` argv
  that resumes them. Pre-flight refusals are `jianying_refused` with the page's `reason`
  and message. `ok:true` does not prove Jianying opens the draft — the reply's `note`
  says so, and recommends `jianying-roots` + `export-jianying --draft-root` (see the
  Jianying draft folders below) rather than moving project folders (media is referenced by
  absolute path, so moved media opens offline).
- **Tiers**: `tiers["export-jianying"] = {level:"L0", local:true, method:null,
timeoutTier:"long"}` — the 36th CLI subcommand (42 with the `docs` and
  `jianying-roots` commands below), 13 of them local.

### Hosts: what `export-jianying` needs (F059-F)

- `--dry-run` is a new boolean flag: a host that mirrors `BOOLEANS` must add it.
  `export-jianying` does not take `--turn` / `--request-id` / `--wait` (like `download`).
- The output folder (`产出/剪映工程/`) should be registered in the product's own file
  boundaries (script-to-video: `.pi/skills/lingying-rules/references/file-boundaries.md`);
  see the command reference, "Hosts: what to register for `export-jianying`".
- The page must be refreshed to a version with `timeline_export`; an older page answers
  `bridge_missing`.

### Project document library (doc@1): the `docs` subcommands

The canvas has a project-level **document library** (canvas left rail → 文档库): scripts,
outlines, the global skeleton, character profiles, series bible, plot breakdowns, shot lists,
shot-analysis ledgers / reports and uploaded novels, shared by every canvas of the project. It
is the single source of truth for those texts — no local mirror, no sync: reading is reading
the library, changing is an in-place update guarded by the version you read.

#### Five `docs` subcommands (36 → 41)

- `docs ls [--section --type --episode --folder --q --limit --offset]` → `documents_list`
  (L0, workers allowed); the reply adds a fixed-width `table`.
- `docs read DOC-ID [--out FILE --overwrite]` → `documents_get` (L0, workers allowed).
  `--out` saves a scratch copy to read; it is never synced back. Missing parent folders inside the
  workspace are created one level at a time (a symlinked component is `workspace_boundary`).
- `docs create --type TYPE (--file FILE | --text TEXT) [--section --episode --folder --title
--id --meta JSON]` → `documents_put` (L1, main only). Without `--id` the library derives the
  id (episode → `script:ep:05`, one-per-project types → the type, folders → `<type>:<key>:NNNN`,
  else type + title slug); an existing derived id holding the same document is `doc_conflict` —
  update it instead. A title-derived id cut to 20 characters that lands on a **different**
  document is `doc_conflict` with `suggestedId` (the cut title + a 4-character hash of the full
  title): nothing is written, `error.next` is `docs create --id SUGGESTED-ID …`, never update the
  document at `id`. An explicit `--id` that is taken is a plain `doc_conflict` naming the document
  there; `error.expectVersion` echoes the 0 so `error.next` says read it first.
- `docs update DOC-ID --expect-version N (--file | --text | --patch UNIFIED-DIFF) [--title --meta]`
  → `documents_put` (L1, main only). In place: omitted fields keep their values; no change at all
  answers `unchanged:true` without a new version. `--patch` is applied by the CLI on the version it
  just read (a moved version is `doc_conflict`; a hunk that does not match is `patch_failed`).
- Deleted documents keep their ids: `docs create --id` on a soft-deleted document's id is
  `doc_conflict` with `deleted:true` and does not revive it; without `--id` the library revives a
  deleted document only when the derived id holds that same document (same type and episode, same
  one-per-project type, or same title), and title alternatives skip deleted documents. `error.next`
  for `deleted:true` says to tell the user before writing it back (`docs read` would only 404).
- `docs create` / `docs update` check the text against the 1,000,000-character cap before sending
  (`--patch`: the patched text): over it is `too_large` (exit 2) with `chars` / `maxChars`, and
  nothing is written. The length is counted after line endings are normalized to LF (a `\r\n` is one
  character), the same way the server stores and counts it; the daemon's policy counts it that way too.
- `docs delete DOC-ID --approved [--expect-version N]` → `documents_delete` (L3, main only):
  a soft delete that needs the user's go-ahead (`approval.userApprovedDocumentIds:[id]`).

Two-word subcommands are one key: `parseArgs` returns `command:"docs ls"`, the key in
`COMMAND_SPEC`, `CANVAS_CONTRACT.tiers` and `help`. They take `--turn` / `--request-id` /
`--wait` / `--wait-ms`; `--file` here is the text file, so `host-argv`'s `extractPayload`
answers `{shape:"none"}` for them instead of parsing it as JSON.

#### Wire methods, policy and contract

- Four page-bridge methods: `documents_list` / `documents_get` (`READ_METHODS`) and
  `documents_put` / `documents_delete` (`MAIN_METHODS`, `MUTATIONS`). The page performs them with
  the signed-in user's own session against `/api/studio/projects/{projectId}/documents`, like the
  panel; the project comes from the pairing (`projectId` stays a reserved param).
- `policy.mjs` exports `DOCUMENTS_LIST_FIELDS`, `DOCUMENTS_GET_FIELDS`, `DOCUMENTS_PUT_FIELDS`,
  `DOCUMENTS_DELETE_FIELDS`, `DOCUMENT_ID_MAX_LENGTH` (20: `doc:<id>@<version>` must fit a
  30-character node tag), `DOCUMENT_CONTENT_MAX_CHARS` (1,000,000) and `DOCUMENTS_LIST_MAX_LIMIT`
  (200); unknown fields are refused, `documents_delete` requires its approval.
- `CANVAS_CONTRACT.documents` (also exported as `DOCUMENTS`): `sections`, `scriptSectionDocTypes`,
  `docTypes` (15, panel order; reverse-engineered scripts are `script` with `source`, the global
  skeleton is reference material, uploaded novels are `novel` in a `folder`, `note` is other
  uploads), `formats`, `fields`, `idPattern`, the length `limits`, `contentShaAlgorithm`
  (the canvas `read` digest over LF-normalized text), `nodeTagPrefix` (`doc:`) and the two error
  codes. The server validates against this very object.
- `bridgeErrors` gains `doc_conflict` (carries `id` / `currentVersion` / `currentSha` / `deleted`, plus
  `expectVersion` from `documents_put` and `suggestedId` when a title-derived id is taken by another
  document; `error.next` points at `docs read`, or at `docs create --id` with `suggestedId`) and
  `doc_not_found`, both not retryable.
- `tiers` gains `docs ls` / `docs read` (L0), `docs create` / `docs update` (L1, main only,
  `timeoutTier:"wait"`) and `docs delete` (L3, main only, `wait`). The document writes are not in
  the canvas undo stack: the server keeps every version, a rollback interface comes later, and
  until then the way back is another `docs update` with the earlier text.

#### Skill and reference

- `references/commands.md`: scenario 17d (list / read / patch / create / delete, ✅/❌ — never
  copy a document into the workspace and `create` it again; change it with `update`), the new
  reference section `` ## Project documents: `docs` ``, the page_away table, worker rules, limits and
  the two error codes. `SKILL.md`: tier table, main-only list and a document library section.

#### Folders: `docs ls --folders`, `docs read --folder`

An uploaded novel is one folder in the reference section, one document per chapter.

- `docs ls --folders [--section reference|script]` lists the folders (reference by default): name,
  id, chapter count, last update, plus a text `table`. It goes through the new read method
  `documents_folders {section?}` (`READ_METHODS`, workers allowed; `DOCUMENTS_FOLDERS_FIELDS`) →
  `{ok, items:[{section, name, id, count, updatedAt}]}`. The document filters (`--type`, `--episode`,
  `--folder`, `--q`, `--limit`, `--offset`) are refused next to it.
- A folder's id is the `<type>:<key>` prefix its documents share (`novel:k3x9` for
  `novel:k3x9:0001`); `CANVAS_CONTRACT.documents.folderIdPattern` publishes its syntax. The page derives
  it from the folder's first document with the server's own `folderKeyOf`; `null` when the documents
  carry explicit ids.
- `docs read --folder NAME-OR-ID --out-dir DIR [--overwrite]` saves the whole folder in one call as one
  scratch file per document, `<seq>_<title>.<ext>` in library order, and replies with each file's
  document id and version. It reads everything first and writes nothing if one document cannot be read
  (nor leaves behind an empty folder it created for `--out-dir`);
  an existing file is `file_exists` (nothing written) unless `--overwrite`. A name used in both sections
  must be given as the id; an unknown folder is `doc_not_found` (exit 1). `docs read DOC-ID` is
  unchanged; `--out-dir` without `--folder` and `--folder` with a document id or `--out` are refused.
- New boolean flag `--folders` (a host mirroring the CLI's boolean flags must add it).

#### `download --out` creates missing parent folders

- `download --out` (and `inspect-media --out`, which saves through it) creates missing parent
  folders inside the workspace one level at a time, like `docs read --out` — the manual's examples
  write into `out/`. A symlinked component is `workspace_boundary`, a file component `invalid_path`;
  paths leaving the workspace are refused as before and nothing is created outside it. The helper
  lives in an internal module (`src/output-dirs.mjs`), so the `./session` / `./media` exports are
  unchanged.

### Jianying draft folders: `jianying-roots` and `export-jianying --draft-root`

Decision A6: after the rough cut the Agent asks which Jianying draft folder to use and writes the
projects straight into it. The user's registered folders (at most 5, account-wide) are now remembered
with a last-used time, dropping the least recently used one when a sixth is added.

#### Commands (41 → 42)

- `jianying-roots` → `jianying_roots_list` (L0, **main only**; takes `--turn` / `--request-id` / `--wait`
  / `--wait-ms`): the user's registered folders, most recently used first, each checked on this machine —
  `exists` (`other_platform` for a path shaped for another OS), `looksLikeDraftRoot` (`root_meta_info.json`
  or existing drafts), `usable` (whether `--draft-root` accepts it, `reason` when not) — plus a text `table`
  and a `hint`. A worker is refused before anything is sent; an old page is `bridge_missing`.
- `export-jianying --draft-root ABSOLUTE-DIR [--approved]`: writes each project straight into that folder
  (`<name>_EP01_<stamp>/`, assembled in `.<name>.partial/` there). Mutually exclusive with `--out-dir`;
  `--overwrite` is refused; `--approved` without `--draft-root` is refused. Main session only
  (`worker_forbidden`). The folder must already exist as a real directory, with no symlink / junction on
  any level, its realpath equal to the path given, and not a drive / share / volume root, the home folder
  or a parent of it, or a system folder (`invalid_path` with `reason`). A folder that passes but does not
  look like a Jianying draft root (no `root_meta_info.json`, no drafts yet) is written to with a warning
  (dry run too). A folder the user has not registered needs `--approved` (`approval_required`, exit 2,
  before any download; `--dry-run` only warns); if the page cannot list the registered folders, only an
  old page (`bridge_missing`) lets `--approved` through — any other failure comes back as is.
  The command creates only its own project and `.partial` folders, never overwrites, deletes nothing else;
  a symlink met while writing is the new `draft_root_boundary` (exit 2). Media already exported into the
  workspace's `产出/剪映工程/` is hard-linked or copied instead of downloaded; nothing is left in the
  workspace. On success the folder is remembered (`jianying_roots_touch`). The reply adds
  `draftRootRegistered` and `remembered`; `outDir` is `null`; `error.retry` keeps `--draft-root` /
  `--approved`. Without `--draft-root` the command still writes only inside the workspace; its `note` now
  recommends `jianying-roots` + `--draft-root` instead of pointing Jianying's global draft location at the
  workspace.

#### Wire methods, policy and contract

- Two page-bridge methods, both in `MAIN_METHODS`: `jianying_roots_list {}` (read) and
  `jianying_roots_touch {path, label?}` (in `MUTATIONS`). The page performs them with the signed-in user's
  session against `/api/runtime/me/settings` and the new atomic `POST
/api/runtime/me/settings/jianying-draft-roots` (remember one folder in one transaction on the locked
  row — this replaces the page's old read-then-overwrite write-back). Errors: `invalid_request`,
  `unauthorized`, `jianying_roots_unavailable`.
- `policy.mjs` exports `JIANYING_ROOTS_TOUCH_FIELDS` (`path` ≤ 400, `label` ≤ 40; unknown fields refused);
  `jianying_roots_list` takes no params.
- `tiers`: `jianying-roots` (L0, `mainOnly:true`, `short`); `export-jianying` keeps L0 / local / long and
  gains `flagTiers["draft-root"] = { level:"L1", mainOnly:true, methods:["jianying_roots_list",
"jianying_roots_touch"], approvalWhen:"unregistered_root" }` (typed as `CanvasContractFlagTier`).
  `cliExitCodes` gains `draft_root_boundary: 2`.
- `src/jianying/core.mjs` is regenerated with `draftRootKey` (the one path comparison: case- and
  slash-insensitive for Windows paths) and `sortDraftRootsByRecentUse` from the page's
  `apps/web/libs/jianying/draft-roots.ts`.

#### Hosts

- `jianying-roots` is a new command: register its timeout tier (read) and, if the host keeps sub-agents
  away from `export-jianying`, keep them away from `jianying-roots` too. It accepts `--turn`, so it does
  not belong on a no-`--turn` list.
- `--draft-root` takes a value; `--approved` is already a boolean flag. A host that pre-blocks
  `export-jianying` for sub-agents already covers `--draft-root`.
- Replace "ask the user to set Jianying's draft location to `draftRoot`" with "`jianying-roots`, let the
  user pick or give a folder, then `export-jianying --draft-root`".

## 0.13.0

Additive. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, the 20 apply
commands, every command field and the `exports` surface are unchanged.

### `CANVAS_CONTRACT.tiers` — command tiers as data

- **`tiers`** — a new contract block keyed by CLI subcommand name (all 35 of
  them) plus `tiers.applyCommands` keyed by apply command `type` (all 20). Each
  wire subcommand carries `{level, method, mutation, mainOnly, approval,
timeoutTier}`; the twelve that never reach the page (`help`, `skill-path`,
  `connect`, `status`, `disconnect`, `stop`, `delegate`, `revoke`, `upload`,
  `download`, `inspect-media`, `frames`) carry `{level, local:true,
method:null, timeoutTier}` — `mutation` / `mainOnly` / `approval` have no wire
  truth for them, so they are absent rather than invented.
- Levels: **L0** read-only, **L1** an undoable free write, **L2** it costs money
  (`approval` mandatory), **L3** the undo stack cannot bring it back or it moves
  the connection identity / workspace files. `timeoutTier` is `short`, `long`
  (media chunk transfer — raise the host timeout) or `wait` (takes `--wait` /
  `--wait-ms`, queues while the page is away; a host may refuse that flag).
- `tiers.applyCommands[*]` is `{workerAllowed, destructive, destructiveWhen?}`.
  `workerAllowed` is the negation of `WORKER_BLOCKED_COMMANDS`;
  `delete_node.destructiveWhen` is the reserved `doc-index` id, and
  `test/contract.test.mjs` pins it against `INDEX_NODE_ID` in the page source.
- Why this is data and not prose: "is this command read-only / billable /
  main-only / safe to give a worker" had four hand copies describing it (the
  bundled SKILL.md, each product's `.pi` copy, the host's injected rule block,
  the host's own tool allowlist), and they had already drifted into answering
  the same question two different ways.

### `policy` exports three more tables

- **`READ_METHODS`**, **`MAIN_METHODS`**, **`WORKER_BLOCKED_COMMANDS`** are now
  exported from `@scenemint/canvas-cli/policy`; `policy.d.mts` also declares the
  previously undeclared `HEALTH_FIELDS` and `RUN_TOOL_FIELDS`. A host that wires
  a tool allowlist reads these instead of copying the names.

### Skill

- SKILL.md opens with a command-tier section (the same four levels, plus the
  destructive apply commands) and tells the model not to read
  `references/commands.md` end to end — the host's file reader truncates, so it
  should match the scenario table first and then read that one section.
- `references/commands.md` gained a section index at the top, and the "Main and
  delegated worker sessions" section moved up into the scenario table, where a
  weak model actually looks before it delegates.

## 0.12.0

No CLI code changed. The version exists so a downstream can tell which canvas
build it is talking to: **this one knows `run-tool --kind capture-frame`**, the
local free tool that grabs a still out of a video node. Contract, command
fields, feature surface and `exports` are identical to 0.11.0.

- `references/commands.md` §6c documents the two ways to address the frame:
  `metadata.atMs` (a timestamp) and `metadata.count` (evenly spaced stills).
- `capture-frame` runs on the page, not through the gateway, so it is billed at
  nothing and `read` reports it with `billable:false` like the other local tools.

## 0.11.0

Additive. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, the 20 apply
commands and every command field are unchanged, and so is the `exports` surface.

### `run_tool` — the node toolbar's secondary operations

- **`run_tool`** is a new wire method with its own parameter face,
  **`RUN_TOOL_FIELDS`** (`nodeId`, `kind` required; `prompt`, `resolution`,
  `aspectRatio`, `metadata`, `title` optional; **`approval` mandatory**). A tool
  costs money exactly like `run_node`, so it carries the same declaration of
  user authorization — "it is only a tool" is not a reason to relax it. CLI:
  `run-tool NODE-ID --kind KIND [--title NAME]`.
- The legal `kind` values are deliberately **not** enumerated in this package.
  That registry lives in the page (three of them: video/audio aux, image edit,
  and the main generators); a fourth hand copy here would drift. An unknown kind
  comes back as `tool_not_found` with the available list attached.
- `--title` names the produced node directly, so a tool run no longer lands as
  an untitled node the agent then has to find and rename.
- **`bridgeErrors` 21 → 23**: `tool_not_found` and `tool_not_applicable` (this
  tool does not apply to that node's kind or state).

### Other additions

- `read` replies now carry **`tools[]`** — which tools that node accepts, each
  with `billable`. The locally-run free ones (`trim-audio`, `trim-video`) never
  reach the gateway and are reported as `billable:false`, so an agent can stop
  asking the user to approve something that costs nothing.
- `timeline` clips carry **`inMs` / `outMs`**, so a clip's trim is readable
  instead of inferred from durations.

## 0.10.1

Additive. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, the 20
commands and every command field are unchanged.

### `focus_node` stops failing silently

- **`ApplyResult.focused[]`** — `{command, nodeId, framed, reason?}`, one entry
  per `focus_node` in the batch, present whenever the batch held one. `framed`
  is the only proof the human's camera moved: `focus_node` is the one command
  whose effect is not in the document, so the batch's `ok:true` says nothing
  about it. Until now the reply carried **no field at all** when the framing did
  not happen, so an agent could only tell the user "I moved your view there"
  about a screen that never moved.
- `reason` appears only on `framed:false`, and the two values are different
  problems: **`unmeasured`** — this page has a camera but no measured geometry
  for that node yet (it is off-screen in a virtualised canvas, or was created in
  this very batch); it can work later. **`no_camera`** — this host embedded the
  bridge without a camera at all; no `focus_node` will ever work in it, for any
  node. Contract: `CANVAS_CONTRACT.focus.unframedReasons`.
- Skill: the scenario table finally has an entry for "定位到 X / 跳过去看看 /
  这个在哪" (business object → `ls`/`grep` → `focus_node`; a task the user
  means → `tasks` → its `node` column → `focus_node`), and every CLI subcommand
  and apply command is now gated to appear in that table (`contract.test.mjs`).

## 0.10.0

Everything below was developed after 0.9.0 was published. Until this release it
sat in a tree that still said `0.9.0`, which is exactly the failure this file
exists to stop: a downstream that reinstalled "0.9.0" got a copy where `health`
did not exist and `changes` had no `epoch`, with no error to point at.

`protocolVersion` stays **2** and `bridgeVersion` stays **3**. Nothing is
removed and nothing changes meaning; every item is additive.

### New read method

- **`health {maxIssues?, groupMinMembers?}`** — read-only, idempotent,
  worker-allowed, no undo step. Answers "what is wrong with this canvas right
  now" as a table of violations rather than as geometry the caller has to reduce
  itself. Reply:
  `{canvasId, rev, seq, scanned:{nodes,groups,edges}, counts, totalIssues, issues[], truncated?, omittedIssues?, healthy}`;
  each issue is `{kind, nodeId?, groupId?, otherId?, message, metrics?, fix?}`.
  Judging happens in the page over the **whole** graph (`snapshot`'s 2000-node
  clamp cannot health-check a bigger canvas), so `scanned` / `counts` are never
  clamped and `truncated` only ever means the **detail list** was cut.
- CLI: `scenemint-canvas health [--limit N]` (`--limit` → `maxIssues`, 1–1000,
  default 100). The CLI decorates the reply with a `report` text block for hosts
  that hand prose to a model. Branch on `issues[].kind`, never on `message`.
- Policy: `health` joins the read allow-list, and `./policy` exports
  `HEALTH_FIELDS` (`maxIssues`, `groupMinMembers`), which is enforced — an
  unknown field is `invalid_request`.

### New command field

- **`resize_group.absorbStrays`** (boolean, default `false`) — added to
  `COMMAND_FIELDS.resize_group`, so `resize_group` is now
  `{nodeId, size?, fit?, absorbStrays?}`. Before the resize, every **parentless**
  node whose centre falls inside the frame joins the group, and the reply carries
  `absorbed:[{command,nodeId,nodeIds}]`. Frame gestures still change no
  membership on their own. CLI: `resize-group <id> --fit|--size WxH` plus
  `--absorb-strays`.
- The **stray criterion is now one rule everywhere**: a node is a stray of a
  frame when its **centre is inside the frame**. `health`'s `stray_over_frame`,
  `tidy`'s `strays[]`, the `frame_strays` change entry and `absorbStrays` all
  judge by it. `health` used to judge rectangle intersection, so it reported
  nodes the prescribed repair could not touch.

### Change feed: a seq alone is not a cursor

- **`changes` and `snapshot` return `epoch`** — a fresh random id per feed
  instance. Resume with the pair `{sinceSeq, sinceEpoch}` (CLI:
  `--since-seq N --since-epoch E`). A mismatch is `truncated` with
  `truncatedReason:"feed_restarted"`, **and so is a non-zero `sinceSeq` sent
  without `sinceEpoch`** — the page cannot prove the number belongs to it. The
  old `sinceSeq > seq` heuristic silently reported "23 things happened" for a
  feed that had been rebuilt over 57 unseen edits.
- **`snapshot` returns `rev`** alongside `seq` and `epoch`, so
  "snapshot → work → snapshot" proves freshness in one call and "re-snapshot,
  then resume the feed" closes.
- **New change notes**: `frame_strays` / `frame_escaped` (a human's frame drag or
  grip pull left the canvas mismatched — records only, `actor:"human"`), and
  `bulk_change` (one transaction touching many nodes is merged into at most one
  `add` / `delete` / `batch` row carrying `nodeIds` and no `fields`). Merging
  never crosses an action, and a single-node action inside a wide transaction
  keeps its plain `nodeId` row with its `fields`.

### Tidy reporting

- **`apply.tidied[]` carries an entry for every `tidy` command** in the batch —
  `{command,moved,resized,strays[]}`. Previously only the `scope` form reported
  and a whole-canvas re-layout answered with nothing at all.
- **`tidySummary`** — a rendered one-line-per-entry text block travels with
  `tidied[]` on **both** paths a tidy arrives by (a plain `apply` batch containing
  a `tidy`, and the CLI's `tidy`). The JSON never reaches the model; a host
  compresses the reply into "applied 1 command", which carries neither counts nor
  stray ids.
- **`./contract` exports `formatTidySummary(tidied): string`** (typed in
  `src/contract.d.mts` together with `CanvasTidyRun`), so a host pastes the same
  string the page renders instead of re-deriving the wording. The CLI only
  computes it as a fallback for a page too old to send one.

### `./contract` additions (subpath unchanged)

- `CANVAS_CONTRACT.changes` — `actors`, `kinds`, `notes`, `truncatedReasons`,
  `cursor:{seq,epoch,sinceSeq,sinceEpoch,flags}`, `cap`.
- `CANVAS_CONTRACT.health` — `issueKinds` (in severity order, which is the order
  the detail list is sorted by, so a clamp keeps the worst) and
  `scanIsWholeCanvas:true`.
- `CANVAS_CONTRACT.limits["health.maxIssues"]` (`{min:1,max:1000,default:100}`)
  and `CANVAS_CONTRACT.limits["health.overlapMinRatio"]` (`0.02`, a bare number —
  two nodes count as stacked only when the intersection covers this fraction of
  the smaller one's area).
- `CANVAS_CONTRACT.commands.resize_group` gains `absorbStrays` in `fields` and
  `optional`.

### Unchanged on purpose

`exports` (`./policy ./contract ./client ./session ./media ./common ./host`),
`protocolVersion` (2), `bridgeVersion` (3), the 20 apply commands, the 6 draft
kinds, the 21 bridge errors and the 24 CLI exit codes are all exactly as in
0.9.0.

## 0.9.0

Twentieth apply command and the contract keys for it: `resize_group
{nodeId, fit?|size?}`; `tidy --scope all|groups|selection [--fit-frames]`;
`tidy` / `upload` accept `--wait` / `--wait-ms`; `./contract` publishes
`limits["group_nodes.minMembers"] = 1`, `limits["group.oversizeRatio"] = 3` and
the `PAGE_AWAY` constant group.

## 0.8.1

`tasks` read method (who submitted a generation, status, timestamps). Export
surface unchanged.

## 0.8.0

`./host` subpath (`injectSession`, `extractPayload`) for hosts that expose the
CLI as a pass-through Agent tool; node / group tags on every read path and
through `apply`.

## 0.7.0

Connection-layer subpaths `./client`, `./session`, `./media`, `./common` — an
implementation, explicitly not a stable API.
