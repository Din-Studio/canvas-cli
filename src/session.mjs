import { promises as fs, constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CliError, UUID, parseObject } from "./common.mjs";
import { PROTOCOL_VERSION } from "./policy.mjs";

export function dataDirectory() {
  if (process.env.SCENEMINT_CANVAS_HOME) return path.resolve(process.env.SCENEMINT_CANVAS_HOME);
  const base =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "scenemint-canvas");
}
export function sessionPath(id) {
  if (!UUID.test(id || ""))
    throw new CliError("invalid_session", "--session must be the UUID returned by connect");
  return path.join(dataDirectory(), "sessions", `${id}.json`);
}
export async function saveSession(record) {
  const file = sessionPath(record.sessionId);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Existing records are never silently replaced by another agent.
  const handle = await fs.open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
    0o600,
  );
  try {
    await handle.writeFile(JSON.stringify(record));
  } finally {
    await handle.close();
  }
  return file;
}
export async function readSession(id) {
  const file = sessionPath(id);
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  } catch {
    throw new CliError(
      "session_not_found",
      "Session does not exist or cannot be read; run connect for this task",
    );
  }
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 16384 ||
      (process.platform !== "win32" && stat.mode & 0o077)
    )
      throw new CliError(
        "unsafe_session",
        "Session credentials must be a private, independent regular file (0600)",
      );
    const record = parseObject(await handle.readFile("utf8"));
    if (record.protocolVersion !== PROTOCOL_VERSION || record.version !== 2) {
      throw new CliError(
        "protocol_mismatch",
        "Session uses an incompatible protocol; disconnect with its original CLI and create a new protocol 2 session",
      );
    }
    if (
      record.sessionId !== id ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(record.endpoint || "") ||
      typeof record.cliToken !== "string" ||
      typeof record.workspace !== "string" ||
      !["main", "worker"].includes(record.role) ||
      (record.role === "worker" &&
        (!UUID.test(record.parentSessionId || "") || record.parentSessionId === id))
    )
      throw new CliError("unsafe_session", "Invalid session record");
    return record;
  } finally {
    await handle.close();
  }
}

function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}
export async function workspaceRoot(input) {
  const root = await fs.realpath(path.resolve(input));
  if (!(await fs.stat(root)).isDirectory())
    throw new CliError("invalid_workspace", "Workspace must be a directory");
  return root;
}
/** Resolve every component without accepting symlinks, including parent directories. */
export async function workspacePath(root, input, { output = false } = {}) {
  if (typeof input !== "string" || !input || input.includes("\0"))
    throw new CliError("invalid_path", "A workspace file path is required");
  if (input.split(/[\\/]/).includes(".."))
    throw new CliError("workspace_boundary", "Parent traversal is not allowed");
  const candidate = path.resolve(root, input);
  if (!inside(root, candidate) || candidate === root)
    throw new CliError("workspace_boundary", "Path must name a file inside the session workspace");
  const rel = path.relative(root, candidate).split(path.sep);
  let current = root;
  // Detect a workspace replaced by a symlink since connect.
  if ((await fs.lstat(root)).isSymbolicLink() || (await fs.realpath(root)) !== root)
    throw new CliError("workspace_boundary", "Workspace location changed");
  for (let i = 0; i < rel.length; i++) {
    current = path.join(current, rel[i]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (output && i === rel.length - 1 && error.code === "ENOENT") return candidate;
      throw new CliError(
        "file_not_found",
        "File or parent directory does not exist inside the workspace",
      );
    }
    if (stat.isSymbolicLink())
      throw new CliError("workspace_boundary", "Symlinks are not allowed inside workspace paths");
    if (i < rel.length - 1 && !stat.isDirectory())
      throw new CliError("invalid_path", "Parent path must be a directory");
    if (i === rel.length - 1 && (!stat.isFile() || stat.nlink !== 1))
      throw new CliError("workspace_boundary", "Expected an independent regular file");
  }
  return candidate;
}
export async function readWorkspaceFile(root, input, limit) {
  const file = await workspacePath(root, input);
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1)
      throw new CliError("workspace_boundary", "Expected an independent regular file");
    if (stat.size > limit) throw new CliError("too_large", `File exceeds ${limit} bytes`);
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw new CliError("too_large", `File exceeds ${limit} bytes`);
    return { file, bytes };
  } finally {
    await handle.close();
  }
}
