# Changelog

Versions are the only identity a downstream has for "which API surface is
installed". **A version number is never reused for two different trees**: if a
command, a field, an export or an `exports` subpath changes, the version changes
with it. `test/pack.test.mjs` enforces that — it pins the `exports` surface AND
the feature surface (methods, command fields, contract blocks) per version, and
fails when either drifts without a bump.

## 0.18.3

_2026-10-16 — synchronize the integrated canvas bridge and layout contract with the public CLI._

- `CANVAS_CONTRACT.layout` publishes the shared body-bounds layout policy used by the canvas UI and bridge: node gaps 160 × 96, group gaps 200 × 160, group padding 56, and `fitFrames: false`.
- Generation drafts retain `audioInputData` alongside `audioSpeaker`, so CLI edits can carry the audio model's structured inputs through the current bridge.
- Includes the 0.18.2 scene3d presence/contact/station-still contracts and the existing `.localhost` development-origin support. The protocol, bridge versions and package export subpaths are unchanged.

The matching frontend changes are integrated on `ui-review-polish`. Updating the CLI package does not deploy that frontend.

## 0.18.2

_2026-10-15 — contact messages that say how deep and what to send, who is on stage when, station stills that look
past walls (decisions A102 ④ ⑧ ⑨, A100 as revised, A103; the user's 2026-10-15 real-machine run: four scenes reworked
about 400 times in two hours because seated figures and penetrations in the scheduled frames got neither a push nor a
suggestion and no message said how deep, indoor station stills showed the top of the front wall, and a scene whose
later shots have different people could not say so). Includes the web-only prompt-box fix that followed 0.18.1
(A99). Tagged as `canvas-cli-v0.18.2` in SceneMint._

`protocolVersion`, `bridgeVersion`, the `exports` surface and the convention (`scene3d@1`, revisions 79–86) are
unchanged; no command or wire method is added. `scene3d_apply` takes two new fields — `set_figure.offstage` and the
acts' `do` — so the daemon's policy changed with them (see Packaging and deploy).

Wrap-up after the canvas batch's review (decision A105), still 0.18.2: `screen` (the TV / monitor prefab) is no longer
an occluder for the station still direction; a depth that rounds to 0.00 reads 「不足 0.01 m」; a figure off stage at
the start that penetrates as it enters is named by its enter act, with the stored-spot suggestion only when it appears
on its stored spot. The summary below is corrected where the review found it inexact.

### Contact messages with depth and fixes (A102 ④) — `scene3d.contact`

- Every blocking `body_penetration` message carries the depth after the part, in metres with `depthDecimals` (2)
  decimals: 「人物 甲（jia） 腿部穿入 椅子（chair） 的座面 0.12 m；…」. Depth is measured on the blocking geometry itself:
  for every penetrating pair of a body segment (pelvis→spine→neck→head, hip→knee→ankle) and a part box of the object
  (furniture parts shrunk by 2 %, cylinders as cylinders), the shortest distance that separates them (separating
  axes: the box's face normals and segment × edges); the deepest pair, over every frame the problem shows up in.
  Below the ankle is not sampled: a figure standing in a 0.2 m platform reads about 0.07 m. A depth that rounds to
  0.00 (under 0.005 m) reads 「不足 0.01 m」 — it still blocks.
- The second half of the message says what to do, with a `fix` (one `scene3d_apply` action to send as is) where
  there is one; `contact.fixes` lists the four forms:
  - Seated on a seat with a front (chair / sofa / bed), facing more than `SEAT_FACING_MAX_DEG` (25°) away from it and
    penetrating that seat: 「他的朝向偏离 椅子（chair） 正面 40°（侧坐，…）：把 椅子（chair） 转到 rotation.y = 40°…」 and
    `fix: {op:"transform", id:<seat>, rotation:{y:<deg>}}` (`seatRotation`). A suggestion only: the seat is the
    director's choice and the repair stage never turns it. A seated figure whose legs enter a floor slab because its
    seat is sunk in it: said so, with the seat's lift as `fix` (`furnitureLift`). Any other seated penetration says
    the figure follows its seat (moving the figure does nothing).
  - Only in the scheduled frames (the stored blocking is clear, an act walks the figure in): names the act — 「调度
    walk-1（0.5 s 起走到 (3, 0, 0)）把他带进 台子（stage）：to 的 y 是 0（没写 y 就落在地面），写成 0.2 就站到 台子（stage）
    顶面上（S01 结束、S02 开始 / 结束）」 — and, when its end / via point lies on the penetrated object and the top there
    is at most `ACT_Y_MAX_M` (0.5 m) or the object is a floor slab, platform or stairs, a `fix` writing that top as
    the y (`actY`: `{op:"update_act", id, to?, via?}`). Higher tops (tables, cabinets) are told to move the end point
    out; paths crossing an object are told to add `via`. The same act is named on the matching `support_gap`. An
    enter act (`do:"@enter"`) is named the same way — 「调度 c-in（3 s 进场，出现在 (x, y, z)）的落点在 …」, no `via`
    advice (it takes none); a figure off stage at the start whose enter act has no `to` appears on its stored spot:
    「调度 c-in（3 s 进场，没写 to）把他放在存储的站位 (x, y, z)，那里穿进 …：给这条进场调度写 to…，或把存储的站位挪出来」
    (never 「存储的站位不穿」 — the stored scene does not check a figure that is off stage).
  - Standing figures keep the 0.18.0 suggestion (nearest clear standing spot within `SUGGEST_MAX_M`, `standPosition`),
    the same spot as 0.18.1 except one edge: a figure this batch touched whose ≤ 0.1 m push was refused because it
    would collide in a shot frame now gets that refused spot (0.18.1 searched from 0.1 m out); either way the
    suggestion is checked against the stored scene only. A figure off stage at the start gets it only when it
    appears on its stored spot (an enter act without `to`).
- `floorSlab`: a level box whose prefab is `floor` (any height), or role `set` with no prefab or `platform` and at most
  0.3 m tall. Its top is the support of what stands on it: a standing figure sunk into it is measured against its top
  however deep (`support_gap`, `figure_grounded`); furniture and props whose centre is over it and whose bottom is in
  it are set on its top by the `grounded` repair (reason 「box 的底面陷进 地板（floor）（地板顶面 y = 0.1）：落到地板顶面
  （y = 0.5）」), and those not repaired (a human edited them, the batch did not touch them) get the new health code
  `sunk_in_floor` (warn, with the lift as `fix`). A slab whose top is at or above y 0 may sit partly below the ground
  on purpose: it is not grounded and never `object_below_ground`.
- `read NODE` (and `NODE/scene`, `NODE/checks`), `scene3d_apply` replies, a `scene3d_conflict`'s `error.checks` and
  the `checks` of `run-stills` / `run-shot-refs` replies now come from one function: the same scene gives the same
  messages and the same `fix`es everywhere (0.18.0 / 0.18.1 added the standing-figure suggestion and the support-gap
  coordinates in the apply reply only). Script-to-video's batch 2 reads them back and writes them into its plan.

### Presence (A102 ⑧) — `scene3d.presence`

- `set_figure {id, offstage:true}` (stored as `figure.offstage`; `false` / `null` clears it): the figure is not on
  stage at the start. `add_act {who, at, do:"@enter", to?, facing?}`: it appears at story second `at` at `to` (a point,
  `y` optional; its current position without one) facing `facing` at once; `add_act {who, at, do:"@offstage"}`: it
  leaves at `at`. Figures only; an enter act takes only `to` / `facing` besides id / who / at / do / note, an exit act
  only `note`; walking in, sitting down and picking up are separate acts. `enums.actSentinels` gains `@enter` /
  `@offstage`.
- Before its entrance / after its exit the figure is not rendered (shot stills, station stills, previz, sheets, desk
  playback; what it holds goes with it), not contact-checked, not framed (station framing, framing reminders) and out
  of the axis / cut / motion reminders; the desk still draws it while editing so it can be selected.
  `endFrameExclusive`: a shot's end frame is the same story second as the next shot's start and does not count an
  entrance / exit at exactly that second — write them at the start of the shot they belong to.
- Replies: `run-stills` / `run-shot-refs` `notes[]` get 「镜 1：未出场：丙（bing，S02 进场）」 per shot with someone off
  stage (「开始未出场：…；结束未出场：…」 when the two stills differ; 「S02 第 1.5 s 进场」 mid-shot), and a
  `run-shot-refs` row carries `offstage:{start, end}` (the off-stage figure ids of its two stills) — list only those on
  stage in a colour legend. The scene text (`read NODE/scene`) reads 「开场不在」, 「进场 在 (x, y, z)」 (a facing as
  `facing …`), 「离场」; the apply summary's act line reads 「3–3 s 进场 在 (x, y, z) 面朝 …」.
- A scene with neither field renders and checks exactly as in 0.18.1 (pixel goldens drawn by 0.18.1 hold).

### Station still direction (A100 as revised, A102 ⑨) — `scene3d.overview.direction` / `cutaway`

- Chosen once per scene, shared by every shot: turn first, move in second, cut last. ① Eight directions 45° apart
  from the default (30° right of the front), 45° down, nearest to the default first (equally near: the side with a
  door / window or no occluder first); a shot is blocked when more than 25 % of one subject's sight lines (figure
  joints, head top and soles at start and end; prop centre and corners) hit an occluder — `wall` `door` `window`
  `pillar` prefabs, or role-`set` boxes / cylinders / backdrops taller than 1.2 m (`screen`, the TV / monitor prefab,
  only by that rule: a TV on a table does not turn the view, a 2 m display wall does); doors and windows by their
  frames. ② All blocked: the camera moves into the room (no closer than 0.3 m to the first occluder along the
  direction) at 45° / 50° / 55° / 60° down, everyone whole. ③ Still not: the default direction, with the occluders in
  front of the camera not drawn in the station stills (`cutaway.mode:"hide"`; shot stills and previz keep them).
- An unmoved default is pixel-identical to 0.18.1 and says nothing; otherwise `run-stills` / `run-shot-refs` put
  「本场俯视方向：默认方向（场景正面右偏 30°，右前方）被 前墙（front） 挡住 → 改为左后方（场景正面右偏 210°，俯 45°），
  同场每镜共用」 (or the move-in / cut-away wording) in `notes[]` — after any placement notes (triptych moved /
  stacked, no matching video node, not centred) and before the framing and presence notes, so not necessarily first:
  find it by the prefix 「本场俯视方向：」.
- Renderer revision 7 → 8 (page side): stills, station stills and previz drawn before read as stale once.

### Packaging and deploy

- Version four places, this heading; `VERSION_FEATURES["0.18.2"]` registers `sunk_in_floor`, the new fields, the act
  sentinels and the two `scene3d.overview` keys, and probes the whole `scene3d.contact` and `scene3d.presence` blocks
  from this version on. `EXPORT_SURFACE` is 0.18.1's. The rules block (SKILL「命令分级」) is unchanged.
- The daemon's policy (`SCENE3D_ACTION_FIELDS`) accepts `set_figure.offstage` and the acts' `do`; a 0.18.1 daemon or
  page answers 「Unexpected scene3d add_act field: do」. The CLI knows these two fields are new: its hint says 「这是
  0.18.2 起才有的写法」 and, by the daemon's `packageVersion`, asks for a canvas refresh (daemon ≥ 0.18.2) or a
  `disconnect` / `connect` (older daemon), and, when both were done, to drop them (the site is still 0.18.1). A plan
  without them works across 0.18.1 / 0.18.2 either way; a 0.18.1 page just gives no new `fix`es on read and keeps the
  default station direction.
- Deploy the canvas page and rebuild the collab image from the same commit, swapping both together (collab bundles
  the scene-3d modules and the contract this release changes). Script-to-video batch 2 re-pins 0.18.2.

## 0.18.1

_2026-10-14 — script-to-video's 3D cards back on the canvas, station stills framed per shot and fixed to 16:9, feet
snapped to what they stand on (decisions A95, A96, A97 fix ③; the user's 2026-10-14 real-machine run: every scene of
a portrait project came out `aspectRatio 9:16` and the figures in its stills were too small to read). Not tagged yet:
do not vendor it before the tag._

`protocolVersion`, `bridgeVersion`, the `exports` surface and the convention (`scene3d@1`) are unchanged; no command,
wire method or request field is added, and the daemon's own files are untouched (it reports the new `packageVersion`).

### Product 3D cards are drawn again (A95)

- `scene3d.embedded` no longer hides anything. A product scene's 3D card (`s3d-epXX-PYY`) is drawn and takes its
  place like any node — marquee selection, the minimap, the outline (whose 「缺站位图的导演台」 entry stays). The block's
  data (`idPattern`, `idFlags`) is unchanged; its text now says what the match still decides: how the scene's stills
  are framed (`overview`) and its stills / previz placed, that `run` makes no still / sheet card for it and that
  `run-batch` skips it. The card has no 「渲染」 button for that reason.
- **Ownership lines**: a thin dashed line from a 3D card to each station still (`stillOf`) and previz card
  (`previzOf`) it made, derived from those two fields and never stored — not in `graph.edges`, not a reference
  connection, not in `mentionCandidates`, not selectable or draggable. It follows the cards and goes with the 3D
  card (the cards stay). Each such card reads 「出自 <3D card title> · S01 开始」 (结束 / 预演). A product previz card no
  longer gets a stored `prov-<card>` edge; one 0.18.0 landed stays in the data and is not drawn (the pair would show
  twice).
- A previz card's toolbar has 「3D导演台」 too: it opens the desk at that shot's start.
- **Placement**: a product scene's 3D card now counts as an obstacle when a triple is placed (0.16.3–0.18.0 ignored
  it). The convention: put it left of the scene's first triple in the same row, or right above it — there it never
  blocks a triple; elsewhere a triple it blocks moves up / overlaps with the usual `notes[]` line, naming the card.
  In pixels: a card's outer frame is its data size + 2 (the 1 px border), the 48 px gap is measured between outer
  frames (exactly 48 does not block), and the canvas rounds the gap to whole pixels before judging it — a triple's
  left edge often sits on a half pixel (centred over the video), so a 3D card placed by rounding from it (47.5 px
  away) counts as 48 and does not block (it used to push the triple up 331 px). The page sometimes measures the
  video 1–2 px narrower than its data (498 for 500), shifting the triple about 1 px left: leave 49–50 px for the
  same-row placement.
  When the scene's 3D card, or one of its station / previz cards, overlaps another node, `run-stills` and
  `run-shot-refs` add a `notes[]` line (also at the end of `stillsSummary` / `shotRefsSummary`) naming who overlaps
  whom and asking for a canvas rebase (script-to-video's `canvas_rebase`); the canvas never moves them. The grid
  fallback's line (no video found) says the cards landed in the grid right of the 3D card.

### Station stills framed per shot, fixed 16:9 (A96)

- `scene3d.overview.camera`: `sharedPerScene` is replaced by `directionPerScene` (every shot of a scene looks from the
  same direction — 30° right of the scene front, 45° down, the front defined as before) and `sharedPerShot` (a shot's
  start and end stills share one camera). Target and distance are per shot.
- `scene3d.overview.bounds` frames only the shot's own subjects (`subjects`: figures, and role-`prop` boxes /
  cylinders without a prefab; furniture and set pieces are drawn but never framed) at the shot's start and end and
  at each cut's start and end (`cuts: true`). In the shot = visible in the shot's own camera (scene aspect; at start,
  end, cut boundaries and quarter points) or named by its `look` / `lookTo` / `follow`; when none is found, every
  figure and prop of the scene. `excludeKinds` / `excludePrefabs` now only size the ground grid.
- New `figureMarginRatio` (0.05) and `minFigureFraction` (1/3): every figure of the shot is whole in the frame first —
  feet and held objects included, each figure's box at least 5 % of the frame height away from every edge (an outer
  box calibrated against the real mannequin: 6 poses × 8 arm states × 5 body types) — and then the camera moves in
  along the same direction, re-centring in the image plane if that lets it come closer, toward the tallest figure at a
  third of the frame height. The third is a target, not a floor: when the figures are too spread out to reach it,
  everyone stays whole and `run-stills` / `run-shot-refs` add a `notes[]` line 「镜 n：本镜人物分布宽，人偶约占画面高 X%」
  (dispatcher decision, 2026-10-14). Four figures on the corners of a 2 m square still reach about a third; on a 3 m
  square they stay whole at about 27 %.
- New `aspectRatio` `"16:9"`, `stillSize` / `previzSize` `{width: 1920, height: 1080}`: station stills and a product
  scene's previz (`run --render video`, `run-shot-refs`, the desk's 出预演) ignore `scene.aspectRatio`; the desk's own
  shot stills (`run --shots`) and every other 3D node keep the scene's. Headless Chromium on a software renderer
  encodes a 1080p previz at about 115 ms a frame against the 250 ms-a-frame budget, so it stays 1920 × 1080.
- Product station still cards are 16:9 on the canvas (499 × 281) and their triples are laid out for that; a 0.18.0
  portrait card refreshed in place may now overlap its neighbour — the overlap line above names it.
- A product previz the page cannot encode no longer gets "switch the scene to 16:9" (it already is); the hint points
  to `run-stills` for the shot.
- Renderer revision 6 → 7 (page side): station stills, previz and stills drawn before read as stale — run each scene
  once (refreshed in place).

### Feet snapped to their support (A97 fix ③)

- New repair `figure_grounded` (`SCENE3D.repairs.codes`; constant `FIGURE_GROUND_MAX_M` 0.1): a standing, crouching or
  kneeling figure whose soles are 5 mm–0.1 m off the surface under them (floating or sunk; the floor, a platform /
  step top, a furniture top — the `support_gap` lookup) is put on it (`transform.position.y`). Only a figure the batch
  touched or whose support it touched, never one a human changed; sitting, lying and prone figures are left alone. It
  runs after `grounded` and before `pushed_out`, so sunk feet are lifted onto a platform instead of being pushed out
  sideways. Entries read 「X 脚底贴面（y a→b）」 in `formatScene3dSummary`.
- A farther gap stays a `support_gap` reminder; for the stored scene its message now ends with 「建议挪到 (x, y, z)
  （贴到<surface>上）」 and it carries a `fix` (a `transform` action to send as is). Gaps that only appear inside a
  shot (walked onto) get no suggestion.

### Cuts keep their cameras in a scene with blocking (T6)

- Since 0.17.0, once a scene had a blocking table (acts), a shot's camera came from the shot level only: its `cuts`
  never switched cameras (five cuts, one camera; no hard cut in the previz), while the same scene without acts cut
  between all five (script-to-video 3.38.0 acceptance, reproduced on a real stack). The camera now follows the cut in
  progress either way — its `cam` / `to` / `look` / `lookTo` / `fov` / `fovTo` / `moveEase` / `orbit` / `via` / `follow` /
  `shake` at its own progress, a follow measured from the cut's entry — while figures follow the blocking table and
  look points include the cuts' stealing moves (the renderer's `shotMoveOffsets`). Shots without cuts are unchanged
  byte for byte (I-29 and the animation goldens hold). Rides on renderer revision 7. Convention revision 78.

### Canvas page

- The generation panel under a node no longer covers it: its top stays 18 px under the node and only its height is
  capped above the bottom dock (content scrolls, the Run bar stays ≥ 12 px above the dock). With under 260 px left it
  goes right of the node, then above it (above the node's own top toolbar); with no room anywhere the canvas pans once
  when the panel opens (after the opening click is released; not at all when that press became a drag; never so far
  that the node's top toolbar — download, 3D导演台, tools — leaves the pane) and never again while it stays open.
  That pan is judged once the layout has settled (the placement unchanged for 3 frames, at most 60; a wheel first
  cancels it): judged on the first placement, a page still loading could find room that was not there a moment
  later and never pan (the first collab e2e run on a fresh dev server). The bottom dock is looked up again until it
  is there. The prompt box is three lines high (resizable to 60vh) instead of growing with its text. While a node is
  dragged its panel hides, and comes back on release.
- The canvas pane clips instead of hiding its overflow: focus or a caret in a panel hanging past the pane edge (an
  image tool panel opened near the right edge, the generation panel) used to scroll the pane, so every node appeared
  to jump while their positions and the camera stayed put.

### Packaging and deploy

- Version four places, this heading; `VERSION_FEATURES["0.18.1"]` registers the changed `scene3d.overview` keys and
  `scene3d.repairs`, and probes the whole `scene3d.overview` block from this version on (names alone let the camera
  and framing rules drift). `EXPORT_SURFACE` is 0.18.0's. The rules block (SKILL「命令分级」) is unchanged.
- No new wire surface, so a 0.18.1 CLI and a 0.18.0 page work together and the other way round — a 0.18.0 page just
  keeps hiding the product card and framing stills the 0.18.0 way. Deploy the canvas page and rebuild the collab
  image from the same commit, swapping both together: collab's `server.mjs` bundles `apps/web/libs` and the contract
  source (the collab stage of `infra/docker/web.Dockerfile`), and this release changes the scene-3d modules and the
  contract in it. Script-to-video re-pins 0.18.1 and moves existing 3D cards to the convention (3.38.0). Old
  portrait product stills refresh to 16:9 in place on the next `run-stills` / `run-shot-refs`.

## 0.18.0

_2026-10-13 — station stills, previz and data repair for script-to-video's 3D scenes (decisions A86, its
supplements 1 and 2, A87, A88, A90 ④). Two parallel lines — T1–T3 (bird's-eye station stills, one previz per
shot of a product scene, `run-shot-refs`) and T4–T7 (problems all at once, data repair, the human-edit mark,
per-episode identity colours, clean-up) — merged with their commits kept, then finalized. Not tagged yet: do not
vendor it before the tag; script-to-video re-pins it in 3.37.x._

### Bird's-eye station stills (T1)

- New contract block `CANVAS_CONTRACT.scene3d.overview`: the camera definition and the framing rule of a
  product scene's station stills. `camera`: the scene front is the active camera's target-to-position
  direction (`+z` for the default camera at (0, 3, 8) looking at (0, 1, 0); `+z` without a camera or with
  one looking straight down); the overview camera turns `yawRightDeg` 30° to the viewer's right of it,
  looks down `pitchDownDeg` 45° at the framing box's centre with a vertical `fovDeg` 35°, and backs off
  just enough to fit the box's 8 corners inside the frame less `marginRatio` (10 %) on every side
  (`sharedPerScene`: every shot of the scene, start and end alike, uses this one camera). `bounds`: the
  union of every shot's start (k 0) and end (k 1) figures (skeleton joints, padded), props and furniture
  (transformed boxes; a held prop sits in the hand); `excludeKinds` `plane` / `backdrop` and
  `excludePrefabs` `wall` `floor` `door` `window` `pillar` `stairs` `platform` do not count; a horizontal
  span under `minSpanM` (3 m) is widened about the centre and the ground is always inside. `grid: true`
  (a 1 m ground grid), `labels: false` (no name labels — figures and blocks carry only their stored
  `color`), `productDefault: true`.
- `run-stills` on a product scene (`scene3d.embedded`) renders every still from that camera; the figures
  are posed at the shot's start / end as before. The desk's stills for a product scene take the same
  path. Other 3D nodes keep the shot camera, and so do `run` / `run --shots` shot cards. A shot where
  nothing moves gives two identical stills — both land as usual (decision A86 supplement 2); nothing
  compares or skips them.
- Renderer revision 5 → 6: station stills, stills and shot cards drawn before read as stale; run them
  again.

### Product-scene previz, one clip per shot (T2)

- `run --render video` on a product scene is no longer refused: one `s3v-` previz card per shot, titled
  `epXX-PYY-SZZ运镜预演` (the stills' shot code: the scene number from the node id, the shot from an
  `S03`-style shot id or else `n`; not de-duplicated, downstream `@` it by title). `run` without
  `--render video` (stills, sheets) on a product scene is still `invalid_request` at `nodeId`; `run-batch`
  still skips it as `not_runnable`.
- Placement: the previz and that shot's two stills form a start / end / previz triple centred right above
  the shot's video (96 px gap); whichever lands first, the others line up with it. When the block is in
  the way of another node (a video column too narrow for three cards) it moves up for free space at most
  two rows, else overlaps right above the video — both add a `notes[]` line naming the shot and the
  blocker (`run-stills` gains `notes` and appends them to `stillsSummary`). The stills of a product scene
  are therefore the left two cells of the triple now (they used to be a centred pair). The 0.17.0 grid
  under the 3D node is kept for other scenes.
- New `data.previzOf {sceneNodeId, shotId, sceneDigest}` on a product previz card (`stillOf`'s shape without
  a frame), in `read`, `ls --long` and the card's `NODE/renders` row; no `sceneDigest` while the card shows
  another candidate than the one landed; `replaced: true` once its video was swapped (cleared with the
  media), like a still's. A product previz is current by `sceneDigest` + renderer revision, like the
  stills — any scene change makes it stale and `run` renders it again instead of reusing it.
- Length = the shot's `dur`; a shot under 2 s is rendered as is with a `notes[]` reminder (the product
  stretches it to the reference minimum when attaching it).
- The desk's 「出预演」 for a product scene lands the same card, title and place. A 0.17.0 product previz card
  (no `previzOf`, generic title) is renamed and moved into the triple on its next landing; a renamed one is
  left alone.

### One command for a shot's three references (T3)

- New command `run-shot-refs NODE [--shots all|SHOT-ID,…] [--force] --approved` (wire method
  `run_shot_refs`, main only; `RUN_SHOT_REFS_FIELDS` `nodeId` `shotIds` `force` `approval`; no new flag —
  `--shots` and `--force` read as in `run-stills`, and there is no `--frames`). For each listed shot
  (default all, in shot-list order) the page makes the start still, the end still and the previz, in that
  order (`SCENE3D.shotRefParts`), one at a time in its single render slot. The stills are `run-stills`'s
  (the same nodes and `stillOf`; bird's-eye on a product scene), the previz is `run --render video`'s card
  (product title, triple, `previzOf`): whatever an earlier `run-stills` / `run` landed is refreshed in
  place, never duplicated.
- Reply `{ok, nodeId, sceneDigest, shots, remaining?, orphans, duplicates?, checks?, notes?,
shotRefsSummary}`; `shots[]` is one row per shot `{shotId, n, start:{nodeId, url}, end:{nodeId, url},
previz:{nodeId, url, durationS}, created, skipped:[{part, reason, nodeId?}], failed:[{part, message}]}`
  (`null` for a part neither made nor already there). Parts that are up to date (stills and a product
  previz by `sceneDigest` + renderer revision, another scene's previz by its shot digest) or swapped (a
  still's `stillOf.replaced`, a previz card holding a human's video) are `skipped` (`up_to_date` /
  `replaced`, with the `nodeId` to wire); `--force` renders them all again in place. A part that fails
  goes to its shot's `failed` and the rest carry on; a shot blocked by data health fails all three
  (`checks` attached — the video reading of the self-check); a shot over the 30 s video cap fails only its
  previz. `ok:false` (`run_failed`) only when nothing landed and something was left undone.
- Budget per shot: 25 s for each still + 15 s and 250 ms a frame for the previz, capped at
  `SCENE3D.limits.shotRefsBudgetMs` (240 s). What the budget or a departing page cut off is `skipped`
  (`budget` / `page_away`) and listed in `remaining:[{shotId, part}]`; the same command again carries on
  with only those. The daemon and the CLI wait `SCENE3D.limits.shotRefsCallMs` (255 s) for this method
  only; every other method keeps the session's call timeout. `cancel NODE` stops it; `run` / `run-stills`
  on the same 3D node while it runs answer `already_running`. A shot whose start and end are the same
  picture is made and landed like any other (decision A86 supplement 2).
- `tiers["run-shot-refs"]`: L2, `--approved`, main only, `billable: false` (it renders in the browser and
  is not a billed generation; the only other tier with the key is `run-stills`). A page or daemon older
  than 0.18.0 refuses the method; the CLI's `hint` says which one to refresh or reconnect, and — when both
  were done and it is still refused, i.e. the site still runs 0.17.0 — that such a site can only make the
  stills with `run-stills` (it refuses `run --render video` on a product scene; another 3D node can still
  get its previz that way).

### Problems all at once, data repair, human edits, per-episode colours (T4–T7)

- **Problems come back all at once.** A `scene3d_apply` with several shape / vocabulary / range problems answers one
  `invalid_request`: `error.path` is the first, the new `error.issues[]` lists every `{path, message}` (prefixed with
  `commands[i].`), the message names them (up to 12). Several fields of one action are each reported; acts judged as
  merged (`validateAct`), shot animation fields and the whole blocking table are collected to the end of the batch
  too. A single problem reads exactly as before (no `issues`). The CLI's `hint` for an unknown op / field (the daemon
  stops at the first) names every other action of the batch with one.
- **The page repairs data before the self-checks** (`scene3d[].repairs[]`, `SCENE3D.repairs`). Only data that leaves
  who sits / stands / holds what as written, only what the batch touched, never what a human changed in the desk:
  `grounded` (a box / cylinder whose bottom is below the ground, not tilted about x / z, not a `rock`, not held),
  `held_to_hand` (a held object stored within `HELD_SNAP_MAX_M` 0.3 m of its wrist), `pushed_out` (a standing figure
  inside furniture / a wall that ≤ `PUSH_MAX_M` 0.1 m of horizontal movement frees, the shortest of 32 directions,
  never creating a new penetration in any shot), `camera_merged` (a camera the batch created equal to an earlier one).
  Entries are `{code, id, field, from, to, reason}`; `formatScene3dSummary` adds a `修数据 N 处…` line. A deeper
  penetration is not moved: its `body_penetration` still blocks, with `建议挪到 (x, y, z)…` in the message and a new
  `checks.health[].fix` (`{op:"transform", id, position}`, the nearest free spot within `SUGGEST_MAX_M` 2 m). A `seat` on
  something without a seat is never rebound and the pose never changed: `invalid_support` now says
  `X 没座面：把它换成 chair / stool / sofa / bed 预制件，或给它加座面…`. Levels are unchanged.
- **Removing what a human did not touch needs no question** (`SCENE3D.humanEdit`). The desk marks every object / shot it
  changes (creating, moving, editing; giving a figure blocking marks that figure) with `editedBy:"human"`, stored in the
  scene, kept by the migration, shown by `read` and as `人改过` in `formatScene3dScene`, left out of shot-card digests.
  An Agent can neither write nor clear it; its `duplicate` copies drop it. `remove` / `remove_shot` against an unmarked
  object / shot just run; against a marked one the whole batch is `approval_required` (nothing written; the message names
  them) until `approval.userApprovedNodeIds` lists the scene node — `apply --approved` now puts the node of every
  `scene3d_apply` with a `remove` / `remove_shot` there. `remove_act` stays "tell the user first". `destructiveOps` is
  unchanged; its rule text (contract, SKILL, commands, PROTOCOL, README) says the above.
- **Per-episode identity colours** (`SCENE3D.identity`): `namedColors` / `namedLabels` are 12 nameable colours in
  allocation order (the 8 palette colours plus 棕 / 黄绿 / 墨绿 / 卡其), `propColors` / `propLabels` the white / light-grey
  prop blocks, `extrasColor` / `extrasLabel` the grey one-off extras share past 12 figures. `scene3dColorLabel` names them
  all and `scene3dIsIdentityColor` accepts them. New `allocateEpisodeIdentityColors(subjects, previous?)` (mains first,
  fixed for the episode; extras grey past 12, the rest of an overflow grey and in `overflow`; props alternate, fewest in
  the same scene first) and `checkEpisodeIdentityColors(scenes)` (`color_drift`: one id, two colours across scenes;
  `color_shared`: two figures of a scene on one nameable colour). The page keeps stored colours and still colours an
  object without one by the 8-colour name rule; `identity_color_clash` covers all 12 nameable colours.
- **Axis and cuts are reminded on the preview only** (A87 ③): `formatScene3dSummary`'s base line no longer has the
  `越轴 …；N 处跳切（…），另 M 处豁免（…）` segments; structured `checks.axis` / `checks.cuts` stay in the reply, `read`'s
  `sceneSummary` and `NODE/checks` still show them. A `run --render video` reply's `notes[]` carries
  `越轴提醒（不拦）：…` and `接缝提醒（不拦）：…` for the shots it rendered. The four recorded `apply` fixtures' `scene3dSummary`
  were rewritten to the new base line (checked against `formatScene3dSummary`).

### Merge finalization

- `run-shot-refs`'s `notes[]` and `shotRefsSummary` carry the `越轴提醒（不拦）` / `接缝提醒（不拦）` lines too, for the
  shots of the call that have a current previz (made now, or `up_to_date`); a previz card holding a human's video and a
  shot whose previz failed do not count. (Each line had done half: only `run --render video` had them.)
- Product triple placement, two more `notes[]` lines: no video node found for a shot (none with id `v-<shot code>`, a
  title starting with the shot code, or wired to that shot's stills / previz) — the stills / previz fall back to the
  grid beside the 3D node, which product canvases do not draw — one line per call naming those shots; and a new card
  that follows an already landed member that is not where the triple belongs (a 0.17.0 still pair centred over the
  video is refreshed in place and never moved, so the triple sits 274.5 px to the right; or a human moved it): it
  still follows, never moves the others, and the line says how far off-centre and what it now overlaps.
- The human-edit mark ignores a reorder: with a blocking table `reorder_shots` pins the follow-edit shots' current
  story `start` (each shot keeps shooting the same story moment), and a shot that differs only by that pin is not
  marked. Setting `start` to something else in the desk still is.
- Repairs: a `pushed_out` reason gives the depth and the actual move separately (`穿进 X 0.019 m（≤ 0.1 m 才自动修）：
沿最短方向水平推开 0.024 m（含 5 mm 余量，推完不贴边）`) — the move is up to about 0.105 m and is not over the limit; a
  `camera_merged` keeps the earlier camera's name, and when the batch had named the merged one (not the default
  `机位n`) the reason says that name was not kept (send `set_camera name` to the kept camera).
- Seats: a figure bound to a default `chair` / `stool` / `sofa` / `bed` is never blocked by its own seat. The pelvis sat
  5 % of the seat's depth ahead of its centre while a seated figure's ankle is 0.311 m × body depth × `scale.z`
  ahead of the pelvis, so a sofa (0.77 m deep seat) caught a shorter figure's shins at its front edge and a bed
  (2 m mattress) caught everyone's. The pelvis now sits no further behind the edge than that reach less 2 cm — along
  the seat's front for chair / sofa / bed (a chair is unchanged; a sofa's sitter moves forward, a bed's sits on the edge
  at its foot), towards where the figure faces for a stool's or a plain top face (only when the shins would be inside).
  Rendering, look points and the contact check share the point; it rides on renderer revision 6.
- The director desk's tab strip (seven tabs with 「取景」) keeps a gap between the English labels (it was 0 px and
  「Framing」 touched the panel edge); it scrolls rather than overflowing when labels grow.
- `hostText`: the `scene3d[].repairs[]` paths are covered by a fixture recorded on the 0.18.0 page
  (`test/fixtures/host-text/apply-repairs.json`) and are out of `PENDING_PATHS`; `run-shot-refs` stays out of the registry
  (as `run-stills`). The convention's revision 26 says `scale` is metres (decision A90 ④), as the page has always read it.
- Version four places (`package.json`, `cli.mjs`, `CANVAS_CONTRACT.packageVersion` and its typing), this heading;
  `VERSION_FEATURES["0.18.0"]` registers both lines and probes four new items (`scene3d.humanEdit`, `scene3d.repairs`,
  the two re-exported episode-colour functions, the `apply` reply paths for repairs / axis / cuts); `EXPORT_SURFACE`
  is 0.17.0's. The rules block (SKILL「命令分级」) drops a repeated "main session only" to stay within its 2066-token
  budget after both lines' changes.

### Upgrade and deploy

- Deploy the canvas (page and collaboration server) before script-to-video 3.37.x: an older page refuses
  `run_shot_refs` (`method_not_allowed`) and a product scene's `run --render video`.
- Renderer revision 6: station stills, stills and shot cards drawn by 0.17.0 read as stale — run each scene once after
  upgrading (refreshed in place). A product still landed by 0.17.0 stays where it was; the triple follows it (notes
  above) until someone moves the group.
- Once the 0.18.0 page is live, a CLI still pinned at 0.17.0 (script-to-video 3.36.0) cannot approve removing an
  object / shot a human changed: the page answers `approval_required` and that CLI's `apply --approved` only approves
  `delete_node` targets (`invalid_argument`). It works again when script-to-video 3.37.0 re-pins 0.18.0.

## 0.17.0

_2026-10-12 — train 2 of the 3D director desk: scene3d animation (blocking acts, multi-shot runs,
preview video, framing reports, shot cards), the B11 fix round with the echo-injection hardening, the
B12 merge of the 0.16.3 / 0.16.4 line (D-91) and the B14 reply fixes from the real-LLM trials (D-93).
Tagged `canvas-cli-v0.17.0`; shipped with script-to-video v3.36.0 and vendored by lingying._

Known limit: `add_act {to:<object>}` stops at the object's circumscribed radius + 0.5 m, so a figure
walking to a long piece of furniture head-on stops about 1 m further out than "0.5 m from its
footprint" suggests — give `to` as coordinates to stand closer (fixed in the next release, D-94).

`protocolVersion` stays **2**, `bridgeVersion` stays **3**, the `exports` surface is unchanged and
the convention stays `scene3d@1` (fields are only added). The daemon closure changes (`policy.mjs`,
and `daemon.mjs` for `packageVersion`): a session still served by a 0.16.x daemon or an unrefreshed
0.16.x page refuses the new ops and fields — refresh the canvas tab, then `disconnect` / `connect`
if it still refuses.

**Includes everything in 0.16.2.** The 0.16.2 line (tagged `canvas-cli-v0.16.2`, shipped with s2v
v3.34.0) was developed in parallel and merged into this one (D-87): `run-stills` / `run_stills` and
`RUN_STILLS_FIELDS`, `run --frame start|end` (since 0.17.0 an end still lands on its own `s3i-` card
— title `… · 镜n · 结束站位`, card `scene3d.frame:"end"`, a `frame:"end"` row in `NODE/renders` — and
`frame` with `render` `video` / `sheet` is `invalid_request` at `frame`; the start card is untouched),
the document library on CDN (`contentUrl`, `docs read --if-version`, the 50,000-character cap and its
`too_large` / `quota_exceeded` / `upload_failed` / `content_unavailable` codes, `limits.uploadChapters`),
the audited director-desk fixes and the cancelled-resume fix. `run-stills` image nodes (`stillOf`) and
the per-shot `s3i-` cards of `run` live side by side and are not merged into one. `test/pack.test.mjs`
keeps the tagged `0.16.1` and `0.16.2` entries as they were; `0.17.0` is their union plus this line.

**Includes everything in 0.16.3 and 0.16.4.** The parallel line went on to tag `canvas-cli-v0.16.3`
(s2v v3.35.0 pins it) and `canvas-cli-v0.16.4`, and was merged into this one too (D-91, B12, test
`0a484abe`): `scene3d_apply` `states` / `cuts` on shots and `seat` / `lean` / `heldL` / `heldR` on
`set_figure`, the contact health codes (`body_penetration`, `invalid_support`, `held_conflict`,
`subshot_invalid`, then `seat_unbound`, `support_gap`, `held_offset`), the `scene3d.identity` and
`scene3d.embedded` contract blocks with the three identity functions re-exported from `./contract`,
the 开始站位 / 结束站位 wording and the "not a billed generation" wording (A81), seat binding on plain
boxes / cylinders (A83), the card full-size viewer and the director-desk dropdown theming. The union,
spelled out where the two lines met:

- `scene3d.checks.healthCodes` is 0.16.4's twenty in 0.16.4's order followed by this line's four
  (`shot_missing_dur`, `act_conflict`, `hold_invalid`, `object_below_ground`): 24 in all. A consumer
  that switches on codes should treat unknown ones as warnings.
- `SCENE3D_ACTION_FIELDS` is the union per op: `add_shot` / `update_shot` take 0.16.3's `states` /
  `cuts` and this line's `start` / `via` / `follow` / `shake`; `set_figure` takes `seat` / `lean` /
  `heldL` / `heldR`; `add_act` / `update_act` / `remove_act` are this line's. The pack test now
  probes the whole health-code list (0.16.3's probe) instead of its length.
- **Renderer revision 5** (page side). Both lines had raised `RENDER_REV` from 2 on their own — this
  line's 3 is the figure animation (leg IK, transitions, gait, the lying / prone arm table), the
  parallel line's 3 / 4 are furniture, seat binding, sub-shots and endpoint states, then the forward
  `lean` and the stool seat. The merged renderer draws both, so its pixels match neither side's 3 or
  4: every still, shot card and staging still from either line reads as stale until rendered again.
  `lean` also applies on top of the animation's blended controls; the seat placement applies to
  static (unscheduled) scenes. The contact checks' joint table is re-measured on the merged
  mannequin (its lying / prone arm table no longer lifts the body).
- `sceneDigest` is unchanged for scenes that use neither line's new fields (cross-version CAS:
  `tests/studio/scene3d-digest-cross-version.test.ts` pins a fixture's digest as computed by both
  parents' code), so a `baseDigest` a host stored before the upgrade still applies. This is about
  digests saved before the upgrade, not about old and new pages sharing a canvas: a live 0.16.x page
  on a schema-2 canvas is read-only (the collab server's version gate) and sees a stale scene
  mirror, so its digests are not usable — reload it. A batch of actions can still produce a
  different stored scene than before: objects without `color` now get their identity colour
  (0.16.3), so the manual's example digests changed.
- Contact-check and sub-shot messages go through this line's echo gate (names through `echoText`,
  ids through `echoId`, a sub-shot's `<shot>/<cut>` id segment by segment) like every other health
  message. A contact message that opens with a figure or object now says so first:
  `人物 甲（actor） 腿部穿入 桌子（table） 的 top；…`, `对象 …` for a held prop (a default name that
  already reads `人物（f1）` is not doubled), because `message` is hostText verbatim and a name
  opening the line could otherwise forge a `下一步：… --approved` line. `scene3dColorLabel` (re-exported from `./contract`) echo-gates the
  off-palette half: a stored `color` with line breaks reads `色号<one line, ≤ 32 code points>`.
- Stays as in this line: a scene-3d `run` / `run-stills` never writes the 3D node (so 0.16.4's
  manual sentence "the 3D node's own still becomes the last one" no longer holds on a 0.17.0 page),
  `stillOf.renderRev` stays page-internal (not in the `read` / `ls --long` view), and an end still
  lands on its own `s3i-` card titled `… · 镜n · 结束站位`. The SKILL rules block is 2051 estimated
  tokens (budget 2066).
- Review fixes after the merge (B12 fix round 1):
  - `checks.health[].path` is index-only again: contact, endpoint-state and sub-shot issues read
    `objects[i].figure.seat`, `shots[j].end.objects[i].contact.objects[m]`, `shots[j].cuts[c].look`,
    `shots[j].states[k].who`, `shots[j].dur` — never a stored id (a host prints `path` raw; an id
    with a line break could forge a line there). An issue found only in one shot's frames (or its
    sub-shots) starts with that `shots[j]` and blocks only that shot; one in the stored scene or in
    several shots is the object's own path and blocks every shot. Contact messages name furniture
    parts in Chinese (座面 / 靠背 / 桌面 / 腿 …; a plain box is not split into parts).
  - On a scene with blocking acts the contact check samples each shot's start / end at the
    scheduled world (the one the renderer draws): an act that walks a standing figure into a table
    now blocks like a figure stored inside it. A pair already blocked by `body_penetration` no longer
    also gets a `figure_collision` per shot.
  - `run` refuses a script-to-video product scene (`SCENE3D.embedded`) with `invalid_request` at
    `nodeId` and points to `run-stills` — its shot cards would land visibly on a canvas that hides
    the scene; `run-batch` skips it as `not_runnable`.
  - Shot cards go stale when a chair is renamed into a swivel / office chair (the name changes its
    geometry): the card digest keeps that geometry key although it drops `name`.
  - `run-stills`' `stillsSummary` echo-gates the shot and node ids it names.
  - `formatScene3dScene` prints `lean` as a number, a shot's endpoint `states` and one line per
    sub-shot (`- 子镜头n …`).
  - A peer older than 0.16.3 refusing `seat` / `lean` / `heldL` / `heldR` / `states` / `cuts` gets
    the old-peer hint (refresh, then `disconnect` / `connect`, then drop those fields — a daemon
    that reports 0.17.0 may be a pre-merge one), not "X does not take seat; X takes … seat …". The
    old-site wording names the test line as 0.16.4.
  - `SCENE3D.identity.defaultNames` lists the names the page stores for unnamed objects (人物 /
    立方体 / 圆柱 / 平面 / 背景板): such a name is no name, the colour comes from the `id`.
    `./contract` re-exports `scene3dObjectIdentity(object)` and `scene3dDefaultColor(object)` so a
    host recomputes the page's colour from a stored object (and can tell a default colour from a
    chosen one).
  - Page side (no contract change): the director desk refuses drive-camera C / set start / set end
    on a shot split into sub-shots, debounces the lean field, shows a stored seat / held target that
    is not in its list, labels the act tab's vocab, and its product-scene render lands stills off
    the human undo stack, skips up-to-date ones and reports in 镜n / 开始站位 terms.
- Reply fixes from the L2 rerun (B14, defects P1–P8, D-93):
  - Identity colours: an `add_object` without `color` takes the colour its name gives unless another
    identity of the same role (figures among figures, props among props) already holds it — then the
    first palette colour nobody in the scene uses (`allocateIdentityColors`' rule; same name, same
    colour) — and stores it. Deterministic for a given scene; stored colours are never rewritten, so
    `sceneDigest` stays as it was for scenes that already carry colours. A stored clash (two
    identities on one palette colour) is a new health code `identity_color_clash` (warn, one per
    scene, 25 codes in all) whose message ends with the recolour action; `transform` takes `color`
    for it (`SCENE3D_ACTION_FIELDS.transform`). The warning covers only colours that at least one
    named object holds (the prompts' identity legend lists named objects only), so old scenes of
    unnamed props stay quiet. `./contract` exports `scene3dIsIdentityColor(color)` (palette, set grey,
    the golden-angle colours past the palette): since a stored identity colour is no longer always
    `scene3dDefaultColor(object)`, hosts use it to keep identity colours out of compact projections.
  - The apply summary's framing lines: when the batch recomputed some shots and others still carry
    framing reminders, a line names those shots and counts them (`取景：上面只算了本批动过的 n 镜；其余
m 镜里 镜k 另有 j 条取景提醒，read NODE/checks 看`); the header count stays this batch's shots only.
    Past 12 other shots it only points there (`其余 m 镜没重算`), so a one-shot edit in a large scene
    does not pay for framing every shot. A colour-only `transform` no longer adds the "other shots may
    have changed" line.
  - `operations` lists a step the CLI labelled with its default (`CLI_APPLY_DEFAULT_LABEL`, now
    exported from `policy.mjs`) under the summary the page derives from the commands, the same text
    as `undoneOps[].label`. The CLI still sends the default (older pages require a label). That
    summary leads with the turn's `scene3d_apply` (`…（另 N 条命令）` for the rest), lists up to three
    actions with the fields the patching ones gave (`update_shot shot-2（fov、framing）；transform
boss（position）`), and folds the node title to one line.
  - A walk-to-sit at a seat echoes `applied[].seat` (the seat's id) next to `applied[].to` (the stand
    point in front of it); `set_figure` echoes `applied[].fields` (the fields it was given), and so
    does `transform` (the groups it was given: `position` / `rotation` / `scale` / `color`). Both are
    hostText `visible`.
  - `undo` / `redo` entries whose scene changed carry `scene3d[].sceneSummary` (the `read`
    `sceneSummary`, word for word, framing count included), hostText `verbatim`.
  - `<command> --json <a workspace file path>`: `invalid_json` now carries `path: "--json"` and a
    `next[].command` that is the same argv with `--json <path>` swapped for `--file <path>` (node id,
    subcommand, `--approved`, `--label` kept); any other unparsable `--json` carries the path and the
    parser's reason in the message.
  - `orbit_cam_ignored` ends with the fix (`cam:null` / `to:null` in the same `update_shot`; a moving
    shot names both);
    `scene3dSummary` says `<id> 按 prefab 画（kind=<kind>）` (was `推为`, read as "drawn as one box").
  - An act whose figure already stands at its stop point (no walk; `applied[].dur` can be 0) reads
    `走到 counter（已在停步点，没走）` in the apply summary's act line, not a bare `0–0 s 走到 counter`.
  - Manual (B14 M1, M3–M6b; no API change, every number recomputed through the page code by
    `tests/studio/scene3d-anim-manual.test.ts`): the yaw / orbit convention (`rotation.y = θ` faces
    (sin θ, 0, cos θ); an orbit camera sits at x = c.x + r·sin θ, z = c.z + r·cos θ, 0° on the +z side, 90° on
    +x) and which way furniture prefabs face, in SKILL.md, the `scene3d_apply` Units and scene 6f (the orbit
    example now gives both end positions); scene 6h states the duration for one gen fed several preview cards
    (`max(4, ceil(sum of dur))`, within the 15 s / 30 s reference total and `videos.maxItems`; one gen per shot
    stays the rule); shot size is measured for figures only (a prop subject gets `主体 <id>`, no size, no
    `framing_mismatch`), and `framing_mismatch` fires only when every sampled frame disagrees; `set_figure` is a
    patch. SKILL.md (outside 命令分级, rules block unchanged) and 6f / the run reference gain a lookup that
    separates 静帧 (`run` → one `s3i-` card per shot) from 站位图 (`run-stills` → two image nodes per shot), and
    no longer calls `run --frame end` 「结束站位」 without saying it is still an `s3i-` card.

- **Behaviour change (relative to 0.16.2):** on a scene-3d node, `run` (with or without `--frame`)
  and `run-stills` no longer write the 3D node itself — not `outputUrl`, `renderedDigest`,
  `renderedShotId`, `renderedFrame` or `status`, and nothing is propagated to nodes wired to its
  output. The 0.16.2 README / command reference said `run --frame` records `renderedFrame` on the
  node and `run-stills` turns the node's own still into the last one landed; on a 0.17.0 page those
  fields keep whatever a 0.16.x page left there (or stay absent). Read `run`'s `outputs[]` or
  `NODE/renders`, and `run-stills`' `stills[]` / the `stillOf` image nodes. Writing the node swapped
  the reference of a generator wired to it and demoted it to dirty, and the whole-node rewrite
  swallowed the human's last undo step on that node (B10, D-87 merge). s2v v3.34.0's director-desk
  flow uses `run-stills`; it reads `renderedShotId` / `renderedFrame` only to describe the 3D node's
  thumbnail (its `ls` row and `read` facts) and leaves them out when absent; its vendored 0.16.2 manual and the internal `canvas_run_node` text ("read 这个节点
  看 outputUrl / renderedShotId / renderedFrame") go away with the 0.17.0 pin in s2v v3.35.0. The 3D
  card shows the first shot's `s3i-` card, else its start `stillOf` image, else the legacy still.
- `run-stills` continuation (`up_to_date`) now also checks the render revision: `stillOf` records
  `renderRev` (page-internal, not in the `read` / `ls --long` view), and a still with none (landed by
  a 0.16.2 page) or an older one is rendered again by a plain `run-stills` — before, a still drawn
  before the B6 mannequin change counted as up to date forever while `read` called the node's still
  stale. `run-stills` also goes through the I-24 / B5 write gate like `run` (`collab_offline` on a
  disconnected, unsynced, silent or version-gated page — nothing rendered or written), and its
  per-still 25 s budget starts when the shared render slot is acquired (time queued behind a preview
  video or another node's stills only counts against the 90 s total, so a still cut by it is
  `skipped` `budget` and resumable, not `failed`). New stills and new `s3i-` cards avoid each other's
  grid (cards go below a scene's stills; stills go below its cards).

- `scene3d_apply` gains three ops (16 in all): `add_act` (required `who`, `at`; `id`, `dur`, `to`,
  `via`, `gait`, `pose`, `arms`, `armL`, `armR`, `facing`, `gaze`, `hold`, `hand`, `gesture`,
  `note`), `update_act` (`id` + the same fields; `null` deletes a field, the reserved words `@drop` /
  `@keep` / `@none` say "put down / freeze facing / look ahead") and `remove_act` (`id`).
  `remove_act` joins `scene3d.destructiveOps` (and the tier table's copy of it).
- `add_shot` / `update_shot` accept `start`, `via`, `follow`, `shake`. The page answers
  `invalid_request` with a `path` for channels it does not implement yet instead of ignoring them.
- `run_node` accepts `shotIds` (1–60 distinct ids, each 1–128 characters), `allShots` (`true`),
  `render` (a string; the page takes `still | video | sheet`, default `still`) and `sheetFrames` (an
  integer; the page takes `3 | 5 | 9` with `render:"sheet"`). The policy checks shapes only; which
  shots exist, "one of `shotId` / `shotIds` / `allShots`" and the enums are the page's answer.
  `limits["run_node.shotIds"]` = `{min: 1, max: 60, itemMaxLength: 128}`.
- **Behaviour change:** `run_nodes` (`run-batch`) now refuses unknown params like `run_node` does
  (`RUN_NODES_FIELDS`: `nodeIds`, `groupId`, `concurrency`, `rerunSucceeded`, `clearCandidates`,
  `approval`). A batch renders 3D nodes as `allShots` + still, so it takes no 3D params. Checked
  against both downstreams: s2v's `canvas_run_nodes` (`.pi/lib/canvas-agent.mjs`, at 564ccc7) sends
  `nodeIds` / `groupId` / `rerunSucceeded` / `concurrency` / `approval`, and Lingying passes
  `run-batch` argv straight to this CLI, which only builds those keys — neither sends anything else.
- New CLI `run` flags, all taking a value (no new boolean flag in 0.17.0's own additions: both hosts
  read a flag outside their copied boolean table as taking a value, so a boolean written before the
  node id would eat it; `test/flags.test.mjs` pins the table). Relative to 0.16.1 the boolean table
  still grows by exactly one flag, `force` (0.16.2's `run-stills --force`). **Host action:** a host
  on a 0.16.1 table (Lingying 1.9 vendors 0.16.1 and jumps straight to 0.17.0) must add `force` to
  its `BOOLEAN_FLAGS` at the same time as it takes this tag — otherwise `run-stills --force NODE
--approved` reads `NODE` as the value of `--force`, and the host's approval gate, session injection
  and wall-clock tier see a command with no node id. s2v v3.34.0 already has it. The new `run`
  flags: `--shots all|a,b` (`allShots:true` or `shotIds`; with
  `--shot` it is a local `invalid_argument`), `--render still|video|sheet`, `--frames 3|5|9` (only
  with `--render sheet` → `sheetFrames`), `--await SECONDS` and `--out-dir DIR`. `--await` (integer
  0–240, default 0) is CLI-local and the whole command's wall-clock budget from CLI start: while the
  reply has `pending[]`, the CLI reads `NODE/renders` every 3 s and merges landed rows into
  `outputs[]` (`result:"created"`, or `"rerendered"` when the card already had a landed row while
  this one rendered) and failed rows into `failed[]` (`ok:false` only when every requested shot
  failed). A still shot's rows are matched by frame too: `run --frame end --await` takes the
  end-frame card (`frame:"end"`), never the shot's start card, and a start-frame run never takes the
  end card (before, the start card sorted first and was reported as this run's landing). Which
  landed row is this run's: when the page's `run` reply carries `pendingOutputIds`
  (`{shotId: outputId | null}`, the take each pending shot's card showed when the batch started;
  0.17.0 pages), a landed row whose `outputId` differs is this run's take even if the scene changed
  while it rendered (`stale:true`; a `notes[]` line says the take no longer matches the scene, B9-FX-23),
  and a shot whose card already held a take counts as `"rerendered"`; `pendingOutputIds` itself is
  dropped from the merged reply. Without it (older page) a landed row marked `stale:true` is an earlier
  take, not this run's output: the shot stays in `pending[]`. Shots merged by polling get a `notes[]`
  line saying `timings.perShot` has no time for them (B9-FX-55). Each poll's socket is cut at the remaining budget, so a page slow to answer `read`
  cannot hold the command past the deadline; at the deadline it answers with what is left in `pending[]` and a `notes[]` line saying
  to `read NODE/renders` later instead of resending `run`. `--out-dir DIR` (CLI-local, the directory
  may exist) saves each output card's current media through the page, like `download` (media_info +
  media_chunk; the page fetches through its media proxy, so the host policy applies — the CLI never
  fetches `outputs[].url` itself), to `DIR/<card title>-<outputId first 8>.<ext>` (a still
  on the 3D node itself, `outputId:null`, uses the first 8 hex of the URL's SHA-256), adds `path`,
  skips a file already there, and puts a per-item failure in `pathError {code, message}`
  (any code `download --out` can answer — a page code such as `media_failed` / `media_missing` /
  `media_unsupported` / `page_away`, `invalid_media`, `too_large`, a workspace code — or `timeout`
  when the `--await` budget ran out before it started) while the run stays `ok:true`.
  `run … --wait 90` is a local `invalid_argument` with a `hint` pointing at `--await` (`--wait` is
  the boolean page-away wait).
- New CLI `snapshot --edges all|touching|none` → `edges` (the page echoes `edgeScope`; default `all`).
- The daemon reports `packageVersion` in `status` and in the `connect` reply, read at start from the
  `package.json` next to `src/` (no version constant in the daemon closure). `hostText.status`
  gains `packageVersion`.
- `formatScene3dSummary` (the apply `scene3dSummary` header) adds `，取景 N 条提醒（不拦，见下）` after
  `<b> 处拦下，<w> 处提醒` when the report has framing reminders. `处提醒` counts health only, and the
  `镜n ⚠ …` lines printed below it read as contradicting a bare `0 处提醒`. Without framing reminders
  the line is byte-identical.
- `cancel` / `cancel-batch` (`cancel_node` / `cancel_batch`, `INTERRUPTS` in `common.mjs`) skip the
  session's serial slot: the daemon delivers them while another mutation of the session is still
  open, and they neither wait for nor take the slot. A 3D still / preview `run` stays open for up to
  30 s; before this, a `cancel` from the same session queued behind it and reached the page only
  after the batch had finished (nothing left to stop, `not_owned`). They stay mutations (tombstoned,
  a lost reply is `unknown_outcome`). Takes effect once the daemon is restarted (`disconnect` /
  `connect`). The same holds for 0.16.2's `run-stills`: a same-session `cancel NODE` now reaches the
  page while it runs and stops it (the still in flight and the rest `cancelled`), where 0.16.2's
  daemon queued it behind the call (see the 0.16.2 entry).
- The old-peer `hint` (a 0.17.0 op / field the local policy accepts, refused by the peer) now asks
  the daemon's `status` once on that failure path: `packageVersion` ≥ 0.17.0 means the stale peer is
  the page, so the hint only says to refresh the canvas tab; a `status` that answers without
  `packageVersion` is a 0.16.x daemon, which refuses before the page sees anything, so the hint leads
  with `disconnect` / `connect` and mentions refreshing only as the follow-up; when `status` itself
  does not answer (version unknown) it still names both ways out, refresh first.
- `run-batch` refusals of keys outside `RUN_NODES_FIELDS` get a `path` (`run_nodes.<key>`) and a
  `hint` listing the accepted keys and pointing 3D video / sheets at `run NODE --shots … --render …`.
- `scene3d` contract additions: `enums.gait` / `shake` / `hand` / `gesture` / `render` /
  `sheetFrames` / `actSentinels`, `ranges.at` / `start` (0–600 s) / `viaT` (0 < t < 1),
  `limits.acts` (200) / `viaPerShot` / `viaPerAct` (8), `units.time` (`"s"`) /
  `shotProgress` (`"unit-interval"`). The page reads its limits and story-second range from here.
- `./contract` re-exports two more renderers from `scene3d-text.mjs`: `formatScene3dScene(scene)` (a
  `read NODE/scene` scene as one line per object, camera, shot and blocking act — a 14-object,
  6-shot scene stays under 3 KB) and `formatScene3dChecks(checks)` (verdict line plus every health
  issue, the axis verdict, every cut and the framing / motion reminders). `formatScene3dRenders`
  stays page-side for now. The typings add `Scene3dFramingIssue`, `Scene3dMotionIssue`,
  `Scene3dShotFraming`, `checks.framing` / `checks.motion` and `apply.scene3d[].framing`.
- `hostText` gains the framing / motion reminders and framing fact rows for `apply` and `read`
  (`…checks.framing[].shotId/code/message`, `…checks.motion[].code/level/message`,
  `…framing[].shotId`, plus `nodes[].framing[].n` on `read`).
- `scene3d.checks.healthCodes` gains `shot_missing_dur` (block when rendering video — for the shot and
  every earlier shot without a `dur`, or one too short for a frame; warn when the scene has a
  blocking table), `act_conflict` and `hold_invalid` (16 in all before the D-91 merge; see above for the merged list); `missing_ref` also covers act
  `who` / `to` / `facing` / `gaze` / `hold` and shot `follow`. New `motionCodes` (8),
  `motionLevels: ["warn","info"]` and `motionConstants`: reminders that never block; the page emits
  all eight (B6, `MOTION_CODES_COMPLETE` in the page's `motion.ts`). `checks.motion` appears only on scenes with a blocking table, so
  reads of existing scenes are unchanged.
- `scene3d.checks.healthCodes` gains `object_below_ground` (warn, 17 in all before the D-91 merge): a box / cylinder not
  tilted about x / z sinks more than 25% of its own height below the ground — `position.y` is its
  centre, so `y: 0` leaves half of it underground. The `rock` prefab is exempt.
- `scene3d.checks` gains the framing segment: `framingCodes` (8 — `cam_inside`, `cam_below_ground`,
  `cam_too_close`, `subject_out`, `head_out`, `subject_blocked`, `foreground_fill`,
  `framing_mismatch`; reminders that never block, `cam_too_close` / `foreground_fill` only from the
  grid mode of `read NODE/framing`) and `framingConstants` (`FULL_MIN_H`, `LONG_MIN_H`,
  `TOO_CLOSE_M`, `BLOCKED`, `FOREGROUND_FILL`). New `scene3d.framing.sizes`: the shot-size ladder
  (9 sizes, downstream s2v / seedance wording) with its coarse size, cut / in-frame height
  fractions and a body-part description. Contract data only — the page emits no framing code yet.
- The CLI adds a top-level `hint` to `page_away` replies (the daemon's message is unchanged): a
  queued write says how to bring the page back and to fetch the result with the same
  `--request-id`; a read says to come back to the tab and resend. When a 0.16.x peer refuses a
  0.17.0 op or field, the `hint` names both ways out (refresh the tab, then reconnect the daemon).
  The CLI says that only when its own 0.17.0 policy accepts the item; a local refusal (a misspelled
  op, a field the op does not take) keeps the "X takes: …" hint and points at that item. Items born in
  0.16.2 get the same treatment with "0.16.2 起才有" wording when a 0.16.1 peer refuses them:
  `run --frame` (`Unexpected run_node field: frame`), `docs read --if-version` (`Unexpected
documents_get field: ifVersion`, `path` `documents_get.ifVersion`) and the whole `run-stills`
  method (the 0.16.1 daemon's `invalid_request` "… supported method …", the 0.16.1 page's
  `method_not_allowed` "Unknown canvas method"). A 0.16.x daemon reports no `packageVersion`, so as
  for 0.17.0 items the hint then leads with `disconnect` / `connect`.
- `hostText.read.verbatim` gains `nodes[].rendersSummary`: the page's one-line-per-row text for
  `read NODE/renders` (shot, output, state, card id, url and `stale`, or the error with its first
  `next` argv), so a host that truncates the leftover JSON still shows which row is which.
- `hostText.undo.visible` gains `undoneOps[].left[]`: nodes the undone step created that are still on
  the canvas, because a write outside the undo stack (a 3D re-render landing rewriting the downstream
  gen it feeds) replaced them whole. The step is only partly undone; the Agent says so instead of
  reporting a clean undo.
- `hostText.read.visible` gains `nodes[].renders[].lastFrameUrl` (a video card's last frame, same as
  `outputs[].lastFrameUrl`, B9-FX-55).
- `hostText.undo` / `hostText.redo`: `verbatim` gains `scene3dSummary` and `visible` gains
  `scene3d[].renders.stale[]`. An undo / redo that changes a scene now reports which shot cards it
  left stale and the same 「产物过期 … run」 line as `apply` (B9-FX-18). It also reports a scene-3d
  node whose scene did not change but whose cards' staleness did (undoing a `select_output` leaves
  the card stale again); a `select_output` offered there says it is a new apply that clears redo; and
  when the undo leaves nodes on the canvas (`left[]` / `undoneOps[].left[]`, D-88) the summary adds
  one line saying they were rewritten by a 3D landing, stay, and need the user's go-ahead before
  `delete_node`.
  **Hosts:** undo / redo replies now carry `scene3dSummary` (verbatim), `scene3d[].renders` and a
  top-level `left[]`. A renderer with no undo / redo branch for them must paste `scene3dSummary` as
  is and must not append it again in a generic dump of unrendered keys — a host that dumps leftover
  keys as compact JSON shows the argv twice, once JSON-escaped (and, on a 0.16.2 registry, only the
  escaped copy). Add the branch before pinning 0.17.0.
- Page reply text, second review round (B11-F1 / F3; no new fields, `scene3d@1` unchanged):
  - The 「产物过期 … run」 line (apply, undo, redo) sorts cards by where they go: an end-frame card's
    argv carries `frame:"end"` (before, following it rendered start frames and left the end cards
    stale); a card the user replaced is named apart and kept out of the argv (another type: ask, then
    `delete_node`; same type: re-rendering would switch away from the user's file, ask first); a card
    that already holds a take matching the current scene gets one `apply` of `select_output` instead
    of a re-render (the usual undo case); shots the Agent added in an earlier apply and never rendered
    are still named and kept in the argv.
  - A `NODE/renders` failed row whose scene changed after the failure says so and its `next[0]` is the
    original `run` argv, not the stale `update_shot` with the current digest. Rows report the
    `mediaType` the card really holds (`audio` for an audio file put into a card).
  - `scene3d_conflict` after the Agent's own `undo` / `redo` says the undone actions are not in the
    scene and to re-plan (`next`: `read NODE/scene`, then the apply), not to drop them.
  - `run-stills` runs beside a human's desk previz batch again (it was refused `already_running`);
    `cancel` on that node returns `not_owned` naming the desk batch's shots, `next[0]` `read NODE/renders`.
  - `formatScene3dSummary`'s base line reads `越轴 不判（轴线端点不存在）` when an axis end is missing
    (`missing_ref` on `scene.axis[i]`) instead of `未声明轴线`. The `framing_mismatch` suggestion is a
    short suffix, `；要<档>：机位离 <id> ≈<m> m 或 fov≈<deg>°`, and the distance scan reaches down to
    0.3 m from the subject (a 特写 from a normal distance now gets a distance, not only a 3° lens).
    `checks.axis.message`'s motion note counts only warn-level cross-cut `axis_motion` the placement
    check did not already list.
- A `scene3d_apply` that changes nothing (every action sets a value the scene already has) carries
  `scene3d[].unchanged: true` (`Scene3dApplyReport.unchanged`, registered in `hostText.apply.visible`):
  nothing is written, there is no undo step, the digest stays. `formatScene3dSummary`'s base line then
  reads `<nodeId>：N 个动作打完场景没有变化（没写、不进撤销栈）→ sceneDigest=…` instead of
  `应用 N 个动作` (B9-FX-51).
- A 3D `run` (one with `--shot` / `--shots` / `--render` / `--frames` / `--frame`) that reached the page
  but got no answer (tab closed, discarded or reloaded, or a timeout) comes back as `render_interrupted`
  (`retryable:true`, exit 1) instead of `unknown_outcome` (exit 4): 3D renders are local, not a billed generation and
  idempotent per shot, so resending only reuses the shots that landed. `error.outcome:"unknown"` stays;
  `error.next[0]` is the same argv without `--session` / `--request-id`, `next[1]` is
  `read NODE/renders`, and the top-level `hint` names Chrome's 『始终保持活跃』. A bare `run NODE` on a 3D
  node carries none of these flags, cannot be told from a paid run and still gets `unknown_outcome`
  (B9-FX-48, errata E-113).
- `undo` reply gains a top-level `left[]` (registered in `hostText.undo.visible`): nodes created by a
  step the undo consumed but could not revert (`skipped`) that are still on the canvas. It is the
  `undoneOps[].left[]` case (D-88) when that insertion was all the step held — the reply is
  `undone:0, reason:"all_skipped"`, and before this it named no node.
- `changes` notes gain `undo_restored` (seven in all): on `kind:"update"` with `fields:[]`, an undo
  emptied the node (a concurrent whole-node write left Yjs nothing to restore) and the page's undo
  guard wrote it straight back. It replaces that undo's `delete` row (same `seq`); before, the feed
  showed `delete` then a `page` `add` for a node nobody deleted or created (B9-FX-56).
- `hostText.undo.visible` gains `scene3d[].fallback`: `true` when the undo emptied the node's scene
  entry (`scene3dScenes`, B5) and the scene is now read from the node's mirror, possibly an older
  scene; re-read before the next apply (B5 hand-off H-B5-2; the manual's digest-relay lines say so).
- Manual (`SKILL.md`, `references/commands.md`):
  - New scene 6g (blocking acts: `add_act` / `update_act` / `remove_act`, default durations, the
    reserved words, shot `start` / `via` / `follow` / `shake`, `timeline`, the eight motion
    reminders) and scene 6h (preview video: the ideal script of one apply, one `run --shots all
--render video --await 180` and one apply that wires the gen nodes; `--await` is the whole
    command's wall-clock budget; video cards into gen, the timeline and Jianying; the prompt rules
    for a reference video: the "only reference for camera / framing / blocking" sentence, the banned
    words, no first / last frame, take length `max(4, ceil(dur))`). The 6g reply is recomputed from
    the page code by `tests/studio/scene3d-anim-manual.test.ts`; the 6h run reply is an
    isolated-stack recording pinned to the same scene.
  - 6h (B8): mixing a first / last frame with reference media is refused at submit on seedance
    (400, nothing billed) and seedance 2.5 frames need `adaptive`; reference videos take ≥ 2 s each (≥ 4 s for a
    seedance 2.5 edit task) and ≤ 15 s (2.0) / 30 s (2.5) in total, overruns come back as a
    single-node `run`'s `notes[]` (advisory, the run still submits; `run-batch` replies carry no such
    note, so check the total yourself before a batch submit); the canvas editor's one-click episode import leaves preview cards out, so they reach the
    timeline only by an explicit `timeline append` or a manual drag.
  - "Wire in one batch, write the prompt in another" gains its exception: a 3D render card already in
    a `run` reply can be connected and `@`-mentioned (label = `outputs[].title`) in the same batch.
  - 6f, the SKILL 3D bullets and the `run` reference describe per-shot cards (`s3i-` / `s3v-` /
    `s3c-`), `pending[]` instead of `unknown_outcome`, and connecting the card rather than the 3D
    node (B4 hand-off); the run / read / snapshot references document the new flags, the
    `NODE/renders` / `NODE/timeline` / `NODE/checks` / `NODE/framing` suffixes and `edges`.
  - The tier section (the rules block hosts copy verbatim) adds `remove_act` to the destructive
    bullet: 2051 estimated tokens after the D-91 merge (budget 2066, `contract.test` checks it). Lingying's rules file and
    s2v's `CANVAS_CLI_RULES` must take the new text at the tag; a host on a 0.16.1 boolean table
    (Lingying) must also add `force` to it (see the `run` flags bullet above).
- **Security (B9-FX-07, FX-15):** `run --out-dir` no longer fetches `outputs[].url` from the Agent
  host (a canvas writer could point a card at loopback / private / metadata addresses): each output is
  saved through the page like `download`, so the page's media proxy and its host policy apply; a
  refusal is that item's `pathError` (the page's code, e.g. `media_failed`). `read` rebuilds the
  verbatim `nodes[].rendersSummary` from the same reply's structured `renders[]` with the package's
  `formatScene3dRenders` (rewriting values one by one could be bypassed by ordering two card URLs,
  B11-F2-1), and rewrites the `renderedShotId` echo in `nodes[].sceneSummary`: a shot or card id
  outside the id grammar (`SCENE3D.idPattern`) prints `（id 不可用）` (`echoId`; flattening line
  breaks alone still let a forged `下一步：… --approved` sit on the row's own line, B11-F2-2), a URL
  that is not a canonical http(s) URL of ≤ 2048 characters prints `（url 不可用）`, and the page's
  error text and argv are kept on one line — so canvas data cannot add a forged render row or next
  step to the Agent's context. The structured url fields a host lists as they are get the same
  check: a `renders[]` row's `url` that is not a canonical http(s) URL becomes `null` (its
  `rendersSummary` row then reads `（无 url）`) and a non-canonical `posterUrl` / `lastFrameUrl` is
  dropped, on `read` and on the `outputs[]` of a 3D `run` (rows with `shotId`, `--await` rows
  included; a trusted host followed by a line break used to print a forged `下一步：… --approved`
  under the host's product list, B11-int recheck). Clean replies are unchanged byte for byte; the
  other structured fields are not touched. Page side (0.17.0 pages, for hosts that read the page
  without this CLI):
  `rendersSummary` is the same `formatScene3dRenders`, `sceneSummary` echoes `renderedShotId` with
  `echoId`, and the `scene3dSummary` stale-card line echoes card ids with `echoId` and card titles on
  one line; its rerun argv (and a failed shot's `next`) only carries shot ids in the id grammar — a
  card whose stored shot id is outside it is named by card id with no argv, a stored `n` that is
  not an integer prints the shot id, and the `--json` of a 3D `run` argv writes `'` as `\u0027` so no
  value can leave the quotes; `renders[]` and a reused run's `outputs[]` never carry a
  non-canonical `url` / `posterUrl` / `lastFrameUrl`; `update_node` refuses a `draft.outputUrl`
  that is not a trusted media URL or carries
  whitespace / control characters (`invalid_request` at `commands[i].draft.outputUrl`, the message
  `adopt_output` gives; `null` still clears); and a shot card whose url is not a trusted media URL is
  never reused by `run` (it is re-rendered, and its url is not copied into a preview's `posterUrl`).
  A stored shot `n` that is not an integer prints the shot id (new export `echoShotN`) wherever a
  shot number is echoed: the axis / jump-cut segments of `scene3dSummary` (`formatScene3dSummary`)
  and `sceneSummary`, the axis / check messages, a `run`'s pending note in `notes[]` and its
  `镜头不存在` `invalid_request` (whose shot ids go through `echoId`); `formatScene3dScene` and
  `formatScene3dChecks` flatten each of their lines, so a collaborator's value cannot add a line
  there either (B11-int final).
  B11 review: the echo helpers fold more and cut on code points — `echoText` / `echoMessage` also
  fold the bidi controls, U+200B, U+2060 and U+FEFF (ZWJ / ZWNJ stay), `echoMessage` prints every
  line terminator as `⏎` (new export `LINE_BREAK`: LF CR VT FF FS GS RS NEL U+2028 U+2029; a value
  that itself starts with a forged next step still starts with it, so hosts label the field), and
  `echoProse` turns every run of `-` not preceded by a letter or digit into U+2010 (`标题（--approved`,
  `：--json`). `formatScene3dScene` keeps two keys that fold the same (`pose`, `pose\n`) as `pose`,
  `pose#2`. Canvas-wide replies echo node titles and ids the same way: `health` `issues[].message`
  (page `label()`: title through `echoText`, id through `echoId`; the CLI folds an older page's
  message) and `report` (a `修复：` line whose argv has a word outside the id grammar is replaced by
  `修复：命令里有回显不了的 id，见 issues[].fix`), `tidySummary` strays through `echoId`, every
  `tasks` `table` cell through `echoText`; `next[].command` resend and `lastError.message` use
  `LINE_BREAK` (a NEL / VT can no longer ride along). `lastError.message` drops the break right after
  a `[CODE]` prefix and is clipped to 400 code points plus `…`.
- **Error guidance (B9-FX-22, 24, 25, 26, 29, 45, 49, 50)** — fields and hints only, no new codes:
  - Old-peer `hint`: every tier now ends with the site branch — still refused after the tier's own
    steps (one refresh; re-`connect` then a refresh; for an unknown daemon version a refresh and a
    `disconnect` / `connect`) means the SceneMint site itself runs 0.16.x (the 0.16.2 test line included; 0.16.1 for the 0.16.2
    tier), so stop asking for refreshes and use the old form (`run <nodeId> --shot <shotId>` for
    `--shots` / `--render`; drop `--frame` / `--if-version`; drop act / camera-move fields). The page
    still does not report its own package version, so the CLI cannot tell the two apart.
  - `page_away` and `status` (when `pageAway:true`, new top-level `hint`, registered in
    `hostText.status`): a closed tab, or the canvas reopened in a new tab, cannot take the session
    back. The branch is checkable and queue-safe (B11-F2-4): only when the user says the tab was
    closed or `resumeExpiresAt` has passed (`reconnecting` / `pageAway:true` alone are also a
    discarded or reloaded tab, which resumes and runs its queued write once), re-pair with a plain
    `connect` — under a host the argv never carries `--session` (`SESSION_NOT_ALLOWED`); the host
    probes its stored session itself — and, run directly without a host, with
    `connect --session <this session>` (it answers `reused:true` while the page was seen within
    60 s — after a close the daemon takes up to ~105 s to notice, so once the user confirms the
    close the hint says to resend the same `connect` a minute later until it answers
    `reused:false` with a new `connectionCode`, never "not closed, wait" — and otherwise stops the old daemon and drops its queue; a direct plain `connect`
    leaves the old queue live), and in the new session check with `ls` / `read` before resending a
    write (3D runs may be resent as they are).
  - `apply`: `Unexpected <command> field: <k>` for non-3D commands gets `error.path`
    (`commands[i].<k>`) and a `hint` listing that command's fields and every refused key of that
    command (`connect` + `sourceHandle`: the output handle is the source node's); `Unknown or nested
apply command` gets `commands[i].type` and the list of types; an unknown scene3d field lists all
    refused keys of that action at once. Page side, for the nested shapes the CLI cannot check
    (`orbit`, `moves[]`, `via[]`, `transform`) and the page's own action-field check: every unexpected
    key at once plus the allowed ones (`unexpected field: radius, height (allowed: center, r, from,
to, y)`), `error.path` at the first one. `export-jianying` `jianying_refused` `untrusted-host`
    carries `error.next` (`timeline list`, then regenerate / upload the clip).
  - `file_not_found` / `workspace_boundary` from a workspace path (`--file`, `--out`, `upload`, …)
    carry `error.path` (resolved absolute path) and `error.workspace` (session root) plus a `hint`
    worded for the argument (B11-F2-5): an output path (`--out`, `--out-dir`) is told to name a
    relative path inside the workspace, and only a `--file` JSON parameter mentions `--json`.
    `session.mjs` changes for this (daemon closure; the daemon does not call `workspacePath`).
  - `collab_offline`: `error.next[0].command` is the real argv of the refused command (no
    `--session`, no `--request-id` — the same id only returns the cached failure), not a
    placeholder; a pretty-printed `--json` is compacted to one line, and the page's text is kept
    when the argv cannot be one line (another multi-line word, B11-F2-3) or is over 4000
    characters. Page side: a probe that lands on
    the five-minute token relink rides out the reconnect (≤ 3 s) instead of refusing.
  - `persisted:false` on a 3D node points `next[0]` at `read <nodeId>/output`, not the whole node.
  - Prefabs: `add_object` refused at `.kind` for an unknown `prefab` gets a `hint` with the closest
    vocabulary words; a batch that draws an unknown prefab by `kind` gets the same as its last
    `notes[]` line. The command reference lists the 24 prefabs and 16 aliases.
- `test/pack.test.mjs` pins the 0.17.0 feature surface (animation vocabulary, `run_node.shotIds`
  limit, the three scene3d renderers, `run` / `snapshot` flags, `hostText.status.packageVersion`),
  the version in four places (`package.json`, `help.version`, `CANVAS_CONTRACT.packageVersion`, the
  installed daemon's `status` / `connect` reply) and the local `run … --wait 90` refusal.
- README: the checklist for adding a scene3d capability (ops / fields, read suffixes, run params,
  tiers and the rules block, reply fields).

## 0.16.4

_2026-10-12 — audit fixes over 0.16.3 (decision A78). Additive only: `protocolVersion` stays **2**,
`bridgeVersion` stays **3**, the `exports` surface is unchanged._

- **0.16.3 is now registered.** 0.16.3 shipped six new `scene3d_apply` fields and four new data-health
  codes while its `test/pack.test.mjs` entry only changed `packageVersion` and its CHANGELOG said the
  surfaces were unchanged (corrected below). The pack test now probes every op's field list
  (`scene3dActionFields`, from `SCENE3D_ACTION_FIELDS`) and `scene3d.checks.healthCodes`
  (`scene3dHealthCodes`); `VERSION_FEATURES["0.16.3"]` records the real difference from 0.16.2 and
  `VERSION_FEATURES["0.16.4"]` starts from it.
- **Product scenes in the contract.** New block `scene3d.embedded` (`idPattern`
  `^s3d-ep[0-9]{2,4}-p[0-9]{2,4}$`, `idFlags` `i`): a `scene-3d` node whose id matches is
  script-to-video's per-scene backing data (`s3d-ep01-P02`). The page has hidden it by this rule
  since 0.16.3 and now reads it from the contract: no card and no place on the canvas, each shot's two
  stills above its video, the director opened from a still's toolbar — and, new in 0.16.4, from the
  outline, which lists such a scene while it has no shots or a shot lacks a still (not rendered,
  deleted or cleared), opening the director at the first missing shot and frame. Agents still see it
  in `ls` / `read` / `snapshot`. The manual drops the sentences that described every 3D node with a
  card and stills to its right. Pinned by `VERSION_FEATURES["0.16.4"]` (`scene3dEmbedded`).
- **Identity colours in the contract.** New block `scene3d.identity` — the eight palette `colors`
  with their Chinese `labels` (paired by index; the order is part of the rule), the set-piece grey
  `setColor` and the rule's name `hash` (`fnv1a32-nfkc-trim-lower`: NFKC, trim, lower case, 32-bit
  FNV-1a over code points, modulo the palette, applied to an object's `name`, else its `id`).
  `./contract` re-exports the implementation the page colours with: `scene3dIdentityColor(role, name)`,
  `scene3dColorLabel(color)` (`色号#rrggbb` off the palette) and `allocateIdentityColors(previous,
names)` (a scene's names without clashes). Script-to-video kept a copy of these; it reads them from
  here from its next release on. Pinned by `VERSION_FEATURES["0.16.4"]` (`scene3dIdentity`,
  `scene3dIdentityFunctions`).
- **Start / end blocking, not start / end frame** (wording only, no surface change). The page now
  labels the two stills of a shot 开始站位 / 结束站位 (English UI: Start / End blocking) — the card
  badge, the batch-run dialog and download names — instead of 开始帧 / 结束帧: they are references for
  where people stand at the start and the end of the shot, not the video's first and last frames. The
  manual words `run --frame end` and `renderedFrame` the same way and tells the model to use these
  words with the user. `--frame start|end`, `run_node.frame`, `renderedFrame` and
  `scene3d.enums.frame` are unchanged. A still node downloads under its own title
  (`ep01-P02-S03开始站位.png`).
- **Self-check and conflict wording** (page side, no surface change). A contact problem is reported
  once — its `path` is the first frame it shows in (unchanged format), and when only shot frames have
  it the `message` ends by naming them (`（S01 结束、S02 开始 / 结束）`, three shots at most, then
  `等 N 镜`); people and things read `name（id）`, or the id when unnamed. A shot with `cuts` no longer
  repeats the scene-wide checks (objects, line of action, contact) once per shot. A three-shot scene
  with one dangling `seat` used to report seven identical `人物 的 seat 指向不存在的 …`. The
  `scene3d_conflict` message names the writer in Chinese (`场景已被本页的人改过` …, never
  `场景已被 unknown 改过`); `sceneWriter.actor` still carries the enum.
- **Whole-body contact** (page side; three new health codes). `body_penetration` used to test one
  torso point only, so a figure standing inside a chair or a table, a 1.2 m child under a 0.75 m
  table, a figure seated backwards (thighs through the chair back) or standing inside a pillar went
  unreported. It now tests the figure's bones — torso (pelvis → waist → neck), head, both legs
  (hip → knee → ankle) — placed from a joint table calibrated against the real mannequin (pose,
  arms, body type, scale, facing, `lean`, seat; within 2 cm), against every solid: `box` objects by
  their furniture parts, `cylinder` objects (stools, pillars, lamps, plants) as cylinders. One entry
  per figure and solid, naming the body and furniture parts (`腿部穿入 椅子（chair） 的 back`). Arms are
  not checked; held things do not count; the seat a figure sits on counts for its shins only;
  standing on a tread, sitting on a seat or lying on a mattress is contact. An 800-scene seeded test
  checks the reports against the real mannequin's bones (all overlaps deeper than 3 cm reported, none
  reported farther than 3 cm out).
- **Renderer revision 4** (page side; `RENDER_REV` 3 → 4, so every earlier still and blocking still
  reads as stale until rendered again). `lean` now leans forward for positive values, as the
  convention and the types always said — the mannequin used to add it to a torso pitch whose
  negative is forward, drawing positive leans backward; the eye point and the contact joints follow.
  `lean` applies to upright poses only (lying / prone figures no longer tilt and re-ground oddly). A
  seat drawn as a cylinder — the stool prefab's footprint — is sat on at the middle of its top face
  instead of at chair-seat height inside the cylinder, and contact checks no longer skip a figure's
  own stool. Sitting on a bed's edge and the lean look-point pivot are left for the next version.
- **Seat binding is optional (decision A83).** `pose:"sit"` without `seat` is the new warning
  `seat_unbound` (`建议绑定座面…`), not a block; the figure keeps its own height. `seat` on a plain
  `box` / `cylinder` without a prefab is no longer `invalid_support` — the figure sits on the middle
  of its top face; `seat` on any other prefab or a non-box/cylinder still is. New warnings
  `support_gap` (a standing figure's soles more than 5 cm off, or into, the surface under its feet)
  and `held_offset` (a held prop's stored position more than 0.3 m from that hand; compared in the
  stored scene and at each shot's start). The three codes are appended to
  `scene3d.checks.healthCodes` (pinned by `VERSION_FEATURES["0.16.4"].scene3dHealthCodes`); a
  consumer that switches on codes should treat unknown ones as warnings.
- **Wording (decision A81).** The Skill, the command reference, the CLI usage, this changelog and
  the contract's tier notes no longer call local work "free" / "costs nothing" / "never charges":
  local tools, 3D stills and `run-stills` are described as _not a billed generation_ (no paid
  approval), and SKILL.md tells the Agent never to say 免费 / 不花钱 / 零费用 / 不扣费 to the user.
  The page's agent-facing messages for a 3D still or a local tool still in progress say the same.
- **Deploy order.** A page older than 0.16.3 refuses the 0.16.3 fields (`invalid_request`,
  `unexpected field: states` at `commands[i].actions[k].states`), and so does a daemon older than 0.16.3
  (`Unexpected scene3d add_shot field: states`). Deploy the canvas (page and collab service) **before**
  script-to-video 3.35.x, which sends them, and have hosts reconnect after upgrading the CLI.

## 0.16.3

_2026-10-12 — test `03189f8b` (tag `canvas-cli-v0.16.3`); `e9d0913d` on top only removes the collab
bundle's browser `three` dependency and leaves this package directory byte-identical._

Two start / end references per product shot, placed above its video in a reserved shot column; the
product's director scenes stay editable through those references without a card of their own. Also
outline ordering, persistent sidebar panels, colored identities, furniture and pose rendering,
scale-table placement and the test branch Gateway model capability fixes. `protocolVersion` stays
**2**, `bridgeVersion` stays **3** and the `exports` surface is unchanged, but — unlike what this
entry first said — the `scene3d_apply` surface is **not**:

- `add_shot` / `update_shot` take `states`: at most 20 `{who, from?, to?}` endpoint states of a figure
  (`pose`, `arms` / `armL` / `armR`, `facing` / `gaze`, `seat` / `lean` / `heldL` / `heldR`; `null`
  clears one). `from` holds for the whole shot, `to` from its midpoint on, so the start frame shows
  `from` and the end frame shows `to`.
- `add_shot` / `update_shot` take `cuts`: 1..60 ordered sub-shots inside one video segment, each a shot
  of its own (the `add_shot` fields except `cuts`, a positive `dur` required, ids unique). The camera
  and moves follow the sub-shot under way; moves a sub-shot leaves out keep where the previous one
  ended.
- `set_figure` takes `seat` (the id of the chair / stool / sofa / bed a seated figure sits on, at its
  real seat surface), `lean` (torso pitch in degrees, −45..45, positive bends forward), `heldL` /
  `heldR` (a prop id in the left / right hand); `null` clears each.
- `scene3d.checks.healthCodes` gains four block-level codes: `body_penetration` (a figure's torso
  inside a solid furniture part), `invalid_support` (a `seat` that is not a chair / stool / sofa /
  bed) and `held_conflict` (one object held by two figures), judged on the scene as stored and at
  every shot's start and end; and `subshot_invalid` (sub-shot durations that do not add up to the
  segment's `dur`). A missing `seat` / `heldL` / `heldR` / `states[].who` target reports `missing_ref`.
- Page only: `RENDER_REV` 3 (furniture geometry, seat binding, sub-shots, endpoint states), so stills
  rendered before read as stale; still nodes record `stillOf.renderRev`; a product scene
  (`s3d-epNN-PNN`) is drawn as no card — its stills' toolbar opens the director at that shot and frame.
- A page or daemon older than this refuses the new fields; see 0.16.4 for the deploy order. Its pack
  test registered none of this; 0.16.4 does.

## 0.16.2

Integrates the author-owned 0.16.1 changes (PR #4), retains start/end stills and document CDN support,
and fixes cancelled resumes leaving retries and release-validation fixtures. External service acceptance is manual.

_2026-09-30 — the 3D director desk's CLI surface (F012 / F048, convention `scene3d@1`), finished for
script-to-video with a still of a shot's end and every shot's start / end stills landed as image
nodes of their own (decision A67 ②); and the document library storing each version's text as a CDN
file (decision A68)._

Includes the author-owned 0.16.1 director-desk hardening and remains additive over 0.15.1: everything 0.15.1 shipped (the A57 / A60 `localTools`)
is carried over unchanged. Two behaviour changes are marked **Changed** below: `run_node` refuses
fields outside `RUN_NODE_FIELDS`, and one document holds at most 50,000 characters (1,000,000
before). On version numbers: `canvas-cli-v0.16.0` and `canvas-cli-v0.16.1` are tagged trees of the
main line (0.16.1 at `ef21b70d`, consumed by s2v v3.33.0 and the Lingying 1.9 line); this 0.16.2 line
ported the same author-owned 0.16.1 changes (PR #4) independently on top of 0.15.1, and this one entry
covers the director desk, the document library on CDN and the stills. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, and the
`exports` surface is unchanged. The 30th apply command `scene3d_apply` edits the 3D scene inside a
`scene-3d` node, `read` / `ls --long` / `snapshot` report it, and the contract gains the `scene3d`
block; one new bridge error code (`scene3d_conflict`, 26 in all); one new CLI subcommand
(`run-stills`, 43 in all) over one new wire method (`run_stills`, main only); three new CLI flags
(`run --shot`, `run --frame`, `docs read --if-version`); the contract's `documents` block gains
`contentUrl`, four error codes and `limits.uploadChapters`.
`test/pack.test.mjs` pins the new surface in `VERSION_FEATURES["0.16.2"]`, which starts from the
`0.15.1` entry and adds contract blocks (with `scene3d`), the 30 apply commands and their tiers, the
13 scene ops from both the contract and `./policy`, `destructiveOps` on both sides,
`bridgeErrors.scene3d_conflict`, `RUN_NODE_FIELDS`, the `scene3d_apply.actions` and
`run_node.shotId` limits, the digest block, the `fov` range, the
`run-stills` subcommand and its tier, `MAIN_METHODS`, `RUN_STILLS_FIELDS`, the frame vocabulary on
both sides, the stills limits and skip reasons, `tiers.run.localKinds`, the documents' fields,
errors, text cap and chapter limit, `DOCUMENTS_GET_FIELDS`, and the new flags in the CLI's own usage;
the `0.14.0` / `0.15.0` / `0.15.1` entries are unchanged.

### 3D director desk: the CLI surface (S1–S4, convention `scene3d@1`)

#### `scene3d_apply` — the 30th apply command

`{type:"scene3d_apply", nodeId, baseDigest, actions}`, all three required. The Agent sends
**actions**, never a whole scene: the page applies them to the scene as it is now with the reducer
the 3D desk itself uses (`applyScene3dActions`), so a human's drag a second earlier is not
overwritten.

- 13 ops in three layers: `add_object` `transform` `remove` `duplicate` `set_camera` `set_scene`
  (structure), `set_figure` `set_axis` `set_focus` (what the scene means — facing, gaze, line of
  action, focus object), `add_shot` `update_shot` `reorder_shots` `remove_shot` (the shot list). An
  unknown op or a field the op does not take is refused by the daemon before the page sees it
  (`scene3d_apply requires 1..200 actions` / `Unknown scene3d action op` /
  `Unexpected scene3d <op> field: <key>`); vocabularies, ranges and point shapes are checked by the
  page — `invalid_request` at `commands[i].actions[k].<field>` for shape / vocabulary / range,
  `invalid_command` for what depends on the current scene (a missing id, `set_figure` on a
  non-figure, a non-permutation `order`, the 100 objects / 12 cameras / 60 shots per scene).
- Units: metres, y up, a figure's feet at `transform.position` facing +z; angles on the wire are
  degrees (stored as radians); `fov` is the vertical field of view in degrees (2–140) and `focal`
  (mm, 36 mm long edge) may stand in for it; points are always `{x, y, z}`.
- **`baseDigest`** is compare-and-set against the node's `sceneDigest` (FNV-1a 64 over the stored
  scene, keys sorted). `"new"` is accepted only for a node an `add_node` earlier in the same batch
  created. One `scene3d_apply` per node per batch.
- **Creating never overwrites**: a taken `add_object` / `duplicate` / `add_shot` id becomes `-2`,
  `-3`, …, and later actions in the batch that name the requested id reach the new one.
  References (`look`, `facing`, `gaze`, axis ends, `moves[].who`) to missing ids are kept and
  reported, not refused. `null` clears the axis, a focus, a facing / gaze or an optional shot field.
- One batch = one undo step; the node's `status` never changes (a still goes stale by digest alone).
  `remove` / `remove_shot` are the destructive ops; workers may send the command.
- The reply carries `scene3d[]` — per command `{command, nodeId, sceneDigest, applied[], checks}`,
  where `checks` is the three self-checks (data health, line of action, cuts) — and a page-rendered
  `scene3dSummary`, one line per entry.
- A page older than this CLI refuses the command as `invalid_request` "Unknown or nested apply
  command", and so does a local daemon still running an older package (a session that stayed
  connected through the upgrade). When the batch holds a `scene3d_apply` the CLI adds a `hint`
  naming both remedies: refresh the canvas page first; if it still fails, `disconnect` and
  `connect` again to get a new daemon.

#### New error code `scene3d_conflict`

`baseDigest` is not the node's current `sceneDigest`: a human or another Agent changed the scene.
`retryable:false`, `path: commands[i].baseDigest`, carries `currentDigest`, and `next` points at
`read NODE-ID` — re-read, re-plan against the scene it returns, send a new batch. Never resend the
old one.

#### `read`, `ls --long`, `snapshot`

- `read NODE` on a scene-3d node returns `scene` (degrees; every object carries its `role`),
  `sceneDigest`, `checks`, `objectCount` / `cameraCount` / `shotCount`, and with the `output` part
  `outputUrl`, `renderedDigest`, `renderedShotId` and `stale` (a still exists and was rendered from
  another scene). `read NODE/scene` returns only the scene part.
- **Side effect:** `scene` joins `params` / `output` / `tags` as a field suffix, so a path ending in
  `/scene` now reads that field — a business path whose last segment is literally `scene` must be
  read by node id. `/scene` on any other kind is `invalid_request` at `paths[i]`.
- `ls --long` scene-3d rows add `sceneDigest` and `shotCount`; a scene-3d `snapshot` summary is
  `{objectCount, cameraCount, shotCount, outputMode, url?, sceneDigest, stale}`.

#### `run --shot` and the `run_node` field list

- `run NODE --shot SHOT-ID --approved` sends `run_node.shotId`: the shot of a 3D scene node whose
  opening frame becomes the still (default: the first shot; with no shots, the active camera). A
  `shotId` on any other kind, or one the scene does not have, is `invalid_request` at `shotId`
  (the message lists the scene's shots). The still is rendered by the canvas page itself — no
  charge, still `--approved` — so a page without the 3D renderer answers `run_failed`.
- **Changed:** `run_node` now refuses any field outside `RUN_NODE_FIELDS` (`nodeId`, `approval`,
  `clearCandidates`, `shotId`, and `frame` below) with `invalid_request` "Unexpected run_node
  field: <key>", like `run_tool` and `tasks`. The check runs after the approval check, so a missing
  or wrong approval is still `approval_required`. `shotId` is a non-empty string of at most 128 characters
  (`limits["run_node.shotId"]`).

#### Contract and policy

- `CANVAS_CONTRACT.scene3d` (also exported as `SCENE3D`): the ops with their fields and required
  fields, the vocabularies (role, kind, bodyType, pose, arms, focus shape, move ease, aspect ratio,
  the 24 prefabs and 16 aliases), the prefab footprints in metres, ranges, limits, the id pattern,
  unit tokens, the digest algorithm and `"new"` sentinel, the self-check constants / health codes /
  levels / cut exemptions, `destructiveOps` and `conflictCode`. The page imports this very object,
  so the values a product reads are the ones enforced.
- `tiers.applyCommands.scene3d_apply` is
  `{workerAllowed:true, destructive:true, destructiveOps:["remove","remove_shot"]}` — the same array
  as `scene3d.destructiveOps` (`CanvasContractApplyTier.destructiveOps?` is new in the typings).
- `limits["scene3d_apply.actions"]` (1..200) and `limits["run_node.shotId"]` (≤ 128).
  `CanvasContractRange` gains the optional `maxLength` / `maxKeys` the `run_node.shotId` and
  `run_tool.*` rows already carried at runtime.
- `./policy` exports `SCENE3D_ACTION_FIELDS` (op → fields; the one place the field names are
  written), `SCENE3D_ACTIONS_MAX` (200) and `RUN_NODE_FIELDS`, all typed in `src/policy.d.mts`.

#### Skill

SKILL.md gains a 3D director desk section (read → one `scene3d_apply` per batch → conflict = re-read
and re-plan → `run --shot` → still into generation), with the self-check stance quoted word for
word from the convention (`test/contract.test.mjs` compares the two). The command reference gains
scene 6f with a copyable `desk.json` and the reply the page really returns for it, a
`scene3d_apply` reference section, the `scene3d_conflict` row, and `--shot` / `/scene` in the run
and read rows.

### End-of-shot stills and staging stills (decision A67 ②)

A still of a shot's end, not only its start, and every shot's start / end stills landed as image
nodes of their own in one command.

#### `run --frame` — a still of a shot's start or its end

- `run NODE --shot SHOT-ID --frame start|end --approved` sends `run_node.frame`. `start` (the
  default, the moment `run --shot` takes without `--frame`) is the shot's first moment, k = 0;
  `end` is the moment the moves and the camera move are complete, k = 1 — the camera at
  `shotCameraAt(scene, shot, 1)`
  (`to`, the orbit's `to` angle, `fovTo`, `lookTo` all at their end values) and every figure at the
  end of its `moves` with its facing recomputed there: the same evaluation the cut check uses for
  the outgoing shot's last frame. A shot with neither moves nor a camera move gives the same picture
  for both frames; it is rendered anyway.
- The daemon refuses a `frame` that is not `start` / `end` with `invalid_request` "frame must be
  start or end"; the page refuses it too (path `frame`), and refuses a `frame` on any kind other
  than scene-3d. `RUN_NODE_FIELDS` (above) is `nodeId`, `approval`, `clearCandidates`, `shotId`,
  `frame`.
- A still that lands inside the wait echoes `shotId` **and** `frame` (`"start"` when none was given).

#### `renderedFrame` on the node

- The 3D node records which frame its still shows: `renderedFrame` next to `renderedShotId`.
  `read` (whole node or `/output`) reports it; `ls --long` rows and the `snapshot` summary now carry
  `renderedShotId` and `renderedFrame` too — only when the node has a still. A still rendered before
  0.16.2 has no stored frame and reads `start` (only starts existed). `stale` is unchanged: it looks
  at the digest alone.

#### `run-stills` — a scene's start / end stills, each in its own image node

For script-to-video's video prompts, which name a start and an end staging reference per shot
(decision A64): one command instead of two `run` round trips per shot.

- `run-stills NODE [--shots all|SHOT-ID,SHOT-ID…] [--frames start|end|both] [--force] --approved`
  sends the new main-only wire method `run_stills {nodeId, shotIds?, frames?, force?, approval}`.
  Defaults: every shot (`--shots all`), both frames (`--frames both`). The page renders them one by
  one in shot-list order, start before end — the same render and upload path as `run`, each still
  with its own 25 s budget — and lands **every still in an image node of its own**: a `media-upload`, `succeeded`
  with its output (the shape `upload` creates), titled `<3D node title>·镜<n>·开始站位` /
  `…·结束站位` (fixed Chinese; consumers read `stillOf`, not the title), carrying
  `data.stillOf = {sceneNodeId, shotId, frame, sceneDigest}` (`replaced: true` instead of the
  digest once its picture was swapped, and neither once such a still's media was cleared —
  below), placed right of the 3D node — one
  row per shot, a column per frame. The grid cell is the card's frame on the canvas (data size plus
  the 1 px border), whether or not the canvas has measured it, so a new row added later and a still
  re-created after a deletion line up with the existing ones even off screen; once a scene has
  stills, new ones follow that grid. An occupied cell moves down the same column to the next row
  whose two cells are free — never on top of another node — and a scene just below another is laid
  out in the free space to its own right. The 3D node's own `outputUrl` becomes the last still (the
  human's card thumbnail).
- **Idempotent:** the same (3D node, shot, frame) again refreshes that node's image in place — the
  `upload --into` path: id, title, position, tags and edges unchanged, old history cleared; the
  reply says `created:false`. All stills of one call are rendered from the scene as it was when the
  call started (one `sceneDigest`).
- **Stills a human or an Agent replaced** (decision A71): the node's own 替换文件 (a file dropped on
  the card, or picked on it — marked the moment the file is chosen), `upload --into`, `update_node`
  writing an `outputUrl` and picking another history entry all swap a node's picture; on a still node
  they keep `stillOf` (it is still that shot's and frame's node — edges and `@{}` references are
  untouched) but set `stillOf.replaced: true` and drop `sceneDigest`. `run-stills` then skips it by
  default — `skipped` with reason `replaced` and that `nodeId`, the summary naming the shot and
  frame — whether the scene changed or not; `replaced` is not unfinished work (no `remaining`,
  `ok:true` when that is all there is). When the user asks for the stills again, `--force` renders it
  again in place and clears the mark (decision A71 as revised: asking the Agent to render them again
  is the explicit intent; there is no separate flag). A still replaced while the call was already
  running is left alone at landing, `--force` or not — the last action wins. Clearing the media is
  not a replacement, and clearing a replaced still drops its mark (`sceneNodeId`, `shotId` and
  `frame` stay; `update_node` writing `outputUrl: null` clears it the same way): the next call
  fills an emptied still again, in the same node. `read` and
  `ls --long` carry `stillOf.replaced`, and the card shows a 「已换图」/ "Replaced" badge. Copies
  still drop `stillOf` (below).
- **Copies are plain images:** copy / paste / duplicate (the editor's and the Agent's
  `duplicate_node` / `duplicate_nodes`, one shared function) drops `stillOf` from the copy, so a
  later `run-stills` never refreshes a copy instead of the node the video nodes are wired to, and
  deleting the original makes the next call create a new node rather than adopt a copy. When two
  nodes still share a (3D node, shot, frame) — data from before this rule, or two pages rendering
  the same still at once — the one with the lowest id (code-unit order, not canvas order) is the
  one used (refreshed when the scene changed, left alone when up to date) and the others are listed
  in the reply's `duplicates`, untouched. `stillsSummary` names, per still, which node it used, and
  says "refreshed" only when it did; SKILL.md tells the Agent to point the extra nodes out to the
  user for deletion, never to delete them itself.
- Reply: `{ok, nodeId, sceneDigest, stills:[{shotId, frame, nodeId, url, created, sceneDigest}],
failed:[{shotId, frame, message}], skipped:[{shotId, frame, reason}], orphans:[{nodeId, shotId,
frame, orphan:true}], duplicates?, remaining?, checks?, stillsSummary}` (`skipped` entries with
  reason `up_to_date` or `replaced` also carry `nodeId`). `stillsSummary` is one page-rendered line (the
  `scene3dSummary` precedent).
- **Budget and partial work:** at most 120 stills per call (`scene3d.limits.stillsPerRun`, 60 shots
  × 2 frames; more is `invalid_request` at `shotIds` — split with `--shots`). The page answers
  within `scene3d.limits.stillsBudgetMs` (90 s, inside the daemon's 120 s call timeout): the still in
  flight at that moment is aborted and it and the rest come back in `skipped` with reason `budget`
  (`page_away` when the page goes away, `cancelled` when the run is cancelled or the 3D node is
  deleted — `scene3d.stillSkipReasons`). A failed render or upload goes to `failed` and the run goes
  on; a shot the data health blocks is `failed` with the same "数据健康拦下…" message as `run`, and
  the reply carries `checks`. Nothing is ever rolled back.
- **Carrying on:** a still whose node already exists and was rendered from the current scene
  (`stillOf.sceneDigest` equals the scene's digest and the node still has its image — the rule
  `run-batch` applies to a 3D node's own still) is not rendered again: it comes back in `skipped`
  with reason `up_to_date` and that `nodeId`. So when the budget or a page leaving cut a call short,
  the reply lists what is left in `remaining:[{shotId, frame}]` and **the same command again
  renders only those** — a scene too big for one 90 s window finishes in two or three calls, and a
  call after that is all `up_to_date` (`ok:true`, nothing rendered). `--force` (`run_stills.force`)
  renders the up-to-date ones anyway. `cancelled` is not carried on, and its summary does not tell
  the Agent to send the command again. `ok:false` with `run_failed` only when not a single still
  landed and something is left undone (`failed` / `skipped` still listed); all `up_to_date` is
  `ok:true`.
- **Leaving the page mid-run** (a reload, a closed tab, leaving the canvas past the leave guard):
  the still in flight is aborted and what landed stays on the canvas. The page sends the partial
  reply first (the rest `page_away`, listed in `remaining`) and only then `/v1/suspend` — the
  daemon retires a delivered call as `unknown_outcome` the moment it hears the page left, so the
  order is what makes the partial reply reach the CLI. If it cannot get out in time (the document
  is gone first, the loopback is down) the CLI gets `unknown_outcome`. Either way, once the page is
  back, the same command again renders only the missing stills.
- **`cancel` while `run-stills` runs:** the daemon delivers one mutation at a time (unchanged), so a
  `cancel NODE` from the same session queues behind the `run-stills` and, delivered after its reply,
  answers `not_owned` — on a 3D node the message now says the stills already finished instead of
  "not started by an agent". Only a cancel from another connection on the same page stops it.
- **Orphans:** image nodes whose shot (or whose 3D node) is gone are kept, listed in the reply's
  `orphans`, and `read` of such a node reports `stillOf.orphan: true`. `read` and `ls --long` of any
  still node carry its `stillOf`.
- Validation (nothing is rendered): an unknown or repeated shot id (`invalid_request` at `shotIds`,
  the message lists the scene's shots), a frame outside `start` / `end` or repeated (at `frames`), a
  node that is not a 3D node or has no shots (at `nodeId`), a missing node (`node_not_found`), a run
  already in flight on the node (`already_running` — `run` and `run-stills` exclude each other).
- One call is one Agent turn: every landing is stamped with it, so `undo --turns 1` takes the whole
  call back.
- Approval stays as for `run` on a 3D node (decision Q4): `--approved` is required and the daemon
  checks `approval.userApprovedNodeIds` before the field list, but it is not a billed generation. A page older
  than this CLI answers `method_not_allowed` "Unknown canvas method": its own copy of the policy
  refuses a method it does not know before any bridge lookup — ask the user to refresh the canvas
  page. (The page's `bridge_missing` branch for a bridge without `runStills` only fires for a host
  that injects an older bridge object; an old page never reaches it.)

#### Contract and policy

- `CANVAS_CONTRACT.scene3d.enums.frame` = `["start", "end"]` — the same array `./policy` exports as
  `SCENE3D_STILL_FRAMES` (typed in `src/policy.d.mts`), which the daemon checks `run_node.frame`
  against.
- `tiers["run-stills"]` = `{level:"L2", method:"run_stills", mutation:true, mainOnly:true,
approval:true, timeoutTier:"wait", billable:false}`. `billable:false` is new
  (`CanvasContractWireTier.billable?` in the typings) and follows the `run-tool.localKinds`
  precedent: the whole command renders in the browser and is not a billed generation, so a host need not ask the
  user to confirm a charge; `--approved` remains the command shape.
- `tiers.run` gains `localKinds: ["scene-3d"]`, the `run-tool.localKinds` shape keyed by node kind:
  a 3D node's `run` renders its still in the browser and is not a billed generation, every other kind still is
  (so `run` is not marked `billable:false` as a whole). The typing is widened to
  `typeof LOCAL_TOOLS.kinds | readonly CanvasContractNodeKind[]`. SKILL.md's L2 row no longer calls
  `run-stills` "one paid generation each".
- `limits["run_stills.shotIds"]` = `{min:1, max:60, itemMaxLength:128}` (the daemon's check);
  `scene3d.limits.stillsPerRun` = 120 and `scene3d.limits.stillsBudgetMs` = 90000 (the page's);
  `scene3d.stillSkipReasons` = `["budget", "cancelled", "page_away", "replaced", "up_to_date"]`.
- `./policy` exports `RUN_STILLS_FIELDS` (`nodeId`, `shotIds`, `frames`, `force`, `approval`;
  `force` must be a boolean) and
  `RUN_STILLS_SHOTS_MAX` (60); `run_stills` joins `MAIN_METHODS`, and
  `METHODS` / `MUTATIONS` in `./common`. `approval` is now accepted on
  `run_node` / `run_nodes` / `run_tool` / `run_stills`.

#### Skill

SKILL.md: `run-stills` in the L2 row (not a billed generation, still `--approved`) and the main-only list; the 3D desk
section gains `--frame end` and the flow read → one `scene3d_apply` → `run-stills` → connect each
shot's two stills to that shot's video node and name them start / end in the prompt, and what a
`replaced` still means (skipped by default; `--force` renders it again, only when the user asks). The command
reference gains, in scene 6f, the copyable `run-stills` argv and the reply the page really returns
for the manual's scene (pinned by `tests/studio/canvas-agent-bridge.test.ts`), the connect step,
`run-stills` in the `page_away` table, the hard-limits table and the Runs section, and `--frame` in
step four and the Runs section. What to do after the page left mid-run is spelled out per case
(SKILL.md's connection and desk sections, scene 6f, the Runs section, "Refresh and errors"): check
`status` first; a reload — or coming back to the canvas in the same tab — resumes the session, so
send the same command again; a closed tab or a browser that went away cannot resume it (the pairing
lives in that tab's session storage), so `connect` again and send it in the new session; and
`status` can still read `connected` for about 45 s after a tab closed (the daemon's lease).

### Document library: each version's text is a CDN file (decision A68)

#### Document text lives in CDN files (`doc@1` gains `contentUrl`)

The server no longer keeps document text in its database: every version of a document is one
UTF-8 `.md` file on the AssetHub CDN, stored by the server with the signed-in user's own token, and
the library records `version → url + sha + bytes`. Reading is unchanged — `docs read` still returns
the full `document.content`, fetched by the server (with a bounded cache) — and so is writing:
`docs update --expect-version N` is still the way to change a document. The text comes back exactly
as it was written: a U+FEFF in it, at the very start included, is part of the text and counts in
`contentSha` — the server neither strips nor adds a byte-order mark (only reading a file does:
`docs create / update --file` drops at most two leading BOMs, so a third one stays in the text). A
byte-order mark the file service puts in front of the file is still read through: the server checks
the sha once more without that one mark.

- **`CANVAS_CONTRACT.documents.fields` gains `contentUrl`** (after `contentSha`): the link to the
  current version's text file, in `docs ls` items and in `docs read`'s `document`. Anyone holding
  the link can open it, so it is shown to project members only and must not be passed on; it is
  `null` for a document whose text still sits in the old database column (migrated in the
  background when a project member opens the library panel). Server-owned like `version`: it is not
  a write field.
- **`CANVAS_CONTRACT.documents.errors` gains `uploadFailed: "upload_failed"` and
  `contentUnavailable: "content_unavailable"`.** Both are HTTP 502 from the library and come through
  the page bridge with their own code and `retryable: true`: the text file could not be stored
  (nothing was written; this includes the file service answering with a link off the CDN host
  allowlist) / could not be fetched — which includes a fetch that came back as something
  other than this version's text (an HTML page — e.g. a 200 error page — or an image / video /
  audio type, not UTF-8, or its `contentSha` recomputed the way the write computed it does not match
  the version's, e.g. another file: the server refuses it, does not cache it and logs it; any other
  type, `application/octet-stream` or none included, is read and checked by the sha). Resend the same call a little later. Other HTTP
  failures are still `documents_unavailable`.
- A write whose text is unchanged but whose fields changed (a new title, summary…) no longer stores
  another copy of the text: the version still goes up by one and `contentUrl` stays the same.

#### Changed: one document holds at most 50,000 characters

- `CANVAS_CONTRACT.documents.contentMaxChars` (and `DOCUMENT_CONTENT_MAX_CHARS` in `./policy`) goes
  from **1,000,000 to 50,000** (A66, kept by A68). This is a value change, not an addition: an
  older CLI checks the old cap locally and lets a longer text through (its daemon too), then the
  page's own check — the page runs this version's policy — refuses it before it reaches the server
  (`too_large`, see below) — split long texts into several documents (one per episode).
  `docs create` / `docs update` refuse a longer text with `too_large` before sending, as before.
- **`CANVAS_CONTRACT.documents.errors` gains `tooLarge: "too_large"`**: a text over the cap is
  refused with the same code and fields wherever the check runs — the CLI before sending, the
  daemon's and the page's policy (`invalid_request` before), and the server (HTTP 413; 400
  `validation` before) — always carrying `chars` (its length after line endings are normalized to
  LF) and `limitChars` (the cap), so a product can split the text by them. The CLI's own refusal
  keeps `maxChars` (its name before, the same number). `RequestPolicyError` gains an optional
  `extra` (fields spread into `toError()`); `./policy`'s `DOCUMENT_CONTENT_MAX_CHARS` type now says
  `50000`.
- The server now also refuses (400, `invalid_request` naming the position) a text or field that
  contains `\u0000` or a lone surrogate. The JSON write routes cap their own request body and answer
  413 (`too_large`) past it.
- **A refused `docs` parameter names its field in `error.path`**, wherever it is refused: the CLI's
  own checks (`invalid_argument`: `id`, `expectVersion`, `docType`, `title`, `content` for `--file` /
  `--text` / `--patch`, `meta.<key>` for a key `--meta` cannot set…), the daemon's and the page's
  policy, and the server's validation (`invalid_request`: the `documents_*` field — `title`,
  `sourceAgent`, `content`, `assetTags[2]`…; the page bridge passes the server's `path` through). A
  text or field holding `\u0000` or a lone surrogate also carries `position`, the 1-based character
  (after line endings are normalized to LF). A refusal about the call as a whole carries no `path`.
- **`CANVAS_CONTRACT.documents.errors` gains `quotaExceeded: "quota_exceeded"`**: a write that would
  push the project's current texts (non-deleted documents) past **50 MB** in total is refused with
  HTTP 400 `quota_exceeded`, carrying `usedBytes` (the total before this write) and `limitBytes`
  (the cap); nothing is written. The page bridge passes the code and both numbers through as they
  are — it is not folded into `invalid_request` — and it is not retryable as-is: delete documents
  that are no longer needed, or shorten this one. Writes that only change fields or shorten a text
  are always accepted.

#### `CANVAS_CONTRACT.documents.limits.uploadChapters: 2000`

A novel uploaded in the canvas panel splits into at most 2,000 chapters (one document, one text file
each); a larger novel is refused with 400 before anything is written and the user is asked to split
it into volumes. The library writes an upload 100 chapters per transaction with at most 4 text files
stored at a time, reports progress to the panel, and keeps the batches already written when a later
one fails. An upload is also refused when its files come to more than 50 MB of text after conversion
(`.docx` unpacks, GBK text grows in UTF-8). The CLI does not upload files; the limit is published for
the products that tell users how to prepare a novel.

#### `docs read --if-version N` — don't transfer text you already have

- New optional flag `docs read DOC-ID --if-version N` (the version you already hold): while the
  document is still at version N the reply is `{ok, notModified:true, id, version, summary}` with no
  text (and `--out` writes nothing); otherwise the full document as before. It cannot be combined
  with `--folder`. On the wire it is `documents_get.ifVersion` (a positive integer;
  `DOCUMENTS_GET_FIELDS` is now `["id", "ifVersion"]`), which the page sends as `?ifVersion=N` and
  the library answers with HTTP 304 without fetching the text file. The HTTP route also honours
  `If-None-Match: "N"` and sends `ETag: "<version>"` on every read.

## 0.16.1

_B1 — 3D director desk hardening: contract additions only._

A patch over 0.16.0. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, the `exports`
surface is unchanged, no command, apply command, scene op, daemon-checked request field or CLI flag
is added (the page adds one `snapshot` option and new reply fields, listed below), and the
daemon closure (`daemon.mjs` and the `policy` / `session` / `common` / `connection-code` modules it
loads) is byte-identical to 0.16.0 — a session started by a 0.16.0 daemon keeps working.
`test/pack.test.mjs` pins the surface in `VERSION_FEATURES["0.16.1"]`, which starts from the
`0.16.0` entry; the earlier entries are unchanged.

- `bridgeErrors` gains two retryable page codes (28 in all): `collab_offline` (the page is not
  connected / synced to the collaboration server, so a write wrote nothing — wait a few seconds and
  resend unchanged) and `render_interrupted` (a browser-side 3D render was cut off by a transient
  cause — resend unchanged, unchanged shots are reused). Neither is in `cliExitCodes`: both exit 1,
  so branch on `bridgeErrors[code].retryable`.
- `tiers.run.localKinds = ["scene-3d"]`: NODE kinds whose `run` renders in the browser and is not a billed generation,
  so a host need not ask the user to confirm a charge (not the same as `tiers["run-tool"].localKinds`,
  which lists tool kinds). The tier itself is unchanged: L2, `--approved`, main session only.
- `draftKeys.gen` gains `audioSpeaker`, which the page already accepted.
- `scene3d.checks.cutExemptionLabels`: the prose label of each jump-cut exemption, moved from the page
  into the contract.
- New block `hostText`: per CLI command, the reply fields a host must surface when it renders a reply
  as text — `verbatim` (pasted word for word) and `visible` (the value must be findable); `"*"` covers
  every failed reply, including the top-level `hint`. "Readers ignore fields they do not know" does not
  apply to these fields.
- New `packageVersion` (`"0.16.1"`), equal to `package.json`'s `version` and the CLI's `VERSION`.
- `scene3d.ops.add_object.required` is `["role"]`: `kind` may be omitted when a known `prefab` (alias
  included) or `role:"figure"` implies it; the page echoes an inferred one as `applied[].kind`. The
  field list is unchanged. Object `position` / `rotation` / `scale` may carry any subset of x / y / z
  (merged per component; `add_object` without `position.y` lands on the ground); camera points still
  need all three. A figure's `facing` gives way when a `transform` sets a different `rotation.y`
  (`applied[].cleared: ["facing"]`).
- `scene3d.checks.healthCodes` gains `orbit_cam_ignored` (warn: a shot has both `orbit` and `cam` /
  `to`; the orbit wins).
- `./contract` re-exports `formatScene3dSummary` (implementation in `src/scene3d-text.mjs`, types in
  `src/scene3d-text.d.mts`, like `formatTidySummary`): the text the page puts in `apply.scene3dSummary`,
  so a host that renders its own prose pastes the same words. `test/fixtures/host-text/` holds real
  0.16.1 page replies; `contract.test` checks that every `hostText` path resolves in at least one of
  them (or is listed as pending / rare with a reason) and that `scene3dSummary` equals the function's
  output word for word.
- A request the local policy refuses for an unknown scene op or field (`Unknown scene3d action op`,
  `Unexpected scene3d <op> field: <k>`, `Unexpected run_node field: <k>`) keeps its message and gains
  `error.path` (`commands[i].actions[j].op` / `.<k>` / `run_node.<k>`) and a top-level `hint` naming
  the legal ops or fields; `allShots` / `shotIds` / `render` / `add_act` add that 0.16.x has no
  multi-shot or animation and that each shot is one `run NODE --shot <id> --approved`.
- Page replies at this build (the CLI passes them through; hosts render them per `hostText`):
  `snapshot` takes `edges: "all" | "touching" | "none"` (default `all`) and echoes `edgeScope`;
  `read` of a 3D node adds `sceneSummary`; `apply` adds `turnId`, and `persisted:false` with
  `notes[]` / `next[]` when the page could not confirm the server took the write (`read` carries the
  same top-level `persisted:false` while the page still holds unacknowledged changes — that, not the
  content, is how the write is confirmed); `undo` / `redo`
  add `undoneOps[]` (`{turnId,label,at}`) and `scene3d[]` (`{nodeId,sceneDigest}`); a winner's undo
  that the page has to write back (a concurrent whole-node write would otherwise delete the node)
  counts as `skipped`, not undone; a `run` on a `scene-3d` node right after the session's own
  `scene3d_apply` on it (nobody else writing the node in between) is part of that apply's undo step,
  so `undo` reverts the scene and its still together and `undoneOps` names the apply;
  `scene3d_conflict` carries `sceneSummary`, `sceneWriter` (an Agent on another tab is reported as
  `agent` with its `agentId` when that page publishes the digest it wrote; otherwise `remote`), `checks`
  and `scene` and its `next[0]` is `read <nodeId>/scene`; a single-shot `run` on a `scene-3d` node
  answers `{local:true, outputs:[…], renderedDigest}` and an unknown `shotId` is `invalid_request`
  (`path:"shotId"`); every `error.next[].command` is written without `--session` or upper-case
  placeholders.
- **The relaxed scene3d inputs need the page at this build.** A page still on the 0.16.0 build
  checks against the 0.16.0 contract: `add_object` without `kind` answers `invalid_request`
  "add_object requires kind", a partial vector answers "<path>.y: expected a finite number", a
  `transform` that sets `rotation.y` leaves `facing` in place, `snapshot` ignores `edges`, and an
  unknown `shotId` silently renders the first shot. The CLI adds no hint for these (the page error
  already has a `path`): the remedy is to refresh the canvas tab, then resend.
- **`set_focus` no longer changes how a prop is drawn** (it only marks the focus object; the prop is
  drawn as its `kind`). The page records the drawing version with each still (`renderedRev`): a still
  rendered by a 0.16.0 page, or by any page before this build, reads `stale:true` even though
  `renderedDigest` still equals `sceneDigest`, and `sceneSummary` says `已过期（画法更新过，场景没变；重渲一次即可）`
  — `run` it again. A canvas tab still on the 0.16.0 build keeps drawing focus props by `focus.shape`
  and does not record `renderedRev`, so a still it renders reads stale on this build; refresh it.
- **Undo needs every open canvas tab on this build.** A tab opened before this build rewrites every
  node on each reconnect when the canvas holds a bare `@` (an e-mail in a prompt is enough). While
  such a tab is open, this build's undo sees every earlier step as superseded and answers
  `undone:0, skipped:1, reason:"all_skipped"`. The web app has no build check that reloads it: ask
  the user to refresh the other canvas tabs.
- **Hosts that render replies as text must surface `hostText` before taking this rules block.** The
  0.16.1 rules relay `sceneDigest` from the last reply, treat a `scene-3d` `run` as local and
  finished (`outputs[]`), and follow the precheck `hint`; a renderer that drops those fields (the
  plain lingying renderer today: no `sceneDigest`, a `run` shown as "submitted, poll `ls --status
running`", no `hint`) leaves rules the model cannot follow. Such a host stays on the 0.16.0 rules
  block until its renderer shows the 0.16.1 `hostText` paths.
- `SKILL.md`'s tier section is the 0.16.1 rules block (`run` on a `scene-3d` node is not a billed generation, no price
  question; `scene3d_apply` removals in a `baseDigest:"new"` batch are not destructive; the asset-sheet
  paragraph is gone from the tier section — `commands.md` scenario 6e already carries it); `commands.md` documents the 0.16.1 scene readback, the digest relay
  and the reducer relaxations; `PROTOCOL.md` states that hosts must surface `hostText` fields.

## 0.16.0

_2026-09-28 — F012 / F048 3D director desk: the CLI surface (convention `scene3d@1`)._

Additive over 0.15.1, the version before it: everything 0.15.1 shipped (the A57 / A60 `localTools`
below) is carried over unchanged. `protocolVersion` stays **2**, `bridgeVersion` stays **3**, and the
`exports` surface is unchanged. The 30th apply command `scene3d_apply` edits the 3D scene inside a
`scene-3d` node, `read` / `ls --long` / `snapshot` report it, `run --shot` picks the shot a still is
taken from, and the contract gains the `scene3d` block. One new bridge error code (26 in all), one
new CLI flag.
`test/pack.test.mjs` pins the new surface in `VERSION_FEATURES["0.16.0"]`, which starts from the
`0.15.1` entry and adds contract blocks (with `scene3d`), the 30 apply commands and their tiers, the
13 scene ops from both the contract and `./policy`, `destructiveOps` on both sides,
`bridgeErrors.scene3d_conflict`, `RUN_NODE_FIELDS`, the digest block, the `fov` range and
`run --shot` in the CLI's own usage; the `0.14.0` / `0.15.0` / `0.15.1` entries are unchanged.

### `scene3d_apply` — the 30th apply command

`{type:"scene3d_apply", nodeId, baseDigest, actions}`, all three required. The Agent sends
**actions**, never a whole scene: the page applies them to the scene as it is now with the reducer
the 3D desk itself uses (`applyScene3dActions`), so a human's drag a second earlier is not
overwritten.

- 13 ops in three layers: `add_object` `transform` `remove` `duplicate` `set_camera` `set_scene`
  (structure), `set_figure` `set_axis` `set_focus` (what the scene means — facing, gaze, line of
  action, focus object), `add_shot` `update_shot` `reorder_shots` `remove_shot` (the shot list). An
  unknown op or a field the op does not take is refused by the daemon before the page sees it
  (`scene3d_apply requires 1..200 actions` / `Unknown scene3d action op` /
  `Unexpected scene3d <op> field: <key>`); vocabularies, ranges and point shapes are checked by the
  page — `invalid_request` at `commands[i].actions[k].<field>` for shape / vocabulary / range,
  `invalid_command` for what depends on the current scene (a missing id, `set_figure` on a
  non-figure, a non-permutation `order`, the 100 objects / 12 cameras / 60 shots per scene).
- Units: metres, y up, a figure's feet at `transform.position` facing +z; angles on the wire are
  degrees (stored as radians); `fov` is the vertical field of view in degrees (2–140) and `focal`
  (mm, 36 mm long edge) may stand in for it; points are always `{x, y, z}`.
- **`baseDigest`** is compare-and-set against the node's `sceneDigest` (FNV-1a 64 over the stored
  scene, keys sorted). `"new"` is accepted only for a node an `add_node` earlier in the same batch
  created. One `scene3d_apply` per node per batch.
- **Creating never overwrites**: a taken `add_object` / `duplicate` / `add_shot` id becomes `-2`,
  `-3`, …, and later actions in the batch that name the requested id reach the new one.
  References (`look`, `facing`, `gaze`, axis ends, `moves[].who`) to missing ids are kept and
  reported, not refused. `null` clears the axis, a focus, a facing / gaze or an optional shot field.
- One batch = one undo step; the node's `status` never changes (a still goes stale by digest alone).
  `remove` / `remove_shot` are the destructive ops; workers may send the command.
- The reply carries `scene3d[]` — per command `{command, nodeId, sceneDigest, applied[], checks}`,
  where `checks` is the three self-checks (data health, line of action, cuts) — and a page-rendered
  `scene3dSummary`, one line per entry.
- A page older than this CLI refuses the command as `invalid_request` "Unknown or nested apply
  command", and so does a local daemon still running an older package (a session that stayed
  connected through the upgrade). When the batch holds a `scene3d_apply` the CLI adds a `hint`
  naming both remedies: refresh the canvas page first; if it still fails, `disconnect` and
  `connect` again to get a new daemon.

### New error code `scene3d_conflict`

`baseDigest` is not the node's current `sceneDigest`: a human or another Agent changed the scene.
`retryable:false`, `path: commands[i].baseDigest`, carries `currentDigest`, and `next` points at
`read NODE-ID` — re-read, re-plan against the scene it returns, send a new batch. Never resend the
old one.

### `read`, `ls --long`, `snapshot`

- `read NODE` on a scene-3d node returns `scene` (degrees; every object carries its `role`),
  `sceneDigest`, `checks`, `objectCount` / `cameraCount` / `shotCount`, and with the `output` part
  `outputUrl`, `renderedDigest`, `renderedShotId` and `stale` (a still exists and was rendered from
  another scene). `read NODE/scene` returns only the scene part.
- **Side effect:** `scene` joins `params` / `output` / `tags` as a field suffix, so a path ending in
  `/scene` now reads that field — a business path whose last segment is literally `scene` must be
  read by node id. `/scene` on any other kind is `invalid_request` at `paths[i]`.
- `ls --long` scene-3d rows add `sceneDigest` and `shotCount`; a scene-3d `snapshot` summary is
  `{objectCount, cameraCount, shotCount, outputMode, url?, sceneDigest, stale}`.

### `run --shot` and the `run_node` field list

- `run NODE --shot SHOT-ID --approved` sends `run_node.shotId`: the shot of a 3D scene node whose
  opening frame becomes the still (default: the first shot; with no shots, the active camera). A
  `shotId` on any other kind, or one the scene does not have, is `invalid_request` at `shotId`
  (the message lists the scene's shots). The still is rendered by the canvas page itself — no
  charge, still `--approved` — so a page without the 3D renderer answers `run_failed`.
- **Changed:** `run_node` now refuses any field outside `RUN_NODE_FIELDS` (`nodeId`, `approval`,
  `clearCandidates`, `shotId`) with `invalid_request` "Unexpected run_node field: <key>", like
  `run_tool` and `tasks`. The check runs after the approval check, so a missing or wrong approval is
  still `approval_required`. `shotId` is a non-empty string of at most 128 characters
  (`limits["run_node.shotId"]`).

### Contract and policy

- `CANVAS_CONTRACT.scene3d` (also exported as `SCENE3D`): the ops with their fields and required
  fields, the vocabularies (role, kind, bodyType, pose, arms, focus shape, move ease, aspect ratio,
  the 24 prefabs and 16 aliases), the prefab footprints in metres, ranges, limits, the id pattern,
  unit tokens, the digest algorithm and `"new"` sentinel, the self-check constants / health codes /
  levels / cut exemptions, `destructiveOps` and `conflictCode`. The page imports this very object,
  so the values a product reads are the ones enforced.
- `tiers.applyCommands.scene3d_apply` is
  `{workerAllowed:true, destructive:true, destructiveOps:["remove","remove_shot"]}` — the same array
  as `scene3d.destructiveOps` (`CanvasContractApplyTier.destructiveOps?` is new in the typings).
- `limits["scene3d_apply.actions"]` (1..200) and `limits["run_node.shotId"]` (≤ 128).
  `CanvasContractRange` gains the optional `maxLength` / `maxKeys` the `run_node.shotId` and
  `run_tool.*` rows already carried at runtime.
- `./policy` exports `SCENE3D_ACTION_FIELDS` (op → fields; the one place the field names are
  written), `SCENE3D_ACTIONS_MAX` (200) and `RUN_NODE_FIELDS`, all typed in `src/policy.d.mts`.

### Skill

SKILL.md gains a 3D director desk section (read → one `scene3d_apply` per batch → conflict = re-read
and re-plan → `run --shot` → still into generation), with the self-check stance quoted word for
word from the convention (`test/contract.test.mjs` compares the two). The command reference gains
scene 6f with a copyable `desk.json` and the reply the page really returns for it, a
`scene3d_apply` reference section, the `scene3d_conflict` row, and `--shot` / `/scene` in the run
and read rows.

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
local code only — no model, no billed generation (`localTools.userSheet`):

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

### `run-tool --kind asset-sheet` (local, not a billed generation)

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

### `run-tool --kind scale-lineup` (local, not a billed generation)

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

The canvas build this pairs with knows **four more local tools** (not billed generations) for
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
- Levels: **L0** read-only, **L1** an undoable write (not a billed generation), **L2** it costs money
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
local tool (not a billed generation) that grabs a still out of a video node. Contract, command
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
  with `billable`. The locally-run ones (`trim-audio`, `trim-video`) never
  reach the gateway and are reported as `billable:false`, so an agent can stop
  asking the user to approve something that is not a billed generation.
- `timeline` clips carry **`inMs` / `outMs`**, so a clip's trim is readable
  instead of inferred from durations.
## 0.10.2

Add `CANVAS_CONTRACT.layout` to describe shared body-geometry defaults:
node gaps 160 × 96, group gaps 200 × 160, group padding 56, and grow-only tidy.
`arrange --gap` still explicitly overrides both node gaps. Skills now reserve
`--fit-frames` for an explicit request to shrink frames. The matching web page
uses the same policy; older deployed pages may still use earlier defaults.
Protocol 2, bridge 3, commands, and coordinate wire formats remain unchanged.
Snapshot positions are absolute; grouped `move_node` positions remain relative.
Body bounds exclude floating titles and toolbars.

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
