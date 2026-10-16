/**
 * `run --await SECONDS` 与 `run --out-dir DIR`（0.17.0，00-contract §6.2 / §7）：**CLI 本地**的两件事，页面与
 * 守护进程都不知道它们。
 *
 *  · `--await`：整条命令的墙钟预算（截止 = CLI 启动 + N 秒）。`run_node` 回包的 `pending[]` 非空时，每 3 s
 *    `read NODE/renders` 一次，把落地的行并进 `outputs[]`（`result:"created"`；同卡重渲 `"rerendered"`），
 *    失败行并进 `failed[]`；到点就停，没完的留在 `pending[]`，`notes[]` 换成「仍在渲 … 不要重发 run」。
 *  · `--out-dir`：把 `outputs[]` 每项的卡片产物经页面下载（同 `download`，不直连 url）进 workspace 里的目录（可以已存在），每项加 `path`；单项失败加
 *    `pathError{code, message}`，run 本身照旧 `ok:true`。文件名 `<卡片标题规整>-<outputId 前 8 位>.<ext>`，
 *    同名已在就跳过、照样回 `path`（重渲出新 outputId → 新文件名，天然幂等）。
 *
 * 只是内部模块（不在 package.json 的 `exports` 里），只由 `cli.mjs` 引用。
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { call } from "./client.mjs";
import { CliError } from "./common.mjs";
import { download } from "./media.mjs";
import { ensureParentDirs } from "./output-dirs.mjs";
import { workspacePath } from "./session.mjs";

/** `--await` 的上限（秒）：`run_node` 这一跳 ≤ 30 s 不被截断，整条命令 ≈ 245 s，低于两宿主的 300 s 档。 */
const AWAIT_MAX_S = 240;
/** 两次 `read NODE/renders` 之间隔多久；每次读带的 `--wait-ms`（页面不在时 5 s 内答 page_away）。 */
const POLL_MS = 3000;
const READ_WAIT_MS = 5000;

/** `--await` 的秒数：整数 0–240；像毫秒（≥ 1000）或越界 → 本地 invalid_argument。 */
export function awaitSeconds(raw) {
  if (raw === undefined) return 0;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > AWAIT_MAX_S)
    throw new CliError("invalid_argument", `--await 的单位是秒，0–${AWAIT_MAX_S}`);
  return seconds;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `read NODE/renders` 的一行（landed）→ run 回包 `outputs[]` 的一项（§7「--await 合并」）。 */
function landedOutput(row, rerendered) {
  const out = {
    nodeId: row.nodeId,
    outputId: row.outputId ?? null,
    shotId: row.shotId ?? null,
    n: row.n ?? null,
    title: row.title,
    mediaType: row.mediaType,
    output: row.output,
    url: row.url,
  };
  for (const key of ["posterUrl", "lastFrameUrl", "durationMs"])
    if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  return {
    ...out,
    result: rerendered ? "rerendered" : "created",
    created: !rerendered,
    reused: false,
  };
}

/**
 * 轮询 `read NODE/renders` 直到 `pending[]` 空了或到 `deadline`。镜头按 (shotId, 这次请求的 render，静帧再加 frame) 认行：
 * 还有 rendering 行 = 仍在渲；否则 failed 行 → `failed[]`，不过期（`stale` 非 true）的 landed 行 → `outputs[]`；
 * 只剩过期旧片的仍算没完。在渲时同卡已有落地行的，记作同卡重渲（`rerendered`）。读失败（页面不在、超时）
 * 不算结论，下一轮再读；每次读的套接字都不超过剩下的预算。
 */
export async function awaitRenders(session, nodeId, request, result, deadline) {
  const output = typeof request.render === "string" ? request.render : "still";
  // 静帧分开头那张与镜尾那张（`frame:"end"`，s3i- 卡上 frame:"end"）：同镜两张卡都在 renders[] 里，只认这次那一种
  const frame = output === "still" && request.frame === "end" ? "end" : undefined;
  const requested = (result.outputs?.length ?? 0) + (result.failed?.length ?? 0);
  let pending = [...result.pending];
  const total = requested + pending.length;
  const outputs = [...(result.outputs ?? [])];
  const failed = [...(result.failed ?? [])];
  const rerendered = new Set();
  /** 落了、但出片途中场景又改过的镜（这次的片已不对应现在的场景）。 */
  const staleTakes = new Set();
  const shotN = new Map();
  /** 轮询并进来的 outputs[] 项（页面回 run 时不知道它们的用时）。 */
  const polled = [];
  /* oxlint-disable eslint/no-await-in-loop -- 轮询：下一次读要等这一次的结论 */
  while (pending.length > 0) {
    const wait = Math.min(POLL_MS, deadline - Date.now());
    if (wait <= 0) break;
    await sleep(wait);
    const left = deadline - Date.now();
    if (left <= 0) break;
    // 读回包是页面的 `{rev, nodes}`（成功时没有 `ok` 字段）；失败才是 `{ok:false, error}`。套接字也按剩下的
    // 预算截断：页面答得慢（守护进程会等满 callTimeoutMs）不能把整条命令拖过截止时刻——读不改东西，
    // 截断只是「这一轮没结论」。
    const reply = await call(
      session,
      "read",
      { paths: [`${nodeId}/renders`] },
      { waitMs: Math.min(READ_WAIT_MS, left), timeoutMs: Math.max(1, left) },
    );
    if (reply?.ok === false || !Array.isArray(reply?.nodes)) continue;
    const node = reply.nodes.find((entry) => entry?.nodeId === nodeId) ?? reply.nodes[0];
    const rows = Array.isArray(node?.renders) ? node.renders : [];
    pending = pending.filter((shotId) => {
      const mine = rows.filter(
        (row) =>
          row?.shotId === shotId &&
          row.output === output &&
          (output !== "still" || (row.frame === "end" ? "end" : undefined) === frame),
      );
      for (const row of mine) if (typeof row.n === "number") shotN.set(shotId, row.n);
      // 只认这次 run 出的片。页面（0.17.0 起）回 `pendingOutputIds`：开批时卡上那条候选的 id —— 同镜落地行的
      // outputId 换了就是这一批落的，即使出片途中场景又改过、那行 stale:true（B9-FX-23）。老页面不带：照旧只认
      // 不过期的（`stale:true` 的落地行是之前某一版场景的旧片，在飞行没了——比如标签页刷新——它还在）。
      const ids = result.pendingOutputIds;
      const key = shotId ?? "";
      const before = ids && Object.hasOwn(ids, key) ? ids[key] : undefined;
      const landed = mine.find(
        (row) =>
          row.state === "landed" &&
          (row.stale !== true || (before !== undefined && row.outputId !== before)),
      );
      const previous =
        before !== undefined
          ? before !== null
          : mine.some((row) => row.state === "landed" && row.stale === true);
      if (mine.some((row) => row.state === "rendering")) {
        if (landed || previous) rerendered.add(shotId);
        return true;
      }
      const failure = mine.find((row) => row.state === "failed");
      if (failure) {
        failed.push({ shotId, error: failure.error });
        return false;
      }
      if (!landed) return true;
      if (landed.stale === true) staleTakes.add(shotId);
      // 开批时卡上已有候选（页面给了 pendingOutputIds）= 同卡重渲，不用等看到 rendering 行
      const merged = landedOutput(landed, rerendered.has(shotId) || (before ?? null) !== null);
      outputs.push(merged);
      polled.push(merged);
      return false;
    });
  }
  /* oxlint-enable eslint/no-await-in-loop */
  // 页面那句「镜 n 仍在渲（预计 ≤ N s）」说的是 30 s 答复窗口时的状况，换成到点时的。
  const notes = (result.notes ?? []).filter((note) => !note.includes("仍在渲"));
  if (staleTakes.size > 0) {
    const shots = [...staleTakes].map((shotId) => shotN.get(shotId) ?? shotId).join("、");
    notes.push(
      `镜 ${shots} 落地了，但出片途中场景又改过：这张已不对应现在的场景（stale:true）；要新的就原样再 run，没变的镜头复用`,
    );
  }
  // B9-FX-55：经 --await 合并进来的镜，页面当场不知道它的用时
  const perShot = result.timings?.perShot ?? {};
  const untimed = polled
    .filter((o) => !Object.hasOwn(perShot, o.shotId ?? ""))
    .map((o) => o.n ?? o.shotId);
  if (untimed.length > 0)
    notes.push(`镜 ${untimed.join("、")} 是 --await 轮询收到的：timings.perShot 里没有它的用时`);
  if (pending.length > 0) {
    const shots = pending.map((shotId) => shotN.get(shotId) ?? shotId).join("、");
    notes.push(
      `${pending.length} 镜仍在渲（镜 ${shots}，--await 到点），等一会儿 read ${nodeId}/renders 取，不要重发 run`,
    );
  }
  const allFailed = failed.length > 0 && failed.length === total;
  const rest = { ...result };
  delete rest.notes;
  delete rest.error;
  delete rest.pendingOutputIds;
  return {
    ...rest,
    ok: !allFailed,
    outputs,
    pending,
    failed,
    ...(notes.length > 0 ? { notes } : {}),
    ...(allFailed ? { error: failed[0].error } : {}),
  };
}

/** 卡片标题 → 文件名的一段：去掉路径 / 保留字符与空白，留中文。 */
function slug(title) {
  const cleaned = String(title ?? "")
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|_+$/g, "")
    .slice(0, 80);
  return cleaned || "output";
}

const EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "mp4", "mov", "webm"]);

/**
 * `<卡片标题规整>-<outputId 前 8 位>.<ext>`。列车 1 的单镜静帧在三维节点自身、`outputId:null`：拿 url 的
 * 摘要前 8 位顶上（重渲换 url → 换文件名，与 outputId 同一个幂等性）。扩展名先看 url，认不出按 mediaType。
 */
export function outputFileName(item) {
  const key =
    typeof item.outputId === "string" && item.outputId
      ? item.outputId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8)
      : createHash("sha256").update(String(item.url)).digest("hex").slice(0, 8);
  let ext;
  try {
    ext = /\.([A-Za-z0-9]{2,5})$/.exec(new URL(item.url).pathname)?.[1]?.toLowerCase();
  } catch {
    ext = undefined;
  }
  if (!EXTENSIONS.has(ext)) ext = item.mediaType === "video" ? "mp4" : "png";
  return `${slug(item.title)}-${key || "output"}.${ext}`;
}

async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * 把 `outputs[]` 存进 workspace 里的 `dir`：每项加 `path` 或 `pathError`，顺序与原数组相同。
 *
 * 字节**不由 CLI 直接去取** `url`（B9-FX-07）：那个 url 是画布里可写的数据，从 Agent 主机直连等于让
 * 任何画布协作者指挥它去取 127.0.0.1 / 内网 / 云元数据。改走与 `download --out` 同一条路：页面的
 * media_info + media_chunk，由页面经 /api/canvas/proxy（safeFetch：https、可信 host、拒私网）取，
 * 拿到的是这张卡**当前**的产物。`--await` 用完就不再开始新的下载。
 */
export async function saveOutputs(session, dir, outputs, deadline) {
  const saved = [];
  /* oxlint-disable eslint/no-await-in-loop -- 一个一个下：共用一个墙钟预算，并发只会让每个都更晚 */
  for (const item of outputs) {
    try {
      if (deadline !== undefined && Date.now() >= deadline)
        throw new CliError("timeout", "--await 的时间用完了，没下载");
      const rel = path.join(dir, outputFileName(item));
      await ensureParentDirs(session.workspace, rel);
      const target = await workspacePath(session.workspace, rel, { output: true });
      if (!(await exists(target))) {
        try {
          await download(session, item.nodeId, rel);
        } catch (error) {
          // 并发的另一条 run 先写好了同名文件：按「同名已在就跳过」算成功。
          if (!(error instanceof CliError && error.code === "file_exists")) throw error;
        }
      }
      saved.push({ ...item, path: target });
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      saved.push({ ...item, pathError: { code: error.code, message: error.message } });
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return saved;
}
