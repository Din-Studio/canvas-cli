/**
 * 剪映导出在 Node 里的探针：读 MP4 / MOV（ISO BMFF / QuickTime）的容器头，拿到草稿要的三样事实
 * —— 显示宽、显示高、源文件全长（微秒）。零依赖，不调 ffprobe（用户机器上不一定装了它）。
 * 另外带回视频轨的编码（首个样本描述的 fourcc，如 `avc1` / `mp4v`）：草稿用不到它，但这个探针
 * 只读容器头、比页面的 mediabunny 宽（MPEG-4 Part 2 的 mov 页面导不出、这里照读），导出那一层
 * 靠它在回包里提醒一句。
 *
 * 口径逐条对齐页面导出用的 mediabunny（`zip-draft.ts` 的 `defaultProbe`：
 * `getPrimaryVideoTrack().displayWidth/displayHeight` 与 `input.computeDuration()`），同一个文件
 * 两条路径算出同一组事实，草稿才会逐字节一致：
 *  · 宽高：第一条（启用的）视频轨 stsd 首个样本描述里的 width / height，按 `pasp` 换成方像素，
 *    再按 `tkhd` 矩阵的旋转（90 / 270 度对调宽高）得到显示尺寸；
 *  · 时长：每条音 / 视频轨「呈现时间最大的那个样本的呈现时间 + 它自己的时长」减去编辑表（`elst`）
 *    的起点偏移，取所有轨里最大的那个。样本来自 `moov` 的样本表（stts / ctts），分片 MP4 则来自
 *    每个 `moof` 的 tfhd / tfdt / trun（mediabunny 的 `getPacket(Infinity)` 同一个算法）。
 *
 * 只读 `moov` 与各个 `moof`（都是几 KB 到几 MB），不读 `mdat`；`moov` 在文件尾也能找到。
 * 认不出的一律抛 `ProbeError`：探针失败就是这个素材失败，工程标 partial，绝不猜一组数。
 */

import { promises as fs, constants } from "node:fs";

/** `moov` / 单个 `moof` 的读入上限：正常片子几十 KB，几小时的长片也就几 MB。 */
const MAX_BOX_READ = 64 * 1024 * 1024;
/** 顶层 box 最多扫这么多个，防一个构造出来的文件让我们原地打转。 */
const MAX_TOP_LEVEL_BOXES = 1_000_000;
/** 一条轨最多逐个看这么多样本；超过就不再细算 B 帧重排，退回解码顺序的最后一帧。 */
const MAX_SAMPLES_WALKED = 20_000_000;

export class ProbeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProbeError";
  }
}

const fail = (message) => {
  throw new ProbeError(message);
};

/* ── box 读取 ─────────────────────────────────────────────────────────────── */

function u64(buf, at) {
  const value = buf.readBigUInt64BE(at);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("容器里的 64 位数值超出范围，文件可能已损坏");
  return Number(value);
}

function i64(buf, at) {
  const value = buf.readBigInt64BE(at);
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
    fail("容器里的 64 位数值超出范围，文件可能已损坏");
  return Number(value);
}

/**
 * `buf[start, end)` 里的子 box，逐个给出 `{type, start, end}`（`start` 是内容起点）。
 * 越界、长度不合法一律抛 —— 半截 box 读出来的数没有一个可信。
 */
function* children(buf, start, end) {
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) fail(`「${type}」的长度字段不完整`);
      size = u64(buf, at + 8);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) fail(`「${type}」的长度越界，文件可能已损坏`);
    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

function child(buf, box, type) {
  for (const entry of children(buf, box.start, box.end)) if (entry.type === type) return entry;
  return undefined;
}

function need(box, bytes, what) {
  if (box.end - box.start < bytes) fail(`「${what}」太短，文件可能已损坏`);
}

/* ── moov 里的各个 box ────────────────────────────────────────────────────── */

function readMvhd(buf, box) {
  need(box, 20, "mvhd");
  if (buf[box.start] === 1) {
    need(box, 32, "mvhd");
    return { timescale: buf.readUInt32BE(box.start + 20), duration: u64(buf, box.start + 24) };
  }
  return {
    timescale: buf.readUInt32BE(box.start + 12),
    duration: buf.readUInt32BE(box.start + 16),
  };
}

/** 旋转：矩阵把 (1,0) 投到 (a,b)，角度就是 atan2(b,a)，取最近的 90 的倍数（与 mediabunny 同法）。 */
function rotationOf(a, b) {
  const degrees = Math.atan2(b, a) * (180 / Math.PI);
  if (!Number.isFinite(degrees)) return 0;
  const rounded = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  return [0, 90, 180, 270].includes(rounded) ? rounded : 0;
}

function readTkhd(buf, box) {
  need(box, 4, "tkhd");
  const version = buf[box.start];
  const flags = buf.readUIntBE(box.start + 1, 3);
  // version/flags(4) + 创建/修改时间 + track_ID(4) + 保留(4) + duration，然后 保留(8) +
  // layer / alternate_group / volume / 保留（各 2），再是 9 个数的矩阵。
  const idAt = box.start + 4 + (version === 1 ? 16 : 8);
  const matrixAt = idAt + 4 + 4 + (version === 1 ? 8 : 4) + 16;
  need(box, matrixAt - box.start + 36, "tkhd");
  const a = buf.readInt32BE(matrixAt) / 65536;
  const b = buf.readInt32BE(matrixAt + 4) / 65536;
  return { id: buf.readUInt32BE(idAt), enabled: (flags & 1) === 1, rotation: rotationOf(a, b) };
}

function readMdhd(buf, box) {
  need(box, 20, "mdhd");
  if (buf[box.start] === 1) {
    need(box, 32, "mdhd");
    return { timescale: buf.readUInt32BE(box.start + 20), duration: u64(buf, box.start + 24) };
  }
  return {
    timescale: buf.readUInt32BE(box.start + 12),
    duration: buf.readUInt32BE(box.start + 16),
  };
}

function readHandler(buf, box) {
  need(box, 12, "hdlr");
  return buf.toString("latin1", box.start + 8, box.start + 12);
}

/**
 * 首个视觉样本描述的宽高，按 `pasp` 换成方像素（mediabunny：num>den 拉宽，否则拉高）；
 * `codec` 是这个样本描述的类型（fourcc）。
 */
function readVisualSampleEntry(buf, stsd) {
  need(stsd, 8, "stsd");
  if (buf.readUInt32BE(stsd.start + 4) < 1) return null;
  const first = children(buf, stsd.start + 8, stsd.end).next();
  if (first.done) return null;
  const entry = first.value;
  // SampleEntry 保留(6) + data_reference_index(2)，再 pre_defined/保留(2+2+12) 之后是宽、高；
  // 视觉样本描述固定 78 字节，后面才是 avcC / pasp 这类子 box。
  if (entry.end - entry.start < 78) return null;
  let width = buf.readUInt16BE(entry.start + 24);
  let height = buf.readUInt16BE(entry.start + 26);
  for (const sub of children(buf, entry.start + 78, entry.end)) {
    if (sub.type !== "pasp" || sub.end - sub.start < 8) continue;
    const num = buf.readUInt32BE(sub.start);
    const den = buf.readUInt32BE(sub.start + 4);
    if (num > 0 && den > 0) {
      if (num > den) width = Math.round((width * num) / den);
      else height = Math.round((height * den) / num);
    }
  }
  return { width, height, codec: entry.type };
}

/** 编辑表的起点偏移（媒体时间单位）：第一段非空编辑的 media_time，减去它前面空编辑占的时长。 */
function editListOffset(buf, elst, movieTimescale, mediaTimescale) {
  need(elst, 8, "elst");
  const version = buf[elst.start];
  const count = buf.readUInt32BE(elst.start + 4);
  const stride = version === 1 ? 20 : 12;
  need(elst, 8 + count * stride, "elst");
  let emptyBefore = 0;
  for (let i = 0; i < count; i += 1) {
    const at = elst.start + 8 + i * stride;
    const segment = version === 1 ? u64(buf, at) : buf.readUInt32BE(at);
    const mediaTime = version === 1 ? i64(buf, at + 8) : buf.readInt32BE(at + 4);
    if (segment === 0) continue;
    if (mediaTime === -1) {
      emptyBefore += segment;
      continue;
    }
    const lead =
      movieTimescale > 0 ? Math.round((emptyBefore / movieTimescale) * mediaTimescale) : 0;
    return mediaTime - lead;
  }
  return 0;
}

/**
 * 一组样本（解码顺序：时长 + 合成偏移）里「呈现时间最大的那个」的结束时间：它的呈现时间 +
 * 它自己的时长 —— mediabunny 的 `getPacket(Infinity)`。同一呈现时间取解码顺序靠后的那个。
 */
function lastPresentedEnd(count, durationAt, offsetAt, base = 0) {
  if (count === 0) return null;
  let dts = base;
  let maxPts = -Infinity;
  let end = base;
  for (let i = 0; i < count; i += 1) {
    const duration = durationAt(i);
    const pts = dts + offsetAt(i);
    if (pts >= maxPts) {
      maxPts = pts;
      end = pts + duration;
    }
    dts += duration;
  }
  return end;
}

/** moov 样本表（stts / ctts）的最后呈现结束时间；样本表是空的（分片 MP4）返回 null。 */
function sampleTableEnd(buf, stbl) {
  const stts = child(buf, stbl, "stts");
  if (!stts) return null;
  need(stts, 8, "stts");
  const entries = buf.readUInt32BE(stts.start + 4);
  need(stts, 8 + entries * 8, "stts");
  const runs = [];
  let samples = 0;
  let total = 0;
  for (let i = 0; i < entries; i += 1) {
    const count = buf.readUInt32BE(stts.start + 8 + i * 8);
    const delta = buf.readUInt32BE(stts.start + 12 + i * 8);
    runs.push([count, delta]);
    samples += count;
    total += count * delta;
  }
  if (samples === 0) return null;
  const ctts = child(buf, stbl, "ctts");
  if (!ctts || samples > MAX_SAMPLES_WALKED) return total;
  need(ctts, 8, "ctts");
  const offsets = [];
  const offsetEntries = buf.readUInt32BE(ctts.start + 4);
  need(ctts, 8 + offsetEntries * 8, "ctts");
  // mediabunny 不看版本，一律按有符号 32 位读合成偏移。
  for (let i = 0; i < offsetEntries; i += 1)
    offsets.push([
      buf.readUInt32BE(ctts.start + 8 + i * 8),
      buf.readInt32BE(ctts.start + 12 + i * 8),
    ]);
  const expand = (list, fallback) => {
    const out = new Array(samples);
    let at = 0;
    for (const [count, value] of list)
      for (let n = 0; n < count && at < samples; n += 1) out[at++] = value;
    while (at < samples) out[at++] = fallback;
    return out;
  };
  const durations = expand(runs, 0);
  const cto = expand(offsets, 0);
  return lastPresentedEnd(
    samples,
    (i) => durations[i],
    (i) => cto[i],
  );
}

/** 一条 trak → 探针要的事实（样本表部分）；不是音 / 视频轨返回 null。 */
function readTrack(buf, trak, movieTimescale) {
  const tkhd = child(buf, trak, "tkhd");
  const mdia = child(buf, trak, "mdia");
  if (!tkhd || !mdia) return null;
  const hdlr = child(buf, mdia, "hdlr");
  const mdhd = child(buf, mdia, "mdhd");
  if (!hdlr || !mdhd) return null;
  const handler = readHandler(buf, hdlr);
  if (handler !== "vide" && handler !== "soun") return null;
  const header = readTkhd(buf, tkhd);
  const media = readMdhd(buf, mdhd);
  const minf = child(buf, mdia, "minf");
  const stbl = minf ? child(buf, minf, "stbl") : undefined;
  const edts = child(buf, trak, "edts");
  const elst = edts ? child(buf, edts, "elst") : undefined;
  const stsd = stbl ? child(buf, stbl, "stsd") : undefined;
  return {
    id: header.id,
    handler,
    enabled: header.enabled,
    rotation: header.rotation,
    timescale: media.timescale,
    mdhdDuration: media.duration,
    editOffset:
      elst && media.timescale > 0 ? editListOffset(buf, elst, movieTimescale, media.timescale) : 0,
    tableEnd: stbl ? sampleTableEnd(buf, stbl) : null,
    fragmentEnd: null,
    visual: handler === "vide" && stsd ? readVisualSampleEntry(buf, stsd) : null,
  };
}

/** moov → `{mvhd, tracks, trex, mehd}`。 */
function readMoov(buf) {
  const moov = { start: 0, end: buf.length };
  const mvhdBox = child(buf, moov, "mvhd");
  const mvhd = mvhdBox ? readMvhd(buf, mvhdBox) : { timescale: 0, duration: 0 };
  const tracks = [];
  for (const entry of children(buf, moov.start, moov.end))
    if (entry.type === "trak") {
      const track = readTrack(buf, entry, mvhd.timescale);
      if (track) tracks.push(track);
    }
  const trex = new Map();
  let mehd = 0;
  const mvex = child(buf, moov, "mvex");
  if (mvex)
    for (const entry of children(buf, mvex.start, mvex.end)) {
      if (entry.type === "trex" && entry.end - entry.start >= 24)
        trex.set(buf.readUInt32BE(entry.start + 4), {
          duration: buf.readUInt32BE(entry.start + 12),
        });
      if (entry.type === "mehd" && entry.end - entry.start >= 8)
        mehd =
          buf[entry.start] === 1 ? u64(buf, entry.start + 4) : buf.readUInt32BE(entry.start + 4);
    }
  return { mvhd, tracks, trex, mehd };
}

/* ── 分片（moof）───────────────────────────────────────────────────────────── */

/**
 * 一个 moof 里各条轨的片段：按 trun 顺序累加解码时间，pts = 解码时间 + 合成偏移（trun 版本 0
 * 无符号、1 有符号），片段起点是 tfdt（没有就接着这条轨上一个片段的解码终点）。
 * 结果写进 `track.fragmentEnd`（取最大）与 `cursor`（下一个没有 tfdt 的片段从哪开始）。
 */
function readMoof(buf, info, cursors) {
  for (const traf of children(buf, 0, buf.length)) {
    if (traf.type !== "traf") continue;
    const tfhd = child(buf, traf, "tfhd");
    if (!tfhd) continue;
    need(tfhd, 8, "tfhd");
    const flags = buf.readUIntBE(tfhd.start + 1, 3);
    const trackId = buf.readUInt32BE(tfhd.start + 4);
    const track = info.tracks.find((entry) => entry.id === trackId);
    if (!track) continue;
    let at = tfhd.start + 8;
    if (flags & 0x1) at += 8; // base_data_offset
    if (flags & 0x2) at += 4; // sample_description_index
    let defaultDuration = info.trex.get(trackId)?.duration ?? 0;
    if (flags & 0x8) {
      need(tfhd, at - tfhd.start + 4, "tfhd");
      defaultDuration = buf.readUInt32BE(at);
    }
    if (flags & 0x10000) defaultDuration = 0; // duration-is-empty
    const tfdt = child(buf, traf, "tfdt");
    let base = cursors.get(trackId) ?? 0;
    if (tfdt) {
      need(tfdt, 8, "tfdt");
      base = buf[tfdt.start] === 1 ? u64(buf, tfdt.start + 4) : buf.readUInt32BE(tfdt.start + 4);
    }
    const durations = [];
    const offsets = [];
    for (const trun of children(buf, traf.start, traf.end)) {
      if (trun.type !== "trun") continue;
      need(trun, 8, "trun");
      const version = buf[trun.start];
      const runFlags = buf.readUIntBE(trun.start + 1, 3);
      const count = buf.readUInt32BE(trun.start + 4);
      let p = trun.start + 8;
      if (runFlags & 0x1) p += 4; // data_offset
      if (runFlags & 0x4) p += 4; // first_sample_flags
      const stride =
        (runFlags & 0x100 ? 4 : 0) +
        (runFlags & 0x200 ? 4 : 0) +
        (runFlags & 0x400 ? 4 : 0) +
        (runFlags & 0x800 ? 4 : 0);
      need(trun, p - trun.start + count * stride, "trun");
      if (durations.length + count > MAX_SAMPLES_WALKED) fail("分片里的样本数大得不正常");
      for (let i = 0; i < count; i += 1) {
        let q = p + i * stride;
        let duration = defaultDuration;
        if (runFlags & 0x100) {
          duration = buf.readUInt32BE(q);
          q += 4;
        }
        if (runFlags & 0x200) q += 4;
        if (runFlags & 0x400) q += 4;
        let offset = 0;
        if (runFlags & 0x800) offset = version === 0 ? buf.readUInt32BE(q) : buf.readInt32BE(q);
        durations.push(duration);
        offsets.push(offset);
      }
    }
    if (durations.length === 0) continue;
    const end = lastPresentedEnd(
      durations.length,
      (i) => durations[i],
      (i) => offsets[i],
      base,
    );
    track.fragmentEnd = Math.max(track.fragmentEnd ?? 0, end);
    cursors.set(trackId, base + durations.reduce((sum, value) => sum + value, 0));
  }
}

/* ── 汇总 ──────────────────────────────────────────────────────────────────── */

/** 各轨事实 → `{width, height, durationUs, codec}`。 */
function summarize(info) {
  const videos = info.tracks.filter((track) => track.handler === "vide" && track.visual);
  const primary = videos.find((track) => track.enabled) ?? videos[0];
  if (!primary) fail("文件里没有视频轨");
  let seconds = 0;
  for (const track of info.tracks) {
    if (!(track.timescale > 0)) continue;
    const end = Math.max(track.tableEnd ?? 0, track.fragmentEnd ?? 0);
    if (end > 0) seconds = Math.max(seconds, Math.max(0, end - track.editOffset) / track.timescale);
  }
  // 样本一个都没读到（极少见的空壳 / 只有声明）：退回 mvhd / mehd 的声明时长。
  if (!(seconds > 0) && info.mvhd.timescale > 0)
    seconds = Math.max(info.mvhd.duration, info.mehd) / info.mvhd.timescale;
  const durationUs = Math.round(seconds * 1_000_000);
  if (!(durationUs > 0)) fail("读不出视频的时长");
  const { width, height, codec } = primary.visual;
  const swap = primary.rotation % 180 !== 0;
  return { width: swap ? height : width, height: swap ? width : height, durationUs, codec };
}

/**
 * 只有一段 `moov` 内容（没有分片）时的探针事实 `{width, height, durationUs, codec}`。导出给单测直接喂字节。
 */
export function parseMoov(buf) {
  return summarize(readMoov(buf));
}

/** 顶层扫一遍：`moov` 与所有 `moof` 的内容位置。 */
async function scanTopLevel(handle, fileSize) {
  const head = Buffer.alloc(16);
  let moov = null;
  const moofs = [];
  let at = 0;
  for (let count = 0; at + 8 <= fileSize; count += 1) {
    if (count >= MAX_TOP_LEVEL_BOXES) fail("顶层 box 太多，不像是正常的 MP4 / MOV");
    // oxlint-disable-next-line eslint/no-await-in-loop -- 下一个 box 在哪要看这一个有多长，只能串行
    const { bytesRead } = await handle.read(head, 0, 16, at);
    if (bytesRead < 8) break;
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    let header = 8;
    if (size === 1) {
      if (bytesRead < 16) fail(`「${type}」的长度字段不完整`);
      size = u64(head, 8);
      header = 16;
    } else if (size === 0) {
      size = fileSize - at;
    }
    if (size < header || at + size > fileSize)
      fail(
        type === "moov" || type === "moof"
          ? `${type} 不完整，文件可能没下完`
          : "不是 MP4 / MOV，或文件已损坏",
      );
    if (type === "moov" && !moov) moov = { offset: at + header, size: size - header };
    if (type === "moof") moofs.push({ offset: at + header, size: size - header });
    at += size;
  }
  if (!moov) fail("找不到 moov：不是 MP4 / MOV，或文件不完整");
  return { moov, moofs };
}

async function readBox(handle, { offset, size }, what) {
  if (size > MAX_BOX_READ) fail(`${what} 大得不正常，不像是正常的视频文件`);
  const buf = Buffer.alloc(size);
  const { bytesRead } = await handle.read(buf, 0, size, offset);
  if (bytesRead !== size) fail(`${what} 读不全，文件可能没下完`);
  return buf;
}

/**
 * 读一个本地视频文件的探针事实 `{width, height, durationUs, codec}`。
 * 只接受普通文件（`O_NOFOLLOW`：不跟符号链接），只读 `moov` 与 `moof`。
 */
export async function probeVideoFile(file) {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail("不是普通文件");
    const { moov, moofs } = await scanTopLevel(handle, stat.size);
    const info = readMoov(await readBox(handle, moov, "moov"));
    const cursors = new Map();
    for (const moof of moofs)
      // oxlint-disable-next-line eslint/no-await-in-loop -- 没有 tfdt 的片段接着上一个片段的终点，按文件顺序读
      readMoof(await readBox(handle, moof, "moof"), info, cursors);
    return summarize(info);
  } finally {
    await handle.close();
  }
}
