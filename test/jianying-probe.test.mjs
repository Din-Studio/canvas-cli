import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProbeError, probeVideoFile } from "../src/jianying/probe.mjs";
import { mp4 } from "./mp4-fixture.mjs";

/**
 * 剪映导出的 Node 探针：宽高（显示尺寸）+ 源文件全长。口径对齐页面导出用的 mediabunny
 * （`getPrimaryVideoTrack().displayWidth/Height`、`computeDuration()`），同一个文件两条路径
 * 得到同一组事实，草稿才会逐字节一致。
 */

async function probeBytes(t, bytes, name = "clip.mp4") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jianying-probe-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  await fs.writeFile(file, bytes);
  return probeVideoFile(file);
}

test("竖屏 5 秒：宽高取视频轨样本描述，时长取各轨呈现结束时间的最大值（音频被编辑表剪短，不影响）", async (t) => {
  assert.deepEqual(await probeBytes(t, mp4()), {
    width: 1080,
    height: 1920,
    durationUs: 5_000_000,
    codec: "avc1",
  });
});

test("moov 在文件尾（没做 faststart）也找得到，结果与 moov 在前完全相同", async (t) => {
  assert.deepEqual(await probeBytes(t, mp4({ moovAtEnd: true, mdatBytes: 50_000 })), {
    width: 1080,
    height: 1920,
    durationUs: 5_000_000,
    codec: "avc1",
  });
});

test("tkhd 矩阵旋转 90 / 270 度时对调宽高（显示尺寸），180 度不对调", async (t) => {
  assert.deepEqual(await probeBytes(t, mp4({ width: 1920, height: 1080, rotation: 90 })), {
    width: 1080,
    height: 1920,
    durationUs: 5_000_000,
    codec: "avc1",
  });
  assert.deepEqual(await probeBytes(t, mp4({ width: 1920, height: 1080, rotation: 270 })), {
    width: 1080,
    height: 1920,
    durationUs: 5_000_000,
    codec: "avc1",
  });
  assert.deepEqual(await probeBytes(t, mp4({ width: 1920, height: 1080, rotation: 180 })), {
    width: 1920,
    height: 1080,
    durationUs: 5_000_000,
    codec: "avc1",
  });
});

test("pasp 非方像素：按 mediabunny 的规则换成方像素（hSpacing > vSpacing 拉宽，否则拉高）", async (t) => {
  assert.equal((await probeBytes(t, mp4({ width: 1440, height: 1080, pasp: [4, 3] }))).width, 1920);
  assert.equal(
    (await probeBytes(t, mp4({ width: 1920, height: 1440, pasp: [3, 4] }))).height,
    1920,
  );
});

test("版本 1 的 mvhd / tkhd / mdhd / elst（64 位时间字段）", async (t) => {
  assert.deepEqual(await probeBytes(t, mp4({ version: 1 })), {
    width: 1080,
    height: 1920,
    durationUs: 5_000_000,
    codec: "avc1",
  });
});

test("B 帧重排（ctts）+ 编辑表起点：取呈现顺序最后一帧的结束时间减去编辑表偏移", async (t) => {
  // 解码顺序 I P B B（每帧 512），合成偏移 512/1536/0/0 → 呈现时间 512/2048/1024/1536：
  // 解码顺序的最后一帧并不是呈现顺序的最后一帧。呈现结束 = 2048 + 512 = 2560，
  // 编辑表从 512 开始 → (2560 − 512) / 15360 = 正好 4 帧。
  const bytes = mp4({
    audio: null,
    video: {
      samples: [[4, 512]],
      ctts: [
        [1, 512],
        [1, 1536],
        [2, 0],
      ],
      elst: [[133, 512]],
    },
  });
  assert.equal((await probeBytes(t, bytes)).durationUs, Math.round((4 * 512 * 1e6) / 15360));
});

test("有符号 ctts（版本 1）与编辑表前的空编辑（延后起播）", async (t) => {
  const bytes = mp4({
    audio: null,
    video: {
      samples: [[4, 512]],
      cttsVersion: 1,
      ctts: [
        [1, 0],
        [1, 1536],
        [1, -512],
        [1, 0],
      ],
      // 空编辑 100 ms（media_time = -1），然后从 0 开始播：整条轨往后推 100 ms。
      elst: [
        [100, -1],
        [133, 0],
      ],
    },
  });
  // 呈现结束 = max(0+512, 512+1536+512, 1024-512+512, 1536+512) = 2560；空编辑 100 ms = 1536 个时基单位。
  assert.equal((await probeBytes(t, bytes)).durationUs, Math.round(((2560 + 1536) * 1e6) / 15360));
});

test("呈现时间最大的那个样本用它自己的时长（mediabunny 的 getPacket(Infinity)），不是所有样本 pts+时长的最大值", async (t) => {
  // 解码顺序最后一帧时长 1540，但它不是呈现顺序的最后一帧：呈现最后的是第 3 帧（pts 1536+512）。
  const bytes = mp4({
    audio: null,
    video: {
      samples: [
        [3, 512],
        [1, 1540],
      ],
      ctts: [
        [1, 512],
        [1, 512],
        [1, 1536],
        [1, 0],
      ],
      elst: [[133, 512]],
    },
  });
  // pts = 512 / 1024 / 2560 / 1536 → 最大 2560（第 3 帧，时长 512）→ 结束 3072 − 编辑表 512 = 2560。
  assert.equal((await probeBytes(t, bytes)).durationUs, Math.round((2560 * 1e6) / 15360));
});

test("分片 MP4：时长来自各个 moof（tfdt 起点 + trun 时长与合成偏移），不信 mdhd 的声明", async (t) => {
  const run = Array.from({ length: 60 }, (_, i) => [512, i % 3 === 1 ? 1024 : 0]);
  const bytes = mp4({
    audio: null,
    // 写错的 mdhd（有的封装器把毫秒写进了媒体时基），真正的时长只在分片里。
    video: { samples: [], mdhdDuration: 3000 },
    mvex: { trexDuration: 512 },
    fragments: [
      { base: 0, samples: run },
      { base: 60 * 512, samples: run },
    ],
  });
  // 最后呈现的样本：第二个片段里 pts 最大的那个 = 30720 + 58*512 + 1024 → 结束 + 512。
  const end = 30720 + 58 * 512 + 1024 + 512;
  assert.equal((await probeBytes(t, bytes)).durationUs, Math.round((end * 1e6) / 15360));
});

test("分片没有 tfdt：接着这条轨上一个片段的解码终点往后排；时长也可以只写在 tfhd / trex 的缺省里", async (t) => {
  const bytes = mp4({
    audio: null,
    video: { samples: [], mdhdDuration: 0 },
    mvex: { trexDuration: 512 },
    fragments: [
      { base: null, samples: Array.from({ length: 30 }, () => [512, 0]), defaultDuration: 512 },
      { base: null, samples: Array.from({ length: 30 }, () => [512, 0]), defaultDuration: 512 },
    ],
  });
  assert.equal((await probeBytes(t, bytes)).durationUs, Math.round((60 * 512 * 1e6) / 15360));
});

test("视频编码：带回首个样本描述的 fourcc；MPEG-4 Part 2（mp4v + esds）的 mov 照样读出宽高时长（支不支持由导出那一层提醒）", async (t) => {
  assert.deepEqual(await probeBytes(t, mp4({ codec: "mp4v" }), "clip.mov"), {
    width: 1080,
    height: 1920,
    durationUs: 5_000_000,
    codec: "mp4v",
  });
  assert.equal((await probeBytes(t, mp4({ codec: "hvc1", rotation: 90 }))).codec, "hvc1");
});

test("64 位长度的 mdat（largesize）照样跳得过去", async (t) => {
  assert.equal(
    (await probeBytes(t, mp4({ largeMdat: true, moovAtEnd: true }))).durationUs,
    5_000_000,
  );
});

test("不是 MP4 / MOV（例如 CDN 回了一页 HTML）→ ProbeError，不猜一组数", async (t) => {
  await assert.rejects(
    probeBytes(t, Buffer.from("<!doctype html><html><body>404</body></html>")),
    ProbeError,
  );
  await assert.rejects(probeBytes(t, Buffer.alloc(0)), ProbeError);
});

test("文件没下完（moov 被截断 / 根本没有 moov）→ ProbeError", async (t) => {
  const whole = mp4({ moovAtEnd: true });
  await assert.rejects(probeBytes(t, whole.subarray(0, whole.length - 40)), ProbeError);
  await assert.rejects(probeBytes(t, whole.subarray(0, 64)), ProbeError);
});

test("只有音频轨 → ProbeError（剪映视频素材必须有视频轨）", async (t) => {
  const bytes = mp4({ video: { samples: [[150, 512]] } });
  // 把视频轨的 hdlr 改成字幕轨，只剩音频。
  const at = bytes.indexOf(Buffer.from("vide"));
  bytes.write("text", at, "latin1");
  await assert.rejects(probeBytes(t, bytes), /没有视频轨/);
});

test("分片 MP4（moov 里没有样本）：退回 mvhd / mehd 的声明时长", async (t) => {
  const bytes = mp4({
    audio: null,
    video: { samples: [], mdhdDuration: 0 },
    mvex: { mvhdDuration: 0, fragmentDuration: 6000 },
  });
  assert.equal((await probeBytes(t, bytes)).durationUs, 6_000_000);
});

test("符号链接不跟（O_NOFOLLOW）", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jianying-probe-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "real.mp4"), mp4());
  try {
    await fs.symlink(path.join(dir, "real.mp4"), path.join(dir, "link.mp4"));
  } catch {
    t.skip("这台机器建不了符号链接");
    return;
  }
  await assert.rejects(probeVideoFile(path.join(dir, "link.mp4")));
});
