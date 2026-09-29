/**
 * 测试用的最小 MP4 / MOV：只拼探针会读的那几个 box（ftyp / moov{mvhd, trak{tkhd, edts/elst,
 * mdia{mdhd, hdlr, minf/stbl{stsd, stts, ctts}}}} / mdat），不含真实码流。字节是确定的：
 * 同一组参数永远得到同一串字节，测试可以按字节数断言下载与复用。
 */

const u8 = (n) => Buffer.from([n & 0xff]);
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
const zeros = (n) => Buffer.alloc(n);
const fixed16 = (n) => i32(Math.round(n * 65536));
const fixed2_30 = (n) => i32(Math.round(n * 2 ** 30));

export function box(type, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, "latin1"), body]);
}

/** 64 位长度的 box（`size == 1` 后跟 largesize）。 */
function largeBox(type, body) {
  return Buffer.concat([u32(1), Buffer.from(type, "latin1"), u64(16 + body.length), body]);
}

function matrix(rotation) {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  return Buffer.concat([
    fixed16(cos),
    fixed16(sin),
    fixed2_30(0),
    fixed16(-sin),
    fixed16(cos),
    fixed2_30(0),
    fixed16(0),
    fixed16(0),
    fixed2_30(1),
  ]);
}

function fullBox(type, version, flags, ...parts) {
  return box(
    type,
    u8(version),
    Buffer.from([(flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]),
    ...parts,
  );
}

function mvhd({ timescale, duration, version }) {
  return version === 1
    ? fullBox(
        "mvhd",
        1,
        0,
        u64(0),
        u64(0),
        u32(timescale),
        u64(duration),
        u32(0x10000),
        u16(0x100),
        zeros(10),
        matrix(0),
        zeros(24),
        u32(3),
      )
    : fullBox(
        "mvhd",
        0,
        0,
        u32(0),
        u32(0),
        u32(timescale),
        u32(duration),
        u32(0x10000),
        u16(0x100),
        zeros(10),
        matrix(0),
        zeros(24),
        u32(3),
      );
}

function tkhd({ id, duration, width, height, rotation, version, enabled }) {
  const head =
    version === 1
      ? [u64(0), u64(0), u32(id), u32(0), u64(duration)]
      : [u32(0), u32(0), u32(id), u32(0), u32(duration)];
  return fullBox(
    "tkhd",
    version,
    enabled ? 3 : 2,
    ...head,
    zeros(8),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    matrix(rotation),
    fixed16(width),
    fixed16(height),
  );
}

function mdhd({ timescale, duration, version }) {
  return version === 1
    ? fullBox("mdhd", 1, 0, u64(0), u64(0), u32(timescale), u64(duration), u16(0x55c4), u16(0))
    : fullBox("mdhd", 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));
}

function hdlr(handler) {
  return fullBox(
    "hdlr",
    0,
    0,
    u32(0),
    Buffer.from(handler, "latin1"),
    zeros(12),
    Buffer.from("Handler\0"),
  );
}

/**
 * 视觉样本描述。`codec` 是它的类型（fourcc），缺省 H.264 的 `avc1`（带 `avcC`）；MPEG-4 Part 2 的
 * `mp4v` 带 `esds`（真实文件都有它，页面的 mediabunny 在视频轨上读到 esds 就断言失败）。
 */
function visualEntry({ width, height, pasp, codec = "avc1" }) {
  return box(
    codec,
    zeros(6),
    u16(1),
    u16(0),
    u16(0),
    zeros(12),
    u16(width),
    u16(height),
    u32(0x480000),
    u32(0x480000),
    u32(0),
    u16(1),
    zeros(32),
    u16(0x18),
    i32(-1).subarray(2),
    codec === "mp4v" ? fullBox("esds", 0, 0, zeros(8)) : box("avcC", zeros(8)),
    ...(pasp ? [box("pasp", u32(pasp[0]), u32(pasp[1]))] : []),
  );
}

function audioEntry() {
  return box("mp4a", zeros(6), u16(1), zeros(8), u16(2), u16(16), u16(0), u16(0), u32(48000 << 16));
}

function stts(entries) {
  return fullBox(
    "stts",
    0,
    0,
    u32(entries.length),
    ...entries.flatMap(([count, delta]) => [u32(count), u32(delta)]),
  );
}

function ctts(offsets, version = 0) {
  return fullBox(
    "ctts",
    version,
    0,
    u32(offsets.length),
    ...offsets.flatMap(([count, offset]) => [
      u32(count),
      version === 1 ? i32(offset) : u32(offset),
    ]),
  );
}

function elst(entries, version = 0) {
  return fullBox(
    "elst",
    version,
    0,
    u32(entries.length),
    ...entries.flatMap(([segment, mediaTime]) =>
      version === 1
        ? [
            u64(segment),
            (() => {
              const b = Buffer.alloc(8);
              b.writeBigInt64BE(BigInt(mediaTime));
              return b;
            })(),
            fixed16(1),
          ]
        : [u32(segment), i32(mediaTime), fixed16(1)],
    ),
  );
}

function trak({ id, handler, track, movieTimescale, version }) {
  const samples = track.samples ?? [];
  const total = samples.reduce((sum, [count, delta]) => sum + count * delta, 0);
  const mediaDuration = track.mdhdDuration ?? total;
  const stsd =
    handler === "vide"
      ? fullBox("stsd", 0, 0, u32(1), visualEntry(track))
      : fullBox("stsd", 0, 0, u32(1), audioEntry());
  const stbl = box(
    "stbl",
    stsd,
    stts(samples),
    ...(track.ctts ? [ctts(track.ctts, track.cttsVersion)] : []),
  );
  return box(
    "trak",
    tkhd({
      id,
      duration: Math.round((mediaDuration / track.timescale) * movieTimescale),
      width: handler === "vide" ? track.width : 0,
      height: handler === "vide" ? track.height : 0,
      rotation: track.rotation ?? 0,
      version,
      enabled: track.enabled !== false,
    }),
    ...(track.elst ? [box("edts", elst(track.elst, version))] : []),
    box(
      "mdia",
      mdhd({ timescale: track.timescale, duration: mediaDuration, version }),
      hdlr(handler),
      box("minf", stbl),
    ),
  );
}

/**
 * 一个 moof（+ 它的 mdat）：`samples` 是 `[时长, 合成偏移]`，`base` 写进 tfdt（null = 不写 tfdt）。
 * trun 版本 1（有符号合成偏移）。
 */
function fragment({ sequence, trackId, base, samples, defaultDuration }) {
  const withDuration = defaultDuration === undefined;
  const flags = 0x800 | (withDuration ? 0x100 : 0);
  const trun = fullBox(
    "trun",
    1,
    flags,
    u32(samples.length),
    ...samples.flatMap(([duration, offset]) => [
      ...(withDuration ? [u32(duration)] : []),
      i32(offset),
    ]),
  );
  const tfhd =
    defaultDuration === undefined
      ? fullBox("tfhd", 0, 0x20000, u32(trackId))
      : fullBox("tfhd", 0, 0x20000 | 0x8, u32(trackId), u32(defaultDuration));
  const traf = box(
    "traf",
    tfhd,
    ...(base === null ? [] : [fullBox("tfdt", 1, 0, u64(base))]),
    trun,
  );
  return Buffer.concat([
    box("moof", fullBox("mfhd", 0, 0, u32(sequence)), traf),
    box("mdat", zeros(64)),
  ]);
}

/**
 * 拼一个文件。缺省：1080×1920 竖屏、15360 时基 150 帧 × 512 = 5 秒视频 + 48 kHz 音频
 * （235 × 1024 = 5.0133 秒，编辑表把开头 1024 个样本的编码器预热剪掉 → 4.992 秒），视频编码 avc1。
 */
export function mp4({
  width = 1080,
  height = 1920,
  rotation = 0,
  pasp,
  codec,
  video = {},
  audio = { timescale: 48000, samples: [[235, 1024]], elst: [[4992, 1024]] },
  movieTimescale = 1000,
  version = 0,
  moovAtEnd = false,
  mdatBytes = 4096,
  largeMdat = false,
  fillByte = 0x5a,
  mvex,
  fragments,
} = {}) {
  const videoTrack = {
    timescale: 15360,
    samples: [[150, 512]],
    width,
    height,
    rotation,
    pasp,
    codec,
    ...video,
  };
  const tracks = [trak({ id: 1, handler: "vide", track: videoTrack, movieTimescale, version })];
  if (audio) tracks.push(trak({ id: 2, handler: "soun", track: audio, movieTimescale, version }));
  const movieDuration = Math.round(
    ((videoTrack.mdhdDuration ?? videoTrack.samples.reduce((s, [c, d]) => s + c * d, 0)) /
      videoTrack.timescale) *
      movieTimescale,
  );
  const moov = box(
    "moov",
    mvhd({ timescale: movieTimescale, duration: mvex?.mvhdDuration ?? movieDuration, version }),
    ...tracks,
    ...(mvex
      ? [
          box(
            "mvex",
            ...(mvex.fragmentDuration === undefined
              ? []
              : [fullBox("mehd", 0, 0, u32(mvex.fragmentDuration))]),
            fullBox("trex", 0, 0, u32(1), u32(1), u32(mvex.trexDuration ?? 0), u32(0), u32(0)),
          ),
        ]
      : []),
  );
  if (fragments) {
    const ftypOnly = box("ftyp", Buffer.from("iso6"), u32(512), Buffer.from("iso6dashmp41"));
    return Buffer.concat([
      ftypOnly,
      moov,
      ...fragments.map((entry, index) => fragment({ sequence: index + 1, trackId: 1, ...entry })),
    ]);
  }
  const ftyp = box("ftyp", Buffer.from("isom"), u32(512), Buffer.from("isomiso2avc1mp41"));
  const payload = Buffer.alloc(mdatBytes, fillByte);
  const mdat = largeMdat ? largeBox("mdat", payload) : box("mdat", payload);
  return moovAtEnd ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
}
