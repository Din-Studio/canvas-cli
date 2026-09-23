import test from "node:test";
import assert from "node:assert/strict";
import { execute, parseArgs } from "../src/cli.mjs";
import { COMMAND_SPEC, resizeGroupCommand, tidyCommand } from "../src/spec.mjs";
import { METHODS, MUTATIONS } from "../src/common.mjs";
import { CANVAS_CONTRACT } from "../src/contract.mjs";

/**
 * 这些断言存在的理由是 2f604695：`--batch` 被 help、SKILL 的 commands.md 和
 * PROTOCOL.md 三处写成首选形式，而它从来没进过 FLAGS 白名单，于是 Agent 只能退回裸
 * `cancel-batch`——那会撤掉该会话所有批次的未提交节点。两份手维护清单漂移，没有关卡。
 * 现在 help 与校验同源，下面把「同源」本身钉住。
 */

const invalidArgument = (re) => (error) =>
  error.code === "invalid_argument" && re.test(error.message);

test("每条命令 usage 里出现的 flag 都必须是它真正接受的 flag", () => {
  for (const [command, entry] of Object.entries(COMMAND_SPEC)) {
    const documented = [...entry.usage.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]);
    for (const flag of documented)
      assert.ok(
        entry.flags.includes(flag),
        `${command}: usage 写了 --${flag}，但 flags 里没有它（这正是 --batch 那次事故的形状）`,
      );
  }
});

test("spec 里声明的 wire method 都在传输层白名单里", () => {
  for (const [command, entry] of Object.entries(COMMAND_SPEC)) {
    if (entry.method === undefined) continue;
    assert.ok(METHODS.has(entry.method), `${command} → ${entry.method} 不在 common.mjs METHODS 里`);
  }
});

test("除 media_info / media_chunk 外，每个传输层方法都至少有一条 CLI 命令可达", () => {
  // media_info / media_chunk 由 media.mjs 内部使用（download / inspect-media / frames），
  // 故意不做成顶层命令。其余任何方法没有命令 = Agent 到不了那个能力，这是要拦的那一类。
  // 一个方法**多个**前端是允许的：`apply` 既有通用入口，又有 `tidy` 这种把作用域校验
  // 收紧后再合成命令体的专用入口（`upload` 同理，只是它不走 METHODS 派发）。
  const internal = new Set(["media_info", "media_chunk"]);
  const byMethod = new Map();
  for (const [command, entry] of Object.entries(COMMAND_SPEC)) {
    if (entry.method === undefined) continue;
    byMethod.set(entry.method, [...(byMethod.get(entry.method) ?? []), command]);
  }
  for (const method of METHODS)
    if (!internal.has(method))
      assert.ok(byMethod.has(method), `${method} 没有对应的 CLI 命令，Agent 无法到达`);
  // `resize-group` 是第三个 apply 前端：和 tidy 同一个理由 —— 它把作用域 / 开关
  // 校验收紧后再合成命令体（尤其是 `--absorb-strays` 这个唯一会动成员归属的开关）。
  assert.deepEqual(byMethod.get("apply"), ["apply", "tidy", "resize-group"]);
});

test("spec 里的每个 flag 都能被 parseArgs 识别（不是 Unknown option）", () => {
  for (const [command, entry] of Object.entries(COMMAND_SPEC))
    for (const flag of entry.flags) {
      let message = "";
      try {
        parseArgs([command, `--${flag}`]);
      } catch (error) {
        message = error.message;
      }
      // 取值型 flag 会报 "requires a value"，布尔型直接通过；只有拼错才会是 Unknown option。
      assert.doesNotMatch(
        message,
        /Unknown option/,
        `${command}: --${flag} 在 spec 里，但 parseArgs 不认识它`,
      );
    }
});

test("help 完全由 spec 生成，分命令 help 只回该命令自己的 flag", async () => {
  const all = await execute(["help"]);
  assert.deepEqual(Object.keys(all.commands), Object.keys(COMMAND_SPEC));
  // 原来 help 手写的 commands 表漏了 `stop` 别名和 snapshot 的 --limit → maxNodes。
  assert.ok(Object.hasOwn(all.commands, "stop"));
  assert.match(all.commands.snapshot, /maxNodes/);

  const one = await execute(["apply", "--help"]);
  assert.equal(one.command, "apply");
  assert.equal(one.method, "apply");
  assert.deepEqual(
    one.flags,
    COMMAND_SPEC.apply.flags.map((flag) => `--${flag}`),
  );
  assert.equal(Object.hasOwn(one, "commands"), false);
  assert.deepEqual(await execute(["help", "apply"]), one);
});

test("对这条命令无意义的 flag 报错，而不是被静默丢弃", async () => {
  // 都是今天真实可复现的静默行为：
  // --group 被 cancel-batch 丢掉 → 页面按「没给 batchId」撤掉本会话全部批次。
  await assert.rejects(
    execute(["cancel-batch", "--group", "g-1"]),
    invalidArgument(/--group is not an option of cancel-batch/),
  );
  // ls 靠 --after 游标分页，--offset 只有 grep/read 认 → Agent 以为在翻页，实际永远第一页。
  await assert.rejects(
    execute(["ls", "--offset", "50"]),
    invalidArgument(/--offset is not an option of ls/),
  );
  // download 在 paramsFrom / rpcOptions 之前就 return 了，--turn 到不了任何地方。
  await assert.rejects(
    execute(["download", "n-1", "--turn", "t"]),
    invalidArgument(/--turn is not an option of download/),
  );
  await assert.rejects(
    execute(["snapshot", "--glob", "*"]),
    invalidArgument(/--glob is not an option of snapshot/),
  );
});

test("拼错 flag 时给出最接近的合法 flag", async () => {
  await assert.rejects(
    execute(["run-batch", "--node", "a"]),
    invalidArgument(/--node is not an option of run-batch; did you mean --nodes\?/),
  );
});

test("cancel-batch --batch 仍然可用（不回退 2f604695）", () => {
  const parsed = parseArgs(["cancel-batch", "--batch", "b-123"]);
  assert.equal(parsed.options.batch, "b-123");
  assert.equal(parseArgs(["cancel-batch"]).options.batch, undefined);
});

test("--count 在命令名前后都能正确解析", () => {
  // frames 的 --count 是数量，grep 的 --count 是布尔开关。命令名已知时行为与原来逐字一致。
  assert.equal(parseArgs(["frames", "n-1", "--count", "12"]).options.count, "12");
  assert.equal(parseArgs(["grep", "pat", "--count"]).options.count, true);
  // 原来这两种写法分别被解析成 command:"12" 和「布尔 flag 不接受取值」。
  const before = parseArgs(["--count", "12", "frames", "n-1"]);
  assert.equal(before.command, "frames");
  assert.equal(before.options.count, "12");
  const eq = parseArgs(["--count=12", "frames", "n-1"]);
  assert.equal(eq.command, "frames");
  assert.equal(eq.options.count, "12");
  // grep 的既有行为不变：--count 后面的非数字仍然是 positional。
  const grep = parseArgs(["grep", "--count", "5"]);
  assert.equal(grep.options.count, true);
  assert.deepEqual(grep.positionals, ["5"]);
});

test("tidy 的全画布必须显式 --all，裸 tidy 报错", () => {
  // 全画布 tidy 是唯一会挪动用户手工摆放过的东西的命令，而且落成 Agent 自己的撤销步，
  // 人的 Ctrl+Z 撤不掉。所以它不能由「少打一个参数」触发。
  assert.deepEqual(tidyCommand({ all: true }), { type: "tidy" });
  assert.throws(() => tidyCommand({}), invalidArgument(/needs --all for the whole canvas/));
  assert.throws(
    () => tidyCommand({ all: true, nodes: "a" }),
    invalidArgument(/either --all or --nodes\/--groups, never both/),
  );
});

test("tidy 的作用域按逗号切分，切出 0 个 id 时报错而不是退化成全画布", () => {
  assert.deepEqual(tidyCommand({ nodes: "a,b,c" }), { type: "tidy", nodeIds: ["a", "b", "c"] });
  assert.deepEqual(tidyCommand({ groups: "g1, g2" }), { type: "tidy", groupIds: ["g1", "g2"] });
  assert.deepEqual(tidyCommand({ nodes: "a", groups: "g1" }), {
    type: "tidy",
    nodeIds: ["a"],
    groupIds: ["g1"],
  });
  // 这两条是本命令最要紧的安全断言：一个筛出 0 个 id 的作用域绝不能变成「整理全部」，
  // 与页面侧 `coerceAgentCommand` 的 `case "tidy"`「列表给了就必须非空」同一条线。
  assert.throws(() => tidyCommand({ nodes: "," }), invalidArgument(/--nodes listed no node ID/));
  assert.throws(() => tidyCommand({ groups: " " }), invalidArgument(/--groups listed no group ID/));
});

test("tidy --scope 是整理画布：不需要 --all，selection 必须带 --nodes/--groups，--fit-frames 只随 --scope", () => {
  assert.deepEqual(tidyCommand({ scope: "all" }), { type: "tidy", scope: "all" });
  assert.deepEqual(tidyCommand({ scope: "groups", "fit-frames": true }), {
    type: "tidy",
    scope: "groups",
    fitFrames: true,
  });
  assert.deepEqual(tidyCommand({ scope: "selection", groups: "g1" }), {
    type: "tidy",
    groupIds: ["g1"],
    scope: "selection",
  });
  assert.throws(
    () => tidyCommand({ scope: "selection" }),
    invalidArgument(/--scope selection needs --nodes/),
  );
  assert.throws(
    () => tidyCommand({ scope: "everything" }),
    invalidArgument(/--scope must be one of/),
  );
  assert.throws(() => tidyCommand({ scope: "all", all: true }), invalidArgument(/never both/));
  assert.throws(
    () => tidyCommand({ all: true, "fit-frames": true }),
    invalidArgument(/--fit-frames needs --scope/),
  );
});

test("tidy --group 被指向 --groups（不设别名，靠最近似建议）", async () => {
  // 刻意不给 --group 加别名：两个名字指同一件事，手册就得解释两遍。
  // 这条断言的是那个「最近似」建议在这个**具体**输入上真的命中，而不是只对远距离词有效。
  await assert.rejects(
    execute(["tidy", "--group", "g1"]),
    invalidArgument(/--group is not an option of tidy; did you mean --groups\?/),
  );
});

test("frames 拿到布尔 --count 时响亮报错，不静默变成 1 帧", async () => {
  await assert.rejects(
    execute(["--count", "frames", "n-1"]),
    invalidArgument(/--count for frames needs a number/),
  );
});

test("--tag 可重复并聚成数组；其它 flag 重复仍然报错", () => {
  const { command, options } = parseArgs(["ls", "/", "--tag", "人物设定", "--tag=终稿"]);
  assert.equal(command, "ls");
  assert.deepEqual(options.tag, ["人物设定", "终稿"]);
  assert.throws(() => parseArgs(["ls", "--tag"]), invalidArgument(/--tag requires a value/));
  assert.throws(
    () => parseArgs(["ls", "--tag", "--long"]),
    invalidArgument(/--tag requires a value/),
  );
  assert.throws(
    () => parseArgs(["ls", "--kind", "gen", "--kind", "group"]),
    invalidArgument(/Duplicate option --kind/),
  );
});

test("--tags 只属于 apply，--tag 只属于 ls / grep（flag 接受面按命令收紧）", async () => {
  // 组合互斥（--tags 与 --json/--file/--text-file）在 execute 里位于 readSession 之后，
  // 由 test/host-argv.test.mjs 经同一条规则的镜像覆盖；这里验 flag 归属。
  await assert.rejects(
    execute(["ls", "--tags", "a", "--session", "x"]),
    invalidArgument(/--tags is not an option of ls/),
  );
  await assert.rejects(
    execute(["apply", "--tag", "a", "--session", "x"]),
    invalidArgument(/--tag is not an option of apply/),
  );
});

/**
 * 案底（本轮）：`wait` / `wait-ms` 进了 RPC 公共表，也写进了 README / PROTOCOL.md /
 * SKILL.md 的「写命令遇到 page_away 的唯一正解」，但 `tidy` 与 `upload` 的 flags 是
 * 手抄的列表、没有展开 RPC，于是这两条**真·写命令**直接拒掉这两个参数：
 * `tidy --scope all --fit-frames --wait` → 退出码 2 的 `invalid_argument`，
 * Agent 拿到的是「参数写错了」，而不是「页面不在」。
 */
test("每条会排队的写命令都必须收 --wait / --wait-ms", () => {
  // 会排队 = 守护进程按 MUTATIONS 判定要占串行槽（common.mjs isMutation），
  // 外加 upload（它在 paramsFrom 之前 return，但一样拿 rpcOptions 并走 apply 路径）。
  const queueing = Object.entries(COMMAND_SPEC).filter(
    ([command, entry]) => MUTATIONS.has(entry.method) || command === "upload",
  );
  assert.ok(queueing.length >= 8, "没识别出写命令，这条闸在空转");
  for (const [command, entry] of queueing) {
    for (const flag of ["wait", "wait-ms", "turn", "request-id"])
      assert.ok(
        entry.flags.includes(flag),
        `${command} 会排队，但 flags 里没有 --${flag}；页面不在时 Agent 无路可走`,
      );
  }
  // 反向：`timeline --op list` 之外的 timeline 也会排队，所以它也在里面。
  assert.ok(COMMAND_SPEC.timeline.flags.includes("wait"));
});

test("--wait / --wait-ms 真的能走到 tidy 与 upload（不是只在表里）", async () => {
  for (const argv of [
    ["tidy", "--scope", "all", "--fit-frames", "--wait"],
    ["tidy", "--scope", "all", "--wait-ms", "60000"],
    ["upload", "a.png", "--wait"],
  ]) {
    // 没有 session 的情况下应当因为 session 失败，而不是因为 flag 不被接受。
    await assert.rejects(execute(argv), (error) => {
      assert.notEqual(error.code, "invalid_argument", `${argv.join(" ")} 被 flag 校验拒了`);
      return true;
    });
  }
});

test("tidy --scope 的取值来自契约那一份，不是第四份手抄", async () => {
  // 案底：TIDY_SCOPES 已经有 canvas-tidy.ts / contract.enums / 页面 coerce 三份，
  // spec.mjs 又抄了第四份且无人看管 —— 加第四个 scope 时全仓绿，唯独 CLI 拒掉。
  for (const scope of CANVAS_CONTRACT.enums["tidy.scope"])
    assert.doesNotThrow(() => tidyCommand({ scope, nodes: "a" }));
  const bogus = "no-such-scope";
  assert.ok(!CANVAS_CONTRACT.enums["tidy.scope"].includes(bogus));
  const message = (() => {
    try {
      tidyCommand({ scope: bogus });
      return "";
    } catch (error) {
      return error.message;
    }
  })();
  // 文案也由同一份枚举拼出来，不会再和实现说两套话。
  assert.equal(
    message,
    `--scope must be one of: ${CANVAS_CONTRACT.enums["tidy.scope"].join(", ")}`,
  );
});

/**
 * A4 —— `resize-group` 是唯一能改组框大小的动词，而 `--absorb-strays` 是唯一
 * 能让一次改框动到**成员归属**的开关。开关默认关闭这件事必须有闸：它一旦变成
 * 默认开启，「把框拉大留点白」就又会收编旁边的散图，而 `delete_node <组>` 连
 * 成员一起删——用户因此丢过成片。
 */
test("resize-group：--fit 与 --size 二选一，--absorb-strays 默认关闭", () => {
  assert.deepEqual(resizeGroupCommand({ fit: true }, "g-1"), {
    type: "resize_group",
    nodeId: "g-1",
    fit: true,
  });
  // 不给开关 = 命令体里**根本没有** absorbStrays 这个键。
  assert.equal(
    Object.hasOwn(resizeGroupCommand({ size: "1800x1200" }, "g-1"), "absorbStrays"),
    false,
  );
  assert.deepEqual(resizeGroupCommand({ size: "1800x1200" }, "g-1"), {
    type: "resize_group",
    nodeId: "g-1",
    size: { width: 1800, height: 1200 },
  });
  assert.deepEqual(resizeGroupCommand({ fit: true, "absorb-strays": true }, "g-1"), {
    type: "resize_group",
    nodeId: "g-1",
    fit: true,
    absorbStrays: true,
  });
  assert.deepEqual(resizeGroupCommand({ size: "1800×1200" }, "g-1").size, {
    width: 1800,
    height: 1200,
  });
});

test("resize-group 的参数错误都响亮报错，不静默退化", () => {
  assert.throws(() => resizeGroupCommand({ fit: true }, undefined), invalidArgument(/group ID/));
  assert.throws(
    () => resizeGroupCommand({ fit: true, size: "1x1" }, "g-1"),
    invalidArgument(/either --fit or --size, never both/),
  );
  assert.throws(() => resizeGroupCommand({}, "g-1"), invalidArgument(/needs --fit/));
  assert.throws(() => resizeGroupCommand({ size: "1800" }, "g-1"), invalidArgument(/WIDTHxHEIGHT/));
  assert.throws(() => resizeGroupCommand({ size: "0x100" }, "g-1"), invalidArgument(/positive/));
});

test("resize-group 的 --absorb-strays 真的能被 parseArgs 解析成布尔", () => {
  // 案底形状：flag 进了 spec 却没进 cli.mjs 的 BOOLEANS，于是 `--absorb-strays`
  // 会去吃下一个 token 当取值（或报 requires a value），手册照着写的人拿到的是
  // 一个与本意无关的报错。
  const parsed = parseArgs(["resize-group", "G-1", "--fit", "--absorb-strays"]);
  assert.equal(parsed.command, "resize-group");
  assert.equal(parsed.options["absorb-strays"], true);
  assert.equal(parsed.options.fit, true);
  assert.deepEqual(parsed.positionals, ["G-1"]);
});

test("resize-group 的字段名与守护进程那张表一致（多给即报错的那张）", () => {
  // `absorbStrays` 没进 COMMAND_FIELDS 的话，守护进程会在页面看到之前就把整批
  // 拒掉 —— CLI 能拼出来、发出去被拒，正是这张表要消灭的漂移。
  const built = resizeGroupCommand({ size: "800x600", "absorb-strays": true }, "g-1");
  for (const key of Object.keys(built))
    if (key !== "type")
      assert.ok(
        CANVAS_CONTRACT.commands.resize_group.fields.includes(key),
        `resize-group 会发出 ${key}，但契约的 resize_group 字段表里没有它`,
      );
});

/* ────────────────────── 命令分级（CANVAS_CONTRACT.tiers） ────────────────────── */

/**
 * 分级表的存在理由和上面那些 flag 断言是同一个：同一件事有四份手抄在描述它
 * （随包的 SKILL.md、产品 `.pi` 里的副本、宿主注入的规则块、宿主自己的工具白名单），
 * 而它们已经互相矛盾过 —— 手册说「写命令都能 `--wait`」、宿主硬拒 `--wait`，模型同时
 * 拿到两个相反答案只能原地猜。
 *
 * `contract.mjs` 不能 import `spec.mjs`（依赖是 `spec.mjs → contract.mjs`，反过来成环），
 * 所以那 35 个子命令名在契约里是手写的。「它就是 COMMAND_SPEC 的键集」这件事没有
 * 别的地方能钉，只能钉在这里 —— 这条断言就是那张手写表的唯一关卡。
 */
const tiers = CANVAS_CONTRACT.tiers;
const tierCommands = Object.fromEntries(
  Object.entries(tiers).filter(([key]) => key !== "applyCommands"),
);

test("tiers 的键集就是 COMMAND_SPEC 的键集（加一条子命令必须同时进分级表）", () => {
  assert.deepEqual(
    Object.keys(tierCommands).sort(),
    Object.keys(COMMAND_SPEC).sort(),
    "契约的分级表与 CLI 的命令表对不上：新命令没分级 = 宿主与模型都不知道该不该放它过",
  );
  assert.ok(tiers.applyCommands, "tiers 少了 applyCommands —— apply 批里的那 20 条没有分级面");
});

test("tiers 的 local 那一档，正好是没有 wire method 的 12 条", () => {
  const local = Object.keys(tierCommands)
    .filter((name) => tierCommands[name].local === true)
    .sort();
  const noMethod = Object.keys(COMMAND_SPEC)
    .filter((name) => !COMMAND_SPEC[name].method)
    .sort();
  assert.deepEqual(
    local,
    noMethod,
    "local 名单与「COMMAND_SPEC 里没有 method 的命令」对不上：给 help / skill-path 标 mutation / mainOnly 是编的，它们根本不发线协议",
  );
  assert.equal(
    local.length,
    12,
    `local 的条数变了（${local.length}）—— 先确认那真的是一条本地命令`,
  );
  for (const name of local) {
    const entry = tierCommands[name];
    assert.equal(entry.method, null, `${name} 是本地命令，method 必须是 null`);
    for (const absent of ["mutation", "mainOnly", "approval"])
      assert.equal(
        Object.hasOwn(entry, absent),
        false,
        `${name} 不发线协议，${absent} 没有真值可对，不要猜一个写上去`,
      );
  }
});

test("tiers 的 method 与 COMMAND_SPEC 逐条相同，mutation 就是 MUTATIONS", () => {
  for (const [name, entry] of Object.entries(tierCommands)) {
    if (entry.local) continue;
    assert.equal(entry.method, COMMAND_SPEC[name].method, `${name} 的 method 与 spec 对不上`);
    assert.ok(METHODS.has(entry.method), `${name} 的 method ${entry.method} 不在 METHODS 里`);
    assert.equal(
      entry.mutation,
      MUTATIONS.has(entry.method),
      `${name}.mutation 与 MUTATIONS 对不上：分级表说它${entry.mutation ? "会" : "不会"}进撤销栈，代码说反了`,
    );
  }
});

test("tiers 的 level：L0 等价于「不是 mutation」，L2 等价于「要 approval」", () => {
  for (const [name, entry] of Object.entries(tierCommands)) {
    assert.match(entry.level, /^L[0-3]$/, `${name} 的 level 取值不合法：${entry.level}`);
    if (entry.local) continue;
    assert.equal(
      entry.level === "L0",
      !entry.mutation,
      `${name} 的 level 与 mutation 自相矛盾：L0 的定义就是「不改任何东西」`,
    );
    assert.equal(
      entry.level === "L2",
      entry.approval === true,
      `${name} 的 level 与 approval 自相矛盾：L2 的定义就是「每条 = 一次付费，必须先得到用户同意」`,
    );
  }
  // 闸不能空转：四档都得有人。
  const levels = new Set(Object.values(tierCommands).map((entry) => entry.level));
  assert.deepEqual([...levels].sort(), ["L0", "L1", "L2", "L3"]);
});

test("tiers 的 timeoutTier `wait` 正好是会排队的那 13 条写命令", () => {
  // 与 contract.test.mjs 里 page_away 那条闸同一个判定：会排队 = 手册必须列它，
  // 也 = 宿主拒 `--wait` 时模型要退回 `--request-id` 取结果的那一批。
  for (const [name, entry] of Object.entries(tierCommands)) {
    assert.ok(
      ["short", "long", "wait"].includes(entry.timeoutTier),
      `${name} 的 timeoutTier 取值不合法：${entry.timeoutTier}`,
    );
    const queues =
      MUTATIONS.has(COMMAND_SPEC[name].method) || name === "upload" || name === "timeline";
    assert.equal(
      entry.timeoutTier === "wait",
      queues,
      `${name} 的 timeoutTier 与「页面不在时会不会排队」对不上`,
    );
    if (entry.timeoutTier === "wait")
      for (const flag of ["wait", "wait-ms"])
        assert.ok(
          COMMAND_SPEC[name].flags.includes(flag),
          `${name} 标了 timeoutTier:"wait"，但它根本不收 --${flag}`,
        );
  }
  // 注意 `short` 里的只读命令也收 --wait（它们走 call()），但页面不在时 5 秒就回
  // `page_away` 且没排队 —— 所以「收不收 --wait」不能反过来推 timeoutTier，
  // 真正的判定是上面那条「会不会排队」。
  const long = Object.keys(tierCommands)
    .filter((name) => tierCommands[name].timeoutTier === "long")
    .sort();
  assert.deepEqual(
    long,
    ["download", "frames", "inspect-media"],
    'timeoutTier:"long" 是「媒体分片传输，宿主超时要放宽」那一档，不是别的',
  );
  for (const name of long)
    assert.equal(tierCommands[name].local, true, `${name} 标了 long，但它不是本地媒体命令`);
});
