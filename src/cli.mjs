import { resolve as resolvePath } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CliError, MAX_BODY, UUID, errorResult, parseObject } from "./common.mjs";
import { call, connect, processAlive, sessionRequest } from "./client.mjs";
import { SCENE3D } from "./contract.mjs";
import { readSession, readWorkspaceFile, workspacePath } from "./session.mjs";
import { download, frames, inspectMedia, upload } from "./media.mjs";
import {
  CLI_APPLY_DEFAULT_LABEL,
  COMMAND_FIELDS,
  RUN_NODE_FIELDS,
  RUN_NODES_FIELDS,
  SCENE3D_ACTION_FIELDS,
} from "./policy.mjs";
import { awaitRenders, awaitSeconds, saveOutputs } from "./run-await.mjs";
// 渲染本身住在包里可复用的一层（页面的 `apply` 也用同一份），这里只负责「装饰回包」。
import { formatTidySummary } from "./tidy-summary.mjs";
import {
  LINE_BREAK,
  echoId,
  echoMessage,
  echoText,
  echoUrl,
  formatScene3dRenders,
} from "./scene3d-text.mjs";
import {
  COMMAND_SPEC,
  DOCS_SUBCOMMANDS,
  allowedFlags,
  nearestFlag,
  resizeGroupCommand,
  similarity,
  tidyCommand,
} from "./spec.mjs";

const VERSION = "0.18.3";
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
  // timeline：list / clear / cut / trim(reset) / append(导入) 只作用于这一集；
  // export-jianying：按集挑（可重复，见 REPEATABLE_BY_COMMAND）。
  "episode",
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
  // run：三维节点出哪一镜（run_node.shotId）、静帧取那一镜的开头还是镜尾（--frame → run_node.frame，0.16.2）；
  // 0.17.0 起多镜 / 产物 / 联系表格数 / CLI 本地的等与存（--shots / --render / --frames / --await；--out-dir 与
  // frames 共用）。全部带值：两宿主把表外 flag 一律按带值处理，布尔 flag 写在节点 id 前会把 id 吃掉
  // （test/flags.test.mjs 钉住）。run-stills（0.16.2）复用 --shots（all 或逗号分隔的镜头 id）与 --frames（这里是
  // start / end / both），另有布尔 --force（已是最新的、被人或 Agent 换过图的也重出，A71 修订）。
  "shot",
  "frame",
  "shots",
  "render",
  "frames",
  "await",
  "force",
  // snapshot：边的范围（all | touching | none）。
  "edges",
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
  "into",
  "wait",
  "wait-ms",
  "fit-frames",
  // export-jianying：工程组织方式、只出计划不下载（按集挑的 --episode 与 timeline 共用上面那条）、
  // 直写剪映草稿目录（--draft-root 绝对路径；表外目录的用户同意沿用 --approved）。
  "layout",
  "dry-run",
  "draft-root",
  // docs（doc@1 文档库）：栏、类型、文件夹、搜索词、文档 id、正文（--text / --file / --patch）、
  // 版本校验、其余元数据（--meta JSON）。
  "section",
  "type",
  "folder",
  // docs ls --folders：列文件夹（上传的小说一部一个），不列文档。
  "folders",
  "q",
  "id",
  "text",
  "patch",
  "expect-version",
  // docs read --if-version N：手上是第 N 版，没变就不传正文（0.16.2）。
  "if-version",
  "meta",
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
const REPEATABLE_BY_COMMAND = {
  tasks: new Set(["node", "status"]),
  // `export-jianying --episode EP01 --episode EP03`（也接受逗号分隔）。
  "export-jianying": new Set(["episode"]),
};
function repeatable(key, command) {
  return REPEATABLE.has(key) || REPEATABLE_BY_COMMAND[command]?.has(key) === true;
}
const BOOLEANS = new Set([
  "all",
  "force",
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
  "dry-run",
  "folders",
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
  // doc@1 文档库是两个词的子命令：`docs ls` 整体就是命令名（规格表、分级表的键都是它），
  // `help docs ls` 同理。认不出的 `docs xxx` 保持 `docs`，由 execute 报「要跟子命令」。
  if (command === "docs" && DOCS_SUBCOMMANDS.includes(positionals[0]))
    command = `docs ${positionals.shift()}`;
  else if (
    command === "help" &&
    positionals[0] === "docs" &&
    DOCS_SUBCOMMANDS.includes(positionals[1])
  )
    positionals.splice(0, 2, `docs ${positionals[1]}`);
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
/**
 * `--json` 给的不是 JSON：一律带 `path:"--json"`，message 带 JSON 解析报的原因（哪个位置坏了）；值不像 JSON（不以
 * `{` / `[` 开头）而在 workspace 里正好是个文件——把文件路径写进了 `--json`——再给一条改用 `--file` 的 argv：就是这次
 * 的 argv，只把 `--json <path>` 换成 `--file <path>`，节点 id、子命令、--approved / --label 原样留着（B14 P5；复核：
 * 原来只拼 `<command> --file <path>`，run-tool 丢了节点 id、apply 丢了 --approved）。
 */
async function jsonFlagError(error, text, session, argv) {
  if (error?.code !== "invalid_json") return error;
  const value = String(text).trim();
  let file = null;
  if (value && !/^[{[]/.test(value) && !LINE_BREAK.test(value)) {
    try {
      file = (await stat(await workspacePath(session.workspace, value))).isFile() ? value : null;
    } catch {
      // 不是 workspace 里的文件：只回 path
    }
  }
  if (file === null) {
    let reason = error.message;
    try {
      JSON.parse(text);
    } catch (parseError) {
      reason = echoText(parseError?.message ?? reason, 200);
    }
    return new CliError("invalid_json", `--json expects inline JSON text: ${reason}`, {
      path: "--json",
    });
  }
  const command = resendCommand(withFileFlag(argv, file));
  return new CliError(
    "invalid_json",
    `--json expects inline JSON text; ${file} is a file in the workspace, pass it with --file`,
    {
      path: "--json",
      ...(command === null
        ? {}
        : {
            next: [{ command, description: "同一个文件改用 --file 给（--json 只收 JSON 文本）" }],
          }),
    },
  );
}
/** argv 里的 `--json <v>` / `--json=<v>` 换成 `--file <file>`，其余词原样。 */
function withFileFlag(argv, file) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json" && i + 1 < argv.length) {
      out.push("--file", file);
      i += 1;
    } else if (argv[i].startsWith("--json=")) out.push("--file", file);
    else out.push(argv[i]);
  }
  return out;
}
async function paramsFrom(options, session, argv) {
  if (options.json !== undefined && options.file !== undefined)
    throw new CliError("invalid_argument", "Use either --json or --file");
  if (options.json !== undefined) {
    try {
      return parseObject(options.json);
    } catch (error) {
      throw await jsonFlagError(error, options.json, session, argv);
    }
  }
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
  if (command === "docs")
    throw new CliError(
      "invalid_argument",
      `docs needs a subcommand: ${DOCS_SUBCOMMANDS.map((sub) => `docs ${sub}`).join(" | ")}`,
    );
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
  // `run … --wait 90`：`--wait` 是布尔（页面不在时排队等），90 会被当成节点 id 或静默丢掉（A-12）。
  if (command === "run" && options.wait === true) {
    const after = argv[argv.indexOf("--wait") + 1];
    if (after !== undefined && /^\d+(\.\d+)?$/.test(after))
      return {
        ok: false,
        error: {
          code: "invalid_argument",
          message: `--wait 不带数字（${after} 不是它的值）`,
        },
        hint: "要等出片请用 --await <秒>；--wait 是页面不在时的排队等待",
      };
  }
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
    return statusHint(result, session.sessionId);
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
  // `--await` 的截止从 CLI 起算（整条命令的墙钟预算），先在发任何请求之前把参数校验掉。
  const startedAt = Date.now();
  const awaitS = command === "run" ? awaitSeconds(options.await) : 0;
  if (command === "upload")
    return upload(session, options.path || positionals[0], options, rpcOptions);
  if (command === "download")
    return download(session, nodeId, options.out, {
      overwrite: options.overwrite,
      resource: options.resource,
    });
  if (command === "inspect-media") return inspectMedia(session, nodeId, options);
  if (command === "frames") return frames(session, nodeId, options);
  // 剪映草稿目录：读一次页面的 jianying_roots_list（main 专用），再在本机看每条在不在、像不像草稿根。
  if (command === "jianying-roots")
    return (await import("./jianying/roots.mjs")).jianyingRoots(session, rpcOptions);
  // 剪映工程导出：本地命令（读一次页面的 timeline_export，其余全在本机做）。按需加载 ——
  // 它带着页面剪映导出纯函数层打成的那个单文件，别的命令用不着为它多解析 50 KB。
  if (command === "export-jianying")
    return (await import("./jianying/export.mjs")).exportJianying(session, options);
  // doc@1 文档库：自己组参数（读 workspace 里的正文文件、应用 unified diff、写临时阅读副本），
  // 再走 call()。文档库是唯一源数据，这里没有任何本地同步。
  if (command.startsWith("docs ")) {
    const result = await (
      await import("./docs.mjs")
    ).runDocs(command, session, options, positionals, rpcOptions);
    // `docs read --if-version`（0.16.2）被 0.16.1 的对端拒收时同样点明出路。
    return command === "docs read"
      ? explainFieldRejection("documents_get", {}, result, () => peerPackageVersion(session))
      : result;
  }
  const params = await paramsFrom(options, session, argv);
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
  // 取值由页面判（all | touching | none，缺省 all），回包回显 edgeScope。
  if (command === "snapshot" && options.edges !== undefined) params.edges = String(options.edges);
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
    if (options.approved) params.approval = deleteApproval(params.commands);
    params.label = options.label || params.label || CLI_APPLY_DEFAULT_LABEL;
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
    if (command === "run" && options.shot !== undefined) params.shotId = String(options.shot);
    if (command === "run") Object.assign(params, runShotParams(options));
    // 取值原样送：词表由守护进程按 SCENE3D_STILL_FRAMES 判（invalid_request），与 --shot 同一个口径。
    if (command === "run" && options.frame !== undefined) params.frame = String(options.frame);
  }
  if (command === "run-stills")
    Object.assign(params, runStillsParams(options, positionals, params));
  if (command === "run-shot-refs")
    Object.assign(params, runShotRefsParams(options, positionals, params));
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
  if (command === "timeline") {
    params.op = options.op || positionals[0] || params.op || "list";
    if (options.episode !== undefined) params.episode = String(options.episode);
  }
  let result = await call(session, COMMAND_SPEC[command].method, params, rpcOptions);
  // 老页面、老守护进程（升级包时还活着的会话不换进程）带的都是老 policy：不认识的 apply 命令一律
  // 「Unknown or nested apply command」，读不出是谁旧了。批里有 scene3d_apply 时两个出路都点明，
  // Agent 才知道先让用户刷新、再换守护进程，而不是改写命令重试。
  if (
    result?.ok === false &&
    result.error?.code === "invalid_request" &&
    /Unknown or nested apply command/.test(result.error.message ?? "") &&
    Array.isArray(params.commands) &&
    params.commands.some((c) => c?.type === "scene3d_apply")
  )
    result = {
      ...result,
      hint: "画布页面或本地守护进程版本过旧（不认识 scene3d_apply）：先请用户刷新画布标签页后重试；仍报错则 `disconnect` 后重新 `connect`（换成新版守护进程）",
    };
  result = await explainFieldRejection(COMMAND_SPEC[command].method, params, result, () =>
    peerPackageVersion(session),
  );
  if (command === "apply") result = explainPrefab(params, result);
  result = pageAwayHint(result, session.sessionId);
  result = scene3dUnknownOutcome(command, params, result, argv, session.sessionId);
  if (command === "run") {
    const deadline = awaitS > 0 ? startedAt + awaitS * 1000 : undefined;
    if (deadline !== undefined && result?.ok === true && result.pending?.length > 0)
      result = await awaitRenders(session, params.nodeId, params, result, deadline);
    if (options["out-dir"] !== undefined && result?.ok === true && result.outputs?.length > 0)
      result = {
        ...result,
        outputs: await saveOutputs(session, options["out-dir"], result.outputs, deadline),
      };
  }
  // 会话 id 要一路带到渲染里：体检报告承诺「这一行可以原样粘贴」，而没有
  // `--session` 的 argv 粘过去只会拿到 not_connected（退出码 3）。
  return decorate(command, resendStep(result, argv), options.session);
}

/**
 * `collab_offline` 的出路就是原样重发，可页面不知道 argv，只能在 `next[0].command` 写占位串（B9-FX-29 / L2 F13）。
 * CLI 知道：换成这次真正的 argv（单行、可直接执行），去掉 `--session`（宿主自己加）和 `--request-id`（同一个 id
 * 只会取回这次的失败）。太长（大批 --json）就留页面那句，免得回包翻倍。
 */
const RESEND_MAX_CHARS = 4000;
const DROP_ON_RESEND = /^--(session|request-id)(=|$)/;
function shellWord(word) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
/**
 * 排好版的 --json（键之间换行）压成一行；本来就是一行的不动（不重排数字等写法），不是 JSON 就原样（下面按
 * 「还有换行」退回页面那句）。
 */
function compactJson(value) {
  if (!LINE_BREAK.test(value)) return value;
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
}
/**
 * 这次的 argv 重排成单行命令；做不成单行（某个词里有换行，比如不是 JSON 的多行值）回 `null`，调用方留页面那句
 * （00-contract §9：next[].command 是一行可直接执行的 argv；B11-F2-3）。
 */
export function resendCommand(argv) {
  const kept = [];
  for (let i = 0; i < argv.length; i++) {
    const drop = DROP_ON_RESEND.exec(argv[i]);
    if (drop) {
      if (drop[2] === "") i += 1;
    } else if (argv[i] === "--json" && i + 1 < argv.length) {
      kept.push(argv[i], compactJson(argv[i + 1]));
      i += 1;
    } else if (argv[i].startsWith("--json=")) kept.push(`--json=${compactJson(argv[i].slice(7))}`);
    else kept.push(argv[i]);
  }
  // 断行按 LINE_BREAK 认（含 VT / FF / NEL）：next[].command 里一个都不许有（B11 复核）
  if (kept.some((word) => LINE_BREAK.test(word))) return null;
  return kept.map(shellWord).join(" ");
}
function resendStep(result, argv) {
  const next = result?.ok === false && result.error?.code === "collab_offline" && result.error.next;
  if (!Array.isArray(next) || next.length === 0) return result;
  const command = resendCommand(argv);
  if (command === null || command.length > RESEND_MAX_CHARS) return result;
  const dropped = argv.some((word) => /^--request-id(=|$)/.test(word));
  return {
    ...result,
    error: {
      ...result.error,
      next: [
        {
          ...next[0],
          command,
          ...(dropped
            ? {
                description: `${next[0].description ?? ""}（已去掉 --request-id：同一个 id 只会取回这次的失败；要防重复就换一个新的）`,
              }
            : {}),
        },
        ...next.slice(1),
      ],
    },
  };
}

/**
 * `run --shots all|a,b --render still|video|sheet --frames 3|5|9`（0.17.0）→ `run_node` 的
 * `allShots` / `shotIds` / `render` / `sheetFrames`。`--shot` 与 `--shots` 同给、`--frames` 不配
 * `--render sheet`、取值不在契约词表里 → 本地 invalid_argument；镜头存不存在、三选一由页面判。
 */
export function runShotParams(options) {
  const out = {};
  const invalid = (message) => new CliError("invalid_argument", message);
  if (options.shots !== undefined) {
    if (options.shot !== undefined)
      throw invalid("Use either --shot SHOT-ID or --shots all|a,b, not both");
    const raw = String(options.shots).trim();
    if (raw === "all") out.allShots = true;
    else {
      const ids = raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length === 0)
        throw invalid("--shots needs all or a comma-separated list of shot ids");
      out.shotIds = ids;
    }
  }
  const { render, sheetFrames } = SCENE3D.enums;
  if (options.render !== undefined) {
    if (!render.includes(options.render)) throw invalid(`--render must be ${render.join("|")}`);
    out.render = options.render;
  }
  if (options.frames !== undefined) {
    if (options.render !== "sheet") throw invalid("--frames only goes with --render sheet");
    const count = Number(options.frames);
    if (!sheetFrames.includes(count)) throw invalid(`--frames must be ${sheetFrames.join("|")}`);
    out.sheetFrames = count;
  }
  return out;
}

/**
 * 0.17.0 才有的多镜 / 动画入参。本地 policy（0.17.0）认它们，所以拒收只可能来自还是 0.16.x 的对端：
 * 没刷新的画布页面，或升级包时还活着的老守护进程。哪一个旧了由守护进程的 `status.packageVersion` 判
 * （D-81，0.17.0 起才有这个字段）：有且 ≥ 0.17.0 → 旧的是页面；没有 → 两条出路都点明。
 */
const NOT_BEFORE_0_17 = new Set([
  "allShots",
  "shotIds",
  "render",
  "sheetFrames",
  "add_act",
  "update_act",
  "remove_act",
  "start",
  "via",
  "follow",
  "shake",
]);
/**
 * 0.16.2 才有的（B10：0.16.2 与 0.17.0 合流，D-87）：`run_node.frame`、`documents_get.ifVersion` 与整个
 * `run_stills` 方法。拒收它们的是 0.16.1 的对端（灵影 1.9 内置 0.16.1 升级包时还连着的老守护进程、合流前没刷新的
 * 页面）。0.16.x 的守护进程都不报 packageVersion，分不出 0.16.1 还是 0.16.2：沿用「没有 packageVersion = 旧的是
 * 守护进程」那一条，措辞写「0.16.2 起才有」。
 */
const NOT_BEFORE_0_16_2 = new Set(["frame", "ifVersion"]);
/**
 * 0.16.3 才有的三维字段（并行线，B12 合流 D-91）：set_figure 的座面 / 前倾 / 持物，add_shot / update_shot 的起止状态
 * 与子镜头。拒收它们的对端早于 0.16.3：0.16.1 / 0.16.2 的守护进程或页面，还有合流前的 0.17.0 守护进程（main 上的
 * B11，与本包同报 0.17.0）——packageVersion 分不出旧的是哪一边，两条出路都点明（见 oldPeerHint）。
 */
const NOT_BEFORE_0_16_3 = new Set(["seat", "lean", "heldL", "heldR", "states", "cuts"]);
/**
 * 0.18.2 才有的三维字段（A102 ⑧，在场模型，契约 `SCENE3D.presence`）：set_figure 的 `offstage`，add_act / update_act 的
 * `do`（"@enter" / "@offstage"）。拒收它们的是 0.18.1 或更早的对端：没刷新的画布页面，或升级包时还活着的老守护进程。
 * 守护进程从 0.17.0 起都报 packageVersion，按它分（同 0.18.0 那一档）。
 */
const NOT_BEFORE_0_18_2 = new Set(["do", "offstage"]);
/**
 * 拒收所在的那一版的说法：0.18.2 是在场模型，0.18.0 是 run-shot-refs，0.17.0 是多镜 / 动画写法，0.16.3 是座面 / 起止状态 /
 * 子镜头，0.16.2 是站位图 / 镜尾 / 文档版本号。
 */
const SINCE = {
  "0.18.2":
    "这是 0.18.2 起才有的写法（在场模型：set_figure 的 offstage，add_act / update_act 的 do「@enter」进场 /「@offstage」离场）",
  "0.18.0": "这是 0.18.0 起才有的写法（run-shot-refs：一条命令出齐每镜开始 / 结束站位图与预演）",
  "0.17.0": "这是 0.17.0 的多镜 / 动画写法",
  "0.16.3":
    "这是 0.16.3 起才有的写法（set_figure 的 seat / lean / heldL / heldR，镜头的 states / cuts）",
  "0.16.2": "这是 0.16.2 起才有的写法（run --frame、run-stills、docs read --if-version）",
};
/** 拒收的那一端最高是哪一版。 */
const OLDER = {
  "0.18.2": "0.18.1 或更早",
  "0.18.0": "0.17.0 或更早",
  "0.17.0": "0.16.x",
  "0.16.3": "0.16.1 / 0.16.2（或合流并行线之前的 0.17.0 守护进程）",
  "0.16.2": "0.16.1",
};
const MULTI_SHOT_HINT = (since) =>
  `${SINCE[since]}，拒收的对端还是 ${OLDER[since]}：先请用户刷新画布标签页后重试；仍报错则 \`disconnect\` 后重新 \`connect\`（换成新版守护进程）`;
/** status 答了、却没有 packageVersion：守护进程一定是 0.16.x（0.17.0 起每个守护进程都报）。它的 policy 在页面之前就拒，刷新没用。 */
const OLD_DAEMON_HINT = (since) =>
  `${SINCE[since]}，本机守护进程还是 0.16.x（status 没有 packageVersion），是它拒收的：请 \`disconnect\` 后重新 \`connect\`（换成新版守护进程，页面会重新配对）；之后仍报错再请用户刷新画布标签页`;
/**
 * 刷新也修不好的那一档（B9-FX-22）：SceneMint 站点本身部署的还是旧线（测试线 0.16.2、或 0.16.1），刷新只会再拿到
 * 同一个旧页面。页面还不报自己的包版本，CLI 分不出「没刷新」与「站点没升级」，所以每句旧对端提示都带上这条退路：
 * 刷新过一次仍是同一句拒收 → 别再让用户刷新，改用旧线就有的写法。
 */
const SITE_FALLBACK = {
  allShots: "逐镜用 run <nodeId> --shot <shotId>（镜头 id 在 read <nodeId>/scene 的 shots[].id）",
  shotIds: "逐镜用 run <nodeId> --shot <shotId>（镜头 id 在 read <nodeId>/scene 的 shots[].id）",
  render: "这个站点只能出静帧：去掉 --render，逐镜用 run <nodeId> --shot <shotId>",
  sheetFrames: "这个站点只能出静帧：去掉 --render / --frames，逐镜用 run <nodeId> --shot <shotId>",
  frame: "去掉 --frame（这个站点只出开头那一帧）",
  ifVersion: "去掉 --if-version，整篇读",
  "run-stills": "逐镜用 run <nodeId> --shot <shotId> 出静帧",
  // 0.17.0 站点拒收产品场景（剧本转视频建的 s3d-epXX-pYY）的 run --render video：那种场景在旧站点只出得了站位图。
  "run-shot-refs":
    "这个站点只能 run-stills <nodeId> 出每镜开始 / 结束站位图；剧本转视频建的场景（id 形如 s3d-ep01-p02）在这个站点出不了预演（run --render video 会被拒，别再试），自己建的三维节点可以再 run <nodeId> --shots all --render video 出预演",
  ...Object.fromEntries(
    [...NOT_BEFORE_0_18_2].map((key) => [
      key,
      "去掉 do / offstage 再发（这个站点没有在场模型：开场不在、调度进场 / 离场都写不进去）",
    ]),
  ),
  ...Object.fromEntries(
    [...NOT_BEFORE_0_16_3].map((key) => [
      key,
      "去掉 seat / lean / heldL / heldR / states / cuts 再发（这个站点不支持座面绑定、前倾、持物、镜头起止状态与子镜头）",
    ]),
  ),
};
/**
 * `after` 是这一档前面那几步都做过之后（B11-F2：版本不明那一档的前一步是 disconnect / connect，不能同一个
 * 「刷新过一次」既叫你重连、又叫你放弃新写法）。
 */
const SITE_LINE = {
  "0.18.2": "0.18.1 或更早",
  "0.18.0": "0.17.0 或更早",
  "0.17.0": "0.16.x（含测试线 0.16.4）",
  "0.16.3": "0.16.1 / 0.16.2",
  "0.16.2": "0.16.1",
};
const SITE_HINT = (key, since, after = "刷新过一次") =>
  `${after}仍是这句拒收，说明这个 SceneMint 站点部署的还是 ${SITE_LINE[since]}，刷新修不好、不要再让用户刷新：${SITE_FALLBACK[key] ?? `这个站点不支持 ${key}，去掉它（调度 / 运镜这类 0.17.0 写法整类不发）再发`}`;

/** `a.b.c` ≥ 0.17.0（非数字段按 0）。 */
function atLeast017(version) {
  const [major, minor] = String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  return major > 0 || minor >= 17;
}

/** `a.b.c` ≥ `since`（非数字段按 0）。 */
function atLeast(version, since) {
  const a = String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const b = since.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/**
 * 0.18.0 起的档（0.18.0 `run_shot_refs`、0.18.2 在场模型的 `do` / `offstage`）：守护进程报得出包版本（0.17.0 起每个
 * 守护进程都报）就按它分 —— ≥ 这一档旧的是页面（刷新）；更旧的是守护进程自己拒收的（它的 policy 不认这个方法 / 字段，
 * 先 disconnect / connect）。0.16.x 守护进程不报版本（null）同样是它拒收的。查不到（undefined）两条出路都写。
 */
function oldPeerHint018(key, packageVersion, since) {
  if (typeof packageVersion === "string" && packageVersion && atLeast(packageVersion, since))
    return `${key}：${SINCE[since]}，本机守护进程已是 ${packageVersion}，拒收的是还没刷新的画布页面：请用户刷新画布标签页后重试；${SITE_HINT(key, since)}`;
  if (packageVersion === null || (typeof packageVersion === "string" && packageVersion))
    return `${key}：${SINCE[since]}，本机守护进程还是 ${packageVersion ?? "0.16.x（status 没有 packageVersion）"}，是它拒收的：请 \`disconnect\` 后重新 \`connect\`（换成新版守护进程，页面会重新配对）；之后仍报错再请用户刷新画布标签页；${SITE_HINT(key, since, "重新 connect、再刷新过一次之后")}`;
  return `${key}：${MULTI_SHOT_HINT(since)}；${SITE_HINT(key, since, "刷新过、也 disconnect / 重新 connect 过之后")}`;
}

/**
 * 旧对端提示（D-81，fix round 1 收窄）：守护进程报得出 ≥ 0.17.0 的包版本 → 旧的只能是页面；status 答了却
 * 没有这个字段（`null`）或报的是 0.16.x → 旧的是守护进程，先 disconnect / connect；status 没查到
 * （`undefined`，版本不明）→ 先刷新、再 disconnect / connect。每档最后一步是站点退路，触发条件是这一档前面
 * 几步都做过之后仍拒收。
 */
export function oldPeerHint(key, packageVersion, since = "0.17.0") {
  if (since === "0.18.0" || since === "0.18.2") return oldPeerHint018(key, packageVersion, since);
  // 0.16.3 的字段：报 0.17.0 的守护进程也可能是合流前的那一版（同一个版本号），报不出版本的 0.16.x 守护进程也可能是
  // 收它的 0.16.3 / 0.16.4——分不出旧的是哪一边，走版本不明那一档（先刷新、再重连，B12 复核）
  if (since === "0.16.3") packageVersion = undefined;
  if (typeof packageVersion === "string" && packageVersion && atLeast017(packageVersion))
    return `${key}：${SINCE[since]}，本机守护进程已是 ${packageVersion}，拒收的是还没刷新的画布页面：请用户刷新画布标签页后重试；${SITE_HINT(key, since)}`;
  if (packageVersion === null || (typeof packageVersion === "string" && packageVersion))
    return `${key}：${OLD_DAEMON_HINT(since)}；${SITE_HINT(key, since, "重新 connect、再刷新过一次之后")}`;
  return `${key}：${MULTI_SHOT_HINT(since)}；${SITE_HINT(key, since, "刷新过、也 disconnect / 重新 connect 过之后")}`;
}

/**
 * 整个方法都是 0.16.2 才有的（`run_stills`）：0.16.1 的守护进程回「Expected requestId UUID, supported method, …」
 * （invalid_request），0.16.1 的页面回 method_not_allowed「Unknown canvas method」。都补 `hint`。
 */
const METHOD_SINCE = {
  run_stills: { since: "0.16.2", name: "run-stills" },
  run_shot_refs: { since: "0.18.0", name: "run-shot-refs" },
};
const UNKNOWN_METHOD = /supported method|Unknown canvas method/;

/**
 * 只在旧对端那条失败路径上查一次守护进程的 status：答了 → 它报的 packageVersion（0.16.x 没有这个字段 →
 * `null`）；没答（3 s 内连不上）→ `undefined`（版本不明）。
 */
async function peerPackageVersion(session) {
  const status = await sessionRequest(session, "/v1/status", undefined, { timeoutMs: 3000 });
  if (status?.ok !== true) return undefined;
  return typeof status.packageVersion === "string" ? status.packageVersion : null;
}

/**
 * `page_away`（页面离线 / 被浏览器省内存丢弃）：守护进程的 message 不改（闭包冻结），回包顶层补一句
 * 怎么让页面回来、回来之后怎么取结果（D-74）。写命令已排队：不要立刻重发，用同一个 --request-id 取。
 */
/**
 * 标签页被关掉、画布在新标签页里重开（B9-FX-24）：配对凭据只在原标签页的 sessionStorage 里，新标签页接不回这个
 * 会话，只有重新配对能恢复。B11-F2-4 收窄成查得到、不会让写命令跑两次的一支：
 *  · 条件只认 Agent 查得到的——用户说关过 / 在新标签页里重开，或过了 resumeExpiresAt。`reconnecting`、
 *    `pageAway:true` 分不出关掉还是被丢弃 / 刷新（后两种原标签页回来会自己续上、排队的命令照样执行一次）。
 *  · 重新配对是 `connect --session <本会话>` 的语义：页面 60 s 内还来过它回 `reused:true`——关标签后守护进程
 *    最多约 105 s（租约 ~45 s + 60 s）才认，所以用户确认关过就过一分钟再发同一条（B11-int 复核）；
 *    否则停掉旧守护进程、连同排队的命令一起丢掉再配对。宿主里 argv 不许带 --session（injectSession 拒收
 *    SESSION_NOT_ALLOWED），宿主的 `connect` 自己带着存下的会话去探活（s2v canvasConnect）：所以对 Agent 说
 *    「发 `connect`」，`--session` 那种写法只给没有宿主、直接跑 CLI 的场合（B11-int 复核）。
 *  · 新会话里写命令先 ls / read 看生效没有；只有三维出片可以原样重发（按镜幂等，已出的复用）。
 */
function pageClosedHint(sessionId) {
  const direct = `\`connect --session ${sessionId ?? "<本会话 id>"}\``;
  return `只有用户说标签页已经关掉（或在新标签页里重开了画布），或过了 resumeExpiresAt 页面还没回来，才是续不上：请用户打开画布，你发 \`connect\` 重新配对（argv 里不写 --session，宿主带着本会话去探活）——回 reused:false 时它停掉旧会话、连同排队的命令一起丢掉，再给新的连接码；回 reused:true 只说明页面不到一分钟前还在（关标签后守护进程要约 1–2 分钟才认出来），不说明没关：用户确认关了就过一分钟再发同一条 connect，直到回 reused:false 带新的 connectionCode。没有宿主、直接跑 CLI 时写成 ${direct}（--origin / --name / --workspace 同第一次）：不带 --session 的 connect 不停旧会话，原标签页回来会把排队的写命令再执行一次。光是 reconnecting、pageAway:true 不算关掉（被浏览器丢弃、刷新的标签页会自己续上）。新会话里写命令先 ls / read 看生效没有再决定重发；三维出片可以原样重发（已出的镜头复用）`;
}
const pageAwayWriteHint = (sessionId) =>
  `若页面是被浏览器省内存丢弃的：请回到画布标签页（或把站点加入 Chrome 设置 → 性能 →『始终保持活跃』）。排队的命令会在页面回来后自动执行，用同一个 --request-id 取结果；requestId 过期后再原样重发——三维出片幂等，已出的镜头会复用。${pageClosedHint(sessionId)}`;
const pageAwayReadHint = (sessionId) =>
  `请回到画布标签页（或设为『始终保持活跃』）后重发。${pageClosedHint(sessionId)}`;
function pageAwayHint(result, sessionId) {
  if (result?.ok !== false || result.error?.code !== "page_away" || result.hint !== undefined)
    return result;
  return {
    ...result,
    hint: result.error.queued === true ? pageAwayWriteHint(sessionId) : pageAwayReadHint(sessionId),
  };
}
/** 认得出是三维 run 的请求参数（页面按镜出片）。裸 `run <三维节点>` 不带它们，认不出（errata E-113）。 */
const SCENE3D_RUN_KEYS = ["shotId", "shotIds", "allShots", "render", "sheetFrames", "frame"];

/**
 * 三维 run 送到了页面却没拿到答复（页面关掉 / 被浏览器丢弃 / 刷新 / 超时）：守护进程只能回 `unknown_outcome`，
 * 原话叫 Agent 不要重发（怕重复建节点、重复扣费）。三维出片在本地渲染、不是生成扣费项、按镜幂等，重发只会复用已落地的镜：
 * 改写成可重试的 `render_interrupted`，`next` = 这次的 argv 原样重发 + 先看 renders，补『始终保持活跃』提示
 * （B9-FX-48）。`unknown_outcome` 本身避免不了（E-113）；认不出是三维的 run 照旧。
 */
function scene3dUnknownOutcome(command, params, result, argv, sessionId) {
  if (command !== "run" || result?.ok !== false || result.error?.code !== "unknown_outcome")
    return result;
  if (!SCENE3D_RUN_KEYS.some((key) => params?.[key] !== undefined)) return result;
  const resend = resendCommand(argv);
  // 同 resendStep：argv 里真有 --request-id 才说去掉了它
  const dropped = argv.some((word) => /^--request-id(=|$)/.test(word));
  return {
    ...result,
    error: {
      ...result.error,
      code: "render_interrupted",
      message:
        "三维 run 送到了页面，但没拿到答复（标签页关掉、被浏览器丢弃、刷新或超时），没回包的镜头可能还没落地。三维出片在本地渲染、不是生成扣费项、按镜幂等：页面在时原样重发，已落地的镜头复用、不重渲",
      retryable: true,
      next: [
        {
          command:
            resend === null || resend.length > RESEND_MAX_CHARS ? "<刚才那条 run 命令>" : resend,
          description: `请用户回到画布标签页后原样重发${dropped ? "（已去掉 --request-id：同一个 id 只会取回这次的结果）" : ""}；已落地的镜头 result:"reused"`,
        },
        {
          command: `read ${params.nodeId}/renders`,
          description: "重发前也可以先看哪些镜头已经落地",
        },
      ],
    },
    hint: `请用户回到画布标签页（或把站点加入 Chrome 设置 → 性能 →『始终保持活跃』），再原样重发。${pageClosedHint(sessionId)}`,
  };
}
/** `status` 报 `pageAway:true` 时同一句出路：先回原标签页；确认关掉了 / 新标签页接不回才重新配对。 */
function statusHint(result, sessionId) {
  if (result?.ok !== true || result.pageAway !== true || result.hint !== undefined) return result;
  return {
    ...result,
    hint: `页面不在：请用户回到原来的画布标签页。${pageClosedHint(result.sessionId ?? sessionId)}`,
  };
}

/**
 * 「多给即报错」的几句拒收（`Unknown scene3d action op`、`Unexpected scene3d <op> field: <k>`、
 * `Unexpected run_node field: <k>`）不带位置，Agent 在 30 个动作的批里找不到是哪一条。原文不改
 * （本地预检与页面同一份 policy，守护进程闭包冻结），这里补 `error.path`（第一处命中）与顶层
 * `hint`（op / 字段名 + 合法清单）。本地预检拒收与页面拒收是同一句话，一并补；已有 path 的不动。
 */
async function explainFieldRejection(method, params, result, peerVersion) {
  const error = result?.ok === false ? result.error : undefined;
  const message = typeof error?.message === "string" ? error.message : "";
  const born = Object.hasOwn(METHOD_SINCE, method) ? METHOD_SINCE[method] : undefined;
  if (
    born &&
    (error?.code === "invalid_request" || error?.code === "method_not_allowed") &&
    UNKNOWN_METHOD.test(message) &&
    result.hint === undefined
  )
    return { ...result, hint: oldPeerHint(born.name, await peerVersion(), born.since) };
  if (error?.code !== "invalid_request" || error.path !== undefined) return result;
  let path;
  let key;
  let hint;
  // 「对端旧了」只在本地 0.17.0 policy 确实收下这一项时才成立；本地也拒的（拼错的 op、
  // 0.17.0 里该 op 本来就不收的字段）照常报「X 不收 / 合法清单」，否则 Agent 会被支去刷新、重连，
  // 回来还是同一句拒收。
  let oldPeer = false;
  const runField = method === "run_node" && /^Unexpected run_node field: (.+)$/.exec(message);
  const docsField =
    method === "documents_get" && /^Unexpected documents_get field: (.+)$/.exec(message);
  const batchField = method === "run_nodes" && /^Unexpected run_nodes field: (.+)$/.exec(message);
  if (docsField) {
    // documents_get 只有 0.16.2 的 ifVersion 会被对端拒（本地 0.17.0 policy 收它）；别的字段照原样不补。
    key = docsField[1];
    if (!NOT_BEFORE_0_16_2.has(key)) return result;
    path = `documents_get.${key}`;
    oldPeer = true;
  } else if (batchField) {
    // run-batch 不收三维出片参数（0.17.0 收紧，RUN_NODES_FIELDS）：指去逐节点的 run。
    key = batchField[1];
    path = `run_nodes.${key}`;
    hint = `run-batch 不收 ${key}（收：${RUN_NODES_FIELDS.join(" / ")}）；三维节点要出视频 / 联系表，逐个节点用 run NODE --shots … --render …`;
  } else if (runField) {
    key = runField[1];
    path = `run_node.${key}`;
    hint = `run 不收 ${key}（收：${RUN_NODE_FIELDS.join(" / ")}）`;
    oldPeer =
      (NOT_BEFORE_0_17.has(key) || NOT_BEFORE_0_16_2.has(key)) && RUN_NODE_FIELDS.includes(key);
  } else if (method === "apply" && Array.isArray(params?.commands)) {
    const unknownOp = message === "Unknown scene3d action op";
    const field = /^Unexpected scene3d (\w+) field: (.+)$/.exec(message);
    const commandField = !field && /^Unexpected (\w+) field: (.+)$/.exec(message);
    if (commandField) return explainCommandField(params.commands, commandField, result);
    if (message === "Unknown or nested apply command")
      return result.hint === undefined ? explainUnknownCommand(params.commands, result) : result;
    if (!unknownOp && !field) return result;
    const actions = params.commands.flatMap((command, i) =>
      command?.type === "scene3d_apply" && Array.isArray(command.actions)
        ? command.actions.map((action, j) => ({ action, at: `commands[${i}].actions[${j}]` }))
        : [],
    );
    const known = (op) => typeof op === "string" && Object.hasOwn(SCENE3D_ACTION_FIELDS, op);
    if (unknownOp) {
      // 先找本地也不认的 op（真拼错）；全都认得，才轮到 0.16.x 对端不认的 0.17.0 op。
      const hit =
        actions.find(({ action }) => !known(action?.op)) ??
        actions.find(({ action }) => NOT_BEFORE_0_17.has(action?.op));
      if (hit) {
        const op = hit.action?.op;
        key = typeof op === "string" ? op : String(op);
        path = `${hit.at}.op`;
        hint = `scene3d_apply 不认识 op ${JSON.stringify(op)}；合法 op：${Object.keys(SCENE3D_ACTION_FIELDS).join(" ")}`;
        oldPeer = known(op);
      }
    } else {
      const [, op, k] = field;
      const hit = actions.find(({ action }) => action?.op === op && Object.hasOwn(action, k));
      if (hit) {
        key = k;
        path = `${hit.at}.${key}`;
        const accepted = known(op) ? SCENE3D_ACTION_FIELDS[op] : [];
        // 一次收齐这一条里全部不收的字段（B9-FX-50）：只报第一个，Agent 改一个、撞一次。
        const extra = Object.keys(hit.action).filter((k2) => k2 !== "op" && !accepted.includes(k2));
        hint = `scene3d_apply 的 ${op} 不收 ${extra.length > 1 ? extra.join(" ") : key}；${op} 收：${accepted.join(" ")}`;
        oldPeer =
          (NOT_BEFORE_0_17.has(key) || NOT_BEFORE_0_16_3.has(key) || NOT_BEFORE_0_18_2.has(key)) &&
          accepted.includes(key);
      }
    }
  }
  if (path === undefined) return result;
  // 本地 0.17.0 policy 认它，「合法清单」那句只会自相矛盾：换成「对端旧了」的出路。
  if (oldPeer)
    hint = oldPeerHint(
      key,
      await peerVersion(),
      NOT_BEFORE_0_16_2.has(key)
        ? "0.16.2"
        : NOT_BEFORE_0_16_3.has(key)
          ? "0.16.3"
          : NOT_BEFORE_0_18_2.has(key)
            ? "0.18.2"
            : "0.17.0",
    );
  else if (method === "apply" && path.includes(".actions["))
    hint += otherActionRejections(params, path);
  return { ...result, error: { ...error, path }, hint };
}

/**
 * 守护进程（与本地预检）停在第一处不认识的 op / 字段；同一批里别的动作也有这类问题时一并点名（0.18.0 T4：一次
 * 收齐，免得改一处、撞一次）。只列本地 policy 也拒的（真拼错的），对端旧了的那类由 oldPeerHint 管。
 */
function otherActionRejections(params, firstPath) {
  const others = [];
  params.commands.forEach((command, i) => {
    if (command?.type !== "scene3d_apply" || !Array.isArray(command.actions)) return;
    command.actions.forEach((action, j) => {
      const at = `commands[${i}].actions[${j}]`;
      if (firstPath.startsWith(`${at}.`)) return;
      const op = action?.op;
      if (typeof op !== "string" || !Object.hasOwn(SCENE3D_ACTION_FIELDS, op)) {
        others.push(`${at} 的 op ${JSON.stringify(op ?? null)} 不认识`);
        return;
      }
      const extra = Object.keys(action).filter(
        (k) => k !== "op" && !SCENE3D_ACTION_FIELDS[op].includes(k),
      );
      if (extra.length > 0) others.push(`${at} 的 ${op} 不收 ${extra.join(" ")}`);
    });
  });
  return others.length > 0
    ? `；同一批另有 ${others.length} 处：${others.join("、")}（一次改完再发）`
    : "";
}

/**
 * apply 里非三维命令的「多给即报错」（`Unexpected connect field: sourceHandle`，B9-FX-25）：与三维动作同一个口径，
 * 补 `error.path`（第一条带这个字段的同类命令）与顶层 `hint`（这条命令收哪些字段；同一条里不收的一次列全）。
 * 字段表是守护进程拒收用的那一张（`COMMAND_FIELDS`），不另抄。
 */
function explainCommandField(commands, [, type, key], result) {
  if (!Object.hasOwn(COMMAND_FIELDS, type)) return result;
  const at = commands.findIndex((c) => c?.type === type && Object.hasOwn(c, key));
  if (at < 0) return result;
  const accepted = COMMAND_FIELDS[type];
  const extra = Object.keys(commands[at]).filter((k) => k !== "type" && !accepted.includes(k));
  // 本地 policy 收它却被拒：是对端旧了，「X 不收」只会自相矛盾。
  if (extra.length === 0) return result;
  const why =
    type === "connect" && extra.includes("sourceHandle")
      ? "：connect 不收 sourceHandle，输出口由源节点决定，去掉它即可（targetHandle 才是选目标的输入口）"
      : "";
  return {
    ...result,
    error: { ...result.error, path: `commands[${at}].${key}` },
    hint: `${type} 不收 ${extra.join(" ")}${why}；${type} 收：${accepted.join(" ")}`,
  };
}

/** `Unknown or nested apply command`：指出是第几条、合法的 type 有哪些。本地也认得的 type 被拒 = 对端旧了，不在这里猜。 */
function explainUnknownCommand(commands, result) {
  const at = commands.findIndex(
    (c) => !c || typeof c !== "object" || !Object.hasOwn(COMMAND_FIELDS, c.type),
  );
  if (at < 0) return result;
  const type = commands[at]?.type;
  return {
    ...result,
    error: { ...result.error, path: `commands[${at}].type` },
    hint: `apply 不认识命令 type ${JSON.stringify(type ?? null)}（每条命令是一个带 type 的对象，不能嵌套）；合法 type：${Object.keys(COMMAND_FIELDS).join(" ")}`,
  };
}

/** 预制件词表（含别名）里离 `name` 最近的几个：包含关系优先，再按编辑距离（与 `nearestFlag` 同一把尺）。 */
export function prefabCandidates(name, count = 5) {
  const { prefab, aliases } = SCENE3D.enums;
  const wanted = String(name).toLowerCase();
  const names = [...prefab, ...Object.keys(aliases)];
  const score = (candidate) =>
    candidate.includes(wanted) || wanted.includes(candidate) ? 2 : similarity(wanted, candidate);
  return names
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ candidate }) =>
      Object.hasOwn(aliases, candidate) ? `${candidate}（= ${aliases[candidate]}）` : candidate,
    );
}
const PREFAB_TABLE_AT =
  "全表（24 个 prefab + 16 个别名）在 commands.md 的 scene3d_apply 段与契约 CANVAS_CONTRACT.scene3d.enums.prefab / aliases";
const knownPrefab = (name) =>
  SCENE3D.enums.prefab.includes(name) || Object.hasOwn(SCENE3D.enums.aliases, name);

/**
 * prefab 查不到（B9-FX-49）：页面的两句话——省略 kind 时推不出来的 invalid_request、词表外照画的 `unknown_prefab`
 * 提醒——都不列候选。按本批 argv 里的 add_object 补一句：拒收补顶层 `hint`，成功（照画、带提醒）接一条 `notes[]`；
 * 写最接近的几个词与全表在哪。页面原话不动。
 */
function explainPrefab(params, result) {
  if (!Array.isArray(params?.commands)) return result;
  const error = result?.ok === false ? result.error : undefined;
  const at =
    error?.code === "invalid_request" && typeof error.path === "string"
      ? /^commands\[(\d+)\]\.actions\[(\d+)\]\.kind$/.exec(error.path)
      : null;
  if (at) {
    const action = params.commands[Number(at[1])]?.actions?.[Number(at[2])];
    if (result.hint !== undefined || action?.op !== "add_object" || action.kind !== undefined)
      return result;
    const kinds = SCENE3D.enums.kind.filter((kind) => kind !== "human").join(" / ");
    return {
      ...result,
      hint:
        typeof action.prefab === "string" && !knownPrefab(action.prefab)
          ? `prefab ${JSON.stringify(action.prefab)} 不在词表里，推不出 kind：换成最接近的 ${prefabCandidates(action.prefab).join(" / ")}，或者显式写 kind（${kinds}）按它画。${PREFAB_TABLE_AT}`
          : `add_object 省略 kind 时要给词表内的 prefab（或 role:"figure"）；否则显式写 kind（${kinds}）。${PREFAB_TABLE_AT}`,
    };
  }
  if (result?.ok !== true) return result;
  const unknown = [
    ...new Set(
      params.commands.flatMap((command) =>
        command?.type === "scene3d_apply" && Array.isArray(command.actions)
          ? command.actions
              .filter(
                (a) =>
                  a?.op === "add_object" && typeof a.prefab === "string" && !knownPrefab(a.prefab),
              )
              .map((a) => a.prefab)
          : [],
      ),
    ),
  ];
  if (unknown.length === 0) return result;
  // 成功回包的顶层 `hint` 不在 apply 的 hostText 里（宿主可能不贴）；`notes[]` 是 verbatim，接在页面的 notes 后面。
  return {
    ...result,
    notes: [
      ...(Array.isArray(result.notes) ? result.notes : []),
      `${unknown.map((name) => `prefab ${JSON.stringify(name)} 不在词表里（按 kind 画、提醒 unknown_prefab），最接近的：${prefabCandidates(name).join(" / ")}`).join("；")}。要用词表的足迹就换成其中一个；${PREFAB_TABLE_AT}`,
    ],
  };
}

/**
 * `run-stills` 的参数体（0.16.2）。抽成纯函数，与 `tasksParams` 同一个理由：flag 翻错一个就是出错
 * 一整场。`--shots all`（缺省）= 不带 `shotIds`，页面按镜头表顺序出全部；`--frames both`（缺省）=
 * 两帧。帧的取值原样送（`--frames middle` → `["middle"]`），词表由守护进程判（invalid_request），
 * 与 `run --frame` 同一个口径。`--force` = `force:true`（不带就不送；换过图的也由它重出，A71 修订）。`--json` 给的
 * 完整参数照旧，flag 覆盖同名字段。
 */
export function runStillsParams(options, positionals, base = {}) {
  const params = { ...base };
  const nodeId = options.node || positionals[0];
  if (nodeId) params.nodeId = nodeId;
  if (!params.nodeId) throw new CliError("invalid_argument", "run-stills requires a node ID");
  if (options.shots !== undefined && String(options.shots).trim() !== "all") {
    const shotIds = String(options.shots)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (shotIds.length === 0)
      throw new CliError(
        "invalid_argument",
        "--shots listed no shot ID (use --shots all, or SHOT-ID,SHOT-ID…)",
      );
    params.shotIds = shotIds;
  }
  if (options.frames !== undefined) {
    const which = String(options.frames).trim();
    params.frames = which === "both" ? ["start", "end"] : [which];
  }
  // 缺省续跑：已是最新的（skipped up_to_date）、被人或 Agent 换过图的（skipped replaced）页面都不出；--force 才全部
  // 重出 —— 换过图的也原地盖掉、标记清掉（用户让智能体重出 = 显式意图，A71 修订）。
  if (options.force) params.force = true;
  // 与 run 同一道闸：一次网络都不发就把「忘了要授权」报出来（退出码 2）。
  if (!options.approved)
    throw new CliError(
      "approval_required",
      "run-stills requires --approved after the user has authorized rendering the stills of this node",
    );
  params.approval = { userApprovedNodeIds: [params.nodeId] };
  return params;
}

/**
 * `run-shot-refs` 的参数体（0.18.0）：与 `run-stills` 同一个写法 —— `--shots all`（缺省）= 不带 `shotIds`，页面按镜头表
 * 顺序出全部；`--force` = `force:true`（不带就不送：已是最新的、换过的跳过，续跑只补没出的）。没有 `--frames`：每镜
 * 三样（开始站位图、结束站位图、预演）都出。`--json` 给的完整参数照旧，flag 覆盖同名字段。
 */
export function runShotRefsParams(options, positionals, base = {}) {
  const params = { ...base };
  const nodeId = options.node || positionals[0];
  if (nodeId) params.nodeId = nodeId;
  if (!params.nodeId) throw new CliError("invalid_argument", "run-shot-refs requires a node ID");
  if (options.shots !== undefined && String(options.shots).trim() !== "all") {
    const shotIds = String(options.shots)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (shotIds.length === 0)
      throw new CliError(
        "invalid_argument",
        "--shots listed no shot ID (use --shots all, or SHOT-ID,SHOT-ID…)",
      );
    params.shotIds = shotIds;
  }
  if (options.force) params.force = true;
  // 与 run / run-stills 同一道闸：一次网络都不发就把「忘了要授权」报出来（退出码 2）。
  if (!options.approved)
    throw new CliError(
      "approval_required",
      "run-shot-refs requires --approved after the user has authorized rendering the shot references of this node",
    );
  params.approval = { userApprovedNodeIds: [params.nodeId] };
  return params;
}

/**
 * `apply --approved`：替**这一批里每条 `delete_node` 的目标**、以及**带 `remove` / `remove_shot` 的每条
 * `scene3d_apply` 的三维节点**（0.18.0：删人在导演台改过的对象 / 镜头要它，契约 `SCENE3D.humanEdit`）声明
 * 「用户同意删」。页面在批量删除（超过 5 个节点或含带成员的组，与界面的删除确认同一道门槛）、删人改过的三维对象 /
 * 镜头时要它；一批里没有这两种删除时 `--approved` 是个误用，直接报错而不是静默忽略。与 `run --approved` 同一个语义：
 * Agent 声明的是它**已经**从用户那里拿到的授权，不是给自己开的票。
 */
export function deleteApproval(commands) {
  const removes = (command) =>
    command?.type === "scene3d_apply" &&
    Array.isArray(command.actions) &&
    command.actions.some((action) => SCENE3D.humanEdit.approvalOps.includes(action?.op));
  const targets = [
    ...new Set(
      commands
        .filter(
          (command) =>
            typeof command?.nodeId === "string" &&
            (command.type === "delete_node" || removes(command)),
        )
        .map((command) => command.nodeId),
    ),
  ];
  if (targets.length === 0)
    throw new CliError(
      "invalid_argument",
      "apply --approved approves delete_node targets and scene3d_apply removals (remove / remove_shot) only, and this batch deletes nothing",
    );
  return { userApprovedNodeIds: targets };
}

/**
 * 回包里「弱模型读 JSON 数组会漏」的部分，再排成一行行人话跟原始字段一起回。
 * 抽成纯函数是为了能直接单测「哪些命令带、带的是什么」——渲染函数单测过、
 * 却根本没接到 `execute` 上，正是 `tidied` 走丢的那一档故障。
 */
export function decorate(command, result, sessionId) {
  // error.message 是 hostText verbatim、常拼进画布数据：新页面在 agentError 出口压成一行（断行写成 ⏎），
  // 这里给老页面兜同一道（B11 fuzz）。干净的消息原样。
  if (typeof result?.error?.message === "string") {
    const message = echoMessage(result.error.message, Number.POSITIVE_INFINITY);
    if (message !== result.error.message)
      result = { ...result, error: { ...result.error, message } };
  }
  if (command === "read" && Array.isArray(result?.nodes))
    result = { ...result, nodes: result.nodes.map(sanitizeEchoes) };
  // 三维 run 的 outputs[]（含 --await 并进来的落地行）：url 也是卡上的画布数据，同 renders[]（B11-int 复核）
  if (command === "run" && Array.isArray(result?.outputs))
    result = {
      ...result,
      outputs: result.outputs.map((row) =>
        row && typeof row === "object" && "shotId" in row ? echoRowUrls(row) : row,
      ),
    };
  // 弱模型读表比读 JSON 数组稳：把 rows 再排成一张定宽文本表，跟原始字段一起回。
  if (command === "tasks" && result?.ok === true && Array.isArray(result.rows))
    return { ...result, table: formatTasksTable(result.rows) };
  // tidy / apply 的 `tidied[]` 是「整理到底动了什么」的唯一出口，尤其是 strays ——
  // 整理拒绝去动的出框 / 压框节点，是 Agent 唯一能知道「这里需要人来处理」的通道。
  // 宿主把回包压成一句「已应用 N 条命令」时它整段丢失，所以这里先渲染成文本。
  // A5 —— 体检的结论是给**弱模型**读的：分类计数 + 每类前几条明细 + 可直接执行的
  // 修复命令，全部排成文本。原始 `issues[]` 照旧一起回，两者并存。
  if (command === "health" && result?.ok !== false && Array.isArray(result?.issues)) {
    // issues[].message 是 hostText verbatim、拼着节点标题与 id：新页面在 health.ts 的 label() 里就过了 echo，
    // 这里给老页面兜同一道（压成一行，断行写成 ⏎；B11 复核）。干净的原样。
    const issues = result.issues.map((issue) =>
      typeof issue?.message === "string" &&
      echoMessage(issue.message, Number.POSITIVE_INFINITY) !== issue.message
        ? { ...issue, message: echoMessage(issue.message, Number.POSITIVE_INFINITY) }
        : issue,
    );
    const folded = { ...result, issues };
    return { ...folded, report: formatHealthReport(folded, sessionId) };
  }
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

/**
 * 读回的人话段（hostText verbatim：`rendersSummary` / `sceneSummary`）是页面拼的，里面回显的卡片 id、
 * 镜头 id、url 是画布数据：值里带一个换行，宿主逐字贴出时 Agent 就多读到一行伪造的渲染行或「下一步：
 * apply … --approved」（B9-FX-15）；不带换行也能在同一行里伪造（B11-F2-2）。
 *  · `rendersSummary`：拿同一份结构化 `renders[]` 用包里的 formatScene3dRenders 重拼、盖掉页面那段（id 只认
 *    id 文法、url 只认规整的 http(s)）。不再逐值替换：前一个值是后一个值的子串时，先替换的会把后一个改得认不出、
 *    它的换行与伪造行原样留下（B11-F2-1）。干净的读回与页面拼的逐字相同。
 *  · `renders[]` 本身（宿主逐行列出）：url / posterUrl / lastFrameUrl 不是规整的 http(s) 就不给（echoRowUrls）。
 *  · `sceneSummary`：只在「静帧：镜头 <renderedShotId>，」回显一个值，把那一处的原样与压成一行的样子（上一版
 *    页面这么回显）换成 echoId 的结果（只换这一处：压成一行的值可能短到是别处文字的子串）。
 */
function sanitizeEchoes(node) {
  if (!node || typeof node !== "object") return node;
  const out = { ...node };
  // lastError.message 是协作者写得进的节点原话：压成一行（断行写成 ⏎）、至多 400 字，同新页面的 failure.ts（B11 fuzz）
  if (typeof node.lastError?.message === "string") {
    const message = echoMessage(node.lastError.message);
    if (message !== node.lastError.message) out.lastError = { ...node.lastError, message };
  }
  // 先清 renders[] 再拿它重拼：新页面（cardRow 已经不给）与老页面同一句「（无 url）」
  if (Array.isArray(node.renders)) out.renders = node.renders.map(echoRowUrls);
  if (Array.isArray(node.renders) && typeof node.rendersSummary === "string")
    out.rendersSummary = formatScene3dRenders(out.renders);
  const raw = node.renderedShotId;
  if (typeof out.sceneSummary === "string" && typeof raw === "string" && raw) {
    const safe = echoId(raw);
    if (safe !== raw)
      for (const shown of new Set([raw, echoText(raw)]))
        out.sceneSummary = out.sceneSummary
          .split(`静帧：镜头 ${shown}，`)
          .join(`静帧：镜头 ${safe}，`);
  }
  return out;
}

/**
 * 三维产物行（`renders[]` / 三维 run 的 `outputs[]`）的 url、posterUrl、lastFrameUrl 是卡上的画布数据，宿主逐字
 * 列出：可信主机后面接一个换行就多出一行「下一步 … --approved」（B11-int 复核）。不是规整的 http(s)（echoUrl）
 * → url 报 null、另两个不带。新页面自己就不给（land-outputs 的 cardRow）；这里给老页面兜底，干净的行原样。
 */
function echoRowUrls(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  if (typeof row.url === "string" && echoUrl(row.url) !== row.url) out.url = null;
  for (const key of ["posterUrl", "lastFrameUrl"])
    if (typeof row[key] === "string" && echoUrl(row[key]) !== row[key]) delete out[key];
  return out;
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
      lines.push(`  - ${echoMessage(issue.message, Number.POSITIVE_INFINITY)}`);
      // fix 拼着组 / 节点 id（协作者写得进的画布数据）：有一个词不合 id 文法（换行、空格、引号……）就不印这条命令，
      // 免得它伪造另起一行或多拼出 --approved 这样的词；结构化的 issues[].fix 照旧（B11 复核）。
      if (Array.isArray(issue.fix) && issue.fix.length)
        lines.push(
          issue.fix.every((word) => echoId(word) === word)
            ? `    修复：scenemint-canvas ${issue.fix.join(" ")}`
            : "    修复：命令里有回显不了的 id，见 issues[].fix",
        );
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
  // 每格都过 echoText：节点标题、项目 / 画布名是协作者写得进的数据，一格里的换行会伪造一行（B11 复核）
  const cells = rows.map((row) =>
    [
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
    ].map((cell) => echoText(cell)),
  );
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
      "draft_root_boundary",
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
/** argv 里某个 flag 的值（`--x v` 或 `--x=v`）；没有回 undefined。 */
function flagValue(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) return argv[i + 1];
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return undefined;
}

/**
 * 文件路径没落在会话 workspace 里（B9-FX-26）：`error.path`（解析后的绝对路径）与 `error.workspace`（会话根）是
 * session.mjs 给的；这里补一句顶层 `hint` 说怎么改。只认带 `workspace` 的那几处（来自 workspacePath）。
 * 按是哪个参数出的错措辞（B11-F2-5）：输出路径（`--out` / `--out-dir`）是 CLI 要写的文件、还不存在，说写
 * workspace 里的相对路径；`--file` JSON 参数（docs 的 --file 是正文，不算）才提「也可以直接 --json 给」。
 */
function workspaceFileHint(result, argv = []) {
  const error = result?.ok === false ? result.error : undefined;
  if (
    !error ||
    result.hint !== undefined ||
    typeof error.workspace !== "string" ||
    !["file_not_found", "workspace_boundary"].includes(error.code)
  )
    return result;
  const names = (flag) => {
    const value = flagValue(argv, flag);
    return typeof value === "string" && value && resolvePath(error.workspace, value) === error.path;
  };
  if (names("out") || names("out-dir"))
    return {
      ...result,
      hint: `输出路径只能写进会话 workspace（${error.workspace}），${error.path} 不行：写它里面的相对路径（不带 ..、不写外面的绝对路径）`,
    };
  const jsonFile = names("file") && argv[0] !== "docs";
  const json = jsonFile ? "；JSON 参数也可以直接 --json 给" : "";
  return {
    ...result,
    hint:
      error.code === "file_not_found"
        ? `没有这个文件：${error.path}。路径按会话 workspace（${error.workspace}）解析——把文件写进这个目录，再用相对它的路径${jsonFile ? "（例如 --file edit.json）" : ""}${json}`
        : `只能用会话 workspace（${error.workspace}）里的文件，${error.path} 不在里面：把文件放进这个目录、写相对路径（不带 ..、不写外面的绝对路径）${json}`,
  };
}
export async function main() {
  let result;
  try {
    result = await execute(process.argv.slice(2));
  } catch (error) {
    result = workspaceFileHint(errorResult(error), process.argv.slice(2));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode(result);
}
