# SceneMint Canvas CLI + Skill

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-blue.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

An Agent-independent entry point to the SceneMint semantic canvas bridge. This package runs on Node.js 22 or later, has no runtime dependencies, and does not require Electron, a browser extension, MCP, or a Pi extension.

It connects a local Agent to an open SceneMint page through a task-scoped loopback daemon. The page continues to enforce the logged-in user's canvas permissions and uses the same canvas operations as the user. Each main connection has a distinct visible Agent identity and its own undo history; its delegated workers share that identity and history with restricted credentials.

## Install

The installer downloads the release tarball, verifies its SHA-256, places the package under `~/.local/lib/scenemint-canvas`, and symlinks the executable into `~/.local/bin`. Node.js 22 or later must already be installed.

### curl: macOS, Linux, and WSL

```bash
curl -fsSL https://github.com/Din-Studio/canvas-cli/releases/latest/download/install.sh | bash
scenemint-canvas --help
```

If the installer reports PATH is not yet in effect, reopen the terminal or `source` the rc file it names.

### PowerShell: native Windows

No WSL needed. The installer requires `tar.exe` (ships with Windows 10 1803+), downloads the same release tarball, verifies SHA-256, installs to `%LOCALAPPDATA%\scenemint-canvas`, and writes the user PATH.

```powershell
irm https://github.com/Din-Studio/canvas-cli/releases/latest/download/install.ps1 | iex
scenemint-canvas --help
```

Reopen PowerShell or Windows Terminal to pick up the new PATH. Checksum, download, or extraction failure aborts the install — an unverified package is never installed.

### Slow networks

Downloads go straight to GitHub and automatically fall back to public mirrors. Set `CANVAS_MIRROR` to put your own mirror first:

```bash
CANVAS_MIRROR="https://your-mirror.example.com" \
  curl -fsSL https://github.com/Din-Studio/canvas-cli/releases/latest/download/install.sh | bash
```

The checksum file is always fetched from GitHub directly first — as long as it comes from the trusted source, the package can safely travel through a mirror. If even the direct checksum fetch fails, the installer falls back to a mirror and prints a clear warning.

### Installer environment variables

| Variable | Effect |
|---|---|
| `CANVAS_VERSION` | Pin a version, e.g. `0.18.3` |
| `CANVAS_MIRROR` | Custom mirror base, tried before public mirrors |
| `CANVAS_HOME` | Install prefix, default `~/.local` (Windows: `%LOCALAPPDATA%\scenemint-canvas`) |

Updating is re-running the same install command; it replaces the package atomically and keeps the symlink.

### Install the Skill

```sh
scenemint-canvas skill-path
```

Copy the directory this prints into your Agent's supported skills directory. It contains `SKILL.md` and a command reference; no host-specific adapter is needed. The Agent must be allowed to run local commands. Visual inspection additionally needs the host's image/audio/video reader. A Skill itself does not add shell or visual capabilities to a restricted host.

### From a source checkout

```sh
npm pack
npm install -g ./scenemint-canvas-cli-*.tgz
scenemint-canvas help
```

The matching SceneMint frontend with **Connect Agent** support must be running. This package does not modify the existing Electron product or automatically deploy the frontend.

## Connect a task

```sh
scenemint-canvas connect --origin https://YOUR-SCENEMINT-HOST --name "Storyboard review" --workspace /absolute/task/workspace
```

Use the real origin without a path or trailing slash. Local development accepts loopback HTTP, for example `http://localhost:3000`. The workspace must already exist.

The command prints a SceneMint connection ID and one complete `connectionCode`. In the current SceneMint canvas, open **Connect my Agent**, paste this single code, and click **Add connection**. The page lists independent Agent tasks and lets you disconnect each separately. Pairing codes expire after ten minutes. The browser may ask permission to access the local network. Keep the paired page open.

```sh
scenemint-canvas status --session SESSION-ID
scenemint-canvas ls / --long --session SESSION-ID
scenemint-canvas read NODE-ID --session SESSION-ID
scenemint-canvas tasks --submitter me --status running --session SESSION-ID
scenemint-canvas resources NODE-ID --session SESSION-ID
scenemint-canvas apply --file edits.json --session SESSION-ID
scenemint-canvas download NODE-ID --out reference.png --session SESSION-ID
scenemint-canvas export-jianying --dry-run --session SESSION-ID
scenemint-canvas disconnect --session SESSION-ID
```

`--file` paths, `--text-file`, uploads, and download destinations stay inside the workspace. The one command that writes outside it is `export-jianying --draft-root`, which writes Jianying draft projects straight into the user's Jianying draft folder (main session only; a folder the user has not registered needs `--approved`). `--file -` accepts JSON from stdin. `--json` accepts a complete parameter object. Every command returns JSON and a stable process exit code. Consult the [bundled command reference](skills/scenemint-canvas/references/commands.md) for editing, media, timeline, and error semantics.

While the paired page is away (reload, upgrade, browser restart) a command never hangs silently: reads answer `page_away` within 5 s and are not queued; mutations are queued and answer `page_away` + `queued:true` + `requestId` after `--wait-ms` (default 30 s) — re-issue with the same `--request-id` to collect the result, or pass `--wait` to block for the whole recovery window. `status` reports `pageAway`, `queuedCommands`, `pageLastSeenAt`, `resumeExpiresAt` and `daemonPid`. A host that stores a session ID across its own restarts should reconnect with `connect --session SESSION-ID …`: it reuses a live session or replaces a dead one in a single call.

## Access every node resource

`resources NODE` lists the current output, every candidate, image/video history, manual reference, legacy frame/image/video/audio input, and available poster/last-frame assets. Rows report `resourceId`, `source`, `part`, `kind`, `current`, `available`, name and MIME type without downloading media; candidate rows add `outputId`, `runId`, `runIndex`, `gatewayTaskId`, `createdAt`, `promptSha` and `promptChanged` so the takes of several reruns can be told apart. A rerun (`run NODE --approved`) appends to that candidate list instead of replacing it — image and video candidates have no automatic eviction — and `run NODE --fresh --approved` is the explicit opt-in to clear the earlier candidates first. Page size is 1–200 (default 100); when `nextOffset` is present, pass it to `resources NODE --offset N`. Offsets are opaque slots, not row counts. Restart listing if the node changes while paging. Resource IDs remain stable when candidates/history entries are reordered and are scoped to the node; do not construct them yourself. On generation nodes, retained legacy history of the current media type is normalized into candidate resources; restart listing after normalization.

Pass an observed `--resource ID` to `download`, `inspect-media`, or `frames` to select a candidate, history item, reference, poster or last frame. Omitting it retains the current-output behavior. A removed resource fails with `resource_not_found`; the CLI never substitutes a different candidate. Resources whose `available` is false cannot be downloaded by this browser connection.

Candidate rows additionally expose `outputId`. After comparing candidates, an `apply` batch may adopt one with `{type:"select_output",nodeId,outputId,expectOutputId}`. Use the currently adopted candidate's `outputId` as `expectOutputId` (or `null` if none); a changed choice returns `stale`. Selection uses the native candidate picker operation, including downstream reference propagation, and is undoable in this Agent's scope. It cannot inject an arbitrary URL or create candidates. Re-read after undo: a later human write can supersede part of an older step because canvas nodes are stored as whole Yjs values.

```sh
scenemint-canvas inspect-media NODE-ID --resource RESOURCE-ID --session SESSION-ID
scenemint-canvas download NODE-ID --resource RESOURCE-ID --out candidate.mp4 --session SESSION-ID
scenemint-canvas frames NODE-ID --resource RESOURCE-ID --out-dir frames --session SESSION-ID
```

`inspect-media` without `--out` reads node metadata without fetching the media body. Binary `size` is `null` until downloaded; text size is known. An unknown media subtype is reported as `image/*`, `video/*`, or `audio/*`, not an invented file format. Downloads of the same node/resource URL reuse a connection-local cache for up to ten minutes, bounded to 256 MiB and 256 entries. The live node is checked before reuse, so removing or replacing a resource does not grant access through an old selector. Cached bytes are discarded on disconnect.

## Identity, authorization, and failure behavior

- Each independent main task starts its own daemon and explicitly supplies its session ID. There is no global “current Agent” setting. CLI invocations in the same task preserve identity.
- Daemons listen only on `127.0.0.1` with a random port. Host validation, exact Origin matching, one-use pairing, and separate browser/CLI bearer tokens isolate the channels. CLI routes reject browser Origins. Long-lived credentials never appear in normal output or command arguments.
- Credentials are saved as an independent `0600` file in the user's application data directory under `scenemint-canvas/sessions/`. `SCENEMINT_CANVAS_HOME` can select a private data directory. On Windows, file privacy additionally follows the user's profile ACLs.
- Pairing binds one canvas/project and browser origin. Protocol 2 is required on both sides; mismatched pages/daemons must be updated and reconnected. The CLI cannot override the bound identity or role. A viewer remains read-only. `run NODE --approved` sends `approval:{userApprovedNodeIds:[NODE]}`; both daemon and page require the target in that explicit list, including raw RPC calls. This is the Agent's recorded declaration of existing user authorization, not a separate UI confirmation token or proof of user input. It does not bypass browser permissions or account checks.
- Mutations serialize within a task, except `cancel` / `cancel-batch`, which go straight to the page so they can stop a running mutation. Related edits may be batched. Reads can run in parallel. `read` hashes and exact edits protect already observed human changes; they are not distributed locks.
- Requests carry unique IDs. In-flight and cached retries of the same request are deduplicated. Evicted results are never re-executed. No automatic retry occurs on failed generation, transport loss, or timeout. A delivered request with a lost outcome stops the connection and reports `unknown_outcome`.
- Media is obtained from authorized canvas nodes, not arbitrary URLs. The one exception is `export-jianying`: it downloads the timeline clips' own source files directly, and only `https` URLs on the page's jianying export host allowlist (every redirect hop re-checked, no cookies or credentials). Uploads are limited to 25 MiB; downloads to 256 MiB. Downloads use chunked transfer and atomic no-overwrite publication. Optional frame extraction requires installed `ffmpeg`; optional probing requires `ffprobe`.

## Delegate within a task

Once the main session is paired, create a restricted worker credential and workspace:

```sh
scenemint-canvas delegate --session MAIN-ID --name "Compare references" --workspace /absolute/existing/worker-workspace
scenemint-canvas read NODE-ID --session RETURNED-WORKER-ID
scenemint-canvas revoke --session MAIN-ID --delegate RETURNED-WORKER-ID
```

Delegation returns a new `sessionId`, `role:"worker"`, and `parentSessionId` without printing credentials. The worker shares the paired page, canvas, visible Agent identity, mutation queue, and undo history. Its file inputs and downloads use its own workspace. Only the main session can create or revoke delegates, with at most 64 delegates over one main session's lifetime.

Workers may read/search/list models/resources/changes, read the project document library (`docs ls` / `docs read`), end a turn, and perform the existing safe `apply` edits. Any batch containing `upload_asset`, `export_output`, `delete_output`, `clear_output` or `recover_deleted` (`WORKER_BLOCKED_COMMANDS` in `policy.mjs`) is rejected before dispatch. A worker also cannot carry `approval` on `apply` (`apply --approved`): consent to a bulk delete — or, since 0.18.0, to removing a 3D object / shot a human changed in the director desk — is declared only by the main session. Workers cannot run or cancel generation, undo, redo, inspect operations, access any timeline operation (including list), write or delete documents, list or write the user's Jianying draft folders (`jianying-roots`, `export-jianying --draft-root`), or delegate again — the one timeline read a worker may make is `timeline_export`, the export view behind `export-jianying`, so a worker can write Jianying draft projects into its own workspace. The parent performs those actions. `media_info` and `media_chunk` deliberately permit workers to obtain fixed node-owned resources as local files: this is narrower than arbitrary URL fetching but broader than the old Electron worker's export ban. Downloads still use the normal node/resource resolution and workspace boundaries.

`disconnect` on a worker revokes only that worker; main disconnect, page disconnect, or browser lease expiry revokes all its workers. Pending unsent worker commands are cancelled. Commands already sent to the page return `unknown_outcome` and may still finish; revocation is not undo. A delivered edit retains its serialization slot until the page replies or its timeout closes the connection. A request ID belongs to the credential that first submitted it, so parent and sibling credentials cannot retrieve one another's cached results.

This is protocol-level delegation, not a sandbox against an Agent with unrestricted shell access as the same OS user. Such a process could read another session's credential file. The host must give a worker only its delegated session ID and isolate parent credentials if it requires an adversarial security boundary.

This version assumes the Agent and browser run on the same computer. Remote Agent sandboxes need a separately designed remote transport; exposing the local daemon on the public network is unsupported. Closed or suspended browser pages cannot keep executing canvas work. Actual image understanding depends on the host and model, even though the files are accessible.

## Read the command contract programmatically

The canvas commands, their required and optional fields, each node kind's draft-key allow-list, the closed enums and numeric ranges, and the request-level hard caps ship as data:

```js
import { CANVAS_CONTRACT, DRAFT_KEYS } from "@scenemint/canvas-cli/contract";
```

Error codes arrive from two places in the same `error.code` field, so they are two tables. `bridgeErrors` is the page bridge's own codes with its `retryable` flag. `cliExitCodes` maps a code — from either side — to the process exit code this CLI ends with: 2 arguments or file boundary, 3 connection/authentication, 4 unknown outcome, and 1 for anything not listed. A connection code such as `not_connected` is in the second table only, so index defensively rather than assuming one table answers for every code.

Everything in it is plain JSON-serializable data, so `JSON.stringify(CANVAS_CONTRACT)` serves a non-JavaScript consumer. Nothing is hand-written twice: the command fields are the same object the daemon rejects unexpected fields against, the SceneMint page imports `DRAFT_KEYS` from here instead of keeping its own copy, `cliExitCodes` is verified by calling the CLI's real `exitCode()`, and `test/contract.test.mjs` fails whenever a table and the source it mirrors disagree in either direction. Prose belongs in the Skill's command reference, not here.

## Reuse the connection layer from an installed package

A product that already has its own canvas business layer — its own batching, its own review gates, its own tool surface — and only wants this package's transport can import the modules directly instead of vendoring the source tree:

```js
import { call, connect, sessionRequest } from "@scenemint/canvas-cli/client";
import { readSession } from "@scenemint/canvas-cli/session";
import { download, frames, inspectMedia } from "@scenemint/canvas-cli/media";
import { CliError, UUID } from "@scenemint/canvas-cli/common";
```

A host that registers the executable as an Agent tool (for example a `canvas_cli` tool that passes argv straight through) has one more subpath, `./host`, added in **0.8.0** and typed by `src/host.d.mts`:

```js
import { injectSession, extractPayload, HostArgvError } from "@scenemint/canvas-cli/host";

// The host owns the session identity. Any `--session` / `--session=…` already in argv —
// even after `--` — throws HostArgvError with code SESSION_NOT_ALLOWED; so does an empty id.
const argv = injectSession(agentArgv, sessionId); // new array, original untouched

// One structural view of whatever payload the argv carries, for the host's approval gate.
// Mirrors every way a payload enters the CLI: --json OBJECT, --file FILE, --file - (stdin,
// readFile is called with "-"), --node ID --field F --text-file FILE --expect-sha SHA, and
// --node ID --tags a,b (tag write), and tidy's flag-synthesized command.
// shape is "json" | "file" | "stdin" | "text-file" | "tags" | "tidy" | "none".
const payload = await extractPayload(argv, {
  readFile: (p) => fs.readFile(resolveInWorkspace(p), "utf8"),
});
payload.commands; // the apply commands array, or null when the params carry none
```

`extractPayload` uses the CLI's own argument parser and per-command flag table, so `--json` plus `--file`, or `--text-file` with either, is rejected (`INVALID_PAYLOAD`) exactly as the CLI rejects it — there is no precedence to guess. Malformed JSON is `INVALID_PAYLOAD`; a flag the command does not read, an unknown command, or a non-string argv is `INVALID_ARGV`. Relative `--file` / `--text-file` paths are resolved by the CLI against the session workspace; the injected `readFile` receives the raw path and the host applies the same rule.

These four subpaths exist so that copying `src/*.mjs` into someone else's repository stops being the only way to reach the daemon. They arrived in **0.7.0**; `>=0.7.0` is what a consumer depends on to mean "this copy has the connection layer". Do not read that from `0.6.0`, which shipped under more than one export surface. **They are not a public stable API.** The boundary is deliberate and narrow:

- `./policy` and `./contract` are the supported, versioned surface. They ship hand-written types, are covered by tests that fail when a table drifts from the source it mirrors, and are what an integrator should build against.
- `./client`, `./session`, `./media`, and `./common` export whatever those modules export today. Names, signatures, and return shapes are internal implementation and may change in any release, including a patch. There are no `.d.mts` declarations for them; TypeScript consumers get no types from these subpaths.
- Nothing here is a second protocol. The wire contract is `PROTOCOL.md` and the CLI's JSON output; the modules are one implementation of it. If a behavior matters to you, pin an exact version or assert it in your own tests.
- The pack test installs the real tarball into a clean prefix and imports all four subpaths, so a rename that breaks the import path fails here rather than in a downstream product. It does not promise that the _meaning_ of an export stayed the same.

Prefer the executable and its JSON output when you can. Reach for these subpaths only when running a subprocess per call is genuinely the wrong shape for your product, and accept that you are tracking an internal module.

## Development and verification

```sh
npm test
npm run test:pack
```

The integration suite starts real CLI processes and real HTTP daemons and simulates a paired browser. It covers credentials, Origin/Host validation, task isolation, full text transfer, batch edits, serial mutations, idempotency, uncertain outcomes, file boundaries, and chunked media. The pack test installs the actual tarball in an isolated prefix and invokes its executable. These tests do not perform paid generation or claim a logged-in production browser has been tested.

### Adding a scene3d capability

One change touches several hand-kept tables; walk the list for its kind before opening the PR.

- **An op or op field** (`add_act`, shot `via`, …) — minor version. Package: `SCENE3D_ACTION_FIELDS` in `policy.mjs`, `SCENE3D_REQUIRED` and `SCENE3D` (`enums` / `ranges` / `limits` / `units` / `checks` / `destructiveOps`) in `contract.mjs`, the typings. Page: `scene-3d/actions.ts` (union, parsers, nullable set, reducer), `types.ts` types **and** the migration whitelist (it must keep unknown keys before anything writes the field), `checks.ts`, `evaluate.ts` / `build-three.ts`. Tests: `contract.test.mjs` (op table vs the page union, codes, destructive ops vs the tier table), `scene3d.test.mjs`, a new `VERSION_FEATURES` entry in `pack.test.mjs`. Docs: the convention `docs/conventions/scene-3d.md`, SKILL「三维导演台」, commands.md 6f / 6g and「`scene3d_apply`」, this README, CHANGELOG, PROTOCOL.md.
- **A read projection** (`NODE/renders`, `NODE/framing`, …) — page-only plus docs, fits a patch release: the page's read suffix table and projection, the commands.md `read` row, the convention's read section. An old page lists an unknown suffix in `missing[]`.
- **A `run` parameter** (`shotIds`, `render`, …) — minor version: `RUN_NODE_FIELDS` and its shape checks in `policy.mjs`, `LIMITS`, `spec.mjs` usage and flags, the mapping in `cli.mjs`, the page's `run_node` validation and result type, `scene3d.test.mjs`, `pack.test.mjs` (`runNodeFields`, usage flags), PROTOCOL.md, SKILL and commands.md. **Every new CLI flag takes a value** (`--render video`, never `--video`): both hosts treat a flag outside their copied boolean table as valued, so a new boolean written before the node id swallows it. `test/flags.test.mjs` pins the boolean table.
- **A tier or rules-block change** (`tiers.run.localKinds`, a new destructive op): `TIERS` in `contract.mjs` and its alignment test, then SKILL「命令分级」 — the rules block two hosts copy verbatim (Lingying's rules file, s2v's `CANVAS_CLI_RULES`), estimated tokens ≤ 2100 (`contract.test.mjs`; the hosts' hard limit is 2500).
- **A reply field** (`timeline`, `framing`, …) — page and docs, patch release allowed: the bridge's result types, the convention's reply section, the commands.md example, and `hostText` (with a recorded fixture under `test/fixtures/host-text/`) so hosts that render replies as text keep showing it.
- **Not** a new `outputMode` value for a new kind of render: the migration rewrites unknown values to `beauty`. New render kinds are a `run` parameter (`render`).

The wire protocol is documented in [PROTOCOL.md](PROTOCOL.md) in the source tree. The CLI package is an independent product direction; it consumes the shared semantic bridge without importing the Electron client or its business Agent pipelines.

Version 0.18.3 synchronizes the public CLI with the integrated canvas bridge. `CANVAS_CONTRACT.layout` exposes the shared layout defaults (body bounds, node gaps 160 × 96, group gaps 200 × 160, padding 56, no automatic frame fitting); generation drafts accept `audioInputData` and `audioSpeaker`. The protocol and bridge versions are unchanged. Use a frontend containing the corresponding `ui-review-polish` changes; updating this package does not deploy the page.

Version 0.18.2 (decisions A102 ④ ⑧ ⑨, A100 as revised) makes the contact checks say how deep and what to send: a blocking `body_penetration` message carries the depth (「…腿部穿入 椅子（chair） 的座面 0.12 m；…」), a seated figure facing more than 25° away from its seat's front gets a `fix` turning the seat, a penetration that only an act causes names that act and gets a `fix` writing its `to` / `via` y onto the top it walks onto, and a low `floor` / platform box is the support for what stands on it (furniture sunk into one is lifted onto its top, or warned as `sunk_in_floor`); `read NODE`, `scene3d_apply` replies and the stills replies carry the same checks and `fix`es (`CANVAS_CONTRACT.scene3d.contact`). Figures can be off stage: `set_figure {id, offstage:true}`, `add_act {who, at, do:"@enter", to?, facing?}` and `add_act {who, at, do:"@offstage"}` — off stage means not rendered, checked or framed, and the stills replies say who is missing per shot (`scene3d.presence`). Station stills turn away from a wall that hides the figures, then move inside the room, and only then leave the wall out (`overview.direction` / `cutaway`, one direction per scene, a `notes[]` line says why). Renderer revision 8. A 0.18.1 daemon or page refuses `do` / `offstage`; the CLI's hint says which to refresh or reconnect. See [CHANGELOG.md](CHANGELOG.md).

Version 0.18.1 (decisions A95 / A96 / A97 fix ③) draws a product scene's 3D card again — it takes its place, is in marquee selection, the minimap and the outline — with an unstored dashed ownership line to each still and previz card it made (not an edge, not a reference) and 「出自 … · S01 开始」 on those cards; a previz card's toolbar opens the desk at its shot's start too. Put the card left of the scene's first triple in the same row or right above it; triples now treat it as an obstacle, and `run-stills` / `run-shot-refs` add a `notes[]` line when it (or a station / previz card) overlaps another node, asking for a canvas rebase — the canvas never moves it. Station stills keep one direction per scene but are framed per shot on that shot's figures and props only (start, end and each cut; furniture drawn, not framed), every figure kept whole in the frame first (feet and held objects included, ≥ 5 % of the frame height from every edge, `overview.figureMarginRatio`), then as close as that allows toward the tallest figure at a third of the frame (`minFigureFraction`, a target — a group too spread out to reach it gets a `notes[]` line instead of losing its edges); station stills and a product scene's previz are always 16:9, 1920 × 1080, whatever the scene's aspect (`overview.aspectRatio` / `stillSize` / `previzSize`). `scene3d_apply` also snaps standing / crouching / kneeling feet within 0.1 m of their support onto it (`repairs[]` code `figure_grounded`, `FIGURE_GROUND_MAX_M`); a farther `support_gap` comes with the coordinates to send. In a scene with a blocking table, a shot's cuts now switch cameras as they do without one (each cut's own camera; figures follow the blocking). Renderer revision 7: earlier stills and previz read as stale once. Nothing on the wire changed, so 0.18.0 and 0.18.1 peers work together.

Version 0.18 makes a product scene's three references per shot (decisions A86 / A88). Its start and end station stills are drawn from one fixed bird's-eye camera for the whole scene — 30° right of the scene front, 45° down, framing every figure, prop and piece of furniture at every shot's start and end, ground grid, no name labels (`CANVAS_CONTRACT.scene3d.overview`). `run --render video` on a product scene lands one previz clip per shot, titled `epXX-PYY-SZZ运镜预演` and placed with the two stills as a triple right above the shot's video (`previzOf` on the card). `run-shot-refs NODE --approved` (new wire method `run_shot_refs`, main only, L2 with `billable:false`) makes all three for every shot in one command, shot by shot — start still, end still, previz — and answers one row per shot; what its per-shot budget (capped at 240 s) or a departing page cut off comes back in `remaining`, and the same command again makes only those; its `notes[]`, like a `run --render video` reply's, carry the line-of-action and cut reminders (never blocking) that 0.18 moved out of the `scene3d_apply` summary. The same version makes `scene3d_apply` report every shape / vocabulary problem of a batch at once (`error.issues[]`) and repair data before the self-checks — only what leaves who sits / stands / holds what as written, only what the batch touched, never what a human changed in the desk — returning each repair in `scene3d[].repairs[]` (`SCENE3D.repairs`); `remove` / `remove_shot` need the user's consent only for an object / shot a human changed in the desk (`editedBy:"human"`, `SCENE3D.humanEdit`; `apply --approved` declares it); and `./contract` gains per-episode identity colours (12 nameable colours, white / light-grey props, grey one-off extras; `allocateEpisodeIdentityColors`, `checkEpisodeIdentityColors`). Deploy the canvas before a product that uses any of this (script-to-video 3.37.x); stills drawn by 0.17.0 read as stale once. A product still landed by 0.17.0 is refreshed in place and stays where it was; the triple follows it until someone moves the group. Once the 0.18.0 page is live, a CLI still pinned at 0.17.0 (script-to-video 3.36.0) cannot approve removing an object / shot a human changed (`approval_required`); it works again when script-to-video 3.37.0 re-pins 0.18.0. See scenes 6f / 6g in the command reference and [CHANGELOG.md](CHANGELOG.md).

Version 0.17 adds animation to the 3D director desk. `scene3d_apply` gains blocking acts — `add_act` / `update_act` / `remove_act`: who does what from which story second (walk or run to a point or object, change pose, arms, facing, gaze, pick up or put down a prop, a gesture) — and shots gain `start`, `via`, `follow` and `shake`; replies carry a `timeline` and the eight motion reminders in `checks.motion`. `run` on a 3D node renders still, preview video or contact sheet cards per shot (`--shot` / `--shots all|a,b`, `--render still|video|sheet`, `--frames 3|5|9`), and the CLI can wait for shots still rendering (`--await SECONDS`, the whole command's wall-clock budget) and save the results (`--out-dir`). `snapshot --edges all|touching|none` narrows the edge list. The daemon reports `packageVersion` in `status`, and an old page or daemon refusing a 0.17.0 op gets a hint naming which one to refresh. See scenes 6g and 6h in the command reference and [CHANGELOG.md](CHANGELOG.md).

Version 0.16 adds the 3D director desk's CLI surface (convention `scene3d@1`). The 30th apply command, `scene3d_apply {nodeId, baseDigest, actions}`, changes the 3D scene inside a `scene-3d` node through 13 actions — objects, cameras, aspect ratio, figures' pose / facing / gaze, the line of action, a focus object, and the shot list — applied by the same reducer the page's desk uses, so a human's edit is never overwritten by a whole-scene write. `baseDigest` is compare-and-set against the node's `sceneDigest` (`"new"` for a node created earlier in the same batch); a mismatch is the new error code `scene3d_conflict`, carrying `currentDigest` and a `next` that says to re-read and re-plan. A created id that is taken is renamed, never overwritten; the reply carries `scene3d[]` (the new `sceneDigest`, what each action landed on, and three self-checks: data health, line of action, cuts) and a one-line `scene3dSummary`. `read` returns the scene in degrees with its `sceneDigest`, `checks`, counts and `stale` (`read NODE/scene` for the scene alone), and `ls --long` / `snapshot` report the digest and shot count. `run --shot` picks the shot a 3D scene node renders; the still itself is rendered by the canvas page, so a page without the renderer answers `run_failed`. `run_node` now refuses fields outside `RUN_NODE_FIELDS`. The contract gains the `scene3d` block (`SCENE3D`: ops and fields, vocabularies, prefab footprints, ranges, limits, units, digest algorithm, self-check constants) and `tiers.applyCommands.scene3d_apply.destructiveOps`. See scene 6f and "`scene3d_apply`" in the command reference and [CHANGELOG.md](CHANGELOG.md).

Version 0.16.2 finishes the desk for script-to-video. `run --frame end` renders a shot's end — moves and camera move complete — instead of its opening, and the node records `renderedFrame`. `run-stills NODE [--shots …] [--frames start|end|both] --approved` (new wire method `run_stills`, main only) renders every shot's start and end stills in the page, one by one, and lands each in an image node of its own (`stillOf` says which node, shot and frame); the same shot and frame again refreshes that node in place. A still already rendered from the current scene is skipped as `up_to_date` (`--force` renders it again); a still whose picture a human or an Agent swapped is marked `stillOf.replaced` and skipped as `replaced` — `--force` renders it again too, in place, clearing the mark (decision A71 as revised). At most 120 stills per call, answered within 90 s; what was not reached comes back in `skipped` and `remaining`, and the same command again renders only those. It is L2 like `run` (still `--approved`) but `tiers["run-stills"].billable` is `false`: it is not a billed generation. See scene 6f in the command reference and [CHANGELOG.md](CHANGELOG.md).

Version 0.15 adds local image tools for `run-tool` (they run in the page, never reach the gateway and are not billed generations): `asset-sheet` composes one asset into a single reference image, and since 0.15.1 (decision A57) the art step draws **one picture per asset** — run-tool's NODE-ID — which the sheet never rearranges: a character's baseline sheet (face close-up plus a three-view with heads) is kept whole beside a scale panel that stands the character's front view next to 1–2 in-story reference characters (`scaleRefs`) at one px/cm with a shared ruler — the front view is the first figure of the three-view, found by the column gaps, and a sheet it cannot be taken from fails the run naming it; a prop's three-cell picture (front, back, held / beside) and a scene's two-cell picture (scene, top-view plan) are kept full width with the uniform info block below; no external reference objects (0.15.0's prop `backRef` / `heldRef` and scene `panels.plan` are retired); a picture the user uploaded themselves gets no composite (decision A60) — as a reference character (`scaleRefs[i].userSheet`) or a lineup item (`items[i].userSheet`) its standing figure is cut out locally, or a grey silhouette stands in. `scale-lineup` lines the production's characters (from their baseline sheets) and creatures (by height) and props (from their three-cell pictures, by the long side of `sizeCm`) up on one ground line with a shared ruler, in several rows or images when there are more than six; and `annotate-image` gains text marks. Chinese text uses a Noto Sans SC subset (OFL) the canvas ships. The contract gains `localTools` (`LOCAL_TOOLS`: the local kinds and every metadata cap and value set) and `tiers["run-tool"].localKinds`; no command, flag or wire method changed. See scene 6e in the command reference and [CHANGELOG.md](CHANGELOG.md).

Version 0.14 adds `export-jianying`, which writes the timeline as Jianying (剪映) draft projects straight into the session workspace (default `产出/剪映工程/`, one draft folder per episode, whole source media under each project's `assets/video/`) — no zip, no browser download. The draft JSON comes from the page's own jianying export code bundled into `src/jianying/core.mjs`, so both paths write byte-identical drafts. `--dry-run` plans without downloading; an interrupted run resumes. See the command reference (scene 17c and "`export-jianying` — Jianying draft projects into the workspace or the user's Jianying draft folder") for flags, the reply, and what a host must register. The same version brings nine more apply commands (29 in all), timeline editing ops (`trim` / `split` / `cut` / `restore`, `--episode`) and four local image tools for `run-tool`; the full list is in [CHANGELOG.md](CHANGELOG.md).

Version 0.14 also brings the Jianying draft folders: `jianying-roots` lists the Jianying draft folders the user registered (up to 5, most recently used first, each checked on this machine), and `export-jianying --draft-root ABSOLUTE-DIR` writes the projects straight into one of them — the only CLI write outside the workspace: main session only, the folder checked first (existing real directory, no symlink or junction on the way, not a drive root / home / system folder), `--approved` for a folder the user has not registered, and the folder remembered after a successful export. See scene 17c and "`jianying-roots` — the user's registered Jianying draft folders" in the command reference.

Version 0.14 also adds `docs ls` / `docs read` / `docs create` / `docs update` / `docs delete`, which read and change the project's document library (scripts, outlines, shot lists, reports, uploaded novels) — the single source of truth for those texts, with no local mirror and no sync. Updates are in place and guarded by `--expect-version` (`doc_conflict` when someone changed the document since you read it); `--patch` applies a unified diff. See scene 17d and "Project documents: `docs`" in the command reference, `CANVAS_CONTRACT.documents`, and [CHANGELOG.md](CHANGELOG.md).

Version 0.3 added tab-scoped refresh recovery, ready mention syntax in `read`, reference/dependency/layout recipes, correct Agent undo attribution, and uncertain-submit protection. Refresh resets page-local undo history; `status.pageEpoch` identifies a new page.

Version 0.10 adds the `health` read method (`scenemint-canvas health [--limit N]`): one read-only, idempotent call that answers "what is wrong with this canvas right now" as a table of violations — oversized group frames, members outside their own frame, loose nodes covering a frame, stacked nodes, overlapping frames, empty groups, and `@` mentions pointing at nodes that no longer exist. Every row names a `nodeId` / `groupId`, says it in one sentence, and mostly carries a `fix` argv you can run verbatim; the reply also renders as a `report` text block (per-kind counts, the first few rows of each, the repair command) for hosts that hand prose to a model. The judging runs in the page over the **whole** graph — `snapshot`'s 2000-node ceiling cannot health-check a bigger canvas, and `truncated` here only ever means the detail list was cut, never that the canvas was not fully seen. See `./contract`'s `health.issueKinds`, `limits["health.maxIssues"]` and `limits["health.overlapMinRatio"]`.

Version 0.10 also makes a `changes` cursor provable and a tidy readable. `changes` and `snapshot` both return `epoch` (the change feed's instance id) and a resumed cursor is the pair `--since-seq N --since-epoch E`; a non-zero `sinceSeq` without an epoch is answered `truncated` with `truncatedReason:"feed_restarted"`, because a page reload rebuilds the feed at 0 and "you missed 57 entries" and "23 things happened" were otherwise byte-identical replies. `snapshot` also returns `rev`. `changes` gains the notes `frame_strays` / `frame_escaped` (a human's frame gesture left members and covered strays mismatched — records only, nothing moved) and `bulk_change` (one transaction touching many nodes becomes one row carrying `nodeIds`, so a collaborator landing twenty images no longer evicts the human edits from the 500-entry buffer). `resize_group` gains `absorbStrays` (`--absorb-strays`), the one explicit way a frame takes in the parentless nodes it covers. `apply.tidied[]` now reports **every** tidy in the batch and both paths carry a rendered `tidySummary`, published as `formatTidySummary` on `./contract`. The full upgrade checklist is in [CHANGELOG.md](CHANGELOG.md).

Version 0.9 was the twentieth apply command and the contract keys that go with it. `resize_group {nodeId, fit?|size?}` resizes or fits a group frame (an explicit `size` is clamped up to the members' own bounding box and every clamp comes back in `clamped[]`); `tidy` gains `--scope all|groups|selection [--fit-frames]`, the conservative pass that only repairs escaped members, stacked nodes and frames that do not fit — it never re-arranges a layout the user placed by hand. `tidy` and `upload` now accept `--wait` / `--wait-ms` like every other write command, which is what the `page_away` guidance always claimed. The contract publishes two scalar limits products used to hard-code: `limits["group_nodes.minMembers"] = 1` (a one-member group is legal) and `limits["group.oversizeRatio"] = 3` (the frame-is-too-big ratio the canvas itself judges by), plus the `PAGE_AWAY` constant group — the `page_away` error code, the `status` field names, the error payload field names, the two `outcome` values and the exit code — so a consumer can assert on them instead of copying the strings.

Version 0.8 adds the `./host` subpath (`injectSession`, `extractPayload`) for hosts that expose the CLI as a pass-through Agent tool, the Skill's standard `@{label}` prompt-writing rules for image and video reference nodes, and node / group tags both ways: every `ls` / `read` / `snapshot` row carries `tags`, `ls` and `grep` take a repeatable `--tag` filter, `grep --fields tags` searches them, and `apply --node ID --tags a,b` (or `draft.assetTags` / `draft.assetTagColors` on gen, media-upload, scene-3d and group) writes them.

Version 0.7 adds the connection-layer subpath exports `./client`, `./session`, `./media`, and `./common`, so a product with its own canvas business layer can install the package instead of vendoring `src/*.mjs`. They are internal modules, not a stable API: depend on `>=0.7.0` to mean "this copy has them", and pin an exact version if their shapes matter to you.

Version 0.6 adds `run-batch`: submit many nodes (or a whole group) in reference order with a concurrency cap, the same executor the page uses for "run selected / run group". Every expanded node must be in the approval list or nothing is submitted.

Version 0.5 makes the daemon the authority on session liveness. A page that reloads, navigates away and back, or loses its poll keeps the same session for ten minutes without a new code; calls issued meanwhile queue and are delivered to the page that comes back. Delivered work with an unknown result is retired as `unknown_outcome` and never replayed, but no longer ends the session.

Version 0.4 adds one-code pairing and multiple independent connections per page. One Agent conversation can keep separate connections to multiple open canvases; always choose the explicit connection ID matching the intended project and canvas. Refresh storage and disconnect are isolated per connection.
