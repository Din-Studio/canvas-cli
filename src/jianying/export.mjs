/**
 * `export-jianying`：把画布时间线导成剪映工程，每个工程一个完整的剪映草稿目录。不打 zip、不走浏览器下载。
 * 两个去处，二选一：
 *
 *     <workspace>/产出/剪映工程/<剧名>_EP01_<时间戳>/   ← 默认：会话 workspace 的文件树（`--out-dir` 可换）
 *     <剪映草稿目录>/<剧名>_EP01_<时间戳>/              ← `--draft-root <绝对路径>`：直接写进用户机器上的
 *                                                         剪映草稿目录（拍板 A6），剪映首页直接看得到
 *
 * 每集一个工程（draft_content.json 等 + assets/video/）；非短剧（标题里没有集号）一个。
 *
 * 分工：
 *  · **草稿长什么样**全在 `./core.mjs` —— 它是页面剪映导出纯函数层（`apps/web/libs/jianying/*.ts`）
 *    打成的单文件（`tools/canvas-cli-jianying-core.mjs` 生成）。分工程、命名、预检闸、转场 / 字幕 /
 *    音量、素材文件名的摘要与主机白名单，与浏览器导出是**同一份代码**。这里一行都不重写。
 *  · 本文件只做 IO：向页面要时间线（只读方法 `timeline_export`）、按白名单直连下载整段素材、
 *    读容器头（`./probe.mjs`）、把文件原子地落进 workspace。
 *
 * 几条落盘规矩（每条都有测试）：
 *  · **除 `--draft-root` 外只写 workspace 里**：`--out-dir` 必须是 workspace 相对路径，逐级 lstat，拒 `..`、
 *    符号链接；工程目录、暂存目录、`assets/video/` 建完之后，以及每一次往里写文件之前，都按 `download` 的
 *    规矩从 workspace 根逐级复查（没有符号链接、realpath 仍在 workspace 里），不合就报
 *    `workspace_boundary`，整个导出停下。
 *  · **`--draft-root` 写的是 workspace 外的一个目录**，所以先把这个根本身验一遍（`resolveDraftRoot`：已存在、
 *    真目录、从盘符根起逐级不是符号链接 / 联接点、realpath 与给的一致、不是盘符根 / 家目录 / 系统目录），
 *    写盘时同一套逐级复查以它为根（越界报 `draft_root_boundary`）。只新建自己的工程目录与 `.partial` 暂存，
 *    不覆盖（没有 `--overwrite`）、不删根里别的任何东西。白名单 = 用户登记的剪映草稿目录（页面桥
 *    `jianying_roots_list`）；表外的要 `--approved`（智能体先把完整路径念给用户、用户同意）。只有主会话能用。
 *    导出成功后经页面桥 `jianying_roots_touch` 把它记进登记表（刷新最近使用时间；新的满 5 条挤掉最久没用的）。
 *    workspace 里不另留一份：素材优先从 workspace 里以前导出的工程（`产出/剪映工程/`）硬链接 / 复制，不重下。
 *  · **不覆盖**：目标工程目录已存在就在下载任何字节之前报 `file_exists`；`--overwrite` 才写进去
 *    （只对 workspace；`--draft-root` 不收 `--overwrite`）。
 *  · **原子发布**：工程先在 `.<工程名>.partial/` 里攒齐素材与草稿文件，齐了才改名成正式目录，
 *    `draft_meta_info.json` 最后写 —— 剪映首页认它当「这是一份草稿」，半截的工程永远不会挂上去。
 *  · **断点续传 / 幂等**：同一素材（AssetHub 文件 id 或地址）一次运行只下一遍，其余工程硬链接
 *    （不支持就复制）；重跑时 out-dir 里已有的同一素材（文件名摘要相同）且字节数与远端一致的
 *    直接复用（`--draft-root` 还看 workspace 的 `产出/剪映工程/`）；上一次没完成的 `.partial` 目录按工程接着下。
 *  · **失败不丢已落盘的**：素材最终下载失败（沿用页面的重试策略：3 次，1 s / 4 s 退避，4xx 不重试）
 *    时继续做完其余工程，失败工程标 `partial`（留在 `.partial` 目录里，回包列出失败的 nodeId 与
 *    重跑用的 argv），其余照常 `ok`。
 *
 * 回包 `ok` 只说明文件都写好了，**不等于剪映能打开**：剪映版本、转场资源要真机验证（回包 `note`）。
 */

import { promises as fs, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CliError } from "../common.mjs";
import { call } from "../client.mjs";
import * as core from "./core.mjs";
import { ProbeError, probeVideoFile } from "./probe.mjs";
import { resolveDraftRoot } from "./draft-root.mjs";
import { ROOT_META_FILE, draftRootLooks } from "./roots.mjs";

/** 默认输出目录（workspace 相对）。 */
export const DEFAULT_OUT_DIR = "产出/剪映工程";
/** 未完成工程的暂存目录后缀；它里面的续传标记文件。 */
const PARTIAL_SUFFIX = ".partial";
const MARKER_FILE = ".scenemint-jianying.json";
/** 下载时这么久没有收到任何字节就中断这一次（按重试策略再来）。 */
const STALL_MS = 60_000;
/** HEAD 拿远端字节数的超时。 */
const SIZE_TIMEOUT_MS = 20_000;
/** 跟随重定向的上限；每一跳都要过主机白名单。 */
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/**
 * 页面导出（mediabunny）认得的视频编码 —— 样本描述的 fourcc，按小写比（mediabunny 也是）：
 * H.264（avc1 / avc3）、H.265（hvc1 / hev1）、VP8、VP9、AV1、ProRes。Node 探针只读容器头，比它宽：
 * 例如 MPEG-4 Part 2（mp4v）的 mov，页面导出会失败，CLI 却照常出工程。这些编码不阻断，只在回包
 * `warnings` 里点名那一段 —— 剪映能否播放以真机为准。
 */
const BROWSER_VIDEO_CODECS = new Set([
  "avc1",
  "avc3",
  "hvc1",
  "hev1",
  "vp08",
  "vp09",
  "av01",
  "ap4x",
  "ap4h",
  "apch",
  "apcn",
  "apcs",
  "apco",
]);
/** 几种常见的「浏览器导出认不出」的编码，警告里给个人话的名字。 */
const CODEC_NAMES = {
  mp4v: "MPEG-4 Part 2",
  s263: "H.263",
  h263: "H.263",
  jpeg: "Motion JPEG",
  mjpa: "Motion JPEG",
  mjpb: "Motion JPEG",
};

function codecLabel(fourcc) {
  const shown = /^[\x20-\x7e]{4}$/.test(fourcc)
    ? fourcc.trim()
    : Buffer.from(fourcc, "latin1").toString("hex");
  const name = CODEC_NAMES[fourcc.toLowerCase()];
  return name ? `${name}（${shown}）` : `「${shown}」`;
}

/** 回包里的提醒（写进 workspace 时）：ok 不等于剪映能打开；交给剪映首选 `--draft-root` 直写。 */
const NOTE =
  "回包 ok 只说明工程文件都写好了，不代表剪映一定能打开。这份工程在 workspace 里，剪映还看不到。首选：用 jianying-roots 列出用户登记的剪映草稿目录，请用户选一条（或给一个新的绝对路径），再用同样的参数加 --draft-root <那条路径> 重导一次 —— 工程直接写进剪映草稿目录，素材从这里的工程硬链接 / 复制，不重下。不要移动工程目录：草稿里的素材按 draftRoot 下的绝对路径引用，工程目录或素材一旦移走、改名或删除，剪映里对应片段会显示素材离线。";
/** 回包里的提醒（`--draft-root` 直写剪映草稿目录时）。 */
const NOTE_DRAFT_ROOT =
  "回包 ok 只说明工程文件都写好了，不代表剪映一定能打开。工程已经直接写进剪映草稿目录（draftRoot）：请用户重启剪映（草稿列表不会自动刷新），在首页找到这几个工程逐个打开核对。不要移动或改名工程目录与里面的 assets：草稿里的素材按这个目录下的绝对路径引用，移走、改名或删除，剪映里对应片段会显示素材离线。";

/* ── 参数 ──────────────────────────────────────────────────────────────────── */

const EPISODE_ALL = "all";

/**
 * `--episode` 的一个取值 → 集键。与 `timeline --json {"episode":…}` 同一套写法：
 * `EP01` / `ep1` / `1`（都规整成 `EP01`）、`unknown`（没有集号的片段；也认 `其他`，
 * 那是剪映工程名里的写法）、`all`（= 不筛）。认不出就报错，绝不静默当成「全部」。
 */
export function normalizeEpisode(raw) {
  const value = String(raw ?? "").trim();
  const lower = value.toLowerCase();
  if (lower === EPISODE_ALL) return EPISODE_ALL;
  if (lower === core.UNKNOWN_EPISODE || value === core.JIANYING_OTHER_PROJECT_LABEL)
    return core.UNKNOWN_EPISODE;
  const digits = /^(?:ep)?([0-9]+)$/i.exec(value)?.[1];
  if (!digits)
    throw new CliError(
      "invalid_argument",
      `--episode 只认 EP01 / ep1 / 1 / 其他 / all 这类集名，收到「${value}」`,
    );
  return core.episodeKey(`ep${digits}`);
}

/** CLI 的 options 对象 → 导出参数。flag 的形状问题一律 `invalid_argument`，一个字节都不下。 */
export function exportOptions(options = {}) {
  let draftRoot = null;
  if (options["draft-root"] !== undefined) {
    draftRoot = String(options["draft-root"]).trim();
    if (!draftRoot)
      throw new CliError(
        "invalid_argument",
        "--draft-root 要给剪映草稿目录的绝对路径（剪映「全局设置 → 草稿位置」里显示的那个）",
      );
    if (options["out-dir"] !== undefined)
      throw new CliError(
        "invalid_argument",
        "--draft-root 与 --out-dir 只能二选一：前者直接写进剪映草稿目录，后者写进 workspace",
      );
    if (options.overwrite === true)
      throw new CliError(
        "invalid_argument",
        "--draft-root 不收 --overwrite：直写剪映草稿目录只新建自己的工程目录，不覆盖任何东西（同名工程已在就换一个 --name）",
      );
  } else if (options.approved === true)
    throw new CliError(
      "invalid_argument",
      "--approved 只用于 --draft-root：目录不在用户登记的剪映草稿目录里时，声明用户已经同意写进这个目录",
    );
  const outDir = options["out-dir"] === undefined ? DEFAULT_OUT_DIR : String(options["out-dir"]);
  const layout = options.layout;
  if (layout !== undefined && layout !== "episodes" && layout !== "single")
    throw new CliError("invalid_argument", "--layout must be episodes or single");
  let name;
  if (options.name !== undefined) {
    name = String(options.name).trim();
    if (!name) throw new CliError("invalid_argument", "--name must not be empty");
  }
  let episodes;
  if (options.episode !== undefined) {
    const values = (Array.isArray(options.episode) ? options.episode : [options.episode])
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length === 0) throw new CliError("invalid_argument", "--episode listed no episode");
    const keys = [...new Set(values.map(normalizeEpisode))];
    if (keys.includes(EPISODE_ALL)) {
      if (keys.length > 1)
        throw new CliError(
          "invalid_argument",
          "--episode all cannot be combined with other episodes",
        );
    } else episodes = keys;
  }
  return {
    outDir,
    draftRoot,
    approved: options.approved === true,
    layout,
    name,
    episodes,
    dryRun: options["dry-run"] === true,
    overwrite: options.overwrite === true,
  };
}

/* ── workspace 边界 ────────────────────────────────────────────────────────── */

/**
 * `--out-dir` → workspace 里的一个目录。规矩与 `session.mjs` 的 `workspacePath` 一致：只认相对路径、
 * 不许 `..`、每一级都 lstat（符号链接一律拒）、workspace 本身被换成了链接也拒。`create` 时逐级建出
 * 缺的目录；dry-run 不建，只报它在不在。
 */
export async function resolveOutDir(root, input, { create }) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0"))
    throw new CliError("invalid_path", "--out-dir must name a directory inside the workspace");
  if (path.isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith("\\\\"))
    throw new CliError(
      "workspace_boundary",
      "--out-dir must be a path relative to the session workspace",
    );
  const parts = input.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (parts.includes(".."))
    throw new CliError("workspace_boundary", "Parent traversal is not allowed");
  if (parts.length === 0)
    throw new CliError(
      "workspace_boundary",
      "--out-dir must be a directory inside the workspace, not the workspace itself",
    );
  if (parts.some((part) => /[:*?"<>|]/.test(part)))
    throw new CliError(
      "invalid_path",
      `--out-dir has characters a folder name cannot contain: ${input}`,
    );
  if ((await fs.lstat(root)).isSymbolicLink() || (await fs.realpath(root)) !== root)
    throw new CliError("workspace_boundary", "Workspace location changed");
  let current = root;
  let exists = true;
  // 逐级走：下一级在不在、是不是链接，要等上一级确认是真目录之后才有意义。
  /* oxlint-disable eslint/no-await-in-loop */
  for (const part of parts) {
    current = path.join(current, part);
    if (!exists) continue;
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!create) {
        exists = false;
        continue;
      }
      try {
        await fs.mkdir(current);
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      stat = await fs.lstat(current);
    }
    // `error.path` 指出是哪一级（workspace 相对），与工程内部目录的复查同一口径。
    const shown = boundaryRel(workspaceBoundary(root), current);
    if (stat.isSymbolicLink())
      throw new CliError("workspace_boundary", "Symlinks are not allowed inside workspace paths", {
        path: shown,
      });
    if (!stat.isDirectory())
      throw new CliError("invalid_path", `--out-dir component is not a directory: ${part}`, {
        path: shown,
      });
  }
  /* oxlint-enable eslint/no-await-in-loop */
  // 逐级 lstat 看不出来的（例如 Windows 的卷挂载点），realpath 看得出来：真实位置必须还在 workspace 里。
  if (exists && !inside(root, await fs.realpath(current)))
    throw new CliError(
      "workspace_boundary",
      "--out-dir resolves to a location outside the workspace",
      { path: parts.join("/") },
    );
  return { abs: current, rel: parts.join("/"), exists };
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** `candidate` 就是 `root` 或在它里面（与 `session.mjs` 的同名判断一致）。 */
function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

/**
 * 写盘的边界：这一次导出往哪个根下写、越界报哪个码、报错里怎么称呼它。workspace（默认）与
 * `--draft-root` 的剪映草稿目录走**同一套**逐级复查，只是根不同 —— 规矩只写一遍。
 */
function workspaceBoundary(root) {
  return { root, code: "workspace_boundary", name: "workspace" };
}
function draftRootBoundary(root) {
  return { root, code: "draft_root_boundary", name: "剪映草稿目录" };
}

/** 边界根下的相对路径（`/` 分隔），报错里给人看。 */
const boundaryRel = (boundary, target) =>
  path.relative(boundary.root, target).split(path.sep).join("/");

/** 越出边界这一类错误不算某个素材 / 工程失败：整个导出停下。 */
const isBoundary = (error) =>
  error instanceof CliError &&
  (error.code === "workspace_boundary" || error.code === "draft_root_boundary");

function symlinkRefused(boundary, rel) {
  return new CliError(
    boundary.code,
    `「${rel}」是符号链接：导出不会顺着符号链接写到${boundary.name}外面，已停止。请用户查看并删掉这个链接后再导出。`,
    { path: rel },
  );
}

/**
 * 写盘前的边界闸，与 `download`（`session.mjs` 的 `workspacePath`）同一条规矩：边界根（workspace，或
 * `--draft-root` 的剪映草稿目录）没被换成链接；从根到 `dir` 逐级 lstat，每一级都必须是真目录、不能是
 * 符号链接；最后 realpath 再比一次，真实路径必须还在根里。
 *
 * 工程目录、暂存目录、`assets/video/` 建完之后，以及每一次往里写文件（下载、硬链接 / 复制素材、写草稿、
 * 写续传标记、清旧素材）之前都过一遍 —— 例如续传暂存目录里被换成符号链接的 `assets`，不查就会把素材
 * 写到根外面去。`create` 时一级一级建出缺的目录：不用 `mkdir -p`，它会顺着半路的符号链接一直
 * 建到根外面。碰到符号链接报边界的码（`workspace_boundary` / `draft_root_boundary`），整个导出停下。
 */
async function assertBoundaryDir(boundary, dir, { create = false } = {}) {
  const { root } = boundary;
  const rel = boundaryRel(boundary, dir);
  if (!rel || !inside(root, dir))
    throw new CliError(boundary.code, `「${dir}」不在${boundary.name}里，导出不会往那里写`);
  if ((await fs.lstat(root)).isSymbolicLink() || (await fs.realpath(root)) !== root)
    throw new CliError(
      boundary.code,
      boundary.code === "workspace_boundary"
        ? "Workspace location changed"
        : `剪映草稿目录「${root}」被换成了别的东西（符号链接 / 换了位置），导出已停止`,
    );
  let current = root;
  // 逐级走：下一级是不是链接，要等上一级确认是真目录之后才有意义。
  /* oxlint-disable eslint/no-await-in-loop */
  for (const part of path.relative(root, dir).split(path.sep)) {
    current = path.join(current, part);
    let stat = await lstatOrNull(current);
    if (!stat && create) {
      try {
        await fs.mkdir(current);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      stat = await fs.lstat(current);
    }
    const shown = boundaryRel(boundary, current);
    if (!stat) throw Object.assign(new Error(`「${shown}」不见了`), { code: "ENOENT" });
    if (stat.isSymbolicLink()) throw symlinkRefused(boundary, shown);
    if (!stat.isDirectory())
      throw new CliError("invalid_path", `「${shown}」不是目录，导出没法往里写`, { path: shown });
  }
  /* oxlint-enable eslint/no-await-in-loop */
  const real = await fs.realpath(dir);
  if (!inside(root, real))
    throw new CliError(
      boundary.code,
      `「${rel}」的真实位置在${boundary.name}外面（${real}），导出不会往那里写，已停止。`,
      { path: rel },
    );
}

/* ── 网络：只下白名单主机上的素材 ─────────────────────────────────────────── */

/** 4xx：同一个请求再发一次还是同样的答案，重试只是白等（与页面导出同一条规矩）。 */
class PermanentMediaError extends Error {}

/** 测试接缝：`NODE_ENV=test` 时把白名单主机上的地址改发到本地假 CDN（白名单照旧按原地址判）。 */
function defaultRewrite(url) {
  const origin =
    process.env.NODE_ENV === "test" ? process.env.SCENEMINT_CANVAS_TEST_MEDIA_ORIGIN : undefined;
  if (!origin) return url;
  const parsed = new URL(url);
  return `${origin.replace(/\/$/, "")}${parsed.pathname}${parsed.search}`;
}

/** 重试之间的退避：0 / 1 s / 4 s，与页面 `zip-draft.ts` 的 `withRetry` 相同。 */
function defaultBackoff(attempt) {
  const override =
    process.env.NODE_ENV === "test" ? process.env.SCENEMINT_CANVAS_TEST_BACKOFF_MS : undefined;
  if (override !== undefined && Number.isFinite(Number(override))) return Number(override);
  return attempt === 0 ? 1000 : 4000;
}

export function defaultExportDeps() {
  return {
    /** `--draft-root` 的根检查看的系统、家目录与环境变量（测试可以换）。 */
    rootEnv: { platform: process.platform, home: os.homedir(), env: process.env },
    fetch: (...args) => globalThis.fetch(...args),
    rewrite: defaultRewrite,
    backoff: defaultBackoff,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    newHexId: core.newHexId,
    newUpperId: core.newUpperId,
    probe: probeVideoFile,
    stallMs: STALL_MS,
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function protocolOf(url) {
  try {
    return new URL(url).protocol;
  } catch {
    return "";
  }
}

/**
 * 发一次素材请求，自己跟重定向：**每一跳**都要过剪映导出的主机白名单（https、非 IP、
 * echojoy / 腾讯云 / 火山存储），不带 cookie、不带任何凭证。压缩编码显式关掉，
 * 好让 `Content-Length` 就是落盘的字节数。重定向跳到 http 单独说清楚是「降级」——
 * 那不是主机的问题，报成「不在白名单」会让人去查错地方。
 */
async function mediaFetch(url, { method = "GET", headers = {}, signal }, deps) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!core.isTrustedJianyingAssetUrl(current))
      throw new PermanentMediaError(
        hop > 0 && protocolOf(current) === "http:"
          ? `素材地址被重定向到了 http（${hostOf(current)}）：不允许降级到 http，不会去下载它`
          : `素材地址不在剪映导出的白名单主机上（${hostOf(current)}），不会去下载它`,
      );
    // oxlint-disable-next-line eslint/no-await-in-loop -- 下一跳去哪要看这一跳的回应，只能串行
    const response = await deps.fetch(deps.rewrite(current), {
      method,
      redirect: "manual",
      signal,
      headers: { "Accept-Encoding": "identity", ...headers },
    });
    if (!REDIRECTS.has(response.status)) return response;
    const location = response.headers.get("location");
    // oxlint-disable-next-line eslint/no-await-in-loop -- 同上：放掉这一跳的连接再发下一跳
    await response.body?.cancel().catch(() => {});
    if (!location) throw new PermanentMediaError(`HTTP ${response.status} 重定向没有给出地址`);
    current = new URL(location, current).href;
  }
  throw new PermanentMediaError("重定向次数太多");
}

/** 远端字节数（HEAD；不给就用 `Range: bytes=0-0` 的 Content-Range）。拿不到返回 null，不抛。 */
async function remoteSize(url, deps) {
  const attempt = async (method, headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIZE_TIMEOUT_MS);
    try {
      const response = await mediaFetch(url, { method, headers, signal: controller.signal }, deps);
      await response.body?.cancel().catch(() => {});
      if (method === "HEAD") {
        const length = response.headers.get("content-length");
        return response.ok && length !== null && /^\d+$/.test(length) ? Number(length) : null;
      }
      const range = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "")?.[1];
      return response.status === 206 && range ? Number(range) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  return (await attempt("HEAD")) ?? (await attempt("GET", { Range: "bytes=0-0" }));
}

function tempName(target) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID().slice(0, 8)}.part`,
  );
}

/**
 * 下一次：流式写进同目录的 `.part`，核对 Content-Length，齐了再改名成正式文件名。开 `.part` 之前、
 * 改名之前各复查一次目录（等回应、收字节的这段时间里，目录可能已被换成了链接）。
 */
async function downloadOnce(url, target, deps, boundary) {
  const controller = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), deps.stallMs);
  };
  const temp = tempName(target);
  let handle;
  let response;
  try {
    arm();
    response = await mediaFetch(url, { signal: controller.signal }, deps);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const message = `HTTP ${response.status}`;
      throw response.status >= 400 && response.status < 500
        ? new PermanentMediaError(message)
        : new Error(message);
    }
    const declared = response.headers.get("content-length");
    await assertBoundaryDir(boundary, path.dirname(target));
    handle = await fs.open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
      0o644,
    );
    let written = 0;
    if (response.body)
      for await (const chunk of response.body) {
        arm();
        await handle.write(chunk);
        written += chunk.byteLength;
      }
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (declared !== null && /^\d+$/.test(declared) && written !== Number(declared))
      throw new Error(`下载不完整：收到 ${written} / ${declared} 字节`);
    if (written === 0) throw new Error("下载到的是空文件");
    await assertBoundaryDir(boundary, path.dirname(target));
    await fs.rename(temp, target);
    return written;
  } catch (error) {
    await handle?.close().catch(() => {});
    await response?.body?.cancel().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    if (controller.signal.aborted && !(error instanceof PermanentMediaError))
      throw new Error(`下载 ${Math.round(deps.stallMs / 1000)} 秒没有进展，已中断`, {
        cause: error,
      });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 重试策略沿用页面导出：最多 `MEDIA_FETCH_ATTEMPTS`（3）次，退避 1 s / 4 s；4xx、白名单拒绝与
 * 目录越出边界（`CliError`）不重试 —— 再来一次还是同样的答案。
 */
async function downloadWithRetry(url, target, deps, boundary) {
  let lastError;
  for (let attempt = 0; attempt < core.MEDIA_FETCH_ATTEMPTS; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 重试按定义是串行的
      return await downloadOnce(url, target, deps, boundary);
    } catch (error) {
      lastError = error;
      if (error instanceof PermanentMediaError || error instanceof CliError) throw error;
      // oxlint-disable-next-line eslint/no-await-in-loop -- 退避按定义是串行的
      if (attempt < core.MEDIA_FETCH_ATTEMPTS - 1) await deps.sleep(deps.backoff(attempt));
    }
  }
  throw lastError;
}

/* ── 本地已有的素材：跨工程、跨运行复用 ──────────────────────────────────── */

/**
 * `001_a3f91c2e.mp4` → `_a3f91c2e.mp4`：摘要 + 扩展名就是素材身份（摘要由素材键算出，序号只是
 * 它在这个工程里的位置）。复用还要再核一次字节数与远端一致，碰巧撞了摘要的文件也过不了这道。
 */
const assetSuffix = (assetName) => assetName.slice(3);

/**
 * 扫一个输出目录下每个工程（含 `.partial`）的 `assets/video/`，按素材身份建索引，并入 `index`（每条记下
 * 它属于哪个边界，放进工程之前按那个边界复查）。符号链接一律跳过。
 */
async function scanLocalAssets(outAbs, boundary, index = new Map()) {
  let entries;
  try {
    entries = await fs.readdir(outAbs, { withFileTypes: true });
  } catch {
    return index;
  }
  const found = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const assets = path.join(outAbs, entry.name, "assets");
        const video = path.join(assets, "video");
        const [assetsStat, videoStat] = await Promise.all([
          lstatOrNull(assets),
          lstatOrNull(video),
        ]);
        if (!assetsStat?.isDirectory() || !videoStat?.isDirectory()) return [];
        const files = (await fs.readdir(video, { withFileTypes: true })).filter(
          (file) => file.isFile() && core.ASSET_FILE_NAME_RE.test(file.name),
        );
        const rows = await Promise.all(
          files.map(async (file) => {
            const full = path.join(video, file.name);
            const stat = await lstatOrNull(full);
            return stat?.isFile()
              ? { suffix: assetSuffix(file.name), file: full, size: stat.size, boundary }
              : null;
          }),
        );
        return rows.filter(Boolean);
      }),
  );
  for (const row of found.flat()) {
    const list = index.get(row.suffix) ?? [];
    list.push({ file: row.file, size: row.size, boundary: row.boundary });
    index.set(row.suffix, list);
  }
  return index;
}

/**
 * 这次导出可以借素材的本地目录：输出目录本身，外加（`--draft-root` 时）workspace 里默认的
 * `产出/剪映工程/` —— 「从 workspace 导出」就是把那里已有的工程按时间线重导进剪映草稿目录，素材从旧
 * 工程硬链接 / 复制，不重下（拍板 A6）。workspace 那一处过不了边界检查（被换成了链接之类）就不借它。
 */
async function localAssetIndex(out, workspace) {
  const index = await scanLocalAssets(out.abs, out.boundary);
  if (out.boundary.code !== "draft_root_boundary" || !workspace) return index;
  try {
    const old = await resolveOutDir(workspace, DEFAULT_OUT_DIR, { create: false });
    if (old.exists) await scanLocalAssets(old.abs, workspaceBoundary(workspace), index);
  } catch {
    /* workspace 里的旧工程借不了，就照常下载 */
  }
  return index;
}

/**
 * 把 `from.file` 放到 `to.file`：优先硬链接（不占第二份磁盘），文件系统不支持（FAT / exFAT、跨卷 ——
 * 例如 workspace 在 C 盘、剪映草稿目录在 D 盘）就复制（能 reflink 的文件系统上是瞬时克隆）。先落到同目录
 * 的临时名再改名，目标永远是完整的。链接 / 复制之前先按各自的边界复查来源与目标所在的目录（硬链接会把
 * 链到的那个文件带进来）。
 */
async function place(from, to, stats) {
  const source = from.file;
  const dest = to.file;
  if (source === dest) return;
  await Promise.all([
    assertBoundaryDir(from.boundary, path.dirname(source)),
    assertBoundaryDir(to.boundary, path.dirname(dest)),
  ]);
  try {
    const [a, b] = await Promise.all([fs.stat(source), fs.lstat(dest)]);
    if (b.isFile() && a.dev === b.dev && a.ino === b.ino && a.ino !== 0) return;
  } catch {
    /* dest 还不存在 */
  }
  const temp = tempName(dest);
  try {
    await fs.link(source, temp);
    stats.linked += 1;
  } catch {
    await fs.copyFile(source, temp, constants.COPYFILE_FICLONE);
    stats.copied += 1;
  }
  try {
    await fs.rename(temp, dest);
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

/* ── 暂存目录与续传标记 ────────────────────────────────────────────────────── */

async function readMarker(dir) {
  const file = path.join(dir, MARKER_FILE);
  const stat = await lstatOrNull(file);
  if (!stat?.isFile() || stat.size > 64 * 1024) return null;
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    return value && typeof value === "object" && value.v === 1 ? value : null;
  } catch {
    return null;
  }
}

async function writeAtomic(boundary, target, body) {
  await assertBoundaryDir(boundary, path.dirname(target));
  const temp = tempName(target);
  try {
    await fs.writeFile(temp, body, { flag: "wx", mode: 0o644 });
    await fs.rename(temp, target);
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

async function writeMarker(boundary, dir, identity, draftName) {
  const now = new Date().toISOString();
  const previous = await readMarker(dir);
  await writeAtomic(
    boundary,
    path.join(dir, MARKER_FILE),
    `${JSON.stringify({ v: 1, tool: "scenemint-canvas export-jianying", ...identity, draftName, createdAt: previous?.createdAt ?? now, updatedAt: now }, null, 2)}\n`,
  );
}

/**
 * out-dir 里上一次没完成的、**同一个工程**的暂存目录（剧名 + 工程标签相同）。有几个就取最近那个。
 * 只认本命令自己留下的（名字是 `.xxx.partial`、里面有续传标记），别的东西一概不碰。
 */
async function findPartials(outAbs) {
  const found = [];
  let entries;
  try {
    entries = await fs.readdir(outAbs, { withFileTypes: true });
  } catch {
    return found;
  }
  const staged = entries.filter(
    (entry) =>
      entry.isDirectory() && entry.name.startsWith(".") && entry.name.endsWith(PARTIAL_SUFFIX),
  );
  const markers = await Promise.all(
    staged.map((entry) => readMarker(path.join(outAbs, entry.name))),
  );
  staged.forEach((entry, i) => {
    if (markers[i]) found.push({ dir: path.join(outAbs, entry.name), marker: markers[i] });
  });
  return found;
}

function samePartial(marker, identity) {
  return marker.name === identity.name && (marker.label ?? null) === identity.label;
}

/** Windows 上刚写完的文件常被杀毒 / 索引短暂占着，目录改名会 EPERM / EBUSY：等一等再试几次。 */
async function renameDir(from, to, sleep) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 重试按定义是串行的
      await fs.rename(from, to);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      // oxlint-disable-next-line eslint/no-await-in-loop -- 退避按定义是串行的
      await sleep(100 * 2 ** attempt);
    }
  }
}

/* ── 主流程 ────────────────────────────────────────────────────────────────── */

/**
 * 定并发跑一批（每一条自己兜住失败，不像页面那样第一条失败就停：CLI 要把失败的一次列全）。
 * worker 抛出来的（只有越出边界这一种）不算「这一条失败」：不再发新的，等在飞的收尾后原样抛出。
 */
async function pool(items, limit, worker) {
  let next = 0;
  let stopped = null;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (!stopped && next < items.length) {
      const index = next;
      next += 1;
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 这一层就是并发闸的「一条车道」，串行是它的定义
        await worker(items[index]);
      } catch (error) {
        stopped ??= { error };
      }
    }
  });
  await Promise.all(lanes);
  if (stopped) throw stopped.error;
}

function refused(error) {
  return new CliError("jianying_refused", error.message, {
    reason: error.reason,
    ...(error.clipTitle ? { clipTitle: error.clipTitle } : {}),
  });
}

/** 时间线片段的形状（页面回包是不可信输入）：画不出草稿的整单拒，别带着坏数据往下走。 */
function checkTimeline(timeline) {
  if (!timeline || typeof timeline !== "object" || !Array.isArray(timeline.clips))
    throw new CliError("invalid_response", "The page returned no timeline clips");
  for (const clip of timeline.clips)
    if (!clip || typeof clip !== "object" || typeof clip.id !== "string")
      throw new CliError("invalid_response", "The page returned a malformed timeline clip");
}

const labelOf = (key) => (key === core.UNKNOWN_EPISODE ? core.JIANYING_OTHER_PROJECT_LABEL : key);

/** 按 `--episode` 挑片段；一段都没挑中就报错并列出时间线上有哪几集。 */
function selectClips(clips, episodes) {
  if (!episodes) return clips;
  const wanted = new Set(episodes);
  const picked = clips.filter((clip) => wanted.has(core.episodeKey(String(clip.title ?? ""))));
  if (picked.length > 0) return picked;
  const available = core.episodeKeys(clips.map((clip) => ({ title: String(clip.title ?? "") })));
  throw new CliError(
    "invalid_argument",
    clips.length === 0
      ? "时间线上还没有片段，先把视频放到时间线上再导出剪映工程。"
      : `--episode ${episodes.map(labelOf).join(", ")} 在时间线上一段都没有；时间线上现有：${available.map(labelOf).join("、")}`,
  );
}

/**
 * 导出的主体（不碰页面：时间线由调用方给）。`deps` 是 IO 的注入点，测试拿假 fetch / 固定时间 /
 * 固定 id 就能把整条路线离线跑完、与浏览器导出逐字节比对。
 */
export async function runExportJianying({
  workspace,
  timeline,
  options,
  deps = defaultExportDeps(),
}) {
  checkTimeline(timeline);
  const warnings = [];
  if (Number(timeline.droppedInvalid) > 0)
    warnings.push(
      `时间线上有 ${timeline.droppedInvalid} 段的视频地址不是 http(s)（历史脏数据），已跳过；与 timeline list 同口径。`,
    );
  const clips = selectClips(timeline.clips, options.episodes);
  // 指名了集、没指定组织方式：按**整条时间线**判断（与浏览器分集页单独导出一集 / 「其他」一致）——
  // 短剧里单导「其他」那一组，工程名照样带 `_其他_`；整条都没有集号（广告片、MV）就是单工程。
  const layout =
    options.layout ?? (options.episodes ? core.detectJianyingLayout(timeline.clips) : null);
  const title = typeof timeline.title === "string" ? timeline.title.trim() : "";
  const projectName = options.name ?? title;

  // ── 预检：页面导出的全部闸（段数上限、容器、独立配音、裁剪区间、转场）+ 主机白名单 ──────
  let exportPlan;
  try {
    exportPlan = core.planJianyingProjects({
      clips,
      projectName,
      layout,
      now: deps.now(),
      hash: core.assetDigest,
    });
  } catch (error) {
    if (error instanceof core.JianyingExportError) throw refused(error);
    throw error;
  }
  // 主机白名单：与页面导出同一道预检（同一个函数、同一句话），拒在下第一个字节之前。
  try {
    for (const project of exportPlan.projects) core.assertTrustedJianyingAssets(project.plan);
  } catch (error) {
    if (error instanceof core.JianyingExportError) throw refused(error);
    throw error;
  }

  // ── 目标目录：workspace 里的 --out-dir，或 --draft-root 给的剪映草稿目录 ─────────────
  let out;
  if (options.draftRoot) {
    // 剪映草稿目录必须已经在（剪映自己建的），这里不建；逐级查、realpath 查、拒盘根 / 家目录 / 系统目录。
    const root = await resolveDraftRoot(options.draftRoot, deps.rootEnv);
    out = { abs: root, rel: null, exists: true, boundary: draftRootBoundary(root) };
    // 目录过了检查，但看着不像剪映草稿根（没有 root_meta_info.json，也还没有任何草稿）：照导，回包提醒 ——
    // 可能是用户刚建的空目录，也可能给错了路径；不是剪映「草稿位置」里那个目录的话，剪映首页看不到这些工程。
    if (!(await draftRootLooks(root)).looksLikeDraftRoot)
      warnings.push(
        `「${root}」看着不像剪映草稿目录（根下没有 ${ROOT_META_FILE}，也还没有任何草稿）：请用户确认它就是剪映「全局设置 → 草稿位置」里显示的那个目录 —— 不是的话，剪映首页看不到这些工程。`,
      );
  } else {
    out = await resolveOutDir(workspace, options.outDir, { create: !options.dryRun });
    out.boundary = workspaceBoundary(workspace);
  }
  const rootIssue = core.checkDraftRootPath(out.abs);
  if (rootIssue)
    throw new CliError(
      "invalid_path",
      rootIssue === "too-long"
        ? "输出目录的绝对路径太长，剪映草稿根最多 400 个字符：换一个短一点的 --out-dir"
        : `输出目录「${out.abs}」不是绝对路径，写不出剪映能认的素材路径`,
    );
  const safeProjectName = core.safeName(projectName);
  // 报错与回包里给人看的位置：workspace 里是 workspace 相对路径，剪映草稿目录里就是工程目录名本身。
  const shown = (name) => (out.rel === null ? name : `${out.rel}/${name}`);
  const targets = exportPlan.projects.map((project) => {
    const draftName = project.plan.draftName;
    return {
      project,
      draftName,
      identity: { name: safeProjectName, label: project.label, layout: exportPlan.layout },
      finalDir: path.join(out.abs, draftName),
      stageDir: path.join(out.abs, `.${draftName}${PARTIAL_SUFFIX}`),
      rel: shown(draftName),
      stageRel: shown(`.${draftName}${PARTIAL_SUFFIX}`),
    };
  });
  if (new Set(targets.map((t) => t.draftName)).size !== targets.length)
    throw new CliError("internal_error", "两个工程算出了同一个目录名，导出已中止");

  // 已存在的同名工程目录：不覆盖。在下载任何字节之前就说清楚。
  const existing = [];
  const finals = await Promise.all(
    targets.map((target) => (out.exists ? lstatOrNull(target.finalDir) : null)),
  );
  targets.forEach((target, i) => {
    const stat = finals[i];
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new CliError(out.boundary.code, `「${target.rel}」已存在但不是普通目录，不会往里写`, {
        path: target.rel,
      });
    target.exists = true;
    existing.push(target.rel);
  });
  if (existing.length > 0 && !options.overwrite && !options.dryRun)
    throw new CliError(
      "file_exists",
      options.draftRoot
        ? `剪映草稿目录里已经有同名工程：${existing.join("、")}。换一个 --name 再导（--draft-root 从不覆盖剪映草稿目录里已有的东西）。`
        : `这些工程目录已经存在：${existing.join("、")}。换一个 --name，或在用户同意覆盖后加 --overwrite。`,
      { dirs: existing },
    );

  const partials = out.exists ? await findPartials(out.abs) : [];
  for (const target of targets) {
    if (target.exists) continue;
    const mine = partials
      .filter((entry) => !entry.claimed && samePartial(entry.marker, target.identity))
      .sort((a, b) => String(b.marker.updatedAt).localeCompare(String(a.marker.updatedAt)))[0];
    if (mine) {
      mine.claimed = true;
      target.resumeFrom = mine.dir;
    }
  }

  // 去重后的素材：一个素材键一份，记下哪些工程要它、各自叫什么。
  const units = new Map();
  for (const target of targets)
    for (const asset of target.project.plan.assets) {
      const unit = units.get(asset.key) ?? {
        key: asset.key,
        url: asset.url,
        suffix: assetSuffix(asset.assetName),
        clipTitle: asset.clipTitles[0] ?? asset.assetName,
        users: [],
      };
      unit.users.push({ target, assetName: asset.assetName });
      units.set(asset.key, unit);
    }

  if (options.dryRun)
    return dryRun({ out, workspace, exportPlan, targets, units, warnings, deps, options });

  // ── 工作目录：已存在（--overwrite）就写在原地；否则接上一次的 .partial，或新建一个 ──────
  // 逐个工程准备（工程数很少）：出错时停在第一个出错的工程上，报错与回包顺序一致。
  /* oxlint-disable eslint/no-await-in-loop */
  for (const target of targets) {
    if (target.exists) {
      target.workDir = target.finalDir;
      target.mode = "overwrite";
    } else {
      // 暂存目录的位置上是个符号链接（不是本命令留下的）：不接着用，也不往它指的地方建。
      if ((await lstatOrNull(target.stageDir))?.isSymbolicLink())
        throw symlinkRefused(out.boundary, target.stageRel);
      if (target.resumeFrom && target.resumeFrom !== target.stageDir)
        await renameDir(target.resumeFrom, target.stageDir, deps.sleep);
      else if (!target.resumeFrom) {
        try {
          await fs.mkdir(target.stageDir);
        } catch (error) {
          // 同一秒里重跑、上一次的暂存目录又丢了续传标记：同名的就是它，接着用（它是本命令的暂存目录）。
          const stat = error.code === "EEXIST" ? await lstatOrNull(target.stageDir) : null;
          if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw error;
          target.resumeFrom = target.stageDir;
        }
      }
      target.resumed = Boolean(target.resumeFrom);
      target.workDir = target.stageDir;
      target.mode = "stage";
    }
    // 建完（或接上）工程目录先复查：它和一路上的每一级都还是边界根（workspace / 剪映草稿目录）里的真目录。
    await assertBoundaryDir(out.boundary, target.workDir);
    if (target.mode === "stage")
      await writeMarker(out.boundary, target.stageDir, target.identity, target.draftName);
    // assets/video/ 一级一级建、一级一级查：`mkdir -p` 会顺着半路的符号链接（例如续传暂存目录里被
    // 换成链接的 assets）一直建到根外面去。
    await assertBoundaryDir(out.boundary, path.join(target.workDir, "assets", "video"), {
      create: true,
    });
  }
  /* oxlint-enable eslint/no-await-in-loop */

  // ── 素材：每个一份（复用 / 下载 → 探针），再放进每个用到它的工程 ─────────────────
  const index = await localAssetIndex(out, workspace);
  const stats = {
    downloaded: 0,
    downloadedBytes: 0,
    reused: 0,
    reusedBytes: 0,
    linked: 0,
    copied: 0,
  };
  await pool([...units.values()], core.DIRECT_FETCH_CONCURRENCY, async (unit) => {
    try {
      for (const user of unit.users)
        user.file = path.join(user.target.workDir, "assets", "video", user.assetName);
      const source = await acquire(unit, index, deps, stats, out.boundary);
      let probed;
      try {
        probed = await deps.probe(source.file);
      } catch (error) {
        throw Object.assign(
          new Error(error instanceof ProbeError ? error.message : String(error?.message ?? error)),
          { code: "probe_failed" },
        );
      }
      unit.fact = {
        assetName: unit.users[0].assetName,
        bytes: source.bytes,
        width: probed.width,
        height: probed.height,
        durationUs: probed.durationUs,
      };
      // 编码不进草稿（fact 与页面导出逐字节一致），只用来在回包里提醒。
      unit.codec = typeof probed.codec === "string" ? probed.codec : null;
      try {
        await Promise.all(
          unit.users.map((user) =>
            place(source, { file: user.file, boundary: out.boundary }, stats),
          ),
        );
      } catch (error) {
        if (isBoundary(error)) throw error;
        throw Object.assign(new Error(`素材放进工程目录失败：${error?.message ?? error}`), {
          code: "write_failed",
        });
      }
    } catch (error) {
      // 越出边界不算「这个素材失败」：整个导出停下（pool 停发新的，在飞的收尾后抛出）。
      if (isBoundary(error)) throw error;
      unit.error = {
        code: ["probe_failed", "write_failed"].includes(error?.code)
          ? error.code
          : "download_failed",
        message: String(error?.message ?? error),
      };
    }
  });
  if (stats.copied > 0)
    warnings.push(
      `有 ${stats.copied} 份素材没能用硬链接（文件系统不支持），按份复制了，会多占一份磁盘。`,
    );
  // 浏览器导出认不出的视频编码：不阻断（工程照常写），但剪映能否播放要用户在真机上看。
  for (const unit of units.values())
    if (unit.fact && unit.codec && !BROWSER_VIDEO_CODECS.has(unit.codec.toLowerCase()))
      warnings.push(
        `片段「${unit.clipTitle}」的素材 ${unit.users[0].assetName} 视频编码是 ${codecLabel(unit.codec)}，不在浏览器导出支持的编码里（H.264 / H.265 / VP8 / VP9 / AV1 / ProRes；页面上的导出按钮可能导不出它）。CLI 照常把它写进了工程，但剪映能否播放以真机为准：请用户在剪映里确认这一段能正常播放。`,
      );

  // ── 每个工程：素材齐了才生成草稿、原子发布；不齐的留在 .partial 里 ─────────────────
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const nodeIdsOf = (target, predicate) => [
    ...new Set(
      target.project.plan.segments
        .filter(predicate)
        .map((segment) => clipById.get(segment.clipId)?.sourceId)
        .filter((id) => typeof id === "string" && id),
    ),
  ];
  for (const target of targets) {
    const plan = target.project.plan;
    const broken = plan.assets.filter((asset) => units.get(asset.key).error);
    if (broken.length > 0) {
      const keys = new Set(broken.map((asset) => asset.key));
      target.status = "partial";
      target.failedNodeIds = nodeIdsOf(target, (segment) => keys.has(segment.assetKey));
      target.errors = broken.map((asset) => ({
        asset: asset.assetName,
        clipTitle: asset.clipTitles[0] ?? asset.assetName,
        ...units.get(asset.key).error,
      }));
      continue;
    }
    const facts = new Map(plan.assets.map((asset) => [asset.key, units.get(asset.key).fact]));
    let built;
    try {
      [{ built }] = core.buildJianyingProjects(
        { layout: exportPlan.layout, projects: [target.project] },
        facts,
        {
          draftRoot: out.abs,
          canvasRatio: null,
          now: deps.now(),
          newHexId: deps.newHexId,
          newUpperId: deps.newUpperId,
        },
      );
    } catch (error) {
      if (!(error instanceof core.JianyingExportError)) throw error;
      // 探针之后才看得出的毛病（入点超出源视频长度、转场比真实长度长）：这个工程做不出来。
      target.status = "partial";
      target.failedNodeIds = nodeIdsOf(
        target,
        (segment) => !error.clipTitle || segment.title === error.clipTitle,
      );
      target.errors = [{ code: "jianying_refused", reason: error.reason, message: error.message }];
      continue;
    }
    // 生成时丢掉的东西（例如叠在一起超过上限的字幕）：工程照常写，回包里说清楚丢了什么。
    if (built.warnings) warnings.push(...built.warnings);
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 工程按顺序一个一个发布：回包与盘上的状态逐个对得上
      await publish(target, built, deps, out.boundary);
      target.status = "ok";
      target.durationUs = built.totalDurationUs;
      target.bytes = built.totalBytes;
    } catch (error) {
      if (isBoundary(error)) throw error;
      target.status = "partial";
      target.failedNodeIds = [];
      target.errors = [{ code: "write_failed", message: String(error?.message ?? error) }];
    }
  }

  return report({ out, exportPlan, targets, units, stats, warnings, options });
}

/**
 * 一个素材从哪来：本地已有（这次的工程目录、输出目录里以前的工程；`--draft-root` 时还有 workspace 里
 * `产出/剪映工程/` 的旧工程）且字节数与远端一致的直接用，否则下载到第一个用到它的工程里。回的
 * `boundary` 是这个文件所在的边界，放进别的工程之前按它复查。
 */
async function acquire(unit, index, deps, stats, boundary) {
  const candidates = [
    ...unit.users.map((user) => ({ file: user.file, boundary })),
    ...(index.get(unit.suffix) ?? []).map((entry) => ({
      file: entry.file,
      boundary: entry.boundary,
    })),
  ];
  const seen = new Set();
  const unique = candidates.filter((entry) => !seen.has(entry.file) && seen.add(entry.file));
  const found = await Promise.all(unique.map((entry) => lstatOrNull(entry.file)));
  const present = unique
    .map((entry, i) => ({ ...entry, stat: found[i] }))
    .filter(({ stat }) => stat?.isFile() && stat.size > 0)
    .map(({ file, boundary: where, stat }) => ({ file, boundary: where, size: stat.size }));
  if (present.length > 0) {
    const expected = await remoteSize(unit.url, deps);
    const match = expected === null ? undefined : present.find((entry) => entry.size === expected);
    if (match) {
      stats.reused += 1;
      stats.reusedBytes += match.size;
      return { file: match.file, boundary: match.boundary, bytes: match.size };
    }
  }
  const target = unit.users[0].file;
  const bytes = await downloadWithRetry(unit.url, target, deps, boundary);
  stats.downloaded += 1;
  stats.downloadedBytes += bytes;
  return { file: target, boundary, bytes };
}

/**
 * 写草稿文件并发布：草稿文件（除 `draft_meta_info.json`）→ 清掉暂存目录里上一次留下的、这次用
 * 不到的素材与 `.part` → 暂存目录改名成正式目录 → 去掉续传标记 → 最后写 `draft_meta_info.json`。
 */
async function publish(target, built, deps, boundary) {
  const order = built.writeOrder.filter((name) => name !== core.DRAFT_META_FILE);
  for (const name of built.writeOrder)
    if (!core.isSafeDraftRelPath(name)) throw new Error(`草稿里出现了非法的文件名「${name}」`);
  for (const name of order)
    // oxlint-disable-next-line eslint/no-await-in-loop -- 按 writeOrder 串行写：这个顺序就是约定本身
    await writeAtomic(boundary, path.join(target.workDir, ...name.split("/")), built.files[name]);
  if (target.mode === "stage") {
    const video = path.join(target.stageDir, "assets", "video");
    // 清旧素材之前复查：顺着换进来的链接去删，删掉的就是根外面的文件。只清自己暂存目录里的。
    await assertBoundaryDir(boundary, video);
    const keep = new Set(target.project.plan.assets.map((asset) => asset.assetName));
    const stale = (await fs.readdir(video)).filter(
      (name) =>
        (core.ASSET_FILE_NAME_RE.test(name) && !keep.has(name)) || /^\..*\.part$/.test(name),
    );
    await Promise.all(stale.map((name) => fs.unlink(path.join(video, name)).catch(() => {})));
    if (await lstatOrNull(target.finalDir))
      throw new Error(`「${target.rel}」在导出过程中被别人建了出来，工程留在暂存目录里没有发布`);
    await renameDir(target.stageDir, target.finalDir, deps.sleep);
    target.published = true;
    await assertBoundaryDir(boundary, target.finalDir);
    // 改名成功之后才去掉续传标记：改名失败时暂存目录还带着它，下一次能接着用。
    await fs.unlink(path.join(target.finalDir, MARKER_FILE)).catch(() => {});
  }
  await writeAtomic(
    boundary,
    path.join(target.finalDir, core.DRAFT_META_FILE),
    built.files[core.DRAFT_META_FILE],
  );
}

function retryArgv(options, exportPlan, partials) {
  const argv = ["export-jianying"];
  if (options.draftRoot) {
    argv.push("--draft-root", options.draftRoot);
    if (options.approved) argv.push("--approved");
  } else if (options.outDir !== DEFAULT_OUT_DIR) argv.push("--out-dir", options.outDir);
  if (options.name !== undefined) argv.push("--name", options.name);
  argv.push("--layout", exportPlan.layout);
  if (exportPlan.layout === "episodes")
    for (const target of partials)
      argv.push("--episode", target.project.label ?? core.JIANYING_OTHER_PROJECT_LABEL);
  else if (options.episodes)
    for (const key of options.episodes) argv.push("--episode", labelOf(key));
  return argv;
}

function report({ out, exportPlan, targets, units, stats, warnings, options }) {
  const projects = targets.map((target) => {
    const ok = target.status === "ok";
    const bytes = ok
      ? target.bytes
      : target.project.plan.assets.reduce(
          (sum, asset) => sum + (units.get(asset.key).fact?.bytes ?? 0),
          0,
        );
    // 暂存目录里的工程报暂存目录；已经改名成正式目录（或 --overwrite 写在原地）的报正式目录。
    const staged = target.mode === "stage" && !target.published;
    return {
      name: target.draftName,
      dir: staged ? target.stageRel : target.rel,
      absoluteDir: staged ? target.stageDir : target.finalDir,
      episode: target.project.label,
      clips: target.project.plan.segments.length,
      assets: target.project.plan.assets.length,
      bytes,
      status: target.status,
      ...(ok ? { durationMs: Math.round(target.durationUs / 1000) } : {}),
      ...(target.resumed ? { resumed: true } : {}),
      ...(target.mode === "overwrite" ? { overwritten: true } : {}),
      ...(ok ? {} : { failedNodeIds: target.failedNodeIds, errors: target.errors }),
    };
  });
  const partials = targets.filter((target) => target.status !== "ok");
  const result = {
    ok: partials.length === 0,
    layout: exportPlan.layout,
    outDir: out.rel,
    draftRoot: out.abs,
    ...draftRootFields(options),
    projects,
    downloadedBytes: stats.downloadedBytes,
    reusedBytes: stats.reusedBytes,
    warnings,
    note: options.draftRoot ? NOTE_DRAFT_ROOT : NOTE,
  };
  if (partials.length === 0) return result;
  const failedNodeIds = [...new Set(partials.flatMap((target) => target.failedNodeIds))];
  return {
    ...result,
    error: {
      code: "export_partial",
      message: `${targets.length} 个工程里有 ${partials.length} 个没做完（状态 partial，留在 .partial 暂存目录里、剪映看不到）；其余 ${targets.length - partials.length} 个已写好。修好失败的片段后用 retry 里的 argv 重跑，已下好的素材不会再下。`,
      failedNodeIds,
      retry: retryArgv(options, exportPlan, partials),
    },
  };
}

/** `--draft-root` 时回包多带的：这个目录在不在用户登记的草稿目录里（查过才带）。 */
function draftRootFields(options) {
  if (!options.draftRoot || typeof options.draftRootRegistered !== "boolean") return {};
  return { draftRootRegistered: options.draftRootRegistered };
}

/** `--dry-run`：只出计划，不建目录、不下载（远端字节数用 HEAD 问）。 */
async function dryRun({ out, workspace, exportPlan, targets, units, warnings, deps, options }) {
  const index = out.exists ? await localAssetIndex(out, workspace) : new Map();
  await pool([...units.values()], core.DIRECT_FETCH_CONCURRENCY, async (unit) => {
    unit.bytes = await remoteSize(unit.url, deps);
    unit.reusable =
      unit.bytes !== null &&
      (index.get(unit.suffix) ?? []).some((entry) => entry.size === unit.bytes);
  });
  const unknown = [...units.values()].filter((unit) => unit.bytes === null).length;
  if (unknown > 0) warnings.push(`有 ${unknown} 个素材问不到大小（HEAD 失败），字节数没算进去。`);
  const sum = (list) => list.reduce((total, unit) => total + (unit.bytes ?? 0), 0);
  const all = [...units.values()];
  for (const target of targets)
    if (target.exists)
      warnings.push(
        options.draftRoot
          ? `剪映草稿目录里已经有「${target.rel}」：正式导出会报 file_exists（换一个 --name）。`
          : `「${target.rel}」已经存在：不加 --overwrite 正式导出会报 file_exists。`,
      );
  if (options.draftRoot && options.draftRootRegistered === false && !options.approved)
    warnings.push(
      `「${out.abs}」不在用户登记的剪映草稿目录里：正式导出前先把这条完整路径念给用户，他同意了再加 --approved。`,
    );
  return {
    ok: true,
    dryRun: true,
    layout: exportPlan.layout,
    outDir: out.rel,
    draftRoot: out.abs,
    ...draftRootFields(options),
    projectCount: targets.length,
    projects: targets.map((target) => {
      const mine = target.project.plan.assets.map((asset) => units.get(asset.key));
      return {
        name: target.draftName,
        dir: target.rel,
        episode: target.project.label,
        clips: target.project.plan.segments.length,
        assets: mine.length,
        bytes: mine.some((unit) => unit.bytes === null) ? null : sum(mine),
        exists: Boolean(target.exists),
        ...(target.resumeFrom ? { resumeFrom: path.basename(target.resumeFrom) } : {}),
      };
    }),
    totalBytes: sum(all),
    downloadBytes: sum(all.filter((unit) => !unit.reusable)),
    reusableBytes: sum(all.filter((unit) => unit.reusable)),
    warnings,
    note: options.draftRoot ? NOTE_DRAFT_ROOT : NOTE,
  };
}

/** 页面太老：没有这个方法。说清楚要刷新，而不是当成别的失败。 */
const missingMethod = (reply) =>
  reply?.ok === false &&
  (reply.error?.code === "method_not_allowed" || reply.error?.code === "bridge_missing");

/**
 * `--draft-root` 的白名单：页面桥 `jianying_roots_list`（用户登记的那几条）里有没有这个目录 ——
 * 按页面纯函数层的 `draftRootKey` 比（Windows 不分大小写 / 斜杠方向），给的写法与 realpath 两种都比。
 * 回 `{ registered: true|false }`，或读不到时 `{ failure: <页面回包> }`。
 */
async function draftRootRegistration(session, input, root) {
  const reply = await call(session, "jianying_roots_list", {});
  if (reply?.ok === false) return { failure: reply };
  const keys = new Set([core.draftRootKey(input), core.draftRootKey(root)]);
  const registered = (Array.isArray(reply?.roots) ? reply.roots : []).some(
    (entry) => typeof entry?.path === "string" && keys.has(core.draftRootKey(entry.path)),
  );
  return { registered };
}

/**
 * 导出成功之后把这个剪映草稿目录「记住」（页面桥 `jianying_roots_touch`：登记表里有就刷新最近使用时间，
 * 没有就登记，满 5 条挤掉最久没用的）。页面不在时这条写命令排队（最多等 5 秒就回），页面回来会自己执行。
 * 失败只进 `warnings`：工程已经写好了，不能因为这一步说导出失败。
 */
async function rememberDraftRoot(session, result) {
  const reply = await call(
    session,
    "jianying_roots_touch",
    { path: result.draftRoot },
    { waitMs: 5000 },
  );
  if (reply?.ok === true) {
    const evicted = (Array.isArray(reply.evicted) ? reply.evicted : [])
      .filter((entry) => typeof entry?.path === "string")
      .map((entry) => ({ path: entry.path, ...(entry.label ? { label: entry.label } : {}) }));
    result.remembered = { ok: true, added: reply.added === true, evicted };
    if (evicted.length > 0)
      result.warnings.push(
        `用户登记的剪映草稿目录已满 5 条：记住这一条时挤掉了最久没用的 ${evicted.map((entry) => `「${entry.label ?? entry.path}」`).join("、")}。把这件事告诉用户。`,
      );
    return;
  }
  const error = reply?.error ?? {};
  result.remembered = {
    ok: false,
    code: error.code ?? "unknown",
    ...(error.queued ? { queued: true } : {}),
  };
  result.warnings.push(
    error.queued
      ? "工程已写好；页面暂时不在，「把这个剪映草稿目录记进用户设置」这一步已排队，页面回来后会自动执行。"
      : `工程已写好，但没能把这个剪映草稿目录记进用户设置（${error.code ?? "unknown"}：${error.message ?? ""}）。下次再导到这里仍要先问用户、加 --approved；也可以请用户去「我的剪映草稿目录」里手动登记。`,
  );
}

/**
 * CLI 入口：向页面要时间线（只读 `timeline_export`，worker 也能调），然后 `runExportJianying`。
 * 页面太老（没有这个方法）时说清楚要刷新，而不是当成空时间线。
 *
 * `--draft-root`：只有主会话能用（它读写的是用户登记的草稿目录，main 专用方法）；在要时间线之前先把
 * 目录本身验一遍，再查白名单 —— 不在用户登记的草稿目录里又没带 `--approved` 的，一个字节都不下就回
 * `approval_required`（`--dry-run` 不拦，只在回包里提醒）。成功之后记住它。
 */
export async function exportJianying(session, rawOptions, deps = defaultExportDeps()) {
  const options = exportOptions(rawOptions);
  if (options.draftRoot) {
    if (session.role !== "main")
      throw new CliError(
        "worker_forbidden",
        "直写剪映草稿目录（--draft-root）只有主会话能做：子代理不能查、不能导。把要导的集写进汇报，由主 Agent 来导。",
      );
    const root = await resolveDraftRoot(options.draftRoot, deps.rootEnv);
    const registration = await draftRootRegistration(session, options.draftRoot, root);
    if (registration.failure) {
      // 读不到登记表时，只有「页面太旧、没有这个方法」（bridge_missing / method_not_allowed）能凭
      // --approved 照导（用户已经听过完整路径并同意）。其余失败 —— worker_forbidden、登录过期、
      // jianying_roots_unavailable、页面不在…… —— 带不带 --approved 都原样回，一个字节都不写。
      if (!missingMethod(registration.failure)) return registration.failure;
      if (!options.approved)
        throw new CliError(
          "bridge_missing",
          "这个画布页面还不支持读用户登记的剪映草稿目录（缺 jianying_roots_list），核对不了白名单：请用户刷新画布页面后再试；或者把这条完整路径念给用户、他同意后加 --approved。",
        );
    } else options.draftRootRegistered = registration.registered;
    if (registration.registered === false && !options.approved && !options.dryRun)
      throw new CliError(
        "approval_required",
        `「${root}」不在用户登记的剪映草稿目录里（jianying-roots 列出的那几条）。先把这条完整路径念给用户、他同意写进这个目录后加 --approved 再导；导出成功后它会自动记进登记表。`,
        { draftRoot: root },
      );
  }
  const reply = await call(session, "timeline_export", {});
  if (reply?.ok === false) {
    if (missingMethod(reply))
      throw new CliError(
        "bridge_missing",
        "这个画布页面还不支持导出剪映工程（缺 timeline_export）：请用户刷新画布页面后再试。",
      );
    return reply;
  }
  const result = await runExportJianying({
    workspace: session.workspace,
    timeline: reply,
    options,
    deps,
  });
  if (options.draftRoot && !options.dryRun && result.ok === true)
    await rememberDraftRoot(session, result);
  return result;
}
