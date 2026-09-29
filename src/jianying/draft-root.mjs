/**
 * `--draft-root`（直写剪映草稿目录，拍板 A6）的根检查。`export-jianying` 在写任何东西之前、
 * `jianying-roots` 在给每条登记的目录打「能不能直写」的标记时，都用这一份。
 *
 * 草稿目录在 workspace **外面**（用户机器上剪映「全局设置 → 草稿位置」那个文件夹），所以 CLI 往里写
 * 之前先确认它就是它看起来的那个地方：
 *
 *  · 这台机器形状的绝对路径（Windows：盘符 / UNC；其余：`/` 开头），不许 `.` / `..` 段；
 *  · 已经存在、是真目录 —— 剪映自己建草稿目录，这里从不替用户建；
 *  · 从盘符根 / `/` 起**逐级** lstat，没有一级是符号链接或联接点（Windows 的 junction 在 lstat 里也是
 *    符号链接）；
 *  · realpath 与给的路径一致（Windows / macOS 不分大小写）—— 逐级看不出来的卷挂载点、映射盘、8.3 短名
 *    在这里现形；
 *  · 不是盘符根 / `/` / UNC 共享根 / macOS 的 `/Volumes/<卷>`，不是家目录或它的上级，不在系统目录里
 *    （`refuseDraftRoot`，纯函数，Windows 规则在任何系统上都测得到）。
 *
 * 不合一律 `invalid_path`（退出码 2），`error.reason` 说是哪一条。
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError } from "../common.mjs";
import * as core from "./core.mjs";

/**
 * 这条路径是不是**这台机器**的形状：Windows 上是盘符（`X:\` / `X:/`）或 UNC（`\\server\share`，不含
 * `\\?\` / `\\.\` 设备路径），别的系统上是 `/` 开头。形状不对的（Mac 上的一条 `D:\…`、Windows 上的一条
 * `/Users/…`）不去碰文件系统 —— 在 Windows 上 `/Users/x` 会被当成「当前盘符下的 \Users\x」去找。
 */
export function onThisPlatform(target, platform = process.platform) {
  const value = String(target ?? "");
  if (platform === "win32")
    return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\/?.][^\\/]*[\\/]+[^\\/]+/.test(value);
  return value.startsWith("/");
}

/** 比路径时要不要不分大小写：Windows 与 macOS（默认的 APFS / HFS+）不分。 */
const foldCase = (platform) => platform === "win32" || platform === "darwin";

/** POSIX 上碰都不碰的系统目录（含它们里面的一切）。 */
const POSIX_SYSTEM_DIRS = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
  "/private",
  "/System",
  "/Library",
  "/Applications",
  "/cores",
];

/** Windows 上碰都不碰的系统目录：先看环境变量（装在别的盘上的也认得出），再补默认位置。 */
function windowsSystemDirs(env) {
  return [
    env.SystemRoot,
    env.windir,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramW6432,
    env.ProgramData,
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
  ].filter((value) => typeof value === "string" && /^[A-Za-z]:[\\/]/.test(value));
}

/**
 * 这个（已经 `path.resolve` 过的）绝对路径是不是**不许直写**的地方。`null` = 可以；否则
 * `{ reason, message }`。纯函数：不碰文件系统，`platform` / `home` / `env` 由调用方给。
 */
export function refuseDraftRoot(
  abs,
  { platform = process.platform, home = os.homedir(), env = process.env } = {},
) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const fold = (value) => (foldCase(platform) ? value.toLowerCase() : value);
  const norm = (value) => fold(p.resolve(value));
  // `child` 就是 `parent` 或在它里面。
  const within = (parent, child) => {
    const rel = p.relative(norm(parent), norm(child));
    return rel === "" || (!rel.startsWith(`..${p.sep}`) && rel !== ".." && !p.isAbsolute(rel));
  };
  const target = p.resolve(abs);
  if (
    p.parse(target).root === target ||
    (platform !== "win32" && /^\/Volumes\/[^/]+$/.test(target))
  )
    return {
      reason: "drive_root",
      message: `「${target}」是整个盘（卷）的根目录：不会把工程直接写在盘根下。请给剪映「全局设置 → 草稿位置」里那个具体的草稿文件夹。`,
    };
  if (home && within(target, home))
    return {
      reason: "home_dir",
      message: `「${target}」是用户的主目录（或它的上级）：不会往这里直写工程。请给剪映「全局设置 → 草稿位置」里那个具体的草稿文件夹。`,
    };
  const system = platform === "win32" ? windowsSystemDirs(env) : POSIX_SYSTEM_DIRS;
  if (system.some((dir) => within(dir, target)))
    return {
      reason: "system_dir",
      message: `「${target}」在系统目录里：不会往这里写。请给剪映「全局设置 → 草稿位置」里那个具体的草稿文件夹。`,
    };
  return null;
}

/**
 * `--draft-root` → 这个剪映草稿目录的真实绝对路径（realpath；与给的只差大小写时，用磁盘上的写法）。
 * 规矩见文件头；不合抛 `invalid_path`，`error.reason` ∈ `empty` / `not_absolute` / `relative_segment` /
 * `too_long` / `drive_root` / `home_dir` / `system_dir` / `not_found` / `not_directory` / `symlink` /
 * `realpath_changed`，`error.path` 是出问题的那一级。
 */
export async function resolveDraftRoot(
  input,
  { platform = process.platform, home = os.homedir(), env = process.env } = {},
) {
  const raw = typeof input === "string" ? input.trim() : "";
  const refuse = (reason, message, extra = {}) =>
    new CliError("invalid_path", message, { reason, draftRoot: raw, ...extra });
  if (!raw || raw.includes("\0")) throw refuse("empty", "--draft-root 要给剪映草稿目录的绝对路径");
  if (!onThisPlatform(raw, platform))
    throw refuse(
      "not_absolute",
      `--draft-root「${raw}」不是这台电脑上的绝对路径：请给剪映「全局设置 → 草稿位置」里显示的完整路径（${platform === "win32" ? "例如 D:\\JianyingPro\\User Data\\Projects\\com.lveditor.draft" : "例如 /Users/你/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"}）。`,
    );
  if (raw.split(/[\\/]+/).some((part) => part === "." || part === ".."))
    throw refuse(
      "relative_segment",
      `--draft-root「${raw}」里不能有 . 或 .. 这样的段：请给完整的真实路径。`,
    );
  const p = platform === "win32" ? path.win32 : path.posix;
  const abs = p.resolve(raw);
  const issue = core.checkDraftRootPath(abs);
  if (issue)
    throw refuse(
      issue === "too-long" ? "too_long" : "not_absolute",
      issue === "too-long"
        ? `--draft-root 太长（剪映草稿根最多 400 个字符）：${abs}`
        : `--draft-root「${abs}」不是绝对路径`,
    );
  const refusal = refuseDraftRoot(abs, { platform, home, env });
  if (refusal) throw refuse(refusal.reason, refusal.message, { path: abs });
  // 逐级走：下一级是不是链接，要等上一级确认是真目录之后才有意义。
  const { root } = p.parse(abs);
  let current = root;
  /* oxlint-disable eslint/no-await-in-loop */
  for (const part of abs.slice(root.length).split(p.sep).filter(Boolean)) {
    current = p.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR")
        throw refuse(
          "not_found",
          `剪映草稿目录「${abs}」不存在（「${current}」这一级没有）。请照剪映「全局设置 → 草稿位置」里显示的原样给；这里不会替用户新建草稿目录。`,
          { path: current },
        );
      throw error;
    }
    if (stat.isSymbolicLink())
      throw refuse(
        "symlink",
        `「${current}」是符号链接或联接点：直写剪映草稿目录不会顺着它往别处写。请给草稿目录的真实路径。`,
        { path: current },
      );
    if (!stat.isDirectory())
      throw refuse("not_directory", `「${current}」不是目录，没法把工程写进去。`, {
        path: current,
      });
  }
  /* oxlint-enable eslint/no-await-in-loop */
  const real = await fs.realpath(abs);
  const fold = (value) => (foldCase(platform) ? value.toLowerCase() : value);
  if (fold(real) !== fold(abs))
    throw refuse(
      "realpath_changed",
      `「${abs}」的真实位置是「${real}」（中间经过了卷挂载点、映射的网络盘或 8.3 短名）：请直接给草稿目录的真实路径。`,
      { path: abs, realPath: real },
    );
  return real;
}
