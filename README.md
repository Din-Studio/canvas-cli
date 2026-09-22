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
| `CANVAS_VERSION` | Pin a version, e.g. `0.10.1` |
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
scenemint-canvas disconnect --session SESSION-ID
```

`--file` paths, `--text-file`, uploads, and download destinations stay inside the workspace. `--file -` accepts JSON from stdin. `--json` accepts a complete parameter object. Every command returns JSON and a stable process exit code. Consult the [bundled command reference](skills/scenemint-canvas/references/commands.md) for editing, media, timeline, and error semantics.

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
- Mutations serialize within a task. Related edits may be batched. Reads can run in parallel. `read` hashes and exact edits protect already observed human changes; they are not distributed locks.
- Requests carry unique IDs. In-flight and cached retries of the same request are deduplicated. Evicted results are never re-executed. No automatic retry occurs on failed generation, transport loss, or timeout. A delivered request with a lost outcome stops the connection and reports `unknown_outcome`.
- Media is obtained from authorized canvas nodes, not arbitrary URLs. Uploads are limited to 25 MiB; downloads to 256 MiB. Downloads use chunked transfer and atomic no-overwrite publication. Optional frame extraction requires installed `ffmpeg`; optional probing requires `ffprobe`.

## Delegate within a task

Once the main session is paired, create a restricted worker credential and workspace:

```sh
scenemint-canvas delegate --session MAIN-ID --name "Compare references" --workspace /absolute/existing/worker-workspace
scenemint-canvas read NODE-ID --session RETURNED-WORKER-ID
scenemint-canvas revoke --session MAIN-ID --delegate RETURNED-WORKER-ID
```

Delegation returns a new `sessionId`, `role:"worker"`, and `parentSessionId` without printing credentials. The worker shares the paired page, canvas, visible Agent identity, mutation queue, and undo history. Its file inputs and downloads use its own workspace. Only the main session can create or revoke delegates, with at most 64 delegates over one main session's lifetime.

Workers may read/search/list models/resources/changes, end a turn, and perform the existing safe `apply` edits. Any batch containing `upload_asset` or `export_output` is rejected before dispatch. Workers cannot run or cancel generation, undo, redo, inspect operations, access any timeline operation (including list), or delegate again. The parent performs those actions. `media_info` and `media_chunk` deliberately permit workers to obtain fixed node-owned resources as local files: this is narrower than arbitrary URL fetching but broader than the old Electron worker's export ban. Downloads still use the normal node/resource resolution and workspace boundaries.

`disconnect` on a worker revokes only that worker; main disconnect, page disconnect, or browser lease expiry revokes all its workers. Pending unsent worker commands are cancelled. Commands already sent to the page return `unknown_outcome` and may still finish; revocation is not undo. A delivered edit retains its serialization slot until the page replies or its timeout closes the connection. A request ID belongs to the credential that first submitted it, so parent and sibling credentials cannot retrieve one another's cached results.

This is protocol-level delegation, not a sandbox against an Agent with unrestricted shell access as the same OS user. Such a process could read another session's credential file. The host must give a worker only its delegated session ID and isolate parent credentials if it requires an adversarial security boundary.

This version assumes the Agent and browser run on the same computer. Remote Agent sandboxes need a separately designed remote transport; exposing the local daemon on the public network is unsupported. Closed or suspended browser pages cannot keep executing canvas work. Actual image understanding depends on the host and model, even though the files are accessible.

## Read the command contract programmatically

The canvas commands, their required and optional fields, each node kind's draft-key allow-list, the closed enums and numeric ranges, and the request-level hard caps ship as data:

```js
import { CANVAS_CONTRACT, DRAFT_KEYS } from "@scenemint/canvas-cli/contract";
```

Error codes arrive from two places in the same `error.code` field, so they are two tables. `bridgeErrors` is the page bridge's own codes with its `retryable` flag. `cliExitCodes` maps a code — from either side — to the process exit code this CLI ends with: 2 arguments or file boundary, 3 connection/authentication, 4 unknown outcome, and 1 for anything not listed. A connection code such as `not_connected` is in the second table only, so index defensively rather than assuming one table answers for every code.

Everything in it is plain JSON-serializable data, so `JSON.stringify(CANVAS_CONTRACT)` serves a non-JavaScript consumer. Nothing is hand-written twice: the command fields are the same object the daemon rejects unexpected fields against, the SceneMint page imports `DRAFT_KEYS` from here instead of keeping its own copy, and `cliExitCodes` is verified by calling the CLI's real `exitCode()`. The full page↔CLI drift gate — the bidirectional test that fails whenever a table and the SceneMint page source it mirrors disagree — reads `apps/web` sources and therefore ships with the SceneMint monorepo, not this repository; `test/spec.test.mjs` here still pins the CLI flags against the contract in both directions. Prose belongs in the Skill's command reference, not here.

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

One gate deliberately does not live here: the bidirectional page↔CLI contract drift test compares this package's tables against the SceneMint page source under `apps/web`, which exists only in the private SceneMint monorepo. That test ships there and runs in its CI; this repository is the publishable artifact it protects.

The wire protocol is documented in [PROTOCOL.md](PROTOCOL.md) in the source tree. The CLI package is an independent product direction; it consumes the shared semantic bridge without importing the Electron client or its business Agent pipelines.

## Releases

Releasing is a manual, local process — GitHub Actions is not available at organization level in this repo, so pushing a tag produces no run record. Everything happens through the Makefile:

```sh
make check                 # full gate: tests (incl. pack contract) + skill validation
make snapshot              # build dist/ assets without publishing, inspect them first
make release TAG=v0.10.2   # guard → check → tag → push → build → gh release create
```

`make release` refuses to run on a dirty tree or a non-`main` branch, requires the tag to match `package.json`'s version, and builds the release assets from the tested `npm pack` output. Asset names intentionally carry no version (`scenemint-canvas.tar.gz`, `checksums.txt`), so `releases/latest/download/…` serves both "install latest" and "pin a version" (`CANVAS_VERSION=0.10.1`). The install scripts ship as release assets themselves, so installation touches only `github.com`. Bump `package.json`'s version and add a `CHANGELOG.md` entry before tagging — `test/pack.test.mjs` pins the feature surface per version and fails when either drifts without a bump.

Version 0.3 added tab-scoped refresh recovery, ready mention syntax in `read`, reference/dependency/layout recipes, correct Agent undo attribution, and uncertain-submit protection. Refresh resets page-local undo history; `status.pageEpoch` identifies a new page.

Version 0.10 adds the `health` read method (`scenemint-canvas health [--limit N]`): one read-only, idempotent call that answers "what is wrong with this canvas right now" as a table of violations — oversized group frames, members outside their own frame, loose nodes covering a frame, stacked nodes, overlapping frames, empty groups, and `@` mentions pointing at nodes that no longer exist. Every row names a `nodeId` / `groupId`, says it in one sentence, and mostly carries a `fix` argv you can run verbatim; the reply also renders as a `report` text block (per-kind counts, the first few rows of each, the repair command) for hosts that hand prose to a model. The judging runs in the page over the **whole** graph — `snapshot`'s 2000-node ceiling cannot health-check a bigger canvas, and `truncated` here only ever means the detail list was cut, never that the canvas was not fully seen. See `./contract`'s `health.issueKinds`, `limits["health.maxIssues"]` and `limits["health.overlapMinRatio"]`.

Version 0.10 also makes a `changes` cursor provable and a tidy readable. `changes` and `snapshot` both return `epoch` (the change feed's instance id) and a resumed cursor is the pair `--since-seq N --since-epoch E`; a non-zero `sinceSeq` without an epoch is answered `truncated` with `truncatedReason:"feed_restarted"`, because a page reload rebuilds the feed at 0 and "you missed 57 entries" and "23 things happened" were otherwise byte-identical replies. `snapshot` also returns `rev`. `changes` gains the notes `frame_strays` / `frame_escaped` (a human's frame gesture left members and covered strays mismatched — records only, nothing moved) and `bulk_change` (one transaction touching many nodes becomes one row carrying `nodeIds`, so a collaborator landing twenty images no longer evicts the human edits from the 500-entry buffer). `resize_group` gains `absorbStrays` (`--absorb-strays`), the one explicit way a frame takes in the parentless nodes it covers. `apply.tidied[]` now reports **every** tidy in the batch and both paths carry a rendered `tidySummary`, published as `formatTidySummary` on `./contract`. The full upgrade checklist is in [CHANGELOG.md](CHANGELOG.md).

Version 0.9 was the twentieth apply command and the contract keys that go with it. `resize_group {nodeId, fit?|size?}` resizes or fits a group frame (an explicit `size` is clamped up to the members' own bounding box and every clamp comes back in `clamped[]`); `tidy` gains `--scope all|groups|selection [--fit-frames]`, the conservative pass that only repairs escaped members, stacked nodes and frames that do not fit — it never re-arranges a layout the user placed by hand. `tidy` and `upload` now accept `--wait` / `--wait-ms` like every other write command, which is what the `page_away` guidance always claimed. The contract publishes two scalar limits products used to hard-code: `limits["group_nodes.minMembers"] = 1` (a one-member group is legal) and `limits["group.oversizeRatio"] = 3` (the frame-is-too-big ratio the canvas itself judges by), plus the `PAGE_AWAY` constant group — the `page_away` error code, the `status` field names, the error payload field names, the two `outcome` values and the exit code — so a consumer can assert on them instead of copying the strings.

Version 0.8 adds the `./host` subpath (`injectSession`, `extractPayload`) for hosts that expose the CLI as a pass-through Agent tool, the Skill's standard `@{label}` prompt-writing rules for image and video reference nodes, and node / group tags both ways: every `ls` / `read` / `snapshot` row carries `tags`, `ls` and `grep` take a repeatable `--tag` filter, `grep --fields tags` searches them, and `apply --node ID --tags a,b` (or `draft.assetTags` / `draft.assetTagColors` on gen, media-upload, scene-3d and group) writes them.

Version 0.7 adds the connection-layer subpath exports `./client`, `./session`, `./media`, and `./common`, so a product with its own canvas business layer can install the package instead of vendoring `src/*.mjs`. They are internal modules, not a stable API: depend on `>=0.7.0` to mean "this copy has them", and pin an exact version if their shapes matter to you.

Version 0.6 adds `run-batch`: submit many nodes (or a whole group) in reference order with a concurrency cap, the same executor the page uses for "run selected / run group". Every expanded node must be in the approval list or nothing is submitted.

Version 0.5 makes the daemon the authority on session liveness. A page that reloads, navigates away and back, or loses its poll keeps the same session for ten minutes without a new code; calls issued meanwhile queue and are delivered to the page that comes back. Delivered work with an unknown result is retired as `unknown_outcome` and never replayed, but no longer ends the session.

Version 0.4 adds one-code pairing and multiple independent connections per page. One Agent conversation can keep separate connections to multiple open canvases; always choose the explicit connection ID matching the intended project and canvas. Refresh storage and disconnect are isolated per connection.
