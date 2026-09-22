import assert from "node:assert/strict";
import { test } from "node:test";
import { audioCompatibility, sniffMediaType } from "../src/media.mjs";

test("sniffMediaType reads the container from leading bytes, not the name", () => {
  assert.equal(sniffMediaType(Buffer.from("fLaC\0\0\0\0")), "audio/flac");
  assert.equal(sniffMediaType(Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0])), "audio/mpeg");
  assert.equal(sniffMediaType(Buffer.from("RIFF\0\0\0\0WAVEfmt ")), "audio/wav");
  assert.equal(sniffMediaType(Buffer.from("\0\0\0\x18ftypisom")), "video/mp4");
  assert.equal(sniffMediaType(Buffer.from("plain text")), null);
});

test("audioCompatibility flags what the video provider will refuse", () => {
  assert.deepEqual(audioCompatibility("audio/mpeg"), {
    detectedMimeType: "audio/mpeg",
    videoReferenceCompatible: true,
  });
  const flac = audioCompatibility("audio/flac");
  assert.equal(flac.videoReferenceCompatible, false);
  assert.match(flac.note, /mp3、wav/);
  assert.equal(audioCompatibility("video/mp4"), undefined);
  assert.equal(audioCompatibility(null), undefined);
});
