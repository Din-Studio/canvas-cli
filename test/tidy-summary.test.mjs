import test from "node:test";
import assert from "node:assert/strict";
import { decorate, formatTidySummary } from "../src/cli.mjs";

/**
 * `tidy` / `apply` 的 `tidied[]` 在真环境里整段走丢过：回包里明明有
 * `{"command":0,"moved":2,"resized":1,"strays":["n4","n5"]}`，Agent 读到的却只有
 * 「已应用 1 条命令。rev=5 undoDepth=5」。strays 是整理**拒绝去动**的节点（出框 /
 * 压框），也是 Agent 唯一能知道「这里需要人来处理」的通道，丢了就等于没整理过。
 *
 * 所以这里钉两层：渲染本身（数量 + 必须点名 id），以及**它真的接在 execute 的回包上**
 * ——渲染函数写好了却没接线，正是原来那个故障的形状。
 */

test("tidy 摘要把 moved / resized 和每个 stray 的 id 都写出来", () => {
  const text = formatTidySummary([{ command: 0, moved: 2, resized: 1, strays: ["n4", "n5"] }]);
  assert.match(text, /commands\[0\]/);
  assert.match(text, /moved 2/);
  assert.match(text, /resized 1/);
  assert.match(text, /2 strays/);
  // 点名 id —— 只给数量的话 Agent 没法把需要人处理的东西指给用户。
  assert.match(text, /n4/);
  assert.match(text, /n5/);
});

test("没有 stray 时明说 no strays，不让「没写」和「没有」长得一样", () => {
  assert.equal(
    formatTidySummary([{ command: 3, moved: 0, resized: 0, strays: [] }]),
    "tidy (commands[3]): moved 0, resized 0, no strays",
  );
});

test("一条 tidy 一行：一个 apply 批里多条整理都要出现", () => {
  const lines = formatTidySummary([
    { command: 0, moved: 1, resized: 0, strays: [] },
    { command: 2, moved: 4, resized: 2, strays: ["stray-a"] },
  ]).split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /commands\[0\]/);
  assert.match(lines[1], /commands\[2\]/);
  assert.match(lines[1], /1 stray left untouched/);
  assert.match(lines[1], /stray-a/);
});

test("tidy 与 apply 的回包都被渲染，strays 的 id 出现在文本里", () => {
  for (const command of ["tidy", "apply"]) {
    const decorated = decorate(command, {
      ok: true,
      created: [],
      tidied: [{ command: 0, moved: 2, resized: 1, strays: ["n4", "n5"] }],
      rev: 5,
      undoDepth: 5,
    });
    assert.equal(typeof decorated.tidySummary, "string", `${command} 少了 tidySummary`);
    assert.match(decorated.tidySummary, /n4, n5/);
    // 原始字段一个都不动，只是多一份人话。
    assert.deepEqual(decorated.tidied, [
      { command: 0, moved: 2, resized: 1, strays: ["n4", "n5"] },
    ]);
    assert.equal(decorated.rev, 5);
  }
});

test("没有 tidied 的回包、以及失败的回包，都不多长出 tidySummary", () => {
  assert.equal(decorate("apply", { ok: true, created: [], rev: 2 }).tidySummary, undefined);
  assert.equal(decorate("apply", { ok: true, created: [], tidied: [] }).tidySummary, undefined);
  assert.equal(
    decorate("tidy", { ok: false, error: { code: "invalid_command", message: "x" } }).tidySummary,
    undefined,
  );
  assert.equal(decorate("ls", { ok: true, tidied: [{ command: 0 }] }).tidySummary, undefined);
});

/**
 * 渲染不许再藏在 CLI 里：页面的 `apply` 回包要自带同一句话（两条路径都带），
 * 所以这份渲染必须从**包的公共表面**拿得到，而不是只有 `cli.mjs` 里那一份。
 * 集成方（宿主 / 产品仓）导的是 `@scenemint/canvas-cli/contract` 这条已发布的子路径。
 */
test("formatTidySummary 从已发布的 ./contract 子路径也拿得到，且是同一份实现", async () => {
  const fromContract = (await import("../src/contract.mjs")).formatTidySummary;
  assert.equal(typeof fromContract, "function");
  assert.equal(fromContract, formatTidySummary, "包的公共表面和 CLI 用的不是同一份渲染");
  assert.equal(
    fromContract([{ command: 1, moved: 3, resized: 0, strays: [] }]),
    "tidy (commands[1]): moved 3, resized 0, no strays",
  );
});

/**
 * 新页面自己就把 `tidySummary` 放进回包里（`apply` 与 `tidy` 两条路径都有）。
 * 装饰只对老页面兜底，绝不能把页面给的那句话覆盖掉 —— 覆盖等于两条路径又开始
 * 各说各话。
 */
test("页面已经给了 tidySummary 时，装饰原样保留它", () => {
  const decorated = decorate("apply", {
    ok: true,
    created: [],
    tidied: [{ command: 0, moved: 2, resized: 1, strays: ["n4"] }],
    tidySummary: "页面给的那一句",
  });
  assert.equal(decorated.tidySummary, "页面给的那一句");
});

test("tasks 的定宽表仍然由同一个装饰器接上（别把老行为改没了）", () => {
  const decorated = decorate("tasks", { ok: true, rows: [{ status: "succeeded", kind: "image" }] });
  assert.equal(typeof decorated.table, "string");
  assert.match(decorated.table, /status/);
});
