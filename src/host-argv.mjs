/**
 * 宿主侧 argv 助手：给把 `scenemint-canvas` 注册成 `canvas_cli` 工具、把 argv 原样透传给
 * CLI 的宿主（灵映 Electron 客户端、剧本转视频等产品）用。宿主只做两件事，都在这里：
 *
 *  1. `injectSession` —— 会话 ID 由宿主注入，Agent 不能自己带。argv 里任何位置出现
 *     `--session`（含 `--session=…`、含 `--` 之后的透传段）都拒绝，否则 Agent 能借别的任务的
 *     会话发命令。
 *  2. `extractPayload` —— 宿主的审批闸门要看「这条命令到底往画布写什么」。载荷进 CLI 的
 *     每一条路都在这里镜像成同一个结构视图；宿主**只**在这里解析载荷，不自己再写一套。
 *
 * 解析器直接复用 `cli.mjs` 的 `parseArgs` 和 `spec.mjs` 的 flag 接受表：CLI 怎么读，
 * 这里就怎么读，`--file=-`、`--count 12` 之类的边角在两边不可能分叉。
 */

import { parseArgs, splitTags } from "./cli.mjs";
import { CliError, parseObject } from "./common.mjs";
import { allowedFlags, tidyCommand } from "./spec.mjs";

export class HostArgvError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HostArgvError";
    this.code = code;
  }
}

/** `--session` 的两种写法：独立 token，或 `--session=值`。 */
const SESSION_TOKEN = /^--session(=|$)/;
const TEXT_FIELDS = ["prompt", "content", "title"];

function assertArgv(argv) {
  if (!Array.isArray(argv) || !argv.every((value) => typeof value === "string"))
    throw new HostArgvError("INVALID_ARGV", "argv must be an array of strings");
}

/**
 * 返回追加了 `--session <sessionId>` 的**新** argv；原数组不动。
 * argv 里已有 `--session` / `--session=…`（不论在命令名前后、还是 `--` 之后）都是
 * `SESSION_NOT_ALLOWED`：会话身份只能由宿主给。空 sessionId 同样拒绝。
 */
export function injectSession(argv, sessionId) {
  assertArgv(argv);
  if (typeof sessionId !== "string" || sessionId.trim() === "")
    throw new HostArgvError("SESSION_NOT_ALLOWED", "sessionId must be a non-empty string");
  const smuggled = argv.find((value) => SESSION_TOKEN.test(value));
  if (smuggled !== undefined)
    throw new HostArgvError(
      "SESSION_NOT_ALLOWED",
      `argv must not carry --session (found ${JSON.stringify(smuggled)}); the host injects it`,
    );
  return [...argv, "--session", sessionId];
}

function parse(argv) {
  try {
    const parsed = parseArgs(argv);
    // 与 `execute` 同一道关：flag 必须是这条命令真的读的。否则 `download --json …` 这种
    // CLI 根本不接的组合会在这里被当成载荷放行。
    const allowed = allowedFlags(parsed.command);
    if (allowed === undefined)
      throw new CliError("invalid_argument", `Unknown command: ${parsed.command}`);
    for (const key of Object.keys(parsed.options))
      if (!allowed.has(key))
        throw new CliError("invalid_argument", `--${key} is not an option of ${parsed.command}`);
    return parsed;
  } catch (error) {
    if (error instanceof CliError) throw new HostArgvError("INVALID_ARGV", error.message);
    throw error;
  }
}

function parsePayload(text) {
  if (typeof text !== "string")
    throw new HostArgvError("INVALID_PAYLOAD", "readFile must return the payload as a string");
  try {
    return parseObject(text);
  } catch (error) {
    if (error instanceof CliError) throw new HostArgvError("INVALID_PAYLOAD", error.message);
    throw error;
  }
}

/**
 * 把 argv 里的载荷镜像成宿主闸门能检查的结构：
 *
 *  - `--json OBJECT`            → `{ shape: "json", command, params, commands }`
 *  - `--file FILE`              → `{ shape: "file", command, params, commands, path }`
 *  - `--file -`（stdin）        → `{ shape: "stdin", … }`，调用 `readFile("-")`
 *  - `--node ID --field NAME --text-file FILE --expect-sha SHA`
 *                               → `{ shape: "text-file", command, fields, commands }`，
 *                                 `commands` 是 CLI 合成的那条 `update_node`
 *  - `--node ID --tags a,b`     → `{ shape: "tags", command, fields: { nodeId, tags }, commands }`，
 *                                 `commands` 是 CLI 合成的 `update_node {draft:{assetTags}}`
 *  - `tidy --all|--nodes|--groups`
 *                               → `{ shape: "tidy", command, commands }`（apply 命令由 flag 合成）
 *  - 其余                        → `{ shape: "none", command }`
 *
 * `commands` 是 `params.commands` 数组，不是数组时为 `null`。`readFile(pathOrDash)` 由宿主
 * 注入，同步或异步都行；相对路径按 CLI 规则应相对会话 workspace 解析，这一步由宿主负责。
 * 组合规则照抄 CLI：`--json` 与 `--file` 互斥、`--text-file` 不能与二者同用、
 * `--tags` 不能与三者同用，CLI 对这些组合直接报错、不存在优先级，这里同样抛 `INVALID_PAYLOAD`。
 * JSON 不合法（或含 `__proto__` 之类禁用键、顶层不是对象）→ `INVALID_PAYLOAD`。
 */
export async function extractPayload(argv, { readFile } = {}) {
  assertArgv(argv);
  if (typeof readFile !== "function")
    throw new HostArgvError("INVALID_ARGV", "extractPayload needs a readFile(pathOrDash) function");
  const { command, options, positionals } = parse(argv);
  const hasJson = options.json !== undefined;
  const hasFile = options.file !== undefined;
  const hasText = options["text-file"] !== undefined;
  const hasTags = options.tags !== undefined;
  if (hasJson && hasFile) throw new HostArgvError("INVALID_PAYLOAD", "Use either --json or --file");
  if (hasTags && (hasJson || hasFile || hasText))
    throw new HostArgvError(
      "INVALID_PAYLOAD",
      "--tags cannot be combined with --json, --file or --text-file",
    );
  if (hasText && (hasJson || hasFile))
    throw new HostArgvError(
      "INVALID_PAYLOAD",
      "--text-file cannot be combined with --json or --file",
    );
  const commandsOf = (params) => (Array.isArray(params.commands) ? params.commands : null);

  if (hasJson) {
    const params = parsePayload(options.json);
    return { shape: "json", command, params, commands: commandsOf(params) };
  }
  if (hasFile) {
    const stdin = options.file === "-";
    const params = parsePayload(await readFile(stdin ? "-" : options.file));
    return {
      shape: stdin ? "stdin" : "file",
      command,
      params,
      commands: commandsOf(params),
      ...(stdin ? {} : { path: options.file }),
    };
  }
  if (hasText) {
    const nodeId = options.node || positionals[0];
    const field = options.field || "prompt";
    const expectSha = options["expect-sha"];
    if (!nodeId || !TEXT_FIELDS.includes(field) || !expectSha)
      throw new HostArgvError(
        "INVALID_PAYLOAD",
        "Whole text writes require --node, --field prompt/content/title, and --expect-sha from read",
      );
    const text = await readFile(options["text-file"]);
    if (typeof text !== "string")
      throw new HostArgvError("INVALID_PAYLOAD", "readFile must return the text as a string");
    const update = {
      type: "update_node",
      nodeId,
      ...(field === "title" ? { title: text } : { draft: { [field]: text } }),
      expect: { [`${field}Sha`]: expectSha },
    };
    return {
      shape: "text-file",
      command,
      fields: { nodeId, field, text, expectSha, path: options["text-file"] },
      commands: [update],
    };
  }
  if (hasTags) {
    const nodeId = options.node || positionals[0];
    if (!nodeId)
      throw new HostArgvError("INVALID_PAYLOAD", "Tag writes require --node (or a node ID)");
    const tags = splitTags(options.tags);
    return {
      shape: "tags",
      command,
      fields: { nodeId, tags },
      commands: [{ type: "update_node", nodeId, draft: { assetTags: tags } }],
    };
  }
  if (command === "tidy") {
    try {
      return { shape: "tidy", command, commands: [tidyCommand(options)] };
    } catch (error) {
      if (error instanceof CliError) throw new HostArgvError("INVALID_ARGV", error.message);
      throw error;
    }
  }
  return { shape: "none", command };
}
