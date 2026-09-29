import test from "node:test";
import assert from "node:assert/strict";
import { execute, parseArgs } from "../src/cli.mjs";
import { COMMAND_SPEC } from "../src/spec.mjs";
import {
  enforceRequestPolicy,
  RequestPolicyError,
  TIMELINE_FIELDS,
  TIMELINE_OPS,
} from "../src/policy.mjs";
import { fixture } from "./helpers.mjs";

/**
 * F059-D —— timeline 的四个编辑 op（trim / split / cut / restore）与 `--episode`。
 * CLI 一侧只守「认不认识」：op 与字段的搭配、取值、CAS 全在页面侧判。
 */

const policyError = (re) => (error) =>
  error instanceof RequestPolicyError && error.code === "invalid_request" && re.test(error.message);

test("timeline 的 op 表与字段表：新 op 与字段都认，拼错的字段当场拒", () => {
  assert.deepEqual(TIMELINE_OPS.slice(-4), ["trim", "split", "cut", "restore"]);
  const ok = (params) => enforceRequestPolicy("main", "timeline", params);
  assert.doesNotThrow(() => ok({ op: "list", episode: "EP01" }));
  assert.doesNotThrow(() => ok({ op: "trim", clipId: "c1", inMs: 0, outMs: 1000 }));
  assert.doesNotThrow(() => ok({ op: "trim", reset: true, episode: "EP02" }));
  assert.doesNotThrow(() => ok({ op: "split", clipId: "c1", atMs: 500, baseRevision: "t1-x" }));
  assert.doesNotThrow(() =>
    ok({ op: "cut", inMs: 0, outMs: 900, baseRevision: "t1-x", baseLayout: "l1-y" }),
  );
  assert.doesNotThrow(() => ok({ op: "restore", previousClips: [], baseRevision: "t0" }));
  // baseLayout：cut 必填，split / trim / restore 可带（搭配由页面判，这里只认字段名）。
  assert.doesNotThrow(() => ok({ op: "trim", clipId: "c1", outMs: 900, baseLayout: "l1-y" }));
  assert.doesNotThrow(() =>
    ok({ op: "restore", previousClips: [], baseRevision: "t0", baseLayout: "l0" }),
  );
  assert.doesNotThrow(() =>
    ok({ op: "append", clips: [{ nodeId: "n1" }], dedupeBySource: true, sort: "shot" }),
  );
  assert.throws(
    () => ok({ op: "trim", clipID: "c1" }),
    policyError(/Unexpected timeline field: clipID/),
  );
  assert.throws(
    () => ok({ op: "trim", src: "https://x" }),
    policyError(/Unexpected timeline field: src/),
  );
  assert.throws(() => ok({ op: "undo" }), policyError(/timeline op must be one of/));
  // 身份字段仍然由会话控制；worker 一律不能碰 timeline。
  assert.throws(() => ok({ op: "list", canvasId: "x" }), /controlled by the authenticated session/);
  assert.throws(
    () => enforceRequestPolicy("worker", "timeline", { op: "list" }),
    (error) => error.code === "worker_forbidden",
  );
  for (const field of [
    "clipId",
    "inMs",
    "outMs",
    "atMs",
    "reset",
    "previousClips",
    "episode",
    "baseLayout",
  ])
    assert.ok(TIMELINE_FIELDS.includes(field), field);
  // 拼错的布局字段同样当场拒（页面只会当它没给，然后报一句「cut 必须带 baseLayout」）。
  assert.throws(
    () => ok({ op: "cut", inMs: 0, outMs: 900, baseRevision: "t1-x", layoutDigest: "l1-y" }),
    policyError(/Unexpected timeline field: layoutDigest/),
  );
});

test("timeline --episode 是这条命令的 flag，usage 列出全部十个 op", async () => {
  assert.ok(COMMAND_SPEC.timeline.flags.includes("episode"));
  for (const op of TIMELINE_OPS)
    assert.match(COMMAND_SPEC.timeline.usage, new RegExp(`\\b${op}\\b`));
  assert.equal(parseArgs(["timeline", "clear", "--episode", "EP02"]).options.episode, "EP02");
  await assert.rejects(
    execute(["list-canvases", "--episode", "EP01"]),
    (error) => error.code === "invalid_argument",
  );
});

test("真实守护进程：timeline list --episode / trim --file 原样送到页面", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const pump = await f.pump((req) => {
    seen.push({ method: req.method, params: req.params });
    return { ok: true, clips: [], revision: "t0", knownMs: 0, unknownCount: 0 };
  });
  t.after(() => pump.stop());
  const listed = await f.cli(["timeline", "list", "--episode", "ep1"]);
  assert.equal(listed.code, 0);
  const trimmed = await f.cli([
    "timeline",
    "trim",
    "--json",
    JSON.stringify({ clipId: "c1", inMs: 200, outMs: 1800 }),
  ]);
  assert.equal(trimmed.code, 0);
  const cut = { inMs: 0, outMs: 900, baseRevision: "t1-x", baseLayout: "l1-y" };
  const cutRun = await f.cli(["timeline", "cut", "--json", JSON.stringify(cut)]);
  assert.equal(cutRun.code, 0);
  assert.deepEqual(seen, [
    { method: "timeline", params: { op: "list", episode: "ep1" } },
    { method: "timeline", params: { clipId: "c1", inMs: 200, outMs: 1800, op: "trim" } },
    { method: "timeline", params: { ...cut, op: "cut" } },
  ]);
  // 拼错字段在守护进程就被拒，一次都不送到页面。
  const bad = await f.cli(["timeline", "trim", "--json", JSON.stringify({ clipID: "c1" })]);
  assert.notEqual(bad.code, 0);
  assert.equal(seen.length, 3);
});
