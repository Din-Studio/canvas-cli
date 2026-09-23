# Changelog

Versions are the only identity a downstream has for "which API surface is
installed". **A version number is never reused for two different trees**: if a
command, a field, an export or an `exports` subpath changes, the version changes
with it. `test/pack.test.mjs` enforces that — it pins the `exports` surface AND
the feature surface (methods, command fields, contract blocks) per version, and
fails when either drifts without a bump.

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
