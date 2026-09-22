/**
 * 命令规格表：一张表同时喂三个消费方 —— flag 接受过滤、`help` 文案、漂移测试。
 *
 * 为什么要有这张表：`cli.mjs` 原来只有一个全局 FLAGS 白名单，`parseArgs` 只校验
 * 「这个 flag 是否属于某个命令」，然后每个命令块各挑自己认识的键、其余**静默丢弃**。
 * 于是「文档写着某个 flag、实现根本不读它」和「flag 能解析、却对这条命令无意义」
 * 两类漂移都没有任何关卡。这不是假想：
 *
 *  - 2f604695：`cli.mjs` 读 `options.batch` 拼 `params.batchId`，但 `batch` 从来没进
 *    过 FLAGS，`parseArgs` 直接 `Unknown option` 退出 2；而 help / SKILL 的
 *    commands.md / PROTOCOL.md 三处都把 `--batch` 写成首选形式。Agent 只能退回裸
 *    `cancel-batch`，那会把该会话**所有**批次的未提交节点一起撤掉。
 *  - 今天仍在的同形态坑：`cancel-batch --group G` 能解析通过，`cancel-batch` 块只读
 *    `options.batch`，于是 `--group` 被静默丢弃，页面按「没给 batchId」撤掉全部批次。
 *  - `ls --offset 50` 能解析，但 `ls` 靠 `after` 游标分页，`offset` 只对 grep/read 生效，
 *    于是 Agent 以为在翻页、实际永远读第一页。
 *
 * 所以规则是：**flags 是这条命令真正会读的键的完整集合**，多给即报错。
 * `usage` 是 help 的文案（保留原来手写的语义提示，机械生成会丢信息），
 * 而 `test/spec.test.mjs` 断言 `usage` 里出现的每个 `--flag` 都在 `flags` 里 ——
 * 这一条就是上面 `--batch` 那类漂移的关卡。
 *
 * 加命令 / 加 flag 时：改这一处即可，help 与校验同源，结构上不可能不一致。
 */

import { CliError } from "./common.mjs";
import { CANVAS_CONTRACT } from "./contract.mjs";

/** `tidy --scope` 的合法取值：契约那一份，不是第四份手抄（contract.test.mjs 把它
 *  和 canvas-tidy.ts 的 TIDY_SCOPES 逐字对齐）。 */
const TIDY_SCOPES = CANVAS_CONTRACT.enums["tidy.scope"];

/** 所有命令都接受（`--help` 提前返回，`--version` 提前返回）。 */
const ALWAYS = ["help", "version"];
/**
 * `rpcOptions` 的四个键（cli.mjs 的 `rpcOptions`）：每条走 `call()` 的命令都读它们。
 * `--wait` / `--wait-ms` 在这里面是有分量的：页面不在（`page_away`）时写命令会排队，
 * 而 README / PROTOCOL.md / SKILL.md 都把这两个参数写成「唯一的正解」。少给一条
 * 写命令，Agent 照着手册重试就会拿到 `--wait is not an option of X` —— 与页面不在
 * 毫无关系的报错，弱模型只能原地猜。
 */
const RPC_OPTIONS = ["turn", "request-id", "wait", "wait-ms"];
/** 走 `call()` 且用 `paramsFrom` 收完整 params 的命令：再加 --json / --file。 */
const RPC = ["json", "file", ...RPC_OPTIONS];

const spec = (entry) => entry;

/**
 * 注意 `flags` 只列「这条命令真的会读」的键。特别是 media 四条命令
 * （upload / download / inspect-media / frames）在 `paramsFrom` **之前**就 return 了，
 * 其中只有 upload 拿到 rpcOptions，所以 download/inspect-media/frames 不收
 * --json/--file/--turn/--request-id。
 */
export const COMMAND_SPEC = {
  help: spec({
    summary: "Print this command map",
    usage: "[command]",
    positionals: "optional command name",
    flags: [],
  }),
  "skill-path": spec({
    summary: "Print the bundled Agent Skill directory",
    usage: "Print the bundled Agent Skill directory",
    flags: [],
  }),
  connect: spec({
    summary:
      "Create a task session and print its one-use connectionCode (--session ID reuses a live session or replaces a dead one)",
    usage:
      '--origin https://your-scenemint-host --name "Agent task name" --workspace /absolute/workspace [--session ID]',
    flags: ["origin", "name", "workspace", "session"],
  }),
  status: spec({
    summary: "Report the paired canvas, role and connection state",
    usage: "--session ID",
    flags: ["session"],
  }),
  disconnect: spec({
    summary: "Stop this session (main stops the daemon and every delegate)",
    usage: "--session ID (stops local task session)",
    flags: ["session"],
  }),
  stop: spec({
    summary: "Alias of disconnect",
    usage: "--session ID (alias of disconnect)",
    flags: ["session"],
  }),
  delegate: spec({
    summary: "Create a restricted worker session under this main session",
    usage:
      "--session MAIN-ID --name NAME --workspace EXISTING-DIRECTORY (creates a restricted worker session)",
    flags: ["session", "name", "workspace"],
  }),
  revoke: spec({
    summary: "Revoke one worker session",
    usage: "--session MAIN-ID --delegate WORKER-ID (revokes that worker only)",
    flags: ["session", "delegate"],
  }),
  "list-canvases": spec({
    summary: "List the canvases this session can address",
    method: "list_canvases",
    usage: "--session ID (only the paired canvas is accessible)",
    flags: ["session", ...RPC],
  }),
  ls: spec({
    summary: "List canvas nodes by path",
    method: "ls",
    usage:
      "[path] [--long --glob PATTERN --kind gen,media-upload --status succeeded --has-output --tag TAG (repeatable) --limit N --after CURSOR]",
    positionals: "optional path",
    // offset 不在这里：ls 用 `after` 游标分页，offset 只有 grep/read 认。
    flags: [
      "session",
      "path",
      "long",
      "glob",
      "after",
      "kind",
      "status",
      "limit",
      "has-output",
      "tag",
      ...RPC,
    ],
  }),
  read: spec({
    summary: "Read full node text, prompts, params and output",
    method: "read",
    usage: "<path-or-node-id>... [--offset N --limit N]",
    positionals: "1..20 paths or node IDs",
    flags: ["session", "path", "node", "offset", "limit", ...RPC],
  }),
  resources: spec({
    summary: "List a node's current, candidate, history and reference media",
    method: "resources",
    usage:
      "<node-id> [--limit N --offset NEXT-OFFSET] (current, candidate, history and reference media)",
    positionals: "node ID",
    flags: ["session", "node", "limit", "offset", ...RPC],
  }),
  models: spec({
    summary: "Account model catalog with full input schemas",
    method: "model_catalog",
    usage:
      "[query] [--model-type TYPE --model-id ID --limit N --offset NEXT-OFFSET] (account models with full input schemas; TYPE is passed through to the gateway)",
    positionals: "optional query",
    flags: ["session", "model-type", "model-id", "query", "limit", "offset", ...RPC],
  }),
  grep: spec({
    summary: "Search node text",
    method: "grep",
    usage:
      "<pattern> [--fixed --ignore-case --path / --glob PATTERN --kind K --status S --tag TAG (repeatable) --fields prompt,content,title,negativePrompt,tags --files-only --count --limit N --offset N]",
    positionals: "pattern",
    flags: [
      "session",
      "path",
      "glob",
      "fixed",
      "ignore-case",
      "files-only",
      "count",
      "fields",
      "kind",
      "status",
      "tag",
      "limit",
      "offset",
      ...RPC,
    ],
  }),
  snapshot: spec({
    summary: "Bounded graph summary",
    method: "snapshot",
    // --limit 映射到 maxNodes；原来的 help 没写这一条，Agent 只能靠读源码发现。
    usage: "[--limit N (maxNodes) | --json OPTIONS | --file OPTIONS.json]",
    flags: ["session", "limit", ...RPC],
  }),
  health: spec({
    summary: "现在画布哪里坏了：组框过大 / 成员出框 / 压框 / 重叠 / 空组 / 悬空引用",
    method: "health",
    // A5 —— 判定在**页面侧**算，整张画布都扫（snapshot 的 2000 节点硬上限体检不了
    // 更大的画布，而半张画布的结论比没有结论更糟）。`--limit` 只截**明细表**，
    // 每一类的计数始终是全量，截断时回包带 truncated / omittedIssues。
    usage: "[--limit N (maxIssues, 默认 100，上限 1000) | --json OPTIONS | --file OPTIONS.json]",
    flags: ["session", "limit", ...RPC],
  }),
  apply: spec({
    summary: "Apply a batch of canvas commands in one transaction",
    method: "apply",
    usage:
      "--file commands.json | --file - | --json OBJECT | --node ID --field prompt|content|title --text-file prompt.md --expect-sha SHA | --node ID --tags a,b [--label TEXT]",
    flags: ["session", "node", "field", "text-file", "expect-sha", "tags", "label", ...RPC],
  }),
  tidy: spec({
    summary: "Lay out nodes with the canvas's own tidy rules (whole canvas needs --all)",
    method: "apply",
    // 桥层的 `tidy` 两个 id 列表都不给就是整张画布（`coerceAgentCommand` 的 `case "tidy"`
    // 与 `applyTidy`），CLI 这一层故意收紧：裸 `tidy` 报错，全画布必须显式 `--all`。
    // 理由不是洁癖 —— 全画布 tidy 是唯一会挪动**用户手工摆放过**的东西的命令
    // （`coerceAgentCommand` 的 `case "tidy"` 注释就这么写），
    // 而它落成 move_node + resize_group 是一个 Agent 自己的撤销步，**人的 Ctrl+Z 撤不掉**，
    // 还会同步给所有协作者。这种不对称的破坏面不该由「少打一个参数」触发。
    // 注意这是默认值的保护、不是权限边界：桥层裸 tidy 仍然合法，
    // `apply --json '{"commands":[{"type":"tidy"}]}'` 绕得过去（那是给程序化调用方留的）。
    // `--scope all|groups|selection [--fit-frames]` 是另一种整理（整理画布，
    // canvas-tidy.ts）：只修坏掉的（出框的成员、叠住的成员、不贴合 / 互相压住的组框），
    // 不重排用户手工摆放的东西，所以 `--scope all` 不需要再加 `--all`。
    usage: `--all | --nodes a,b,c | --groups g1,g2 | --scope ${TIDY_SCOPES.join("|")} [--fit-frames] [--nodes/--groups for selection] [--label TEXT]`,
    // `...RPC`，不是手抄到 "request-id" 为止：tidy 走 `call()`，rpcOptions 里
    // 的 --wait / --wait-ms 是页面不在（page_away）时唯一的正解，而 README /
    // PROTOCOL.md / SKILL.md 都这么教。手抄的清单漏了它们，于是照着手册重试
    // 拿到的是 `--wait is not an option of tidy`，与 page_away 毫无关系。
    // 只加 `...RPC_OPTIONS`，不加 --json/--file：tidy 自己合成 `params.commands`，
    // 收下 --json 只会被静默覆盖，那正是这张表要消灭的形状。
    flags: ["session", "all", "nodes", "groups", "scope", "fit-frames", "label", ...RPC_OPTIONS],
  }),
  "resize-group": spec({
    summary: "Resize ONE group frame (membership frozen unless --absorb-strays)",
    method: "apply",
    // 为什么值得有个专用动词而不是只留 `apply --json`：改框大小的唯一合法路径就是
    // 这一条命令（`move_node size` / `update_node draft.width` 都会被守护进程拒），
    // 而 `--absorb-strays` 是**唯一**能让一次改框动到成员归属的开关——它必须是
    // 用户 / Agent 显式打出来的一个词，而不是藏在一坨 JSON 里的一个布尔。
    usage: "<group-id> --fit | --size WIDTHxHEIGHT [--absorb-strays] [--label TEXT]",
    positionals: "group ID",
    flags: ["session", "group", "fit", "size", "absorb-strays", "label", ...RPC_OPTIONS],
  }),
  run: spec({
    summary: "Run one node (requires prior user authorization)",
    method: "run_node",
    usage:
      "<node-id> [--fresh] --approved (a rerun keeps earlier candidates; --fresh discards them)",
    positionals: "node ID",
    flags: ["session", "node", "fresh", "approved", ...RPC],
  }),
  "run-batch": spec({
    summary: "Run many nodes in reference-edge topological order",
    method: "run_nodes",
    usage:
      "--nodes a,b,c | --group GROUP-ID [--concurrency 1-200 --rerun-succeeded --fresh] --approved (topological order; every expanded node needs approval)",
    flags: [
      "session",
      "nodes",
      "group",
      "concurrency",
      "rerun-succeeded",
      "fresh",
      "approved",
      ...RPC,
    ],
  }),
  "run-tool": spec({
    summary: "Run one of the node's toolbar tools (requires prior user authorization)",
    method: "run_tool",
    usage:
      '<node-id> --kind KIND [--prompt TEXT --resolution R --title NAME] [--json \'{"metadata":{…},"aspectRatio":"16:9"}\'] --approved (KIND is a toolbar tool id: separate-vocal, image-matting, …; `read` the node lists what applies under `tools`; model parameters such as light_azimuth go in --json metadata; see the `models` command for the ranges of each model)',
    positionals: "node ID",
    flags: ["session", "node", "kind", "prompt", "resolution", "title", "approved", ...RPC],
  }),
  cancel: spec({
    summary: "Cancel one node's run",
    method: "cancel_node",
    usage: "<node-id> (also drops a node still queued in one of your batches)",
    positionals: "node ID",
    flags: ["session", "node", ...RPC],
  }),
  "cancel-batch": spec({
    summary: "Drop the unsubmitted nodes of a batch",
    method: "cancel_batch",
    usage:
      "[--batch BATCH-ID] (drops the unsubmitted nodes of your batch; omit --batch for all your batches)",
    flags: ["session", "batch", ...RPC],
  }),
  undo: spec({
    summary: "Undo this agent's own edits",
    method: "undo",
    usage: "[--steps N | --turns N]",
    flags: ["session", "steps", "turns", ...RPC],
  }),
  redo: spec({
    summary: "Redo this agent's own edits",
    method: "redo",
    usage: "[--steps N | --turns N]",
    flags: ["session", "steps", "turns", ...RPC],
  }),
  operations: spec({
    summary: "List this agent's undo/redo history",
    method: "operations",
    usage: "--session ID",
    flags: ["session", ...RPC],
  }),
  tasks: spec({
    summary: "List generation tasks: who submitted each (me / agent / human), status and timing",
    method: "tasks",
    // --node / --status 可重复（也接受逗号分隔）；--scope 只放宽列表，别的画布的节点仍然动不了。
    usage:
      "[--node ID (repeatable) --status queued|running|succeeded|failed|cancelled (repeatable) --submitter me|agent|human --since ISO --scope canvas|project|all --limit N --after CURSOR]",
    flags: ["session", "node", "status", "submitter", "since", "scope", "limit", "after", ...RPC],
  }),
  changes: spec({
    summary: "Observe human and remote updates since a sequence number",
    method: "changes",
    usage: "[--since-seq N --since-epoch EPOCH]",
    flags: ["session", "since-seq", "since-epoch", ...RPC],
  }),
  timeline: spec({
    summary: "Read or write the canvas timeline",
    method: "timeline",
    usage: "[list|set|append|remove|reorder|clear] [--op OP] [--file request.json]",
    positionals: "optional op",
    flags: ["session", "op", ...RPC],
  }),
  "turn-end": spec({
    summary: "Clear this agent's presence cursor",
    method: "end_turn",
    usage: "--session ID",
    flags: ["session", ...RPC],
  }),
  upload: spec({
    summary: "Import a workspace file into the paired canvas",
    usage: "<workspace-file> [--mime TYPE --title TITLE --x N --y N --label TEXT]",
    positionals: "workspace file path",
    // 同 tidy：upload 也拿 rpcOptions（cli.mjs 的 `upload(session, …, rpcOptions)`），
    // 25 MB 的上传恰恰是最需要 --wait 阻塞等待的那一条。
    flags: ["session", "path", "mime", "title", "x", "y", "label", ...RPC_OPTIONS],
  }),
  download: spec({
    summary: "Download a node's output or a listed resource",
    usage: "<node-id> --out workspace-file [--resource ID --overwrite]",
    positionals: "node ID",
    flags: ["session", "node", "out", "resource", "overwrite"],
  }),
  "inspect-media": spec({
    summary: "Media metadata, optionally downloading the body",
    usage:
      "<node-id> [--resource ID --out workspace-file --overwrite --probe] (without --out: no media download)",
    positionals: "node ID",
    flags: ["session", "node", "resource", "out", "overwrite", "probe"],
  }),
  frames: spec({
    summary: "Extract a bounded frame sample with installed ffmpeg",
    usage: "<node-id> --out-dir new-workspace-directory [--resource ID --every SECONDS --count N]",
    positionals: "node ID",
    flags: ["session", "node", "out-dir", "resource", "every", "count"],
  }),
};

/**
 * `tidy` 的 apply 命令体。抽成纯函数是为了能像 `parseArgs` 一样直接单测 ——
 * 作用域判断错一次的代价是「悄悄整理了整张画布」，那是这条命令唯一不可逆的失败模式。
 *
 * 与页面侧的两条不变量保持一致（`coerceAgentCommand` 的 `case "tidy"` 与 `applyTidy`）：
 *  - 作用域只看「字段有没有给」，不看长度；
 *  - 逗号切分后为空**绝不**退化成全画布 —— 筛出 0 个 id 的作用域必须报错。
 */
export function tidyCommand(options) {
  const ids = (raw) =>
    String(raw)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const scope = {};
  if (options.nodes !== undefined) scope.nodeIds = ids(options.nodes);
  if (options.groups !== undefined) scope.groupIds = ids(options.groups);
  const scoped = scope.nodeIds !== undefined || scope.groupIds !== undefined;
  if (scope.nodeIds?.length === 0)
    throw new CliError("invalid_argument", "--nodes listed no node ID");
  if (scope.groupIds?.length === 0)
    throw new CliError("invalid_argument", "--groups listed no group ID");
  if (options.scope !== undefined) {
    // 整理画布：保守的一趟，不动手工摆放的东西，所以不受 `--all` 那道闸约束。
    const mode = String(options.scope);
    if (!TIDY_SCOPES.includes(mode))
      throw new CliError("invalid_argument", `--scope must be one of: ${TIDY_SCOPES.join(", ")}`);
    if (options.all)
      throw new CliError("invalid_argument", "tidy takes either --scope or --all, never both");
    if (mode === "selection" && !scoped)
      throw new CliError("invalid_argument", "--scope selection needs --nodes and/or --groups");
    return {
      type: "tidy",
      ...scope,
      scope: mode,
      ...(options["fit-frames"] ? { fitFrames: true } : {}),
    };
  }
  if (options["fit-frames"])
    throw new CliError("invalid_argument", `--fit-frames needs --scope ${TIDY_SCOPES.join("|")}`);
  if (options.all && scoped)
    throw new CliError(
      "invalid_argument",
      "tidy takes either --all or --nodes/--groups, never both",
    );
  if (!options.all && !scoped)
    throw new CliError(
      "invalid_argument",
      `tidy needs --all for the whole canvas, or --nodes a,b,c / --groups g1,g2 to scope it (or --scope ${TIDY_SCOPES.join("|")} for the conservative canvas tidy). A whole-canvas tidy moves work the user placed by hand and lands as one Agent undo step, which the human's Ctrl+Z cannot reverse, so it has to be asked for`,
    );
  return { type: "tidy", ...scope };
}

/**
 * `resize-group` 的命令体。与 `tidyCommand` 同一形状：CLI 这一层把参数拼成桥层
 * 认识的那条命令，页面侧的判定（`fit` 与 `size` 二选一、`size` 必须为正、夹在
 * 成员地板上）照旧由桥层再走一遍。
 *
 * `--absorb-strays` 是这条命令唯一会改**成员归属**的开关，所以它：
 *  · 默认关闭 —— 不给就是今天的行为：改框只动几何，一个归属都不改；
 *  · 只收无主散件 —— 已经属于别的组的节点绝不抢（`absorbStrayNodes`）。
 * 这不是洁癖：产品曾经让「把框拉大留点白」自动收编框下的散图，回头
 * `delete_node <组>` 连框带成员一起删，用户因此丢过成片。
 */
export function resizeGroupCommand(options, groupId) {
  if (!groupId)
    throw new CliError(
      "invalid_argument",
      "resize-group needs a group ID (positional, or --group GROUP-ID)",
    );
  const wantsFit = options.fit === true;
  const hasSize = options.size !== undefined;
  if (wantsFit && hasSize)
    throw new CliError("invalid_argument", "resize-group takes either --fit or --size, never both");
  if (!wantsFit && !hasSize)
    throw new CliError(
      "invalid_argument",
      "resize-group needs --fit (fit the frame to its members) or --size WIDTHxHEIGHT",
    );
  const command = { type: "resize_group", nodeId: String(groupId) };
  if (wantsFit) command.fit = true;
  else {
    const hit = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(options.size).trim());
    if (!hit)
      throw new CliError(
        "invalid_argument",
        "--size must be WIDTHxHEIGHT in pixels, e.g. --size 1800x1200",
      );
    const width = Number(hit[1]);
    const height = Number(hit[2]);
    if (!(width > 0) || !(height > 0))
      throw new CliError("invalid_argument", "--size needs a positive width and height");
    command.size = { width, height };
  }
  if (options["absorb-strays"]) command.absorbStrays = true;
  return command;
}

/** 这条命令允许出现的 flag 集合（含所有命令都允许的 --help/--version）。 */
export function allowedFlags(command) {
  const entry = COMMAND_SPEC[command];
  if (entry === undefined) return undefined;
  return new Set([...entry.flags, ...ALWAYS]);
}

/** 名字最接近的合法 flag —— 错一个字母时告诉调用方要打什么，而不是只说「不认识」。 */
export function nearestFlag(key, allowed) {
  let best,
    bestScore = 0;
  for (const candidate of allowed) {
    if (candidate === "help" || candidate === "version") continue;
    const score = similarity(key, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // 0.6 是经验阈值：够 `--node`→`--nodes`、`--group`→`--groups` 这类打字错，
  // 又不会把毫不相干的 flag 猜成建议。
  return bestScore >= 0.6 ? best : undefined;
}
function similarity(a, b) {
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length === 0) return 1;
  return (longer.length - distance(longer, shorter)) / longer.length;
}
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
