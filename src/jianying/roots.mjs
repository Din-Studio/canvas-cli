/**
 * `jianying-roots`：列出用户登记的剪映草稿目录（最多 5 条），给「直写剪映草稿目录」
 * （`export-jianying --draft-root`）挑目标用。
 *
 * 登记表存在服务端的用户设置里（按用户全局、跟项目无关），CLI 不持 cookie，所以经页面桥读：
 * `jianying_roots_list`（main 专用 —— 子代理不能查，拍板 A6）。回来的每一条再在**这台机器上**看一眼：
 *
 *  · `exists`：这台机器上有没有这个目录（路径形状不是这台机器的 —— 例如在 Mac 上看一条 `D:\…` ——
 *    直接算不在，`reason:"other_platform"`）；
 *  · `looksLikeDraftRoot`：像不像剪映草稿根 —— 根下有 `root_meta_info.json`，或者已经有草稿目录
 *    （子目录里有 `draft_meta_info.json`）。空目录不算像：可能是用户刚建的，也可能填错了；
 *  · `usable`：`export-jianying --draft-root` 收不收它（与导出同一份根检查 `resolveDraftRoot`：真目录、
 *    逐级没有符号链接、realpath 一致、不是盘根 / 家目录 / 系统目录），不收的 `reason` 说为什么。
 *
 * 排序：最近用过的在前（`lastUsedAt`，页面纯函数层的 `sortDraftRootsByRecentUse`，经 `core.mjs`）。
 * 回包带一张定宽文本表 `table`（弱模型读表比读 JSON 数组稳）和一句 `hint`：下一步怎么问用户。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { CliError } from "../common.mjs";
import { call } from "../client.mjs";
import * as core from "./core.mjs";
import { onThisPlatform, resolveDraftRoot } from "./draft-root.mjs";

/** 看「像不像草稿根」时最多翻这么多个子目录：草稿根里可能有几百份草稿，列表不该因此变慢。 */
const SCAN_LIMIT = 500;

/** 剪映草稿根下的这个文件（剪映自己维护的草稿索引）；有它就是草稿根。 */
export const ROOT_META_FILE = "root_meta_info.json";

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch {
    return null;
  }
}

/**
 * 像不像剪映草稿根：根下有 `root_meta_info.json`，或者已经有草稿（子目录里有 `draft_meta_info.json`，
 * 最多翻 `SCAN_LIMIT` 个子目录）。空目录不算像。不抛：读不了目录就只凭 `root_meta_info.json` 判断。
 * `jianying-roots` 的逐条检查与 `export-jianying --draft-root` 的回包提醒共用这一份口径。
 */
export async function draftRootLooks(target) {
  const rootMetaInfo = (await lstatOrNull(path.join(target, ROOT_META_FILE)))?.isFile() === true;
  const names = [];
  try {
    const dir = await fs.opendir(target);
    for await (const entry of dir) {
      if (entry.isDirectory()) names.push(entry.name);
      if (names.length >= SCAN_LIMIT) break;
    }
  } catch {
    /* 读不了目录：只凭 root_meta_info.json 判断 */
  }
  const metas = await Promise.all(
    names.map((name) => lstatOrNull(path.join(target, name, core.DRAFT_META_FILE))),
  );
  const drafts = metas.filter((meta) => meta?.isFile()).length;
  return { looksLikeDraftRoot: rootMetaInfo || drafts > 0, rootMetaInfo, drafts };
}

/**
 * 在这台机器上看一眼这个目录：在不在、像不像剪映草稿根、`--draft-root` 收不收。不抛。
 * `rootEnv` 是根检查看的 `{ platform, home, env }`（与 `export-jianying` 同一个注入点）。
 */
export async function probeDraftRoot(target, rootEnv = {}) {
  const platform = rootEnv.platform ?? process.platform;
  if (!onThisPlatform(target, platform))
    return { exists: false, looksLikeDraftRoot: false, usable: false, reason: "other_platform" };
  let stat;
  try {
    stat = await fs.stat(target);
  } catch (error) {
    return {
      exists: false,
      looksLikeDraftRoot: false,
      usable: false,
      reason: ["ENOENT", "ENOTDIR"].includes(error?.code) ? "not_found" : "unreadable",
    };
  }
  if (!stat.isDirectory())
    return { exists: false, looksLikeDraftRoot: false, usable: false, reason: "not_directory" };
  const { looksLikeDraftRoot, rootMetaInfo, drafts } = await draftRootLooks(target);
  let refusal = null;
  try {
    await resolveDraftRoot(target, rootEnv);
  } catch (error) {
    refusal = error instanceof CliError ? (error.extra?.reason ?? error.code) : "unreadable";
  }
  return {
    exists: true,
    looksLikeDraftRoot,
    rootMetaInfo,
    drafts,
    usable: refusal === null,
    ...(refusal ? { reason: refusal } : {}),
  };
}

/** 页面回包（不可信输入）→ 干净的几条：path 必须是字符串，label / lastUsedAt 不是字符串就当没有。 */
function cleanRoots(value) {
  if (!Array.isArray(value))
    throw new CliError("invalid_response", "The page returned no draft folder list");
  return value
    .filter(
      (root) => root && typeof root === "object" && typeof root.path === "string" && root.path,
    )
    .map((root) => ({
      path: root.path,
      ...(typeof root.label === "string" && root.label ? { label: root.label } : {}),
      ...(typeof root.lastUsedAt === "string" && root.lastUsedAt
        ? { lastUsedAt: root.lastUsedAt }
        : {}),
    }));
}

const yesNo = (value) => (value ? "yes" : "no");

/** 定宽文本表：一行一条，最近用过的在前。 */
export function formatRootsTable(rows) {
  const header = ["#", "lastUsedAt", "label", "exists", "looksLikeDraftRoot", "usable", "path"];
  const cells = rows.map((row, index) => [
    String(index + 1),
    row.lastUsedAt ?? "-",
    row.label ?? "-",
    row.exists ? "yes" : `no (${row.reason})`,
    row.exists
      ? `${yesNo(row.looksLikeDraftRoot)}${row.drafts ? ` (${row.drafts} drafts)` : ""}`
      : "-",
    row.exists ? (row.usable ? "yes" : `no (${row.reason})`) : "-",
    row.path,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((line) => line[i].length)));
  const line = (values) =>
    values
      .map((value, i) => value.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(header), ...cells.map(line)].join("\n");
}

const HINT =
  "把这几条念给用户（备注 + 路径；本机不在的、不像剪映草稿根的、usable 为 no 的说清楚），请他选一条，或者给一个新的绝对路径（剪映「全局设置 → 草稿位置」里显示的那个）；然后 export-jianying --draft-root <那条路径>。表里有的直接导；表外的新路径先把完整路径念给用户、他同意了再加 --approved —— 导出成功后它会自动记进这张表（满 5 条挤掉最久没用的）。";
const HINT_EMPTY =
  "用户还没有登记剪映草稿目录。请他给出剪映「全局设置 → 草稿位置」里显示的完整路径，把这条路径念给他确认后，export-jianying --draft-root <那条路径> --approved；导出成功后会自动登记。";

/**
 * CLI 入口。worker 在这里就拒（守护进程和页面也会按 `MAIN_METHODS` 拒，这里只是一次网络都不发）；
 * 页面太老（没有这个方法）时说清楚要刷新。
 */
export async function jianyingRoots(session, rpcOptions = {}, rootEnv = {}) {
  if (session.role !== "main")
    throw new CliError(
      "worker_forbidden",
      "剪映草稿目录只有主会话能查（子代理不能查、不能直写草稿目录）：把要导的集写进汇报，由主 Agent 来导。",
    );
  const reply = await call(session, "jianying_roots_list", {}, rpcOptions);
  if (reply?.ok === false) {
    const code = reply.error?.code;
    if (code === "method_not_allowed" || code === "bridge_missing")
      throw new CliError(
        "bridge_missing",
        "这个画布页面还不支持读剪映草稿目录（缺 jianying_roots_list）：请用户刷新画布页面后再试。",
      );
    return reply;
  }
  const roots = core.sortDraftRootsByRecentUse(cleanRoots(reply?.roots));
  const rows = await Promise.all(
    roots.map(async (root) => ({
      path: root.path,
      ...(root.label ? { label: root.label } : {}),
      lastUsedAt: root.lastUsedAt ?? null,
      ...(await probeDraftRoot(root.path, rootEnv)),
    })),
  );
  return {
    ok: true,
    max: Number.isInteger(reply?.max) ? reply.max : 5,
    roots: rows,
    table: formatRootsTable(rows),
    hint: rows.length > 0 ? HINT : HINT_EMPTY,
  };
}
