/**
 * 写到 workspace 里的输出文件（`docs read --out`、`download --out` / `inspect-media --out`）：上级目录不在
 * 就建出来 —— 手册的例子就写在子目录里（`看/第3集.md`、`out/白妍-终稿.png`）。
 *
 * 只是内部模块（不在 package.json 的 `exports` 里）：`./session`、`./media` 的公开导出不因它变。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { CliError } from "./common.mjs";

/** `candidate` 就是 `root` 或在它里面（与 `session.mjs` 的同名判断一致）。 */
function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

/**
 * `output` 的上级目录不在就建出来。一级一级建、一级一级查，与 `export-jianying` 建输出目录同一个做法：
 * 不用 `mkdir -p` —— 它会顺着半路的符号链接一直建到 workspace 外面。某一级是符号链接 →
 * `workspace_boundary`，是文件 → `invalid_path`；越出 workspace 的路径（`..`、外面的绝对路径）与不像路径的
 * 输入这里不建，交给随后的 `workspacePath` 照旧拒。
 */
export async function ensureParentDirs(root, output) {
  if (typeof output !== "string" || !output || output.includes("\0")) return;
  const candidate = path.resolve(root, output);
  if (output.split(/[\\/]/).includes("..") || !inside(root, candidate) || candidate === root)
    return;
  if ((await fs.lstat(root)).isSymbolicLink() || (await fs.realpath(root)) !== root)
    throw new CliError("workspace_boundary", "Workspace location changed");
  const parents = path.relative(root, candidate).split(path.sep).slice(0, -1);
  let current = root;
  /* oxlint-disable eslint/no-await-in-loop -- 下一级在不在、是不是链接，要等上一级确认是真目录才有意义 */
  for (const part of parents) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink())
      throw new CliError("workspace_boundary", "Symlinks are not allowed inside workspace paths");
    if (!stat.isDirectory()) throw new CliError("invalid_path", "Parent path must be a directory");
  }
  /* oxlint-enable eslint/no-await-in-loop */
}
