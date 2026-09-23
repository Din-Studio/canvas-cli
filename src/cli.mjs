import { fileURLToPath } from "node:url";
import { CliError, MAX_BODY, UUID, errorResult, parseObject } from "./common.mjs";
import { call, connect, processAlive, sessionRequest } from "./client.mjs";
import { readSession, readWorkspaceFile } from "./session.mjs";
import { download, frames, inspectMedia, upload } from "./media.mjs";
// 渲染本身住在包里可复用的一层（页面的 `apply` 也用同一份），这里只负责「装饰回包」。
import { formatTidySummary } from "./tidy-summary.mjs";
import {
  COMMAND_SPEC,
  allowedFlags,
  nearestFlag,
  resizeGroupCommand,
  tidyCommand,
} from "./spec.mjs";

const VERSION = "0.13.0";
const FLAGS = new Set([
  "session",
  "origin",
  "name",
  "workspace",
  "delegate",
  "json",
  "file",
  "text-file",
  "node",
  "resource",
  "model-type",
  "model-id",
  "query",
  "field",
  "expect-sha",
  "label",
  "turn",
  "request-id",
  "path",
  "out",
  "mime",
  "title",
  "x",
  "y",
  "kind",
  // run-tool：带 prompt 的编辑类工具（重绘 / 推演 / 编辑元素）与带档位的超清类
  "prompt",
  "resolution",
  "status",
  "limit",
  "after",
  "glob",
  "offset",
  "fields",
  "since-seq",
  "since-epoch",
  "steps",
  "turns",
  "op",
  "out-dir",
  "every",
  "count",
  "nodes",
  "group",
  "groups",
  "all",
  "batch",
  "concurrency",
  "rerun-succeeded",
  "fresh",
  "approved",
  "overwrite",
  "long",
  "fixed",
  "ignore-case",
  "files-only",
  "has-output",
  "tag",
  "tags",
  "probe",
  "submitter",
  "since",
  "scope",
  "fit",
  "size",
  "absorb-strays",
  "wait",
  "wait-ms",
  "fit-frames",
  "help",
  "version",
]);
/** 可重复出现、聚成数组的 flag：`--tag 人物设定 --tag 终稿`。其余 flag 重复即报错。 */
const REPEATABLE = new Set(["tag"]);
/**
 * 只在某条命令下可重复的 flag。`tasks --node A --node B --status failed --status running`：
 * `--node` 在其它命令里是单值（`options.node || positionals[0]`），不能全局改成数组，
 * 所以按命令放开。命令名出现之前的 `--node` 仍按单值解析——与 `--count` 同一类边角。
 */
const REPEATABLE_BY_COMMAND = { tasks: new Set(["node", "status"]) };
function repeatable(key, command) {
  return REPEATABLE.has(key) || REPEATABLE_BY_COMMAND[command]?.has(key) === true;
}
const BOOLEANS = new Set([
  "all",
  "fit-frames",
  "fit",
  "absorb-strays",
  "rerun-succeeded",
  "fresh",
  "approved",
  "overwrite",
  "long",
  "fixed",
  "ignore-case",
  "files-only",
  "has-output",
  "probe",
  "wait",
  "help",
  "version",
]);
/**
 * `--count` 是 grep 的布尔开关、frames 的数量。出现在命令名**之前**时无从按命令判断，
 * 只能看紧跟的 token 是不是数字 —— 修掉 `--count 12 frames N`（12 被当成命令名）和
 * `--count=12 frames N`（被当成「布尔 flag 不接受取值」）这两种误解析。
 * 命令名已知时行为与原来逐字一致：frames 取值、其余布尔。
 */
function takesValue(key, command, next, hasEq) {
  if (key !== "count") return !BOOLEANS.has(key);
  if (command === "frames") return true;
  if (command !== undefined) return false;
  return hasEq ? true : next !== undefined && /^\d+(\.\d+)?$/.test(next);
}

export function parseArgs(argv) {
  const options = {},
    positionals = [];
  let command;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = arg.slice(2, eq === -1 ? undefined : eq);
      if (!FLAGS.has(key)) throw new CliError("invalid_argument", `Unknown option --${key}`);
      if (repeatable(key, command)) {
        const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
        if (value === undefined || (eq === -1 && value.startsWith("--")))
          throw new CliError("invalid_argument", `--${key} requires a value`);
        (options[key] ??= []).push(value);
        continue;
      }
      if (Object.hasOwn(options, key))
        throw new CliError("invalid_argument", `Duplicate option --${key}`);
      if (!takesValue(key, command, argv[i + 1], eq !== -1)) {
        if (eq !== -1)
          throw new CliError("invalid_argument", `--${key} is a flag and does not take a value`);
        options[key] = true;
      } else {
        const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
        if (value === undefined || (eq === -1 && value.startsWith("--")))
          throw new CliError("invalid_argument", `--${key} requires a value`);
        options[key] = value;
      }
    } else if (!command) command = arg;
    else positionals.push(arg);
  }
  return { command: command || "help", options, positionals };
}
/** `--tags a,b`：逗号分隔、逐个 trim、丢空项；`--tags ""` 就是清空。去重与上限由页面校验。 */
export function splitTags(raw) {
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
function numberOption(options, key, params, target = key) {
  if (options[key] === undefined) return;
  const value = Number(options[key]);
  if (!Number.isFinite(value)) throw new CliError("invalid_argument", `--${key} must be a number`);
  params[target] = value;
}
async function stdinText() {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw new CliError("too_large", "stdin exceeds 36 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function paramsFrom(options, session) {
  if (options.json !== undefined && options.file !== undefined)
    throw new CliError("invalid_argument", "Use either --json or --file");
  if (options.json !== undefined) return parseObject(options.json);
  if (options.file !== undefined)
    return parseObject(
      options.file === "-"
        ? await stdinText()
        : (await readWorkspaceFile(session.workspace, options.file, MAX_BODY)).bytes.toString(
            "utf8",
          ),
    );
  return {};
}
const OUTPUT_LINE =
  "One JSON value per invocation. Exit 0 success, 1 business failure, 2 arguments/files, 3 connection/auth, 4 unknown outcome.";

/**
 * help 与 flag 校验同源（`COMMAND_SPEC`），所以「文档写着的 flag 实现不认」这类漂移
 * 结构上不可能再出现。`scenemint-canvas <command> --help` 只回这条命令。
 */
function help(command) {
  const entry = command === undefined ? undefined : COMMAND_SPEC[command];
  if (entry !== undefined)
    return {
      ok: true,
      name: "scenemint-canvas",
      version: VERSION,
      command,
      summary: entry.summary,
      usage: `scenemint-canvas ${command} ${entry.usage}`,
      ...(entry.positionals ? { positionals: entry.positionals } : {}),
      ...(entry.method ? { method: entry.method } : {}),
      flags: entry.flags.map((flag) => `--${flag}`),
      output: OUTPUT_LINE,
    };
  return {
    ok: true,
    name: "scenemint-canvas",
    version: VERSION,
    usage: "scenemint-canvas <command> --session <UUID> [options]",
    commands: Object.fromEntries(
      Object.entries(COMMAND_SPEC).map(([name, value]) => [name, value.usage]),
    ),
    sharedOptions:
      "--session ID is required except connect/help/skill-path (connect --session ID reuses that session when its daemon and page are alive, otherwise replaces it). Every flag is checked against the command: an option this command does not read is an error, not a silently dropped argument. `scenemint-canvas <command> --help` lists that command's own flags. --json OBJECT or --file FILE/- pass complete params to the commands that take them; --turn NAME groups undo history; --request-id UUID permits same-payload result lookup without re-executing a request. While the page is away (status.pageAway) a read answers page_away within 5 s and is not queued; a mutation is queued and answers page_away+queued after --wait-ms (default 30000) unless --wait blocks for the whole recovery window.",
    output: OUTPUT_LINE,
    pairing:
      "Keep the SceneMint page open. In the current canvas click Connect Agent and paste the single connectionCode from connect into Add connection. Each task gets a separate identity. Pair codes expire after 10 minutes.",
  };
}
export async function execute(argv) {
  const { command, options, positionals } = parseArgs(argv);
  if (options.version) return { ok: true, version: VERSION };
  if (command === "help" || options.help)
    return help(command === "help" ? positionals[0] : command);
  // 命令面与 flag 接受面的唯一来源是 COMMAND_SPEC。对这条命令无意义的 flag 一律报错：
  // 原来它们会被静默丢弃，于是 `cancel-batch --group G` 撤掉全部批次、
  // `ls --offset 50` 永远读第一页，都没有任何关卡。
  const allowed = allowedFlags(command);
  if (allowed === undefined) throw new CliError("invalid_argument", `Unknown command: ${command}`);
  for (const key of Object.keys(options))
    if (!allowed.has(key)) {
      const near = nearestFlag(key, allowed);
      throw new CliError(
        "invalid_argument",
        `--${key} is not an option of ${command}${near === undefined ? "" : `; did you mean --${near}?`}`,
      );
    }
  if (command === "frames" && options.count === true)
    throw new CliError(
      "invalid_argument",
      "--count for frames needs a number; put it after the command name (frames NODE --count 12) or write --count=12",
    );
  if (command === "skill-path")
    return {
      ok: true,
      path: fileURLToPath(new URL("../skills/scenemint-canvas/", import.meta.url)),
    };
  if (command === "connect") return connect(options);
  if (!options.session)
    throw new CliError(
      "invalid_session",
      "--session is required; do not share another task’s session",
    );
  const session = await readSession(options.session);
  if (command === "status") {
    const result = await sessionRequest(session, "/v1/status");
    // Unreachable daemon: say whether its process is even there. A host that
    // kept a session file across its own restart reads this before reusing it.
    if (result?.ok === false && result.error?.code === "connection_failed")
      return {
        ...result,
        error: {
          ...result.error,
          daemonPid: session.pid ?? null,
          daemonAlive: processAlive(session.pid),
        },
      };
    return result;
  }
  if (command === "disconnect" || command === "stop")
    return sessionRequest(session, "/v1/stop", {});
  if (command === "delegate") {
    if (!options.name || !options.workspace)
      throw new CliError("invalid_argument", "delegate requires --name and --workspace");
    return sessionRequest(
      session,
      "/v1/delegate",
      { name: options.name, workspace: options.workspace },
      { mutation: true },
    );
  }
  if (command === "revoke") {
    if (!UUID.test(options.delegate || ""))
      throw new CliError(
        "invalid_argument",
        "revoke requires --delegate with the worker session UUID",
      );
    return sessionRequest(
      session,
      "/v1/revoke",
      { sessionId: options.delegate },
      { mutation: true },
    );
  }
  const requestId = options["request-id"];
  if (requestId && !UUID.test(requestId))
    throw new CliError("invalid_argument", "--request-id must be a UUID v4");
  if (options.wait && options["wait-ms"] !== undefined)
    throw new CliError("invalid_argument", "Use either --wait or --wait-ms");
  const waitMs = options["wait-ms"] === undefined ? undefined : Number(options["wait-ms"]);
  if (waitMs !== undefined && (!Number.isInteger(waitMs) || waitMs < 0))
    throw new CliError("invalid_argument", "--wait-ms must be a non-negative integer");
  const rpcOptions = {
    ...(requestId ? { requestId } : {}),
    ...(options.turn ? { turnId: options.turn } : {}),
    ...(options.wait ? { wait: true } : {}),
    ...(waitMs !== undefined ? { waitMs } : {}),
  };
  const nodeId = options.node || positionals[0];
  if (command === "upload")
    return upload(session, options.path || positionals[0], options, rpcOptions);
  if (command === "download")
    return download(session, nodeId, options.out, {
      overwrite: options.overwrite,
      resource: options.resource,
    });
  if (command === "inspect-media") return inspectMedia(session, nodeId, options);
  if (command === "frames") return frames(session, nodeId, options);
  const params = await paramsFrom(options, session);
  if (command === "models") {
    if (positionals[0]) params.query = positionals[0];
    for (const [flag, key] of [
      ["model-type", "modelType"],
      ["model-id", "modelId"],
      ["query", "query"],
    ])
      if (options[flag] !== undefined) params[key] = options[flag];
    numberOption(options, "limit", params);
    numberOption(options, "offset", params);
  }
  if (command === "resources") {
    if (nodeId) params.nodeId = nodeId;
    if (!params.nodeId) throw new CliError("invalid_argument", "resources requires a node ID");
    numberOption(options, "limit", params);
    numberOption(options, "offset", params);
  }
  if (command === "ls") {
    if (positionals[0]) params.path = positionals[0];
    if (options.path) params.path = options.path;
    if (options.long) params.long = true;
    if (options["has-output"]) params.hasOutput = true;
    for (const key of ["glob", "after"]) if (options[key] !== undefined) params[key] = options[key];
  }
  if (command === "read") {
    if (positionals.length) params.paths = positionals;
    else if (options.path || options.node) params.paths = [options.path || options.node];
    if (!Array.isArray(params.paths) || params.paths.length === 0)
      throw new CliError("invalid_argument", "read requires one or more paths or node IDs");
  }
  if (command === "grep") {
    if (positionals[0] !== undefined) params.pattern = positionals[0];
    if (typeof params.pattern !== "string")
      throw new CliError("invalid_argument", "grep requires a pattern");
    for (const key of ["path", "glob"]) if (options[key] !== undefined) params[key] = options[key];
    for (const [key, target] of [
      ["fixed", "fixed"],
      ["ignore-case", "ignoreCase"],
      ["files-only", "filesOnly"],
      ["count", "count"],
    ])
      if (options[key]) params[target] = true;
    if (options.fields) params.fields = options.fields.split(",");
  }
  if (command === "ls" || command === "grep") {
    for (const key of ["kind", "status"]) if (options[key]) params[key] = options[key].split(",");
    // --tag 可重复，值原样传（标签本身可以含逗号），任一命中、不分大小写。
    if (options.tag) params.tag = options.tag;
  }
  if (["ls", "grep", "read"].includes(command)) numberOption(options, "limit", params);
  if (command === "snapshot") numberOption(options, "limit", params, "maxNodes");
  if (command === "health") numberOption(options, "limit", params, "maxIssues");
  if (["grep", "read"].includes(command)) numberOption(options, "offset", params);
  if (command === "apply") {
    if (options.tags !== undefined) {
      if (options.file || options.json || options["text-file"])
        throw new CliError(
          "invalid_argument",
          "--tags cannot be combined with --json, --file or --text-file",
        );
      if (!nodeId)
        throw new CliError("invalid_argument", "Tag writes require --node (or a node ID)");
      params.commands = [
        { type: "update_node", nodeId, draft: { assetTags: splitTags(options.tags) } },
      ];
    }
    if (options["text-file"]) {
      if (options.file || options.json)
        throw new CliError(
          "invalid_argument",
          "--text-file cannot be combined with --json or --file",
        );
      if (
        !nodeId ||
        !["prompt", "content", "title"].includes(options.field || "prompt") ||
        !options["expect-sha"]
      )
        throw new CliError(
          "invalid_argument",
          "Whole text writes require --node, --field prompt/content/title, and --expect-sha from read",
        );
      const field = options.field || "prompt";
      const text = (
        await readWorkspaceFile(session.workspace, options["text-file"], MAX_BODY)
      ).bytes.toString("utf8");
      params.commands = [
        {
          type: "update_node",
          nodeId,
          ...(field === "title" ? { title: text } : { draft: { [field]: text } }),
          expect: { [`${field}Sha`]: options["expect-sha"] },
        },
      ];
    }
    if (!Array.isArray(params.commands) || params.commands.length === 0)
      throw new CliError("invalid_argument", "apply requires a nonempty commands array");
    params.label = options.label || params.label || "CLI canvas edit";
  }
  if (command === "tidy") {
    params.commands = [tidyCommand(options)];
    params.label = options.label || "CLI canvas tidy";
  }
  if (command === "resize-group") {
    params.commands = [resizeGroupCommand(options, options.group || positionals[0])];
    params.label = options.label || "CLI resize group";
  }
  if (command === "run-batch") {
    if (options.nodes)
      params.nodeIds = String(options.nodes)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    if (options.group) params.groupId = options.group;
    if (!params.nodeIds && !params.groupId)
      throw new CliError(
        "invalid_argument",
        "run-batch requires --nodes a,b,c and/or --group GROUP-ID",
      );
    numberOption(options, "concurrency", params);
    if (options["rerun-succeeded"]) params.rerunSucceeded = true;
    // 默认重跑保留旧候选；--fresh 才清空同类型旧候选（页面 RunNodesRequest.clearCandidates）。
    if (options.fresh) params.clearCandidates = true;
    if (!options.approved)
      throw new CliError(
        "approval_required",
        "run-batch requires --approved after the user has authorized generation for every target",
      );
    // 只能替 --nodes 里的 id 声明授权；--group 展开后的成员由页面校验，需要用 --json 显式给全清单。
    if (!params.approval) params.approval = { userApprovedNodeIds: [...(params.nodeIds ?? [])] };
    if (
      params.groupId &&
      !(
        Array.isArray(params.approval?.userApprovedNodeIds) &&
        params.approval.userApprovedNodeIds.length
      )
    )
      throw new CliError(
        "approval_required",
        "run-batch --group needs the expanded member IDs in approval.userApprovedNodeIds (pass --json with the full list after reading the group)",
      );
  }
  if (command === "cancel-batch") {
    if (options.batch) params.batchId = options.batch;
  }
  if (command === "run" || command === "cancel") {
    if (nodeId) params.nodeId = nodeId;
    if (!params.nodeId) throw new CliError("invalid_argument", `${command} requires a node ID`);
    if (command === "run" && !options.approved)
      throw new CliError(
        "approval_required",
        "run requires --approved after the user has authorized generation for this task",
      );
    if (command === "run") params.approval = { userApprovedNodeIds: [params.nodeId] };
    if (command === "run" && options.fresh) params.clearCandidates = true;
  }
  if (command === "run-tool") {
    // 工具和 run 一样花钱，所以同一道 --approved。挡在 CLI 这一层是为了**一次网络都不发**
    // 就把「忘了要授权」报出来（和 run / run-batch 同一个形状，见上面两处）。
    if (nodeId) params.nodeId = nodeId;
    if (!params.nodeId) throw new CliError("invalid_argument", "run-tool requires a node ID");
    if (!options.kind)
      throw new CliError(
        "invalid_argument",
        "run-tool requires --kind (the toolbar tool id, e.g. separate-vocal)",
      );
    params.kind = String(options.kind);
    if (options.prompt !== undefined) params.prompt = String(options.prompt);
    if (options.resolution !== undefined) params.resolution = String(options.resolution);
    if (options.title !== undefined) params.title = String(options.title);
    if (!options.approved)
      throw new CliError(
        "approval_required",
        "run-tool requires --approved after the user has authorized this tool run for this node",
      );
    params.approval = { userApprovedNodeIds: [params.nodeId] };
  }
  if (command === "undo" || command === "redo") {
    numberOption(options, "steps", params);
    numberOption(options, "turns", params);
  }
  if (command === "tasks") Object.assign(params, tasksParams(options, positionals));
  if (command === "changes") {
    numberOption(options, "since-seq", params, "sinceSeq");
    // 游标是「序号 + 它属于哪条 feed」两件东西。只带序号的续读页面一律按
    // feed_restarted 回 —— 它证明不了这个数字还有效，而「什么都没发生」是
    // 这里唯一不能猜错的答案。
    if (options["since-epoch"] !== undefined) params.sinceEpoch = String(options["since-epoch"]);
  }
  if (command === "timeline") params.op = options.op || positionals[0] || params.op || "list";
  const result = await call(session, COMMAND_SPEC[command].method, params, rpcOptions);
  // 会话 id 要一路带到渲染里：体检报告承诺「这一行可以原样粘贴」，而没有
  // `--session` 的 argv 粘过去只会拿到 not_connected（退出码 3）。
  return decorate(command, result, options.session);
}

/**
 * 回包里「弱模型读 JSON 数组会漏」的部分，再排成一行行人话跟原始字段一起回。
 * 抽成纯函数是为了能直接单测「哪些命令带、带的是什么」——渲染函数单测过、
 * 却根本没接到 `execute` 上，正是 `tidied` 走丢的那一档故障。
 */
export function decorate(command, result, sessionId) {
  // 弱模型读表比读 JSON 数组稳：把 rows 再排成一张定宽文本表，跟原始字段一起回。
  if (command === "tasks" && result?.ok === true && Array.isArray(result.rows))
    return { ...result, table: formatTasksTable(result.rows) };
  // tidy / apply 的 `tidied[]` 是「整理到底动了什么」的唯一出口，尤其是 strays ——
  // 整理拒绝去动的出框 / 压框节点，是 Agent 唯一能知道「这里需要人来处理」的通道。
  // 宿主把回包压成一句「已应用 N 条命令」时它整段丢失，所以这里先渲染成文本。
  // A5 —— 体检的结论是给**弱模型**读的：分类计数 + 每类前几条明细 + 可直接执行的
  // 修复命令，全部排成文本。原始 `issues[]` 照旧一起回，两者并存。
  if (command === "health" && result?.ok !== false && Array.isArray(result?.issues))
    return { ...result, report: formatHealthReport(result, sessionId) };
  if (
    (command === "tidy" || command === "apply") &&
    result?.ok === true &&
    Array.isArray(result.tidied) &&
    result.tidied.length > 0
  )
    // 新页面自己就带 `tidySummary`（两条路径都带），那一份优先：装饰只是给老页面
    // 兜底，不许把页面给的那句话覆盖掉。
    return {
      ...result,
      tidySummary:
        typeof result.tidySummary === "string" && result.tidySummary
          ? result.tidySummary
          : formatTidySummary(result.tidied),
    };
  return result;
}

/** 每一类在文本报告里最多列几条明细；其余靠计数说话。 */
const HEALTH_DETAIL_PER_KIND = 3;

/**
 * 「这些修复行怎么跑」——**一次**说清，而不是往每一行 argv 里塞 `--session`。
 *
 * 报告以前只写「可以原样粘贴」，而渲染出来的 argv 不带 `--session`：直接在 shell
 * 里粘贴拿到的是 `not_connected`（退出码 3），模型拿着这个退出码去猜画布出了什么
 * 事。但把 `--session` 塞进每一行也不对，而且更糟：宿主（灵映客户端把本 CLI 注册
 * 成 `canvas_cli`）走 `injectSession`，argv 里**任何位置**出现 `--session` 都是
 * `SESSION_NOT_ALLOWED` —— 今天能原样粘贴的那一条会变成硬错。
 *
 * 所以 argv 保持契约里那一份（PROTOCOL：「an argv a caller can run verbatim」），
 * 两种调用方式的差别用一句话交代，并且在知道会话 id 的时候把它原字写出来，省得
 * shell 那一侧还要自己去翻。
 */
function howToRunFixes(sessionId) {
  return sessionId
    ? `修复命令按 argv 原样给出：宿主（canvas_cli）自己补会话；直接在 shell 里跑要在末尾加 --session ${sessionId}。`
    : "修复命令按 argv 原样给出：宿主（canvas_cli）自己补会话；直接在 shell 里跑要在末尾加 --session <本次会话 UUID>。";
}

/**
 * 类别 → 一句中文抬头，让「node_overlap」这种机器名不必被模型自己翻译。
 *
 * **必须与 `CANVAS_CONTRACT.health.issueKinds` 一一对应**，由 test/health.test.mjs
 * 逐字钉死。少一条不会报错、只会让那一类在报告里退化成一个光秃秃的机器名 —— 而
 * 这份报告存在的全部理由就是让弱模型不必自己翻译 `node_overlap`。导出只为让那条
 * 闸能读到它。
 */
export const HEALTH_KIND_TITLES = {
  dangling_mention: "悬空引用（提示词 @ 了不存在的节点，跑起来会少带参考且照样计费）",
  member_escaped: "成员出框（是这个组的成员，却露在框外）",
  group_frame_oversize: "组框过大（框比成员实际占地大太多，看着像还没生成完）",
  stray_over_frame: "散节点压框（不是成员，却压在组框上，人眼会以为它在组里）",
  group_overlap: "组框重叠（两个组的框互相压住）",
  node_overlap: "节点重叠（两张图叠在一起，后面那张看不到）",
  group_empty: "空组（一个成员都没有）",
  group_undersized: "成员太少（低于契约的下限）",
};

/**
 * 体检结论的文本版。
 *
 * 为什么必须有：`issues[]` 是一个可能上百条的对象数组，弱模型读它的方式是「看前
 * 两条然后开始动手」。文本版把**分类计数**放在最前面（先知道规模），每类只列前
 * 三条明细，并把每条的修复 argv 拼成一行可以跑的命令 —— 以及**一句**说清这一行
 * 在两种调用方式下各自怎么跑（`howToRunFixes`）。
 * 截断同样必须显式：`truncated` 时第一段就写明「明细没列全」，不能让一张被截的
 * 表被读成「就这些」。
 */
export function formatHealthReport(result, sessionId) {
  const scanned = result.scanned ?? {};
  const head = `画布 ${result.canvasId ?? "?"}（rev ${result.rev ?? "?"}）：扫了 ${scanned.nodes ?? 0} 个节点 / ${scanned.groups ?? 0} 个组`;
  if (!result.issues.length && !result.totalIssues) return `${head}，没发现几何/引用问题。`;
  const lines = [`${head}，共 ${result.totalIssues ?? result.issues.length} 条问题。`];
  if (result.truncated)
    lines.push(
      `注意：明细只列了 ${result.issues.length} 条，还有 ${result.omittedIssues ?? 0} 条没列出来（下面的分类计数是全量的）。要看全部明细：--limit 1000。`,
    );
  lines.push("", howToRunFixes(sessionId), "", "分类计数：");
  const counts = result.counts ?? {};
  const kinds = Object.keys(counts).filter((kind) => counts[kind] > 0);
  const width = Math.max(0, ...kinds.map((k) => k.length));
  for (const kind of kinds)
    lines.push(
      `  ${kind.padEnd(width)}  ${String(counts[kind]).padStart(4)}  ${HEALTH_KIND_TITLES[kind] ?? ""}`.trimEnd(),
    );
  for (const kind of kinds) {
    const rows = result.issues.filter((issue) => issue.kind === kind);
    if (rows.length === 0) continue;
    // 每一类都要自己说清「这一类还有几条没列出来」。顶部那句 `omittedIssues` 是
    // **全体**的合计，读它推不出某一类被砍掉多少 —— 而弱模型的下一步（要不要
    // 再 `--limit` 一次、要不要先跟用户说「这一类有 49 万条」）恰恰按类走。
    const shown = Math.min(rows.length, HEALTH_DETAIL_PER_KIND);
    const hidden = counts[kind] - shown;
    lines.push(
      "",
      `${kind}（全部 ${counts[kind]} 条，下面 ${shown} 条${hidden > 0 ? `，这一类还有 ${hidden} 条没列出来` : ""}）：`,
    );
    for (const issue of rows.slice(0, HEALTH_DETAIL_PER_KIND)) {
      lines.push(`  - ${issue.message}`);
      if (Array.isArray(issue.fix) && issue.fix.length)
        lines.push(`    修复：scenemint-canvas ${issue.fix.join(" ")}`);
    }
  }
  return lines.join("\n");
}

// `formatTidySummary` 现在住在 `./tidy-summary.mjs`（页面侧的 `apply` 也导它，
// 两条路径给出的是逐字相同的一句话）。这里原样再导出一次，旧的导入点不必改。
export { formatTidySummary };

/** 逗号分隔或重复出现都行：`--status failed,running` ≡ `--status failed --status running`。 */
function listOption(raw) {
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

/**
 * `tasks` 的参数体。抽成纯函数是为了能直接单测：这条命令是 Agent 回答「这批是谁跑的」
 * 的唯一依据，flag 翻错一个（比如把 `--submitter me` 丢掉）就会把别人的任务报成自己的。
 * 节点 id 也接受裸 positional：`tasks NODE-A NODE-B`。
 */
export function tasksParams(options, positionals = []) {
  const params = {};
  const nodeIds = listOption([...(options.node ? [].concat(options.node) : []), ...positionals]);
  if (nodeIds) params.nodeIds = nodeIds;
  const status = listOption(options.status ?? []);
  if (status) params.status = status;
  if (options.submitter !== undefined) {
    if (!["me", "agent", "human"].includes(options.submitter))
      throw new CliError("invalid_argument", "--submitter must be me, agent or human");
    params.submitter = options.submitter;
  }
  if (options.scope !== undefined) {
    if (!["canvas", "project", "all"].includes(options.scope))
      throw new CliError("invalid_argument", "--scope must be canvas, project or all");
    params.scope = options.scope;
  }
  if (options.since !== undefined) {
    if (!Number.isFinite(Date.parse(options.since)))
      throw new CliError("invalid_argument", "--since must be an ISO timestamp");
    params.since = new Date(options.since).toISOString();
  }
  numberOption(options, "limit", params);
  if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1))
    throw new CliError("invalid_argument", "--limit must be a positive integer");
  if (options.after !== undefined) params.after = options.after;
  return params;
}

/** 提交者一列：`me` / `agent:名字` / `human` / `?`（老行没记录）。 */
function submitterCell(submitter) {
  if (!submitter) return "?";
  if (submitter.isMe) return "me";
  if (submitter.kind === "agent") return `agent:${submitter.name ?? ""}`;
  if (submitter.kind === "human") return "human";
  return "?";
}

/** 定宽文本表：一行一个任务，列顺序固定，别的画布的任务多一列「在哪」。 */
export function formatTasksTable(rows) {
  const elsewhere = rows.some((row) => row.canvasId !== undefined || row.projectId !== undefined);
  const header = [
    "status",
    "kind",
    "submitter",
    "submittedAt",
    "finishedAt",
    "node",
    "taskId",
    ...(elsewhere ? ["where"] : []),
  ];
  const cells = rows.map((row) => [
    row.status,
    row.kind,
    submitterCell(row.submitter),
    row.submittedAt ?? "",
    row.finishedAt ?? "-",
    row.nodeTitle ? `${row.nodeTitle} (${row.nodeId})` : (row.nodeId ?? "-"),
    row.taskId ?? "(pending)",
    ...(elsewhere
      ? [
          [row.projectName ?? row.projectId, row.canvasName ?? row.canvasId]
            .filter(Boolean)
            .join(" / "),
        ]
      : []),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...cells.map((line) => String(line[i]).length)),
  );
  const line = (values) =>
    values
      .map((v, i) => String(v).padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(header), ...cells.map(line)].join("\n");
}
// 导出只为了让 `contract.mjs` 的 `cliExitCodes` 有闸门可对：契约里那张表由
// test/contract.test.mjs 直接调本函数逐条验，而不是再抄一遍这两个清单。
export function exitCode(result) {
  if (result?.ok !== false) return 0;
  const code = result.error?.code || "";
  if (code === "unknown_outcome") return 4;
  if (
    [
      "not_connected",
      "reconnecting",
      "page_away",
      "connection_failed",
      "connect_failed",
      "unauthorized",
      "invalid_origin",
      "invalid_pair_code",
      "disconnected",
      "session_not_found",
      "protocol_mismatch",
      "delegate_revoked",
    ].includes(code)
  )
    return 3;
  if (
    [
      "invalid_argument",
      "invalid_json",
      "invalid_session",
      "invalid_path",
      "invalid_workspace",
      "workspace_boundary",
      "unsafe_session",
      "file_not_found",
      "file_exists",
      "too_large",
      "approval_required",
    ].includes(code)
  )
    return 2;
  return 1;
}
export async function main() {
  let result;
  try {
    result = await execute(process.argv.slice(2));
  } catch (error) {
    result = errorResult(error);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode(result);
}
