/**
 * `docs ls / read / create / update / delete` —— doc@1 项目文档库（剧本、大纲、全局骨架、人物档案、
 * 镜头表、拉片报告、上传的小说）。
 *
 * 文档库是**唯一源数据**：读就是读库，改就是带 `--expect-version` 原地改。这里没有本地镜像、
 * 没有同步：`docs read --out` 存下来的只是一份临时阅读副本，改了它不会回到文档库；要改就
 * `docs update`（整篇 `--file` / `--text`，或只改一处 `--patch` unified diff）。版本对不上回
 * `doc_conflict`，带 `id` / `currentVersion` / `currentSha` —— 重读、在新版本上重做那一处，再写。
 * 一篇正文最多 100 万字（契约 `contentMaxChars`）：超了在发出去之前就回 `too_large`。
 *
 * 线协议是五个页面桥方法（`documents_list` / `documents_get` / `documents_folders` / `documents_put` /
 * `documents_delete`，字段表在 `policy.mjs`）；页面用用户自己的登录态去读写，CLI 手里没有任何凭据。
 * 这一层只做三件本地的事：读 workspace 里的正文文件、应用 unified diff、写临时阅读副本（一篇
 * `docs read --out`，或整个文件夹 `docs read --folder --out-dir`：上传的小说一部一个文件夹，每章一个文件）。
 */

import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CliError, MAX_BODY, failure, parseObject } from "./common.mjs";
import { call } from "./client.mjs";
import { DOCUMENTS } from "./contract.mjs";
import { ensureParentDirs } from "./output-dirs.mjs";
import { readWorkspaceFile, workspacePath } from "./session.mjs";

const ID_PATTERN = new RegExp(DOCUMENTS.idPattern, "u");
/** `--meta` 能带的元数据键（栏 / 类型 / 集 / 文件夹 / 标题有自己的 flag）。 */
export const DOCS_META_KEYS = [
  "series",
  "scene",
  "format",
  "sourceAgent",
  "source",
  "assetTags",
  "derivedFrom",
  "summary",
];

function invalid(message) {
  throw new CliError("invalid_argument", message);
}

/** 文档 id：positional 或 `--id`；本地先按契约的语法挡一遍（错字在发出去之前就说清）。 */
function docIdArg(options, positionals, command) {
  if (positionals.length > (options.id === undefined ? 1 : 0))
    invalid(
      `${command} takes one document id; got ${[options.id, ...positionals].filter(Boolean).join(", ")}`,
    );
  const id = options.id ?? positionals[0];
  if (id === undefined)
    invalid(`${command} needs a document id (positional or --id); docs ls lists them`);
  if (typeof id !== "string" || id.length > DOCUMENTS.idMaxLength || !ID_PATTERN.test(id))
    invalid(
      `${JSON.stringify(id)} is not a document id (like script:ep:01, outline, novel:k3x9:0001); docs ls lists them`,
    );
  return id;
}

function integerArg(options, key, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (options[key] === undefined) return undefined;
  const text = String(options[key]).trim();
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max)
    invalid(`--${key} must be an integer between ${min} and ${max}`);
  return Number(text);
}

/** `--episode 3` / `03` / `ep03` / `EP3` → 3。 */
function episodeArg(options) {
  if (options.episode === undefined) return undefined;
  const hit = /^(?:ep)?0*(\d{1,4})$/i.exec(String(options.episode).trim());
  if (!hit) invalid("--episode must be an episode number such as 3 or EP03");
  return Number(hit[1]);
}

function enumArg(options, key, allowed, flag = key) {
  if (options[key] === undefined) return undefined;
  const value = String(options[key]).trim();
  if (!allowed.includes(value)) invalid(`--${flag} must be one of: ${allowed.join(", ")}`);
  return value;
}

function metaArg(options) {
  if (options.meta === undefined) return {};
  let meta;
  try {
    meta = parseObject(String(options.meta));
  } catch (error) {
    invalid(`--meta must be a JSON object: ${error.message}`);
  }
  for (const key of Object.keys(meta))
    if (!DOCS_META_KEYS.includes(key))
      invalid(
        `--meta cannot set ${key}; allowed: ${DOCS_META_KEYS.join(", ")} (section / type / episode / folder / title have their own flags)`,
      );
  return meta;
}

/** workspace 里的正文文件 → 文本。只收 UTF-8 文本；docx 请在画布文档库面板上传（服务端转 Markdown）。 */
async function readContentFile(session, file) {
  if (/\.docx?$/i.test(file))
    invalid(
      "docs create/update read UTF-8 text files (.md / .txt); upload .docx in the canvas document library panel, which converts it to Markdown",
    );
  const { bytes } = await readWorkspaceFile(session.workspace, file, MAX_BODY);
  let view = bytes;
  if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) view = view.subarray(3);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    invalid(`${file} is not UTF-8 text; save it as UTF-8 and try again`);
  }
}

/**
 * 一篇正文的上限（契约 `contentMaxChars`：100 万字，服务端、守护进程、页面同一个数）。口径与服务端一致：
 * 换行统一成 LF 之后的 JS 字符串长度（`\r\n` 与单独的 `\r` 都算一个字符 —— 服务端就按这个形态存）。
 * 发出去之前就说清是多长、怎么办：超长的正文进不了库，policy 那一道只会笼统地说 `content must be a string
 * of at most …`。`what` 是给人看的「哪一段正文」。
 */
function checkContentLength(content, what) {
  const chars = content.replace(/\r\n?/g, "\n").length;
  if (chars > DOCUMENTS.contentMaxChars)
    throw new CliError(
      "too_large",
      `${what} is ${chars} characters; one document holds at most ${DOCUMENTS.contentMaxChars}. Split it into several documents (for example one per episode), each under the limit`,
      { chars, maxChars: DOCUMENTS.contentMaxChars },
    );
}

/** 正文来源：`--file` 与 `--text`（update 还有 `--patch`）只能给一个。 */
function contentSources(options, { patch = false } = {}) {
  const given = ["file", "text", ...(patch ? ["patch"] : [])].filter(
    (key) => options[key] !== undefined,
  );
  if (given.length > 1) invalid(`use only one of ${given.map((key) => `--${key}`).join(" / ")}`);
  return given[0];
}

/** Markdown 前 30 行里第一个 `#` 标题。 */
function headingOf(text) {
  for (const line of text.split(/\r?\n/).slice(0, 30)) {
    const hit = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (hit) return hit[1];
  }
  return undefined;
}

/* ───────────────────────── unified diff（docs update --patch） ───────────────────────── */

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunks(diff) {
  // 最后那个换行只是结尾，不是一行空的上下文（否则截断的块会被它凑够行数）。
  const lines = diff.replace(/\n$/, "").split("\n");
  const hunks = [];
  for (let i = 0; i < lines.length; i++) {
    const head = HUNK.exec(lines[i]);
    if (!head) continue;
    const hunk = {
      header: lines[i].slice(0, lines[i].indexOf("@@", 2) + 2),
      oldStart: Number(head[1]),
      oldCount: head[2] === undefined ? 1 : Number(head[2]),
      newCount: head[4] === undefined ? 1 : Number(head[4]),
      oldLines: [],
      newLines: [],
      oldNoEol: false,
      newNoEol: false,
    };
    let last = null;
    while (hunk.oldLines.length < hunk.oldCount || hunk.newLines.length < hunk.newCount) {
      i += 1;
      if (i >= lines.length)
        invalid(`--patch hunk ${hunks.length + 1} (${hunk.header}) is cut short`);
      const line = lines[i];
      const mark = line[0];
      if (mark === "\\") {
        if (last === "old" || last === "both") hunk.oldNoEol = true;
        if (last === "new" || last === "both") hunk.newNoEol = true;
        continue;
      }
      // 很多编辑器会把空的上下文行尾巴上的空格吃掉：空行按「两边都有的空行」算。
      if (mark === " " || line === "") {
        hunk.oldLines.push(line.slice(1));
        hunk.newLines.push(line.slice(1));
        last = "both";
      } else if (mark === "-") {
        hunk.oldLines.push(line.slice(1));
        last = "old";
      } else if (mark === "+") {
        hunk.newLines.push(line.slice(1));
        last = "new";
      } else
        invalid(
          `--patch hunk ${hunks.length + 1} (${hunk.header}) has an unexpected line: ${line}`,
        );
      if (hunk.oldLines.length > hunk.oldCount || hunk.newLines.length > hunk.newCount)
        invalid(
          `--patch hunk ${hunks.length + 1} (${hunk.header}) has more lines than its header says`,
        );
    }
    // 紧跟在最后一行后面的「\ No newline at end of file」。
    if (lines[i + 1]?.startsWith("\\")) {
      i += 1;
      if (last === "old" || last === "both") hunk.oldNoEol = true;
      if (last === "new" || last === "both") hunk.newNoEol = true;
    }
    hunks.push(hunk);
  }
  return hunks;
}

function matchesAt(lines, block, at) {
  if (at < 0 || at + block.length > lines.length) return false;
  for (let k = 0; k < block.length; k++) if (lines[at + k] !== block[k]) return false;
  return true;
}

/** 这一块旧行在哪：先看头里写的位置，不对就从近到远找（只往前一块之后找，块之间不许交叉）。 */
function locate(lines, block, expected, from) {
  if (block.length === 0) return Math.min(Math.max(expected, from), lines.length);
  if (expected >= from && matchesAt(lines, block, expected)) return expected;
  for (let distance = 1; distance <= lines.length; distance++) {
    for (const at of [expected - distance, expected + distance])
      if (at >= from && matchesAt(lines, block, at)) return at;
  }
  return -1;
}

/**
 * 把一段 unified diff（`diff -u` 的格式：`@@ -a,b +c,d @@` 与 ` ` / `-` / `+` 行）应用到正文上。
 * 每一块的旧行（上下文 + 删掉的行）必须在正文里原样出现；位置不对就在附近找，找不到就是
 * `patch_failed` —— 正文已经不是你做 diff 时的那一版，重读再做。`--- ` / `+++ ` 头可有可无。
 */
export function applyUnifiedDiff(original, diffText) {
  const diff = String(diffText).replace(/\r\n?/g, "\n");
  const source = String(original).replace(/\r\n?/g, "\n");
  const hunks = parseHunks(diff);
  if (hunks.length === 0)
    invalid("--patch has no @@ hunk; pass a unified diff such as the output of diff -u");
  let eol = source.endsWith("\n");
  const lines = source === "" ? [] : (eol ? source.slice(0, -1) : source).split("\n");
  let delta = 0;
  let from = 0;
  for (const [index, hunk] of hunks.entries()) {
    // `-N,0`（纯插入）的 N 是「插在第 N 行之后」；其余是「从第 N 行开始」。
    const expected = hunk.oldCount === 0 ? hunk.oldStart + delta : hunk.oldStart - 1 + delta;
    const at = locate(lines, hunk.oldLines, expected, from);
    if (at < 0)
      throw new CliError(
        "patch_failed",
        `patch hunk ${index + 1} (${hunk.header}) does not match the document's current text; docs read it again and rebuild the patch`,
        { hunk: index + 1 },
      );
    const reachesEnd = at + hunk.oldLines.length === lines.length;
    lines.splice(at, hunk.oldLines.length, ...hunk.newLines);
    if (reachesEnd) {
      if (hunk.newNoEol) eol = false;
      else if (hunk.oldNoEol) eol = true;
    }
    delta += hunk.newLines.length - hunk.oldLines.length;
    from = at + hunk.newLines.length;
  }
  return lines.join("\n") + (eol && lines.length > 0 ? "\n" : "");
}

/* ───────────────────────────── 回包装饰 ───────────────────────────── */

/** `docs ls` 的定宽文本表（弱模型读表比读 JSON 数组稳）。 */
export function formatDocsTable(items) {
  const header = ["id", "section", "type", "ep", "v", "title", "folder"];
  const rows = items.map((doc) => [
    doc.id,
    doc.section,
    doc.docType,
    doc.episode ?? "-",
    doc.version,
    doc.title,
    doc.folder ?? "-",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => String(row[i]).length)),
  );
  const line = (values) =>
    values
      .map((value, i) => String(value).padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

function writeSummary(result) {
  const doc = result.document;
  if (result.unchanged) return `内容与字段都没变：${doc.id} 仍是 v${doc.version}，没有写新版本。`;
  if (result.created) return `已新建 ${doc.id}（v${doc.version}）：${doc.title}`;
  return `已原地更新 ${doc.id} → v${doc.version}：${doc.title}`;
}

/**
 * 临时阅读副本：上级目录不在就建（`./output-dirs` 的 `ensureParentDirs`，与 `download --out` 同一个做法）；
 * 不覆盖已有文件（除非 `--overwrite`），写完才出现（临时文件 + 链接 / 改名）。
 */
async function writeScratch(session, output, text, overwrite) {
  await ensureParentDirs(session.workspace, output);
  const target = await workspacePath(session.workspace, output, { output: true });
  if (!overwrite) {
    try {
      await fs.lstat(target);
      throw new CliError(
        "file_exists",
        "Output already exists; choose another path or explicitly use --overwrite",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const temp = path.join(path.dirname(target), `.scenemint-${randomUUID()}.part`);
  const handle = await fs.open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
    0o600,
  );
  const bytes = Buffer.from(text, "utf8");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await workspacePath(session.workspace, output, { output: true });
    if (overwrite) await fs.rename(temp, target);
    else {
      try {
        await fs.link(temp, target);
      } catch (error) {
        if (error.code === "EEXIST")
          throw new CliError("file_exists", "Output appeared while writing and was preserved");
        throw error;
      }
      await fs.unlink(temp);
    }
    return { path: target, bytes: bytes.length };
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

/* ───────────────────────────── 文件夹（上传的小说一部一个） ───────────────────────────── */

const FOLDER_ID = new RegExp(DOCUMENTS.folderIdPattern, "u");
/** `docs read --folder` 同时取正文的篇数（都是读，守护进程不排队；一次几篇就够快，也不挤占别的请求）。 */
const FOLDER_READ_CONCURRENCY = 4;
/** 一个文件夹最多读这么多篇（契约 id 里的序号是四位数）。 */
const FOLDER_MAX_DOCS = 9999;

/** `docs ls --folders` 的定宽文本表。 */
export function formatFoldersTable(items) {
  const header = ["id", "name", "chapters", "updatedAt", "section"];
  const rows = items.map((folder) => [
    folder.id ?? "-",
    folder.name,
    folder.count,
    folder.updatedAt,
    folder.section,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => String(row[i]).length)),
  );
  const line = (values) =>
    values
      .map((value, i) => String(value).padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

/**
 * 文件夹里第 `seq` 篇存成什么文件名：`<序号>_<标题>.<扩展名>`。序号补零到至少三位（按篇数够宽，排序
 * 就是章节顺序）；标题里文件名放不下的字符（`/ \ : * ? " < > |` 与控制字符）换成 `_`，首尾的空白和点去掉，
 * 最长 60 个字；标题是空的就用文档 id 的最后一段。
 */
export function folderFileName(seq, total, doc) {
  const width = Math.max(3, String(total).length);
  const ext = { markdown: ".md", srt: ".srt", json: ".json" }[doc.format] ?? ".md";
  const title = String(doc.title ?? "")
    // oxlint-disable-next-line eslint/no-control-regex -- 控制字符正是要换掉的东西
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "_")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.]+|[\s.]+$/gu, "")
    .slice(0, 60)
    .trim();
  const fallback = String(doc.id).split(":").pop() || "doc";
  return `${String(seq).padStart(width, "0")}_${title || fallback}${ext}`;
}

/** `documents_folders` 的回包（不可信输入）→ 干净的几行。 */
function folderRows(result) {
  return (Array.isArray(result?.items) ? result.items : []).filter(
    (folder) => folder && typeof folder.name === "string" && folder.name,
  );
}

async function docsLsFolders(session, options, rpcOptions) {
  for (const key of ["type", "episode", "folder", "q", "limit", "offset"])
    if (options[key] !== undefined)
      invalid(`docs ls --folders lists folders; --${key} filters documents, drop one of them`);
  const section = enumArg(options, "section", DOCUMENTS.sections) ?? "reference";
  const result = await call(session, "documents_folders", { section }, rpcOptions);
  if (result?.ok !== true) return result;
  const items = folderRows(result);
  return {
    ok: true,
    section,
    items,
    table: formatFoldersTable(items),
    hint: "整个文件夹存到 workspace 里读：docs read --folder <id 或名字> --out-dir <目录>（每章一个文件，带序号与标题）。",
  };
}

/**
 * `dir`（workspace 相对）这几级里眼下还不存在的（从上往下，绝对路径）——`ensureParentDirs` 会把它们一级一级
 * 建出来。`docs read --folder` 失败时只删这几级（`rmdir` 只删空目录），原来就有的目录一个都不碰。
 * 越出 workspace 的输入回空：那种路径不会被建，随后的 `workspacePath` 照旧拒。
 */
async function missingLevels(root, dir) {
  if (dir.split(/[\\/]/).includes("..")) return [];
  const rel = path.relative(root, path.resolve(root, dir));
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return [];
  const missing = [];
  let current = root;
  /* oxlint-disable eslint/no-await-in-loop -- 一级一级往下看，某一级不在，下面的就都不在 */
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    if (missing.length > 0 || (await fs.lstat(current).catch(() => null)) === null)
      missing.push(current);
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return missing;
}

/**
 * `docs read --folder <名或 id> --out-dir <workspace 里的目录>`：整个文件夹一次存下来，每篇一个文件
 * （`folderFileName`），章节顺序就是文档库列出来的顺序。先找文件夹（id 或名字；两栏都找，重名要用 id），
 * 再一页页列出它的文档，逐篇取正文（`documents_get`，一次 4 篇），全部取到了才开始写 —— 中途读不到
 * 一篇，一个文件都不写。目录不在就一级一级建（与 `docs read --out` 同一个做法）；已有同名文件不覆盖，
 * 除非 `--overwrite`（有一个就整次不写）。失败时这次新建的目录只要还是空的就删掉，不留空目录。
 * 写下来的都是临时阅读副本，改它不会回到文档库。
 */
async function docsReadFolder(session, options, positionals, rpcOptions) {
  if (positionals.length > 0 || options.id !== undefined)
    invalid("docs read --folder reads a whole folder; drop the document id (or drop --folder)");
  if (options.out !== undefined)
    invalid("docs read --folder writes one file per document: use --out-dir DIR, not --out");
  if (options["out-dir"] === undefined)
    invalid(
      "docs read --folder needs --out-dir DIR (a directory inside the workspace; one file per chapter)",
    );
  const wanted = String(options.folder).trim();
  if (!wanted) invalid("--folder needs a folder name or id (docs ls --folders lists them)");
  const outDir = String(options["out-dir"])
    .replace(/[\\/]+$/u, "")
    .trim();
  if (!outDir) invalid("--out-dir needs a directory inside the workspace");
  // 读用不带 --request-id 的选项：一次 --folder 要发好几个读，同一个 request id 只能配一个载荷。
  const { requestId: _requestId, ...readOptions } = rpcOptions;

  const folders = await call(session, "documents_folders", {}, readOptions);
  if (folders?.ok !== true) return folders;
  const byId = FOLDER_ID.test(wanted);
  const matches = folderRows(folders).filter((folder) =>
    byId ? folder.id === wanted : folder.name === wanted,
  );
  if (matches.length === 0)
    throw new CliError(
      "doc_not_found",
      `文档库里没有${byId ? " id 为" : "叫"}「${wanted}」的文件夹；docs ls --folders 列出有哪些`,
    );
  if (matches.length > 1)
    invalid(
      `两栏都有叫「${wanted}」的文件夹：${matches.map((folder) => `${folder.id ?? "（无 id）"}（${folder.section}）`).join("、")}；用 --folder <id> 指定`,
    );
  const folder = matches[0];

  const docs = [];
  for (let offset = 0; docs.length < FOLDER_MAX_DOCS;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- 下一页从哪开始要看这一页的 nextOffset
    const page = await call(
      session,
      "documents_list",
      { section: folder.section, folder: folder.name, limit: DOCUMENTS.listMaxLimit, offset },
      readOptions,
    );
    if (page?.ok !== true) return page;
    docs.push(...(Array.isArray(page.items) ? page.items : []));
    if (page.nextOffset === null || page.nextOffset === undefined || page.nextOffset <= offset)
      break;
    offset = page.nextOffset;
  }
  if (docs.length === 0)
    throw new CliError("doc_not_found", `文件夹「${folder.name}」里已经没有文档了`);

  const files = docs.map((doc, index) => ({
    doc,
    rel: `${outDir}/${folderFileName(index + 1, docs.length, doc)}`,
  }));
  // 先确认目录能建、文件名都在 workspace 里、没有已存在的（除非 --overwrite）—— 一个字节都还没写。
  // 这一步可能新建了 --out-dir（及其上级）：之后任何一步失败，就把这次新建、仍是空的目录删掉（从最深一级
  // 往上；rmdir 只删空目录，已经写下的文件和原来就有的目录都不动）。
  const created = await missingLevels(session.workspace, outDir);
  const dropCreated = async () => {
    // oxlint-disable-next-line eslint/no-await-in-loop -- 上一级要等下一级删掉才空
    for (const dir of [...created].reverse()) await fs.rmdir(dir).catch(() => {});
  };
  try {
    return await saveFolder({ session, options, folder, files, outDir, readOptions, dropCreated });
  } catch (error) {
    await dropCreated();
    throw error;
  }
}

/** `docsReadFolder` 的后半段：建目录、查重名、取正文、按章节顺序写。读失败回页面的错误前先删掉新建的空目录。 */
async function saveFolder({ session, options, folder, files, outDir, readOptions, dropCreated }) {
  await ensureParentDirs(session.workspace, files[0].rel);
  const targets = await Promise.all(
    files.map((file) => workspacePath(session.workspace, file.rel, { output: true })),
  );
  if (options.overwrite !== true) {
    const stats = await Promise.all(targets.map((target) => fs.lstat(target).catch(() => null)));
    const taken = files.filter((_, i) => stats[i]).map((file) => file.rel);
    if (taken.length > 0)
      throw new CliError(
        "file_exists",
        `这些文件已经存在：${taken.slice(0, 5).join("、")}${taken.length > 5 ? ` 等 ${taken.length} 个` : ""}。换一个 --out-dir，或在确认可以覆盖后加 --overwrite。`,
        { files: taken },
      );
  }

  // 取正文：一次几篇；全部取到了才写，中途读不到一篇就一个文件都不写。
  const contents = new Array(files.length);
  let next = 0;
  let failed = null;
  await Promise.all(
    Array.from({ length: Math.min(FOLDER_READ_CONCURRENCY, files.length) }, async () => {
      while (!failed && next < files.length) {
        const index = next;
        next += 1;
        // oxlint-disable-next-line eslint/no-await-in-loop -- 这是一条并发车道，车道内按顺序取
        const result = await call(
          session,
          "documents_get",
          { id: files[index].doc.id },
          readOptions,
        );
        if (result?.ok !== true) failed ??= result;
        else contents[index] = result.document;
      }
    }),
  );
  if (failed) {
    await dropCreated();
    return failed;
  }

  const written = [];
  for (const [index, file] of files.entries()) {
    const { content, ...document } = contents[index];
    // oxlint-disable-next-line eslint/no-await-in-loop -- 按章节顺序一个一个写，出错时停在出错的那一篇
    const out = await writeScratch(session, file.rel, content, options.overwrite === true);
    written.push({
      path: file.rel,
      id: document.id,
      title: document.title,
      version: document.version,
      contentSha: document.contentSha,
      bytes: out.bytes,
    });
  }
  return {
    ok: true,
    folder: {
      section: folder.section,
      name: folder.name,
      id: folder.id ?? null,
      count: written.length,
    },
    outDir,
    files: written,
    note: "这些都是临时阅读副本，改它们不会回到文档库；要改哪一篇就对那一篇的 id 用 docs update（带 --expect-version）。",
  };
}

/* ───────────────────────────── 五条命令 ───────────────────────────── */

async function docsLs(session, options, positionals, rpcOptions) {
  if (positionals.length > 0)
    invalid(
      "docs ls takes no positional argument; filter with --section / --type / --episode / --folder / --q",
    );
  if (options.folders === true) return docsLsFolders(session, options, rpcOptions);
  const params = {};
  const section = enumArg(options, "section", DOCUMENTS.sections);
  if (section) params.section = section;
  const docType = enumArg(options, "type", DOCUMENTS.docTypes);
  if (docType) params.docType = docType;
  const episode = episodeArg(options);
  if (episode !== undefined) params.episode = episode;
  if (options.folder !== undefined) params.folder = String(options.folder);
  if (options.q !== undefined) params.q = String(options.q);
  const limit = integerArg(options, "limit", { min: 1, max: DOCUMENTS.listMaxLimit });
  if (limit !== undefined) params.limit = limit;
  const offset = integerArg(options, "offset");
  if (offset !== undefined) params.offset = offset;
  const result = await call(session, "documents_list", params, rpcOptions);
  if (result?.ok === true && Array.isArray(result.items))
    return { ...result, table: formatDocsTable(result.items) };
  return result;
}

async function docsRead(session, options, positionals, rpcOptions) {
  if (options.folder !== undefined)
    return docsReadFolder(session, options, positionals, rpcOptions);
  if (options["out-dir"] !== undefined)
    invalid("--out-dir goes with --folder (a whole folder); one document is saved with --out FILE");
  const id = docIdArg(options, positionals, "docs read");
  if (options.overwrite && options.out === undefined)
    invalid("--overwrite only goes with --out (or --folder --out-dir)");
  const result = await call(session, "documents_get", { id }, rpcOptions);
  if (result?.ok !== true || options.out === undefined) return result;
  const { content, ...document } = result.document;
  const written = await writeScratch(
    session,
    String(options.out),
    content,
    options.overwrite === true,
  );
  return {
    ok: true,
    ...written,
    document,
    note: "这是一份临时阅读副本，改它不会回到文档库；要改文档用 docs update（带 --expect-version）。",
  };
}

async function docsCreate(session, options, positionals, rpcOptions) {
  if (positionals.length > 0)
    invalid(
      "docs create takes no positional argument; choose the id with --id (or let the library derive it)",
    );
  const docType = enumArg(options, "type", DOCUMENTS.docTypes);
  if (!docType) invalid(`docs create needs --type (one of: ${DOCUMENTS.docTypes.join(", ")})`);
  const source = contentSources(options);
  if (!source) invalid("docs create needs the text: --file workspace-file or --text TEXT");
  const content =
    source === "file" ? await readContentFile(session, String(options.file)) : String(options.text);
  checkContentLength(content, source === "file" ? String(options.file) : "--text");
  const title =
    options.title !== undefined
      ? String(options.title)
      : (headingOf(content) ??
        (source === "file"
          ? path.basename(String(options.file)).replace(/\.[^.]+$/, "")
          : undefined));
  if (!title) invalid("docs create needs --title (or a # heading at the top of the text)");
  const params = { expectVersion: 0, docType, title, content, ...metaArg(options) };
  if (options.id !== undefined) params.id = docIdArg(options, [], "docs create");
  const section = enumArg(options, "section", DOCUMENTS.sections);
  if (section) params.section = section;
  const episode = episodeArg(options);
  if (episode !== undefined) params.episode = episode;
  if (options.folder !== undefined) params.folder = String(options.folder);
  const result = await call(session, "documents_put", params, rpcOptions);
  return result?.ok === true && result.document
    ? { ...result, summary: writeSummary(result) }
    : result;
}

async function docsUpdate(session, options, positionals, rpcOptions) {
  const id = docIdArg(options, positionals, "docs update");
  const expectVersion = integerArg(options, "expect-version", { min: 1 });
  if (expectVersion === undefined)
    invalid(
      "docs update needs --expect-version N: the version you read (docs read / docs ls show it)",
    );
  const source = contentSources(options, { patch: true });
  const meta = metaArg(options);
  if (!source && options.title === undefined && Object.keys(meta).length === 0)
    invalid(
      "docs update needs a change: --file / --text / --patch for the text, or --title / --meta",
    );
  const params = { id, expectVersion, ...meta };
  if (options.title !== undefined) params.title = String(options.title);
  if (source === "file") {
    params.content = await readContentFile(session, String(options.file));
    checkContentLength(params.content, String(options.file));
  } else if (source === "text") {
    params.content = String(options.text);
    checkContentLength(params.content, "--text");
  } else if (source === "patch") {
    // 先读，版本对得上才在这一版的正文上打补丁；对不上就是冲突，不猜。读用自己的 request id ——
    // `--request-id` 归后面那次写（同一个 id 带两种载荷会被守护进程当成冲突拒掉）。
    const { requestId: _writeRequestId, ...readOptions } = rpcOptions;
    const current = await call(session, "documents_get", { id }, readOptions);
    if (current?.ok !== true) return current;
    const doc = current.document;
    if (doc.version !== expectVersion)
      return failure(
        "doc_conflict",
        `document ${id} was changed: current version is ${doc.version}, this update expected ${expectVersion}; docs read it again and redo the change on version ${doc.version}`,
        {
          retryable: false,
          id,
          currentVersion: doc.version,
          currentSha: doc.contentSha,
          deleted: false,
        },
      );
    params.content = applyUnifiedDiff(doc.content, String(options.patch));
    checkContentLength(params.content, `${id} with this patch applied`);
  }
  const result = await call(session, "documents_put", params, rpcOptions);
  return result?.ok === true && result.document
    ? { ...result, summary: writeSummary(result) }
    : result;
}

async function docsDelete(session, options, positionals, rpcOptions) {
  const id = docIdArg(options, positionals, "docs delete");
  if (!options.approved)
    throw new CliError(
      "approval_required",
      "docs delete requires --approved after the user agreed to delete this document",
    );
  const params = { id, approval: { userApprovedDocumentIds: [id] } };
  const expectVersion = integerArg(options, "expect-version", { min: 1 });
  if (expectVersion !== undefined) params.expectVersion = expectVersion;
  const result = await call(session, "documents_delete", params, rpcOptions);
  return result?.ok === true
    ? {
        ...result,
        summary: `已删除 ${id}（删之前是 v${result.version}）；文档库面板里不再显示它。`,
      }
    : result;
}

export async function runDocs(command, session, options, positionals, rpcOptions) {
  if (command === "docs ls") return docsLs(session, options, positionals, rpcOptions);
  if (command === "docs read") return docsRead(session, options, positionals, rpcOptions);
  if (command === "docs create") return docsCreate(session, options, positionals, rpcOptions);
  if (command === "docs update") return docsUpdate(session, options, positionals, rpcOptions);
  if (command === "docs delete") return docsDelete(session, options, positionals, rpcOptions);
  throw new CliError("invalid_argument", `Unknown command: ${command}`);
}
