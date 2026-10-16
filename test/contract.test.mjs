import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  allocateIdentityColors,
  CANVAS_CONTRACT,
  DOCUMENTS,
  DRAFT_KEYS,
  formatScene3dSummary,
  LOCAL_TOOLS,
  PAGE_AWAY,
  SCENE3D,
  scene3dColorLabel,
  scene3dDefaultColor,
  scene3dIdentityColor,
  scene3dIsIdentityColor,
  scene3dObjectIdentity,
} from "../src/contract.mjs";
import { IDENTITY_PALETTE } from "../src/scene3d-identity.mjs";
import { exitCode } from "../src/cli.mjs";
import { HOST_TEXT } from "../src/host-text.mjs";
import { SCENE3D_CUT_EXEMPTION_LABELS } from "../src/scene3d-labels.mjs";
import {
  COMMAND_FIELDS,
  DOCUMENT_CONTENT_MAX_CHARS,
  DOCUMENT_ID_MAX_LENGTH,
  DOCUMENTS_GET_FIELDS,
  DOCUMENTS_LIST_FIELDS,
  DOCUMENTS_PUT_FIELDS,
  JIANYING_ROOTS_TOUCH_FIELDS,
  MAIN_METHODS,
  READ_METHODS,
  RUN_STILLS_FIELDS,
  RUN_STILLS_SHOTS_MAX,
  SCENE3D_ACTION_FIELDS,
  SCENE3D_ACTIONS_MAX,
  SCENE3D_STILL_FRAMES,
  WORKER_BLOCKED_COMMANDS,
  enforceRequestPolicy,
} from "../src/policy.mjs";
import { COMMAND_SPEC } from "../src/spec.mjs";
import { METHODS, MUTATIONS } from "../src/common.mjs";
import { packageRoot } from "./helpers.mjs";

/**
 * 契约的闸门 —— 与 `spec.test.mjs` 同一个形状，只是它钉的是 CLI flag，这里钉的是
 * 页面侧的命令本身。
 *
 * 每一条断言都是**双向**的：契约里有的必须在代码里，代码里有的必须在契约里。
 * 单向断言挡不住真正会出事的那一半 —— `realPersonMode` 从模型下线时，白名单里
 * 「多出来一个键」没有任何关卡，于是 Agent 写它拿到 `ok:true`、值却在下一次
 * coerce 时消失（tests/studio/canvas-agent-bridge.test.ts 仍在跑那条）。
 *
 * 比对的对象是 apps/web 的源码文本，不是它的运行时：页面侧是 TypeScript，联合类型
 * 在运行时枚举不出来，而这个包是纯 Node、不编译 TS。所以这里做的是受控的源码提取 ——
 * 先剥注释再按括号深度扫描，只认「命令联合的成员」「coerce 里读的 raw.X」
 * 「applyXDraft 里的 "k" in draft」这三种结构极稳定的形状。
 * 提取不到东西时一律 fail，绝不静默跳过：一个悄悄空转的闸门比没有闸门更糟。
 */

const repoRoot = path.resolve(packageRoot, "..", "..");
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

const BRIDGE = "apps/web/libs/canvas/agent-bridge";
const typesSrc = read(`${BRIDGE}/types.ts`);
const applySrc = read(`${BRIDGE}/apply.ts`);
const uploadSrc = read(`${BRIDGE}/upload.ts`);
const commandsSrc = read("apps/web/libs/canvas/commands.ts");
const canvasTypesSrc = read("apps/web/libs/canvas/types.ts");
const layoutSrc = read("apps/web/libs/canvas/layout-align.ts");
const canvasTidySrc = read("apps/web/libs/canvas/canvas-tidy.ts");
// 并发上限常量随 B4 从 batch-run.ts 挪到了 batch-watch.ts（画布首包只带执行侧小件）
const batchSrc = read("apps/web/libs/canvas/batch-watch.ts");
const taskFeedSrc = read("apps/web/libs/runtime/agent-task-feed.ts");
const policySrc = readFileSync(path.join(packageRoot, "src", "policy.mjs"), "utf8");

/* ─────────────────────────────── 源码提取 ─────────────────────────────── */

/**
 * 注释换成等长空白：下标不变，所以剥完注释之后所有正则的位置仍然对得上原文。
 * 必须先剥再扫 —— 注释里的撇号（`the nodes' bounding box`）会被当成字符串起点，
 * 一路吞掉半个文件。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (hit) => hit.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (hit) => " ".repeat(hit.length));
}

const applyClean = stripComments(applySrc);
const typesClean = stripComments(typesSrc);
const canvasTypesClean = stripComments(canvasTypesSrc);
const commandsClean = stripComments(commandsSrc);

/** 从 `at` 处的引号开始，返回配对引号的下标（认转义）。 */
function endOfString(text, at) {
  const quote = text[at];
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === quote) return i;
  }
  throw new Error(`未闭合的字符串字面量 @${at}`);
}

/** 每个字符所处的括号深度；字符串整段按起始深度算，引号里的括号不计。 */
function depthMap(text) {
  const out = new Array(text.length).fill(0);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = endOfString(text, i);
      for (let j = i; j <= end; j++) out[j] = depth;
      i = end;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      out[i] = depth;
      depth++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      out[i] = depth;
      continue;
    }
    out[i] = depth;
  }
  return out;
}

/** `export type NAME = …;` 或内部 type NAME 的右边（不含分号）。扫到顶层分号就停，绝不越过声明本身。 */
function typeBody(clean, name) {
  const head = "type " + name + " =";
  const at = clean.indexOf(head);
  assert.ok(at >= 0, `源码里找不到 ${name}`);
  const from = at + head.length;
  let depth = 0;
  for (let i = from; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(clean, i);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === ";" && depth === 0) return clean.slice(from, i);
  }
  throw new Error(`${name} 没有以分号结束`);
}

/** 顶层 `|` 切开的联合成员。 */
function unionMembers(body) {
  const depth = depthMap(body);
  const parts = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '"' || body[i] === "'" || body[i] === "`") {
      i = endOfString(body, i);
      continue;
    }
    if (body[i] === "|" && depth[i] === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** 字符串字面量联合（`"a" | "b"`）的取值，按声明顺序。 */
function literalUnion(source, name) {
  const values = unionMembers(typeBody(source, name)).map((part) => {
    const m = /^"([^"]+)"$/.exec(part);
    assert.ok(m, `${name} 的成员 ${part} 不是字符串字面量`);
    return m[1];
  });
  assert.ok(values.length > 0, `${name} 提取为空`);
  return values;
}

/** 一个对象类型成员的顶层字段名，分成必填与可选两组。 */
function memberFields(member) {
  const open = member.indexOf("{");
  const close = member.lastIndexOf("}");
  assert.ok(open >= 0 && close > open, `联合成员不是对象类型：${member.slice(0, 60)}`);
  const body = member.slice(open + 1, close);
  const depth = depthMap(body);
  const required = [];
  const optional = [];
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*(\?)?\s*:/g)) {
    if (depth[m.index] !== 0) continue;
    (m[2] ? optional : required).push(m[1]);
  }
  return { required, optional };
}

/** `const NAME = { … };` 顶层的键名（值里的 `foo:` 不算）。 */
function declaredKeys(clean, name) {
  const head = `const ${name} = {`;
  const at = clean.indexOf(head);
  assert.ok(at >= 0, `源码里找不到 ${name}`);
  const open = at + head.length - 1;
  let depth = 0;
  let body;
  for (let i = open; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(clean, i);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) {
        body = clean.slice(open + 1, i);
        break;
      }
    }
  }
  assert.ok(body !== undefined, `${name} 的对象字面量没有闭合`);
  const depths = depthMap(body);
  const keys = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)]
    .filter((hit) => depths[hit.index] === 0)
    .map((hit) => hit[1]);
  assert.ok(keys.length > 0, `${name} 提取为空`);
  return keys;
}

/** `function NAME(` 的函数体（不含最外层大括号）。配平到自己的右括号就停。 */
function functionBody(clean, name) {
  const at = clean.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `源码里找不到 function ${name}`);
  const open = clean.indexOf("{", clean.indexOf(")", at));
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(clean, i);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) return clean.slice(open + 1, i);
    }
  }
  throw new Error(`${name} 的函数体没有闭合`);
}

/* ─────────────────────────── 19 条命令：双向 ─────────────────────────── */

/** `AgentCommand` 联合：命令名 → 它声明的必填 / 可选字段。 */
function unionCommands() {
  const out = new Map();
  for (const member of unionMembers(typeBody(typesClean, "AgentCommand"))) {
    const type = /\btype\s*:\s*"([a-z][a-z0-9_]*)"/.exec(member);
    assert.ok(type, `联合成员没有字面量 type：${member.slice(0, 60)}`);
    const { required, optional } = memberFields(member);
    out.set(type[1], {
      required: required.filter((field) => field !== "type"),
      optional,
    });
  }
  return out;
}

/** `coerceAgentCommand` 里每个 `case` 分支真正读到的 `raw.X`。 */
function coercerFields() {
  const body = functionBody(applyClean, "coerceAgentCommand");
  const out = new Map();
  const cases = [...body.matchAll(/case\s+"([a-z][a-z0-9_]*)"\s*:/g)];
  assert.ok(cases.length > 0, "coerceAgentCommand 里一个 case 都没提取到");
  for (const [i, hit] of cases.entries()) {
    const end = i + 1 < cases.length ? cases[i + 1].index : body.length;
    const block = body.slice(hit.index, end);
    out.set(hit[1], new Set([...block.matchAll(/\braw\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1])));
  }
  return out;
}

test("契约的命令集合与 AgentCommand 联合互为子集（30 条，一条不多一条不少）", () => {
  const union = unionCommands();
  assert.equal(union.size, 30, "AgentCommand 提取到的命令数变了，契约要一起改");
  assert.deepEqual(
    Object.keys(CANVAS_CONTRACT.commands).sort(),
    [...union.keys()].sort(),
    "契约与 AgentCommand 联合的命令集合不一致",
  );
});

test("每条命令的必填 / 可选字段与联合里的 `?` 逐字一致", () => {
  const union = unionCommands();
  for (const [type, entry] of Object.entries(CANVAS_CONTRACT.commands)) {
    const declared = union.get(type);
    assert.deepEqual(
      [...entry.required].sort(),
      [...declared.required].sort(),
      `${type}: 必填字段与 types.ts 不一致`,
    );
    assert.deepEqual(
      [...entry.optional].sort(),
      [...declared.optional].sort(),
      `${type}: 可选字段与 types.ts 不一致`,
    );
  }
});

test("契约的字段就是 coerceAgentCommand 真正读的键", () => {
  // 「类型上写了、coerce 根本不读」和「coerce 读了、类型上没有」都是漂移：前者是
  // 静默丢弃（v2 §1 那批事故的形状），后者是没进类型的暗门。
  const coercer = coercerFields();
  assert.equal(coercer.size, 30, "apply.ts 的 case 数量与 30 条命令对不上");
  for (const [type, entry] of Object.entries(CANVAS_CONTRACT.commands)) {
    assert.deepEqual(
      [...entry.fields].sort(),
      [...coercer.get(type)].sort(),
      `${type}: 契约字段与 apply.ts 里读的 raw.X 不一致`,
    );
  }
});

test("契约的字段表就是守护进程「多给即报错」用的那张表（同一个对象）", () => {
  for (const [type, entry] of Object.entries(CANVAS_CONTRACT.commands)) {
    assert.deepEqual([...entry.fields], [...COMMAND_FIELDS[type]], `${type}: 字段表漂了`);
    assert.deepEqual(
      [...entry.required, ...entry.optional].sort(),
      [...entry.fields].sort(),
      `${type}: required + optional 必须正好覆盖 fields`,
    );
  }
  assert.deepEqual(Object.keys(CANVAS_CONTRACT.commands), Object.keys(COMMAND_FIELDS));
  // 上面几个提取器按这个字符集认命令名：`scene3d_apply` 之前它们只认 `[a-z_]+`，带数字的名字
  // 会被静默跳过（联合成员「没有字面量 type」、case 的 raw.X 记到上一条名下）。以后再有别的
  // 字符，先在这里红，而不是让提取器悄悄少认一条。
  for (const type of Object.keys(COMMAND_FIELDS))
    assert.match(type, /^[a-z][a-z0-9_]*$/, `${type}: 命令名超出了提取器认的字符集`);
});

const contractSrc = readFileSync(path.join(packageRoot, "src", "contract.mjs"), "utf8");
const contractClean = stripComments(contractSrc);

test("REQUIRED_FIELDS 的键集就是命令集，每个必填字段都在字段表里", () => {
  // 这两条原来是 contract.mjs 顶层 `buildCommands()` 里的 throw。页面侧 apply.ts
  // 只 import 本模块的 DRAFT_KEYS，顶层建表就意味着两张表哪天对不上是**浏览器
  // chunk 求值时**抛异常（画布整块不加载），而它本该只是这里的一条红。
  assert.deepEqual(
    declaredKeys(contractClean, "REQUIRED_FIELDS").sort(),
    Object.keys(COMMAND_FIELDS).sort(),
    "REQUIRED_FIELDS 与 COMMAND_FIELDS 的命令集不一致：加命令时两张表必须一起改",
  );
  for (const [type, entry] of Object.entries(CANVAS_CONTRACT.commands))
    for (const key of entry.required)
      assert.ok(entry.fields.includes(key), `${type}.${key} 必填，却不在 COMMAND_FIELDS 里`);
});

test("commands 是惰性的：import contract.mjs 本身不建表", () => {
  // 惰性是这条链的唯一目的：DRAFT_KEYS 的消费方（页面）不该为命令表的一次笔误付账。
  const descriptor = Object.getOwnPropertyDescriptor(CANVAS_CONTRACT, "commands");
  assert.equal(typeof descriptor.get, "function", "commands 又变回了顶层求值的普通字段");
  assert.equal(descriptor.enumerable, true);
  // 惰性不能改变消费方看到的东西：序列化后仍是同一张表。
  assert.deepEqual(JSON.parse(JSON.stringify(CANVAS_CONTRACT)).commands, CANVAS_CONTRACT.commands);
});

/* ──────────────────────────── draft 键：双向 ──────────────────────────── */

/** `applyXDraft` 里每一条 `"key" in draft`，按首次出现排序、去重
 *  （`outputUrl` / `content` 在 applyGenDraft 末尾还要再判一次「是不是设了输出」）。 */
function draftKeysRead(fn) {
  const body = functionBody(commandsClean, fn);
  const keys = [
    ...new Set([...body.matchAll(/"([A-Za-z_$][\w$]*)"\s+in\s+draft/g)].map((m) => m[1])),
  ];
  assert.ok(keys.length > 0, `${fn} 里一个 draft 键都没提取到`);
  return keys;
}

test("DRAFT_KEYS 覆盖的 kind 恰好是画布节点的全部 kind", () => {
  // applyNodeDraft 对每种有可写字段的 kind 各有一条分支；`group` 是唯一没有分支的
  // （它原样返回），所以也是唯一允许「有键、没分支」的那一个。
  const dispatched = [
    ...new Set(
      [...functionBody(commandsClean, "applyNodeDraft").matchAll(/node\.kind === "([\w-]+)"/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  assert.ok(dispatched.length > 0, "applyNodeDraft 里一个 kind 都没提取到");
  assert.deepEqual(
    Object.keys(DRAFT_KEYS).sort(),
    [...dispatched, "group"].sort(),
    "DRAFT_KEYS 的 kind 集合与 applyNodeDraft 的分支对不上",
  );
  assert.deepEqual(DRAFT_KEYS, CANVAS_CONTRACT.draftKeys);
});

/** 标签两键由 `applyTagsDraft` 统一读（四种 kind 共用），不在各 kind 的 applier 里。 */
const tagKeys = () => draftKeysRead("applyTagsDraft");

test("标签键就是 applyTagsDraft 读的那两个，且 splitTagDraft 用同一张表拆", () => {
  const TAG_KEYS = tagKeys();
  assert.deepEqual(TAG_KEYS, ["assetTags", "assetTagColors"]);
  const declared = /const TAG_DRAFT_KEYS = \[([^\]]*)\] as const;/.exec(commandsClean);
  assert.ok(declared, "找不到 TAG_DRAFT_KEYS");
  assert.deepEqual(
    [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    TAG_KEYS,
  );
});

test("Agent 能新建的三种 kind，白名单 = applyXDraft 真正读的键 + 标签键，逐字一致", () => {
  const TAG_KEYS = tagKeys();
  // 少一个 = 合法的写被拒；多一个 = 写了但没生效（`realPersonMode` 那次）。
  for (const [kind, fn] of [
    ["gen", "applyGenDraft"],
    ["media-upload", "applyMediaDraft"],
    ["scene-3d", "applyScene3dDraft"],
  ]) {
    assert.deepEqual(
      [...DRAFT_KEYS[kind]],
      [...draftKeysRead(fn), ...TAG_KEYS],
      `${kind} 的 draft 白名单漂了`,
    );
  }
  // 白名单里除标签外还有键的 kind，就是 `AgentNodeKind`：Agent 能建的那三种。
  assert.deepEqual(
    Object.keys(DRAFT_KEYS)
      .filter((kind) => DRAFT_KEYS[kind].some((key) => !TAG_KEYS.includes(key)))
      .sort(),
    [...literalUnion(typesClean, "AgentNodeKind")].sort(),
  );
});

test("group 只开放标签键；两个迁移遗留 kind 的白名单必须是空的", () => {
  const TAG_KEYS = tagKeys();
  // 组是装饰性容器，Agent 唯一能写的是分类标签（人物设定 / 场景设定 / epNN……）。
  assert.deepEqual([...DRAFT_KEYS.group], TAG_KEYS, "group 的白名单只能是标签两键");
  // image-gen / video-gen 的 applier 其实读键，白名单仍然留空：它们不在
  // AgentNodeKind 里，Agent 建不出也不该改，空白名单 = 任何 draft 都拒。
  // 这条断言存在是为了让「顺手把键抄进去」这个动作先撞上一次红。
  for (const kind of ["image-gen", "video-gen"])
    assert.deepEqual(DRAFT_KEYS[kind], [], `${kind} 的白名单必须为空`);
  const creatable = literalUnion(typesClean, "AgentNodeKind");
  for (const kind of ["image-gen", "video-gen"])
    assert.equal(creatable.includes(kind), false, `${kind} 不该出现在 AgentNodeKind 里`);
  assert.notDeepEqual(draftKeysRead("applyImageDraft"), []);
  assert.notDeepEqual(draftKeysRead("applyVideoDraft"), []);
});

/* ────────────────────────── 枚举与区间：双向 ────────────────────────── */

/** `export const NAME = [ … ] as const;` 的取值。 */
function constArray(source, name) {
  const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(source);
  assert.ok(m, `找不到 ${name}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((hit) => hit[1]);
}

test("每个枚举 / 区间的键都指向一条真命令的真字段", () => {
  for (const key of [
    ...Object.keys(CANVAS_CONTRACT.enums),
    ...Object.keys(CANVAS_CONTRACT.ranges),
  ]) {
    const [type, field] = key.split(".");
    const entry = CANVAS_CONTRACT.commands[type];
    assert.ok(entry, `${key}: ${type} 不是一条命令`);
    assert.ok(entry.fields.includes(field), `${key}: ${type} 没有字段 ${field}`);
  }
});

test("枚举取值与源码里的那张表逐字一致", () => {
  const bridgeTypes = typesClean;
  assert.deepEqual(
    CANVAS_CONTRACT.enums["add_node.kind"],
    literalUnion(bridgeTypes, "AgentNodeKind"),
  );
  assert.deepEqual(
    CANVAS_CONTRACT.enums["edit_text.field"],
    literalUnion(bridgeTypes, "AgentTextField"),
  );
  assert.deepEqual(
    CANVAS_CONTRACT.enums["connect.targetHandle"],
    literalUnion(canvasTypesClean, "EdgeTargetHandle"),
  );
  assert.deepEqual(
    CANVAS_CONTRACT.enums["arrange.layout"],
    constArray(layoutSrc, "ARRANGE_LAYOUTS"),
  );
  assert.deepEqual(CANVAS_CONTRACT.enums["align.mode"], constArray(layoutSrc, "ALIGN_MODES"));
  assert.deepEqual(CANVAS_CONTRACT.enums["tidy.scope"], constArray(canvasTidySrc, "TIDY_SCOPES"));
  // duplicate_node.layout 没有具名常量，判定就写在 coerce 里。
  for (const value of CANVAS_CONTRACT.enums["duplicate_node.layout"])
    assert.match(applySrc, new RegExp(`layout !== "${value}"`));
});

test("每个区间 / 上限的数字都能在它声称的那行代码里找到", () => {
  // 一条一条对着判定写死。少了任何一条，契约就变回了「没人核对的文档」。
  const evidence = [
    [
      "ranges",
      "arrange.gap",
      "min",
      applySrc,
      /value < (\d)\) \{\s*throw invalid\("expected non-negative/,
    ],
    [
      "ranges",
      "arrange.columns",
      "min",
      applySrc,
      /columns < (\d)\) throw invalid\("expected >= 1"/,
    ],
    ["ranges", "align.nodeIds", "min", layoutSrc, /ALIGN_MIN_NODES = (\d+);/],
    ["ranges", "align.nodeIds", "minForDistribute", layoutSrc, /DISTRIBUTE_MIN_NODES = (\d+);/],
    ["ranges", "duplicate_node.count", "max", applySrc, /DUPLICATE_MAX = (\d+);/],
    ["ranges", "duplicate_node.count", "default", applySrc, /command\.count \?\? (\d+);/],
    ["ranges", "focus_node.fill", "exclusiveMin", applySrc, /!\(fill > (\d)\)/],
    ["ranges", "focus_node.fill", "max", applySrc, /fill > 0\) \|\| fill > (\d)\)/],
    ["ranges", "focus_node.fill", "default", applySrc, /command\.fill \?\? ([\d.]+)/],
    ["ranges", "set_viewport.viewport.zoom", "exclusiveMin", applySrc, /zoom <= (\d)\)/],
    ["limits", "apply.commands", "max", policySrc, /params\.commands\.length > (\d+)/],
    ["limits", "run_nodes.nodeIds", "max", policySrc, /nodeIds\.length > (\d+) \|\|/],
    ["limits", "run_nodes.nodeIds", "itemMaxLength", policySrc, /id\.length > (\d+)/],
    ["limits", "run_nodes.concurrency", "min", policySrc, /params\.concurrency < (\d+)/],
    ["limits", "run_nodes.concurrency", "max", policySrc, /params\.concurrency > (\d+)/],
    ["limits", "run_nodes.concurrency", "default", batchSrc, /BATCH_CONCURRENCY_DEFAULT = (\d+);/],
    ["limits", "run_nodes.concurrency", "max", batchSrc, /BATCH_CONCURRENCY_MAX = (\d+);/],
    ["limits", "update_node.draft.assetTags", "max", commandsSrc, /NODE_TAG_MAX = (\d+);/],
    [
      "limits",
      "update_node.draft.assetTags",
      "itemMaxLength",
      commandsSrc,
      /NODE_TAG_MAX_LENGTH = (\d+);/,
    ],
    [
      "limits",
      "run_nodes.approval.userApprovedNodeIds",
      "max",
      policySrc,
      /approval\.userApprovedNodeIds\.length > (\d+)/,
    ],
    // v3 §12 tasks：守护进程挡的数字与页面 / 服务端的常量必须是同一个。
    ["limits", "tasks.limit", "max", policySrc, /params\.limit < 1 \|\| params\.limit > (\d+)/],
    ["limits", "tasks.limit", "max", taskFeedSrc, /AGENT_TASKS_MAX_LIMIT = (\d+);/],
    ["limits", "tasks.limit", "default", taskFeedSrc, /AGENT_TASKS_DEFAULT_LIMIT = (\d+);/],
    ["limits", "tasks.nodeIds", "max", policySrc, /\["nodeIds", (\d+)\]/],
    // scene3d@1：动作数上限只在 policy 写一处；`run --shot` 的镜头 id 长度。
    ["limits", "scene3d_apply.actions", "max", policySrc, /SCENE3D_ACTIONS_MAX = (\d+);/],
    ["limits", "run_node.shotId", "maxLength", policySrc, /params\.shotId\.length > (\d+)/],
    // 0.17.0：多镜出片的镜头清单（CC-L2：三条都指向 policy 的判定）。
    ["limits", "run_node.shotIds", "min", policySrc, /params\.shotIds\.length < (\d+)/],
    ["limits", "run_node.shotIds", "max", policySrc, /RUN_NODE_SHOT_IDS_MAX = (\d+);/],
    [
      "limits",
      "run_node.shotIds",
      "itemMaxLength",
      policySrc,
      /params\.shotIds\.some\(\(id\) => [^;]*id\.length > (\d+)\)/,
    ],
    // 0.16.2 run-stills：镜头清单的条数与单个 id 的长度，守护进程那一行。
    ["limits", "run_stills.shotIds", "max", policySrc, /RUN_STILLS_SHOTS_MAX = (\d+);/],
    [
      "limits",
      "run_stills.shotIds",
      "itemMaxLength",
      policySrc,
      /\(shotId\) => typeof shotId !== "string" \|\| !shotId\.trim\(\) \|\| shotId\.length > (\d+)/,
    ],
  ];
  for (const [table, key, field, source, pattern] of evidence) {
    const hit = pattern.exec(source);
    assert.ok(hit, `${key}.${field}: 判定 ${pattern} 已经不在源码里了`);
    assert.equal(
      CANVAS_CONTRACT[table][key][field],
      Number(hit[1]),
      `${key}.${field} 与源码里的判定对不上`,
    );
  }
  assert.equal(CANVAS_CONTRACT.limits["gen.candidates"], undefined);
  assert.equal(CANVAS_CONTRACT.limits["gen.videoCandidates"], undefined);
  // 25 MB 的上限写成乘法，单独对。
  const cap = /UPLOAD_MAX_BYTES = (\d+) \* 1024 \* 1024;/.exec(uploadSrc);
  assert.ok(cap, "upload.ts 的 UPLOAD_MAX_BYTES 形状变了");
  assert.equal(
    CANVAS_CONTRACT.ranges["upload_asset.bytesBase64"].maxDecodedBytes,
    Number(cap[1]) * 1024 * 1024,
  );
  // run_node 与 run_nodes 的授权清单共用同一套判定，别让它们悄悄分叉。
  assert.deepEqual(
    CANVAS_CONTRACT.limits["run_node.approval.userApprovedNodeIds"],
    CANVAS_CONTRACT.limits["run_nodes.approval.userApprovedNodeIds"],
  );
  // 「给了就必须非空」的三处：arrange / tidy 的两个 id 列表。
  for (const key of ["arrange.nodeIds", "tidy.nodeIds", "tidy.groupIds"])
    assert.equal(CANVAS_CONTRACT.ranges[key].min, 1, `${key} 的下界必须是 1`);
  assert.match(applySrc, /nodeIds\?\.length === 0\) throw invalid\("expected at least one node"/);
  assert.match(applySrc, /groupIds\?\.length === 0\) throw invalid\("expected at least one group"/);
  assert.equal(CANVAS_CONTRACT.limits["apply.commands"].min, 1);
  assert.match(policySrc, /params\.commands\.length === 0/);
});

/* ──────────────────────────── changes：双向 ──────────────────────────── */

test("changes 的四组取值与 agent-bridge/types.ts 的联合逐字一致", () => {
  // 双向：页面加一档 actor（比如把自动写入从 human 里分出来）而契约没跟，下游
  // 就会继续把页面自己的动作当成用户的；契约多一档而页面没有，下游会去分支一个
  // 永远不出现的值。两边都必须红。
  assert.deepEqual(CANVAS_CONTRACT.changes.actors, literalUnion(typesClean, "ChangeActor"));
  assert.deepEqual(CANVAS_CONTRACT.changes.kinds, literalUnion(typesClean, "ChangeEntryKind"));
  assert.deepEqual(CANVAS_CONTRACT.changes.notes, literalUnion(typesClean, "ChangeNote"));
  assert.deepEqual(
    CANVAS_CONTRACT.changes.truncatedReasons,
    literalUnion(typesClean, "ChangesTruncatedReason"),
  );
});

/**
 * 游标的两半必须在**每一处**都同时存在：页面的请求 / 回包类型、`snapshot` 的回包、
 * CLI 的 flag 与参数映射。少任何一处，Agent 就只能发出一个裸序号 —— 而一个裸序号
 * 在刷新之后与「什么都没发生」逐字相同，正是这条契约存在的原因。
 */
test("changes.cursor 的四个名字与两个 flag 在页面与 CLI 两侧都真的存在", () => {
  const { cursor } = CANVAS_CONTRACT.changes;
  const changesSrc = stripComments(read(`${BRIDGE}/changes.ts`));
  // ① 请求面：ChangesRequest 两个字段都在。
  const request = /export interface ChangesRequest \{([\s\S]*?)\n\}/.exec(typesClean);
  assert.ok(request, "ChangesRequest 形状变了");
  for (const field of [cursor.sinceSeq, cursor.sinceEpoch])
    assert.match(request[1], new RegExp(`\\b${field}\\?: `), `ChangesRequest 少了 ${field}`);
  // ② 回包面：ChangesResult 与 AgentSnapshot 都要给出 seq + epoch —— snapshot 不给
  //    epoch，「重新 snapshot 再接着走」就是个闭不上的圈（永远 feed_restarted）。
  const result = /export interface ChangesResult \{([\s\S]*?)\n\}/.exec(typesClean);
  assert.ok(result, "ChangesResult 形状变了");
  const snapshot = /export interface AgentSnapshot \{([\s\S]*?)\n\}/.exec(typesClean);
  assert.ok(snapshot, "AgentSnapshot 形状变了");
  for (const field of [cursor.seq, cursor.epoch]) {
    assert.match(result[1], new RegExp(`\\n  ${field}: `), `ChangesResult 少了 ${field}`);
    assert.match(snapshot[1], new RegExp(`\\n  ${field}: `), `AgentSnapshot 少了 ${field}`);
  }
  // ③ 页面真的产出 epoch，而且是每个实例一个。
  assert.match(changesSrc, /readonly epoch: string = newFeedEpoch\(\);/);
  // ④ CLI：两个 flag 在 spec 的白名单与 usage 里，`--since-epoch` 映射到 sinceEpoch。
  const cliSrc = stripComments(readFileSync(path.join(packageRoot, "src", "cli.mjs"), "utf8"));
  for (const flag of cursor.flags) {
    const bare = flag.replace(/^--/, "");
    assert.ok(COMMAND_SPEC.changes.flags.includes(bare), `spec 的 changes 不收 ${flag}`);
    assert.ok(COMMAND_SPEC.changes.usage.includes(flag), `changes 的 usage 没写 ${flag}`);
    assert.match(cliSrc, new RegExp(`"${bare}"`), `cli.mjs 的 FLAGS 白名单里没有 ${flag}`);
  }
  assert.match(cliSrc, /params\.sinceEpoch = String\(options\["since-epoch"\]\)/);
});

test("changes.cap 就是页面的 CHANGE_FEED_CAP", () => {
  const src = stripComments(read(`${BRIDGE}/changes.ts`));
  const m = /CHANGE_FEED_CAP\s*=\s*(\d+)/.exec(src);
  assert.ok(m, "找不到 CHANGE_FEED_CAP");
  assert.equal(CANVAS_CONTRACT.changes.cap, Number(m[1]));
});

test("truncatedReason 的两个值在页面 since() 里真的会被写出来", () => {
  // 只比联合类型挡不住「类型里有、代码永远不发」：feed_restarted 这一档的全部
  // 价值就在于它真的会在刷新之后出现。
  const src = stripComments(read(`${BRIDGE}/changes.ts`));
  for (const reason of CANVAS_CONTRACT.changes.truncatedReasons) {
    assert.match(src, new RegExp(`"${reason}"`), `changes.ts 从不产出 ${reason}`);
  }
  // 重启的判据必须比 **epoch**，不能只比序号：刷新后的新 feed 一旦攒过头，
  // `from > lastSeq` 就为假，于是回一份看着连续的增量，把刷新前后的历史接在一起。
  assert.match(src, /sinceEpoch\s*!==\s*this\.epoch/);
  assert.match(src, /since\(sinceSeq\?: number, sinceEpoch\?: string\)/);
});

/* ────────────────────────── 错误码与版本：双向 ────────────────────────── */

test("bridgeErrors 与 AgentErrorCode 联合互为子集", () => {
  const codes = literalUnion(typesClean, "AgentErrorCode");
  assert.deepEqual(Object.keys(CANVAS_CONTRACT.bridgeErrors).sort(), [...codes].sort());
});

test("retryable 为真的恰好是 RETRYABLE_ERROR_CODES 里的那几个", () => {
  // 退出码 1 以前把「等一会儿自己会好」和「绝不可重试」装在同一个桶里，下游模型
  // 据此空转甚至重复付费。契约把这个布尔发出去，就得跟页面的集合完全一致。
  const set = /RETRYABLE_ERROR_CODES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(typesClean);
  assert.ok(set, "找不到 RETRYABLE_ERROR_CODES");
  const retryable = [...set[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(retryable.length > 0, "RETRYABLE_ERROR_CODES 提取为空");
  assert.deepEqual(
    Object.entries(CANVAS_CONTRACT.bridgeErrors)
      .filter(([, entry]) => entry.retryable)
      .map(([code]) => code)
      .sort(),
    [...retryable].sort(),
  );
});

test("0.16.1 的两个页面码（render_interrupted / collab_offline）可重试，且不进 cliExitCodes：退出码落兜底桶 1", () => {
  for (const code of ["render_interrupted", "collab_offline"]) {
    assert.equal(CANVAS_CONTRACT.bridgeErrors[code]?.retryable, true, code);
    assert.equal(Object.hasOwn(CANVAS_CONTRACT.cliExitCodes, code), false, code);
    assert.equal(exitCode({ ok: false, error: { code } }), 1, code);
  }
});

test("cliExitCodes 逐条就是 cli.mjs 的 exitCode() 的答案", () => {
  // 行为验，不是抄清单：直接拿真函数问。契约给 3 而 CLI 其实退 1，这里就红。
  for (const [code, expected] of Object.entries(CANVAS_CONTRACT.cliExitCodes)) {
    assert.equal(exitCode({ ok: false, error: { code } }), expected, `${code} 的退出码对不上`);
    assert.notEqual(expected, 1, `${code}：1 是兜底桶，列进表里没有信息`);
  }
  assert.equal(exitCode({ ok: true }), 0);
  assert.equal(exitCode({ ok: false, error: { code: "run_failed" } }), 1);
});

test("exitCode() 里点名的每个码都必须在 cliExitCodes 里，反之亦然", () => {
  // 缺的这一条正是本表原来的漏洞：`errors` 自称全集却只有页面那 21 个，
  // 而 `not_connected` 这类最常撞上的连接码一个都没有 —— 消费方直接 TypeError。
  // 单向断言挡不住漂移：cli.mjs 新增一个码而契约没跟上，必须在这里红。
  const cliSrc = readFileSync(path.join(packageRoot, "src", "cli.mjs"), "utf8");
  const body = functionBody(stripComments(cliSrc), "exitCode");
  const named = [...new Set([...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))];
  assert.ok(named.length > 10, "exitCode() 的形状变了，码提取为空");
  assert.deepEqual(named.sort(), Object.keys(CANVAS_CONTRACT.cliExitCodes).sort());
});

test("两张错误码表在重叠的码上不打架", () => {
  // `too_large` / `approval_required` / `unknown_outcome` 页面和 CLI 都会发。
  // 页面独有的码必须落进兜底桶 1，否则说明 exitCode() 改了而契约的分类没跟。
  const shared = Object.keys(CANVAS_CONTRACT.bridgeErrors).filter(
    (code) => code in CANVAS_CONTRACT.cliExitCodes,
  );
  assert.deepEqual(shared.sort(), ["approval_required", "too_large", "unknown_outcome"]);
  for (const code of Object.keys(CANVAS_CONTRACT.bridgeErrors))
    if (!shared.includes(code)) assert.equal(exitCode({ ok: false, error: { code } }), 1);
});

/* ─────────────── CLI 自己造的每个码都被分类过（不是抄清单） ─────────────── */

/**
 * `new CliError(<第一个实参>, …)` 第一个实参里出现的小写字符串字面量，按文件分组。
 * 只取第一个实参：`message` 里的字符串不是码。认得三种形状 —— 直接字面量、
 * 三元（`mutation ? "unknown_outcome" : "connection_failed"`）、`||` 兜底
 * （`result.error?.code || "request_failed"`）。转发上来的码（`message.error.error.code`）
 * 没有字面量，自然不在集合里，那是页面/子进程的码、不是本包造的。
 */
function constructedCliCodes() {
  const out = new Map();
  const dir = path.join(packageRoot, "src");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".mjs"))) {
    const clean = stripComments(readFileSync(path.join(dir, file), "utf8"));
    const codes = new Set();
    for (const hit of clean.matchAll(/new CliError\(/g)) {
      let depth = 0;
      for (let i = hit.index + hit[0].length; i < clean.length; i++) {
        const c = clean[i];
        if (c === '"' || c === "'" || c === "`") {
          const end = endOfString(clean, i);
          // 码是 snake_case 小写；`error.code === "ENOENT"` 这类判定条件不是码。
          const literal = clean.slice(i + 1, end);
          if (depth === 0 && /^[a-z][a-z_]*$/.test(literal)) codes.add(literal);
          i = end;
          continue;
        }
        if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        else if (c === ")") {
          if (depth === 0) break;
          depth--;
        } else if (c === "," && depth === 0) break;
      }
    }
    out.set(file, codes);
  }
  return out;
}

/**
 * 落进兜底桶 1 的码，逐个写清楚它为什么**不是**「参数或文件边界」。这不是豁免
 * 名单，而是分类的另一半：`src/*.mjs` 造出的每个码要么在 `cliExitCodes` 里，
 * 要么在这里，两处都没有就说明有人加了个没人分过类的码。
 */
const EXIT_ONE_CODES = {
  invalid_request: "守护进程 / 页面命名空间的载荷校验：请求本身不合法",
  invalid_response: "本地会话回了非 JSON —— 连上了，但答案不可解析",
  invalid_media: "页面回的媒体元数据或分片与自己的描述不符",
  media_tool_failed: "外部 ffmpeg / ffprobe 非零退出或被中断",
  tool_missing: "ffmpeg / ffprobe 没装或不在 PATH 上",
  scope_mismatch: "恢复回来的页面换了画布",
  resume_expired: "刷新恢复窗口过期，得建新连接",
  worker_forbidden: "worker 调了只有主会话能调的方法",
  delegate_not_found: "revoke 指向的 worker 不存在",
  session_limit: "会话额度（结果、请求 ID、委派数）用尽",
  request_failed: "页面回了 ok:false 却没给 code 时的兜底",
  patch_failed:
    "docs update --patch 的 unified diff 对不上文档当前的正文（参数本身合法，是内容变了）",
  doc_not_found:
    "docs read --folder 要的文件夹文档库里没有（或已经空了）—— 与页面桥的 doc_not_found 同一个意思",
  // run --out-dir 单项下载失败的 media_failed 现在是页面的码（经页面下载，B9-FX-07），CLI 不再自己造。
  timeout:
    "run --out-dir 开始下一项时 --await 预算已用完：只进 outputs[].pathError，run 本身照旧成功",
};

test("src/*.mjs 造的每个 CliError 码都被 cliExitCodes 或兜底桶清单分类过", () => {
  // 缺这条闸门的后果实测过：`invalid_name`（--name 长度）和 media 那五处
  // `invalid_request`（--node/--out/--out-dir/--x/--count）都是 CLI 本地的参数错，
  // 却因为不在表里退 1，而表自己声称 2 才是「参数或文件边界」。
  const codes = new Set([...constructedCliCodes().values()].flatMap((set) => [...set]));
  assert.ok(codes.size > 25, `CliError 码提取为空或形状变了（拿到 ${codes.size} 个）`);
  for (const code of codes) {
    const classified =
      code in CANVAS_CONTRACT.cliExitCodes ? CANVAS_CONTRACT.cliExitCodes[code] : 1;
    assert.equal(
      exitCode({ ok: false, error: { code } }),
      classified,
      `${code}: 契约的分类与 exitCode() 对不上`,
    );
    if (classified === 1)
      assert.ok(
        Object.hasOwn(EXIT_ONE_CODES, code),
        `${code} 谁都没分类：进 cliExitCodes（2/3/4），或写进 EXIT_ONE_CODES 说明它为什么是业务失败`,
      );
  }
  // 反向：清单不许腐烂 —— 里面每个码都必须真的还在 src/*.mjs 里被造出来。
  for (const code of Object.keys(EXIT_ONE_CODES)) {
    assert.ok(codes.has(code), `EXIT_ONE_CODES 里的 ${code} 已经没人构造了`);
    assert.equal(exitCode({ ok: false, error: { code } }), 1, `${code} 已经不在兜底桶里了`);
  }
});

test("invalid_request 只属于守护进程 / 载荷校验，不做 CLI 本地的参数码", () => {
  // CLI 本地的参数错必须用 invalid_argument（退 2）。用 invalid_request 会退 1，
  // 与页面「请求不合法」的码撞在同一个字段里，调用方分不出「我打错了参数」和
  // 「页面拒了这个请求」。common.mjs 的 assertJson/parseObject 与 daemon.mjs 是
  // 线协议那一侧，invalid_request 在那里才是对的。
  for (const [file, codes] of constructedCliCodes())
    if (!["daemon.mjs", "common.mjs"].includes(file))
      assert.equal(
        codes.has("invalid_request"),
        false,
        `${file}: CLI 本地校验用了 invalid_request（退 1），改成 invalid_argument`,
      );
});

test("契约声明的桥版本与线协议版本都来自代码", () => {
  const bridge = /readonly version: (\d+);/.exec(typesSrc);
  assert.ok(bridge, "SceneMintAgentBridge 的 version 形状变了");
  assert.equal(CANVAS_CONTRACT.bridgeVersion, Number(bridge[1]));
  const wire = /PROTOCOL_VERSION = (\d+);/.exec(policySrc);
  assert.equal(CANVAS_CONTRACT.protocolVersion, Number(wire[1]));
});

/* ─────────────────────── 页面侧确实用的是这份契约 ─────────────────────── */

test("apply.ts 的 DRAFT_KEYS 就是本包导出的那一份，页面没有第二张表", () => {
  // 搬家的意义全在这一条上：页面里再出现一份字面量白名单，这里就红。
  assert.match(
    applySrc,
    /import \{ DRAFT_KEYS as CONTRACT_DRAFT_KEYS \} from "[^"]*canvas-cli\/src\/contract\.mjs"/,
  );
  assert.match(
    applySrc,
    /const DRAFT_KEYS: Record<CanvasNode\["kind"\], readonly string\[\]> =\s*CONTRACT_DRAFT_KEYS;/,
  );
  assert.equal(/DRAFT_KEYS[^=\n]*=\s*\{/.test(applySrc), false, "apply.ts 里又出现了字面量白名单");
});

/* ───────────────────── 手册与契约对齐（随包发布的那份） ───────────────────── */

/**
 * 案底：`resize_group` 在引擎和桥里都存在，手册里一个字都没有，于是 Agent 猜
 * `move_node{size}` 被拒、猜 `update_node{draft:{width}}` 被静默丢弃，最后用
 * `delete_node` 删组框、连带删掉了框里 7 段成片。手册是 Agent 唯一读得到的东西，
 * 所以它漏一条命令和契约漏一条命令是同一级别的事故——这条闸把它钉死。
 */
const skillCommandsMd = readFileSync(
  path.join(packageRoot, "skills", "scenemint-canvas", "references", "commands.md"),
  "utf8",
);

test("技能手册的命令清单与 `### \\`type\\`` 小节，跟 COMMAND_FIELDS 一条不差", () => {
  const types = Object.keys(COMMAND_FIELDS).sort();
  // ① 「The N apply commands」那一段列出的 `add_node` · `update_node` · …
  const listed = /Exactly ([\w-]+) `type` values exist\.[\s\S]*?\n\n([\s\S]*?)\n\n/.exec(
    skillCommandsMd,
  );
  assert.ok(listed, "手册里「Exactly N `type` values exist」那一段不见了");
  const inline = [...listed[2].matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]).sort();
  assert.deepEqual(inline, types, "手册的命令清单与 COMMAND_FIELDS 对不上");
  const WORDS = {
    nineteen: 19,
    twenty: 20,
    "twenty-one": 21,
    "twenty-two": 22,
    "twenty-nine": 29,
    thirty: 30,
  };
  assert.equal(
    WORDS[listed[1]],
    types.length,
    `手册写着 ${listed[1]} 条命令，实际 ${types.length} 条`,
  );
  // ② 每条命令都得有自己的参考小节，不能只在清单里露个名字。
  const sections = [...skillCommandsMd.matchAll(/^### `([a-z][a-z0-9_]*)`$/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(sections, types, "手册的 `### `命令`` 小节与 COMMAND_FIELDS 对不上");
});

test("手册写到了新字段：resize_group.fit、tidy.scope 的三个取值、group_nodes 的 skipped", () => {
  // 字段进了 COMMAND_FIELDS 却没进手册 = Agent 永远不会用它（resize_group 的原案底）。
  for (const field of COMMAND_FIELDS.resize_group)
    assert.match(skillCommandsMd, new RegExp("`" + field + "`"), `手册没写 resize_group.${field}`);
  for (const scope of CANVAS_CONTRACT.enums["tidy.scope"])
    assert.match(skillCommandsMd, new RegExp("`" + scope + "`"), `手册没写 tidy --scope ${scope}`);
  assert.match(skillCommandsMd, /`fitFrames`/);
  assert.match(skillCommandsMd, /`skipped\[\]`/);
  // 删组框会级联删成员——这条必须成对写在 ungroup 旁边。
  const ungroup = /### `ungroup`[\s\S]*?(?=\n### )/.exec(skillCommandsMd);
  assert.ok(ungroup, "手册没有 ungroup 小节");
  assert.match(ungroup[0], /delete_node/, "ungroup 小节没有与 delete_node 成对的 ❌");
});

/**
 * 案底（本轮）：手册里命令条数两处打架——硬限制表仍写 nineteen，命令小节已改成
 * twenty，而 `resize_group` 正是第 20 条。旧的漂移闸只正则匹配「Exactly N `type`
 * values exist」那一句，抓不到硬限制表里的那句。弱模型先读硬限制表（在命令小节
 * 之前 300 多行），记住「只有十九条」，随后看到 `resize_group` 就当手册笔误，回头
 * 去猜 `move_node size` / `update_node draft.width`——正是删组框丢 7 段成片那条路径。
 */
test("手册里每一处写「命令有 N 条」的数词都等于 COMMAND_FIELDS 的条数", () => {
  const WORDS = {
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    "twenty-one": 21,
    "twenty-two": 22,
    "twenty-nine": 29,
    thirty: 30,
  };
  const expected = Object.keys(COMMAND_FIELDS).length;
  const patterns = [
    /one of the ([a-z-]+) names below/g,
    /Exactly ([a-z-]+) `type` values exist/g,
    /## The ([a-z-]+) apply commands/g,
  ];
  let seen = 0;
  for (const pattern of patterns) {
    const hits = [...skillCommandsMd.matchAll(pattern)];
    assert.ok(hits.length > 0, `手册里找不到 ${pattern} —— 这条闸在空转`);
    for (const hit of hits) {
      seen += 1;
      assert.equal(
        WORDS[hit[1]],
        expected,
        `手册写着 ${hit[1]} 条命令（"${hit[0]}"），实际 ${expected} 条`,
      );
    }
  }
  assert.ok(seen >= 3, "数词只匹配到不足三处，正则大概率失效了");
});

/**
 * 案底（本轮）：手册开头明令「argv 用 JSON 数组写，原样复制即可」，而本分支新增的
 * 「整理画布」是全文唯一用裸 shell 写的命令（5 处）。弱模型照抄 → argv 变成
 * `["scenemint-canvas tidy --scope all --fit-frames"]` → `Unknown command`，
 * 两种猜法都失败，最后退回它「会用」的 `tidy --all`，把用户手摆的整张画布重排。
 */
test("手册里没有裸 shell 形式的命令示例（argv 一律写 JSON 数组）", () => {
  const shellLines = skillCommandsMd
    .split("\n")
    .filter((line) => /^\s*(\$\s*)?scenemint-canvas\s+\S/.test(line));
  assert.deepEqual(shellLines, [], "这些行是裸 shell，弱模型会原样抄进 argv");
  // 反向：整理画布那几条确实以 argv 数组的形式在手册里。
  for (const argv of [
    '["tidy", "--scope", "all", "--fit-frames"]',
    '["tidy", "--scope", "groups", "--fit-frames"]',
    '["tidy", "--all"]',
    '["snapshot", "--limit", "2000"]',
  ])
    assert.ok(skillCommandsMd.includes(argv), `手册缺少 argv 示例 ${argv}`);
});

/**
 * 案底（本轮）：page_away 表教「写命令 … `--wait` 可一直等」，但 `tidy` / `upload`
 * 的 flags 是手抄的、不含 wait。表里那个「等」字必须展开成真实清单，并且清单里的
 * 每一条都得真的接受 --wait / --wait-ms。
 */
test("page_away 表列出的写命令，每一条都真的接受 --wait / --wait-ms", () => {
  const row = /\| 写（完整清单：([^）]*)）/.exec(skillCommandsMd);
  assert.ok(row, "page_away 表里的写命令行不见了（或不再是「完整清单」）");
  // `docs create` 这类两个词的子命令也是一个命令名（规格表的键带空格）。
  const listed = [...row[1].matchAll(/`([a-z][a-z -]*[a-z])`/g)].map((hit) => hit[1]);
  assert.ok(listed.length >= 10, `清单只列了 ${listed.length} 条，八成又被缩成「等」了`);
  for (const command of listed) {
    const entry = COMMAND_SPEC[command];
    assert.ok(entry, `手册列了不存在的命令 ${command}`);
    for (const flag of ["wait", "wait-ms"])
      assert.ok(entry.flags.includes(flag), `手册说 ${command} 可以 --${flag}，spec 里没有`);
  }
  // 会排队却没被列进表 = 手册漏教，同样要红。
  for (const [command, entry] of Object.entries(COMMAND_SPEC)) {
    const queues = MUTATIONS.has(entry.method) || command === "upload" || command === "timeline";
    if (queues) assert.ok(listed.includes(command), `${command} 会排队，page_away 表没列它`);
  }
  // 案底（本轮）：seedance 宿主硬拒 `--wait`（它的工具调用有超时，一个能阻塞十分钟的
  // 参数会挂死整轮对话），而手册说「写命令都能 --wait」。模型同时拿到两个相反答案，
  // 于是把宿主的拒绝当成自己参数写错，换着写法重试。手册必须自己说清这件事，并给出
  // 被拒时的退路（status + 同一个 --request-id 取结果）。
  const cell = row.input.slice(row.index).split("\n")[0];
  assert.match(cell, /宿主/, "page_away 表没写「宿主可能禁用 --wait」");
  assert.match(cell, /--request-id/, "page_away 表没给被宿主拒绝后的退路");
});

/**
 * 案底（本轮）：手册两处「硬上限 2000」和 snapshot.ts 的 `HARD_MAX_NODES` 之间
 * 没有任何绑定，常量随时可以漂走（改成 1_000_000 全仓绿）。
 */
test("手册里的 snapshot 硬上限就是 snapshot.ts 的 HARD_MAX_NODES", () => {
  const snapshotSrc = read(`${BRIDGE}/snapshot.ts`);
  const hit = /const HARD_MAX_NODES = ([\d_]+);/.exec(snapshotSrc);
  assert.ok(hit, "snapshot.ts 的 HARD_MAX_NODES 形状变了");
  const ceiling = Number(hit[1].replaceAll("_", ""));
  const skillMd = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  for (const [name, text] of [
    ["commands.md", skillCommandsMd],
    ["SKILL.md", skillMd],
  ]) {
    const mentions = [...text.matchAll(/(?:硬上限|上限|hard ceiling \*\*?)\s*\**(\d{3,})/g)].map(
      (m) => Number(m[1]),
    );
    assert.ok(mentions.length > 0, `${name} 不再提 snapshot 上限了 —— 这条闸在空转`);
    for (const value of mentions)
      assert.equal(value, ceiling, `${name} 写着上限 ${value}，代码是 ${ceiling}`);
  }
});

/**
 * 案底（本轮）：`resize_group {size}` 的成员地板是代码里新加的夹紧 + `clamped[]`
 * 回报。手册要么写清楚，要么模型照着旧的 ✅ 例把成员全甩到框外还汇报「已改好」。
 */
test("手册写清了 resize_group size 的成员地板与 clamped 回报", () => {
  const section = /### `resize_group`[\s\S]*?(?=\n### )/.exec(skillCommandsMd);
  assert.ok(section, "手册没有 resize_group 小节");
  assert.match(section[0], /clamped/, "手册没写 clamped[] 回报");
  assert.match(section[0], /members_floor/, "手册没写夹紧的 reason");
  // 代码侧确实会夹紧并回报——手册不是一句好听话。
  assert.match(applySrc, /reason: "members_floor"/);
  assert.match(applySrc, /constrainGroupFrame\(/);
  // 组框手势**默认**不改归属（拖框只报告，拖节点才入组），唯一的例外是显式
  // `absorbStrays` —— 手册说的和画布做的必须是同一件事，两半都要写到。
  assert.match(section[0], /Membership does not change by default/, "手册没写「改框默认不改归属」");
  assert.match(section[0], /`absorbStrays`/, "手册没写唯一那个会改归属的开关");
  assert.match(
    section[0],
    /never stolen/,
    "手册没写「绝不从别的组抢成员」——absorbStrays 最要紧的那半条规矩",
  );
  assert.match(section[0], /strays/, "手册没把它和 tidy 报的 stray 对上");
  // 代码侧：接纳只收无主散件（`n.parentId` 有值就跳过），手册那句不是好听话。
  const tidySrc = read("apps/web/libs/canvas/canvas-tidy.ts");
  assert.match(
    tidySrc,
    /export function absorbStrayNodes\([\s\S]*?n\.kind === "group" \|\| n\.parentId\) continue;/,
    "absorbStrayNodes 不再跳过「已经有 parent」的节点了 —— 它会抢别的组的成员",
  );
  const membershipSrc = read("apps/web/components/canvas/group-membership.ts");
  assert.match(
    membershipSrc,
    /export function commitGroupFrameGesture\([\s\S]*?membership: "frozen"/,
    "组框手势的提交口不再冻结归属了，手册这句话就成了假的",
  );
});

/**
 * 案底（本轮复核）：「stray」在这个产品里曾经有**两套互不相容的判据** —— health 的
 * `stray_over_frame` 判矩形相交，而 tidy 的 `strays[]`、`frame_strays`、
 * `absorbStrayNodes` 判中心在框内。于是一个只把 30px 压进框的节点被体检点名，
 * 体检自己开的药方却永远收不掉它；用户点头、Agent 执行、再体检，同一行原样还在。
 *
 * 同一轮的第二半：`resize_group --fit --absorb-strays` 先跑几何再接纳，等于空转
 * （fit 把框收到成员包围盒，散件按定义不在里面）。
 *
 * 这条闸把四处判据钉成同一个函数、把顺序钉成「先接纳再几何」，并要求手册与
 * PROTOCOL 说的是同一句话 —— 手册是弱模型唯一读得到的东西。
 */
test("stray 判据四处同源、接纳在几何之前，手册与 PROTOCOL 说的是同一句话", () => {
  // ① 判据只有一份，而且是导出的那个函数。
  const healthSrcLocal = read(`${BRIDGE}/health.ts`);
  assert.match(
    canvasTidySrc,
    /export function isStrayOverFrame\(box: Box, frame: Box\): boolean/,
    "canvas-tidy 不再导出唯一那份 stray 判据了",
  );
  assert.match(
    healthSrcLocal,
    /forEachCrossPair\(\s*loose\.map\([\s\S]*?groups\.map\([\s\S]*?isStrayOverFrame,/,
    "health 的 stray_over_frame 没有用共享判据（又回到了矩形相交）",
  );
  assert.match(
    canvasTidySrc,
    /export function absorbStrayNodes\([\s\S]*?isStrayOverFrame\(\{ x, y, w, h \}, frame\)/,
    "absorbStrayNodes 没有用共享判据",
  );
  const membershipSrc2 = read("apps/web/components/canvas/group-membership.ts");
  assert.match(
    membershipSrc2,
    /import \{ isStrayOverFrame \} from "@libs\/canvas\/canvas-tidy";/,
    "页面的组框手势又自己抄了一份判据",
  );

  // ② 顺序：resize_group 分支里 absorbStrayNodes 必须出现在几何落盘之前。
  // apply.ts 里有两个 `case "resize_group"`（先校验、后执行），要的是带接纳那一段。
  const branch = [...applyClean.matchAll(/case "resize_group": \{([\s\S]*?)\n        case "/g)]
    .map((hit) => hit[1])
    .find((body) => body.includes("absorbStrayNodes("));
  assert.ok(branch, "apply.ts 的 resize_group 执行分支形状变了");
  const absorbAt = branch.indexOf("absorbStrayNodes(");
  const applyAt = branch.indexOf("applyCanvasCommands(next, commands, ctx)");
  assert.ok(absorbAt > 0 && applyAt > 0, "这条闸在空转：没找到接纳或几何落盘那一步");
  assert.ok(
    absorbAt < applyAt,
    "resize_group 又变成「先收框再接纳」了 —— 那是空转：fit 之后散件必然在框外",
  );

  // ③ 手册与 PROTOCOL：判据那句话、顺序那句话，都得写到。
  const section = /### `resize_group`[\s\S]*?(?=\n### )/.exec(skillCommandsMd);
  assert.ok(section, "手册没有 resize_group 小节");
  assert.match(section[0], /centre lies inside that frame/, "手册没写统一后的 stray 判据");
  assert.match(section[0], /absorb first, resize second/i, "手册没写「先接纳再收框」的顺序");
  const protocolMd = readFileSync(path.join(packageRoot, "PROTOCOL.md"), "utf8");
  assert.match(protocolMd, /centre lies inside that frame/, "PROTOCOL 没写统一后的 stray 判据");
  assert.match(
    protocolMd,
    /\*\*before\*\* the resize/,
    "PROTOCOL 还写着「resize 之后再接纳」——那是已经修掉的那个空转",
  );
  // 体检那张表里的判据也得跟着改（它是弱模型判「这条该不该报」的唯一依据）。
  assert.match(
    skillCommandsMd,
    /`stray_over_frame`\s*\|[^|]*中心/,
    "手册的八类违例表还写着 stray_over_frame 判相交",
  );
});

/**
 * `rev` 的口径：它跟着 **meta**（保存的视口 / 时间线）一起涨，不只是 nodes/edges/
 * docIndex。文档以前只写前三样，于是「人平移一下画布 `rev` 就变了」变成了一件
 * 没人写下来的事 —— 而下游对 `rev` 变化的默认反应是**重新拉一份 2000 节点的
 * snapshot**。行为那一侧由 tests/unit/canvas-agent-changes.test.ts 钉（viewport
 * 写入让 rev 涨、且不发条目）；这里钉的是「两份文档都把这件事说了，并且说了
 * 『别因此重拉快照』」。
 */
test("rev 的口径：文档写明 meta/viewport 也让它涨，并且说清别因此重拉快照", () => {
  const protocolMd = readFileSync(path.join(packageRoot, "PROTOCOL.md"), "utf8");
  const revPara = protocolMd
    .split("\n")
    .find((line) => line.includes("`rev` is the document revision"));
  assert.ok(revPara, "PROTOCOL.md 里找不到 rev 的那一段 —— 这条闸在空转");
  assert.match(revPara, /viewport/, "PROTOCOL 的 rev 段没写 viewport 也让它涨");
  assert.match(revPara, /re-pull|re-read/, "PROTOCOL 的 rev 段没说清「别因此重拉快照」");

  const revDoc = /\* v3 — the doc revision at snapshot time[\s\S]*?\n  rev: number;/.exec(typesSrc);
  assert.ok(revDoc, "types.ts 的 AgentSnapshot.rev 注释形状变了");
  assert.match(revDoc[0], /viewport/, "types.ts 的 rev 注释没写 viewport 也让它涨");
  assert.match(
    revDoc[0],
    /NOT\s+\n?\s*\*?\s*"re-pull|re-pull the snapshot/,
    "types.ts 的 rev 注释没说清「别因此重拉快照」",
  );
});

/* ──────────── 两条标量 limit：产品照着它改行为，形状错了等于没发 ──────────── */

/**
 * 案底（2026-09-11）：页面把 `group_nodes` 放宽到「一个成员也建组」，产品那边仍按
 * 旧口径 2 自我审查，把单成员的组整批跳过并在报告里写「成员不足 2 个，这一轮不重组」。
 * 页面改了、产品看不见 —— 放宽在两个产品里都是**死代码**。
 *
 * 消费方（script-to-video `.pi/lib/canvas-plan.mjs` 的 `groupMinMembers()`）依次找
 * `limits['group_nodes.minMembers']` / `limits['group_nodes.min']` /
 * `commands.group_nodes.minMembers`，对拿到的值做 `Number(v)` 再 `Number.isInteger`。
 * 所以这条 limit 必须是**裸数字**：写成 `{min:1}` 会 `Number(...)` 成 `NaN`，三个候选
 * 全落空，产品静静退回硬编码的 2 —— 与没加这一条完全一样，而且更难发现。
 * 这条测试把①形状②数值③页面那句错误文案钉在一起：改任何一处都红。
 */
test("group_nodes.minMembers 是裸数字，且与 apply.ts 的「needs at least N」逐字一致", () => {
  const value = CANVAS_CONTRACT.limits["group_nodes.minMembers"];
  assert.equal(typeof value, "number", "必须是裸数字：消费方 Number(v) 读不动对象");
  assert.ok(Number.isInteger(value) && value >= 1, `minMembers 必须是 >= 1 的整数，得到 ${value}`);
  const hit = /group_nodes needs at least (\d+) existing, ungrouped, non-group node/.exec(applySrc);
  assert.ok(hit, "apply.ts 里那句 group_nodes 的错误文案变了（或被删了）");
  assert.equal(value, Number(hit[1]), "契约里的 minMembers 与页面报的「至少 N 个」对不上");
  // 手册引用的是同一句话：它是 Agent 唯一读得到的那份。
  assert.ok(
    skillCommandsMd.includes(hit[0]),
    "手册里 group_nodes 的那句错误文案与 apply.ts 不一致",
  );
  // 消费方那段查找逻辑照抄一遍：真能从契约里解析出这个数，而不是只是「键在」。
  const contract = { CANVAS_CONTRACT };
  const c = contract?.CANVAS_CONTRACT ?? contract;
  let resolved = 2;
  for (const v of [
    c?.limits?.["group_nodes.minMembers"],
    c?.limits?.["group_nodes.min"],
    c?.commands?.group_nodes?.minMembers,
  ]) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1) {
      resolved = n;
      break;
    }
  }
  assert.equal(resolved, value, "消费方的查找顺序解析不出这条 limit（形状不对）");
});

/**
 * 案底（2026-09-11）：画布判「巨框」用 `GROUP_OVERSIZE_RATIO = 3`，script-to-video 收框
 * 硬编码 1.5。同一个框，画布觉得正常、产品觉得太大，于是用户特意留白的组框每 rebase
 * 一次就被收紧一次。比例只能有一处，就是契约。
 */
test("group.oversizeRatio 是裸数字，且就是 canvas-tidy.ts 的 GROUP_OVERSIZE_RATIO", () => {
  const value = CANVAS_CONTRACT.limits["group.oversizeRatio"];
  assert.equal(typeof value, "number", "必须是裸数字：消费方 Number(v) 读不动对象");
  const hit = /GROUP_OVERSIZE_RATIO = ([\d.]+);/.exec(canvasTidySrc);
  assert.ok(hit, "canvas-tidy.ts 的 GROUP_OVERSIZE_RATIO 形状变了");
  assert.equal(value, Number(hit[1]), "契约里的收框比例与画布自己的判定对不上");
  // 判定确实按这个常量做，而不是它旁边另写了一个数。
  assert.match(
    canvasTidySrc,
    /frame\.w \* frame\.h > GROUP_OVERSIZE_RATIO \* membersBounds\.w \* membersBounds\.h/,
    "isOversizeFrame 不再用 GROUP_OVERSIZE_RATIO 判定了",
  );
  // 手册里 `frameOversize` 的那两处倍数是同一个数（弱模型按手册的数自己判巨框）。
  const quoted = [
    ...skillCommandsMd.matchAll(/包围盒的 (\d+(?:\.\d+)?) 倍|more than (\d+(?:\.\d+)?)× the area/g),
  ].map((hit) => Number(hit[1] ?? hit[2]));
  assert.ok(quoted.length >= 2, "手册不再写 frameOversize 的倍数了 —— 这条闸在空转");
  for (const ratio of quoted) assert.equal(ratio, value, "手册写的巨框倍数与契约对不上");
});

/* ──────────────────────── A5 health：体检的结论面 ──────────────────────── */

const healthSrc = read(`${BRIDGE}/health.ts`);

/**
 * `issues[].kind` 是下游唯一能分支的东西（哪些直接报给用户、哪些要先问过人 ——
 * `stray_over_frame` 的修复 argv 会**改成员归属**）。所以这组字符串必须与页面侧
 * 的联合、与页面侧排严重度用的那张表三方一致：多一类少一类都是「产品收到一种它
 * 不认识的违例，然后当成没有」。
 */
test("health.issueKinds 与 types.ts 的 AgentHealthIssueKind 联合逐字一致", () => {
  const block = /export type AgentHealthIssueKind =([\s\S]*?);\n/.exec(typesSrc);
  assert.ok(block, "types.ts 的 AgentHealthIssueKind 形状变了");
  const union = [...block[1].matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(union.length >= 8, "联合没提取到东西 —— 这条闸在空转");
  assert.deepEqual(
    [...CANVAS_CONTRACT.health.issueKinds].sort(),
    [...union].sort(),
    "契约的 issueKinds 与页面侧的联合对不上",
  );
});

test("health.issueKinds 的顺序就是 health.ts 排明细用的 SEVERITY（截断时留下的必须是最严重的）", () => {
  const block = /const SEVERITY: readonly AgentHealthIssueKind\[\] = \[([\s\S]*?)\];/.exec(
    healthSrc,
  );
  assert.ok(block, "health.ts 的 SEVERITY 形状变了");
  const order = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    CANVAS_CONTRACT.health.issueKinds,
    order,
    "契约写的严重度顺序与页面侧真正排序用的那张表不一样",
  );
});

/**
 * 案底就在 snapshot.ts 的注释里：一张 600 节点的画布被 clamp 掉一半，回包的
 * `truncated:true` 没人看见，于是「这里很干净」。体检不能重蹈 —— 它扫的是整张图，
 * `maxIssues` 只截明细表。这条闸钉住这件事在代码里确实成立。
 */
test("health 的 maxIssues 只截明细表，判定范围是整张画布", () => {
  assert.equal(CANVAS_CONTRACT.health.scanIsWholeCanvas, true);
  // scanned.nodes 直接取自 graph.nodes.length：没有任何 clamp 插在中间。
  assert.match(
    healthSrc,
    /scanned: \{ nodes: graph\.nodes\.length,/,
    "health 的 scanned.nodes 不再是整张图的节点数了",
  );
  // truncated 只由**全量**违例条数决定，与节点数无关；counts 也永远是全量
  // （`record()` 先记数再决定要不要物化，上限只挡物化那一步）。
  assert.match(healthSrc, /const truncated = totalIssues > maxIssues;/);
  assert.match(
    healthSrc,
    /counts\[kind\] \+= 1;\s*if \(keptOfKind\[kind\] >= maxIssues\) return false;/,
    "health 的 maxIssues 不再是「先记全量计数、再决定物化」了（上限挪到了截断阶段？）",
  );
  const limit = CANVAS_CONTRACT.limits["health.maxIssues"];
  const hit = /export const HEALTH_MAX_ISSUES = (\d+);/.exec(healthSrc);
  assert.ok(hit, "health.ts 的 HEALTH_MAX_ISSUES 形状变了");
  assert.equal(limit.max, Number(hit[1]), "契约的 health.maxIssues.max 与页面侧硬上限对不上");
  const def = /opts\.maxIssues \?\? DEFAULT_MAX_ISSUES/.test(healthSrc);
  assert.ok(def, "health.ts 不再有 maxIssues 默认值了");
  const defHit = /const DEFAULT_MAX_ISSUES = (\d+);/.exec(healthSrc);
  assert.equal(limit.default, Number(defHit[1]), "契约的默认条数与页面侧对不上");
  // 守护进程按同一个上下界挡（多给即报错的那张表旁边）。
  assert.match(policySrc, /params\.maxIssues > 1000/);
});

test("health.overlapMinRatio 是裸数字，且就是 health.ts 的 HEALTH_OVERLAP_MIN_RATIO", () => {
  const value = CANVAS_CONTRACT.limits["health.overlapMinRatio"];
  assert.equal(typeof value, "number", "必须是裸数字：消费方 Number(v) 读不动对象");
  const hit = /(?:export )?const HEALTH_OVERLAP_MIN_RATIO = ([\d.]+);/.exec(healthSrc);
  assert.ok(hit, "health.ts 的 HEALTH_OVERLAP_MIN_RATIO 形状变了");
  assert.equal(value, Number(hit[1]));
});

/**
 * 组的成员数下限只能有一处（契约那一处）。页面侧体检的默认值是它的镜像，
 * 漂了就是「产品说这是单成员组、画布说不是」。
 */
test("health.ts 的 DEFAULT_GROUP_MIN_MEMBERS 就是契约的 group_nodes.minMembers", () => {
  const hit = /export const DEFAULT_GROUP_MIN_MEMBERS = (\d+);/.exec(healthSrc);
  assert.ok(hit, "health.ts 的 DEFAULT_GROUP_MIN_MEMBERS 形状变了");
  assert.equal(Number(hit[1]), Number(CANVAS_CONTRACT.limits["group_nodes.minMembers"]));
});

/**
 * 手册漏一条命令和契约漏一条命令是同一级别的事故（见上面 resize_group 那条案底）。
 * `health` 是回答「画布哪里坏了」的唯一一条命令，弱模型读不到它就只能自己对着
 * 几百个节点做几何运算 —— 那正是它做不对的事。
 */
test("health 在 SKILL.md 与 commands.md 里都有，且八类违例一条不落", () => {
  const skillMd = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  for (const [name, text] of [
    ["SKILL.md", skillMd],
    ["commands.md", skillCommandsMd],
  ])
    assert.match(text, /\bhealth\b/, `${name} 里没有 health 命令`);
  for (const kind of CANVAS_CONTRACT.health.issueKinds)
    assert.ok(
      skillCommandsMd.includes(kind),
      `commands.md 没写 ${kind} 这一类 —— Agent 拿到这种 kind 不知道是什么`,
    );
});

/* ────────── 场景表的覆盖率闸：能力在、场景表没有 = 模型当它不存在 ────────── */

/**
 * 案底（真环境实测，2026-09）：用户让 Agent「把画布定位到某个组」，Agent 回答
 * 「让你浏览器里的视图跳过去、放大到某个节点——那是页面自己的行为，我碰不到」。
 * **能力一直都在**：`focus_node` 是 apply 命令之一，policy 放行，参考小节
 * 写了整整十行，真环境里三条路都通（节点、组、裸 apply）。唯一的缺口是**入口**：
 * SKILL.md 提它 0 次，开头那张「场景 → 命令」表里没有「定位 / 跳过去 / 看一眼」
 * 这一条。弱模型读场景表得出「我没这个能力」，然后自信地告诉用户。
 *
 * 参数表不是入口。模型翻译的是「用户说了什么」，不是「这条命令有哪些字段」——
 * 所以这条闸钉的是**场景表**（`# CLI command reference` 之前的那一整段），要求
 * 每条 CLI 子命令、每条 apply 命令在那里都有一份**能照抄的调用**：
 *  · CLI 子命令 → argv 数组的第一个词（`["tasks"`），或带参数的行内用法（`` `tidy --scope …` ``）；
 *  · apply 命令 → `"type": "…"`（JSON 块里、或 argv 里转义过的那种）。
 * 只是被提到一次不算：`arrange` 以前就在 11c 的一句话里露过名字，而模型照样不会用它。
 *
 * 故意不进场景表的，写进下面的白名单并**各自带一句理由**——「故意不写」和「漏了」
 * 必须分得开，这正是 `focus_node` 那次的教训。
 */

/** 场景表：`# CLI command reference` 之前的那一整段，也就是弱模型真正照抄的部分。 */
const scenarioTable = skillCommandsMd.slice(0, skillCommandsMd.indexOf("# CLI command reference"));

/** 明确不进场景表的 CLI 子命令，每条都要说清为什么。 */
const SCENARIO_EXEMPT_CLI = {
  // 用户不会让 Agent「去看看帮助」；`help` / `COMMAND --help` 是人在 shell 里排查
  // 用的，而且它的内容由 COMMAND_SPEC 直接生成，永远不会漂。
  help: "人工排查用，不是用户会提的需求；内容由 COMMAND_SPEC 生成",
  // 同上：打印随包技能目录的路径，装机 / 宿主接线时用一次。
  "skill-path": "装机时打印技能目录，不是画布上的活",
  // worker 由**宿主**创建（SKILL.md 的「子任务由宿主 delegate 创建 worker」）。
  // 模型自己发它就等于自己发明一个身份——场景表教它怎么发是反向教学。
  delegate: "worker 身份由宿主创建，模型不该自己发",
  // 同上的反向操作，也在宿主那一侧。
  revoke: "收回 worker 身份，属宿主职责",
};

/** 明确不进场景表的 apply 命令，每条都要说清为什么。 */
const SCENARIO_EXEMPT_APPLY = {
  // 场景 11b 教的是 CLI 的 `tidy --scope all --fit-frames`（整理画布，只修坏掉的
  // 部分）。裸 `{"type":"tidy"}` 是**整张画布重排**：动用户手摆的东西、落成 Agent
  // 的撤销步、给用户弹通知。故意不给弱模型一份可照抄的 JSON。
  tidy: "场景表只教 CLI 的 `tidy --scope`；裸 JSON 形式是全画布重排，故意不示范",
  // 手写不出来：`bytesBase64` 要读文件。场景 14 教的是 `upload`，它替模型组装这条命令。
  upload_asset: "只能由 CLI 的 `upload` 合成（模型读不到文件字节），场景 14 教的是 upload",
};

test("每条 CLI 子命令都能在场景表里找到一份能照抄的调用（豁免的要写明理由）", () => {
  const missing = [];
  for (const command of Object.keys(COMMAND_SPEC)) {
    if (command in SCENARIO_EXEMPT_CLI) continue;
    const asArgv = scenarioTable.includes(`["${command}"`);
    const asUsage = new RegExp("`" + command.replaceAll("-", "\\-") + "[ —]").test(scenarioTable);
    if (!asArgv && !asUsage) missing.push(command);
  }
  assert.deepEqual(
    missing,
    [],
    `这些命令有能力、场景表没入口 —— 弱模型会当它们不存在（focus_node 的原案底）：${missing.join(", ")}`,
  );
});

test("每条 apply 命令都能在场景表里找到一份能照抄的 JSON（豁免的要写明理由）", () => {
  const missing = [];
  for (const command of Object.keys(COMMAND_FIELDS)) {
    if (command in SCENARIO_EXEMPT_APPLY) continue;
    const forms = [`"type": "${command}"`, `"type":"${command}"`, `\\"type\\":\\"${command}\\"`];
    if (!forms.some((form) => scenarioTable.includes(form))) missing.push(command);
  }
  assert.deepEqual(missing, [], `这些 apply 命令场景表里没有可照抄的 JSON：${missing.join(", ")}`);
});

/**
 * 白名单本身也要防腐：豁免一条命令只能是**决定**，不能是把红变绿的手段。所以
 * 每一项都必须真的存在于对应的清单里（改名后留下的死条目 = 一条无人知晓的漏网），
 * 理由不能是空串，而且豁免掉的那条仍然必须在**参考小节**里写清楚——不进场景表
 * 是「模型不该主动用」，不是「不用写」。
 */
test("场景表白名单：每条都真的存在、都带理由、都仍在参考手册里有交代", () => {
  for (const [command, why] of Object.entries(SCENARIO_EXEMPT_CLI)) {
    assert.ok(COMMAND_SPEC[command], `白名单里的 ${command} 不是 CLI 子命令了（改名后的死条目）`);
    assert.ok(why.length > 4, `${command} 的豁免理由太短`);
    assert.ok(
      skillCommandsMd.includes(`\`${command}\``) || skillCommandsMd.includes(`${command} `),
      `${command} 不进场景表，参考手册里也一个字都没有 —— 那是漏了，不是豁免`,
    );
  }
  for (const [command, why] of Object.entries(SCENARIO_EXEMPT_APPLY)) {
    assert.ok(COMMAND_FIELDS[command], `白名单里的 ${command} 不是 apply 命令了`);
    assert.ok(why.length > 4, `${command} 的豁免理由太短`);
    assert.match(
      skillCommandsMd,
      new RegExp("### `" + command + "`"),
      `${command} 不进场景表，连自己的参考小节都没有`,
    );
  }
  // 闸不能空转：豁免掉太多就等于没闸。
  const exempt =
    Object.keys(SCENARIO_EXEMPT_CLI).length + Object.keys(SCENARIO_EXEMPT_APPLY).length;
  const total = Object.keys(COMMAND_SPEC).length + Object.keys(COMMAND_FIELDS).length;
  assert.ok(exempt * 5 < total, `豁免了 ${exempt}/${total} 条 —— 白名单正在取代这条闸`);
});

/**
 * 场景表的条目要长成「用户可能怎么说」的样子。弱模型是拿用户那句话去匹配标题的，
 * 一个只写命令名的标题（「## 13. arrange」）对它毫无用处。
 */
test("场景表的每个场景标题都带一句用户的原话", () => {
  const headings = [...scenarioTable.matchAll(/^## (?!铁律)(\d+[a-z]?)\. (.+)$/gm)];
  assert.ok(headings.length >= 18, `只找到 ${headings.length} 个场景标题 —— 这条闸在空转`);
  for (const [, number, title] of headings)
    assert.match(title, /「[^」]+」/, `场景 ${number} 的标题里没有用户会说的话（「…」）：${title}`);
});

/* ──────────────── focus_node：取景到底有没有发生 ──────────────── */

const canvasBridgeSrc = read(`${BRIDGE}/canvas.ts`);

/**
 * 案底（真环境实测）：`focus_node` 曾是唯一一条「效果不在文档里」的命令（后来加的
 * `select` 是第二条）——
 * 它动的是某一个浏览器里的相机，而它搭车的那一批写入无论如何都提交成功。页面还没
 * 量到那个节点的几何时，取景**根本没发生**，回包里却一个字都没有、`ok:true`。
 * 于是 Agent 唯一说得出口的话是「已经定位过去了」，而用户的画面没动 —— 与
 * `tidied[]` 之前那档「已应用 1 条命令」是同一类静默失败。
 *
 * 两个失败原因必须分开，因为给用户的话不一样：`unmeasured` 这一次没量到（进视野
 * 后再来一次可能就行），`no_camera` 这个宿主压根没接相机（换哪个节点、重试多少次
 * 都不行，只能改口报节点名）。契约、页面侧的联合、页面侧真正 push 的取值，三方一致。
 */
test("focus.unframedReasons 与 types.ts 的 FocusUnframedReason 联合逐字一致", () => {
  const union = literalUnion(typesClean, "FocusUnframedReason");
  assert.deepEqual(
    [...CANVAS_CONTRACT.focus.unframedReasons].sort(),
    [...union].sort(),
    "契约的 focus.unframedReasons 与页面侧的联合对不上",
  );
});

test("页面侧真的会产出这两个原因，而且 framed 读的是相机的返回值", () => {
  const clean = stripComments(canvasBridgeSrc);
  for (const reason of CANVAS_CONTRACT.focus.unframedReasons)
    assert.match(
      clean,
      new RegExp(`reason: "${reason}"`),
      `canvas.ts 从来不产出 reason:"${reason}" —— 契约里这一档是空的`,
    );
  // 「宿主没接相机」必须在**调用之前**就分出去：调用 undefined 会抛，
  // 而 `?.` 的结果 undefined 又与「量不到」混成同一个 falsy。
  assert.match(
    clean,
    /const fit = this\.config\.fitNodes;\s*if \(!fit\) \{\s*focused\.push\(\{ command, \.\.\.target, framed: false, reason: "no_camera" \}\);/,
    "canvas.ts 不再把「宿主没接相机」单独分出来了（又变回 fitNodes?.(…) 的一元判断？）",
  );
  assert.match(
    clean,
    /const framed = fit\(nodeIds, Math\.max\(0, 1 \/ fill - 1\)\);/,
    "framed 不再是相机的返回值了 —— 它又变成了一句好听话",
  );
  // 有 focus_node 就必须带 focused[]，尤其是在**没取上景**的时候：
  // 失败才省略字段，等于把静默原样搬回来。
  assert.match(
    clean,
    /\.\.\.\(focused\.length > 0 \? \{ focused \} : \{\}\),/,
    "回包不再按「批里有没有 focus_node」带 focused[] 了",
  );
});

/**
 * 手册必须教模型读 `focused[].framed`。旧手册那句「Never treat a successful apply
 * as proof」只说了不能信什么，没说该读什么 —— 模型于是继续对用户说「已经定位过去了」。
 */
test("手册把 focused[].framed 写成了判据，两个原因都写到了", () => {
  const section = /### `focus_node`[\s\S]*?(?=\n### )/.exec(skillCommandsMd);
  assert.ok(section, "手册没有 focus_node 小节");
  assert.match(section[0], /`focused\[\]`/, "手册没写 focused[] 回报");
  assert.match(section[0], /\bframed\b/, "手册没写该读哪个字段");
  // 旧手册只说了「不能信 ok」，没说该读什么，模型于是照旧汇报「已经定位过去了」。
  assert.match(
    section[0],
    /Read `focused\[\]`, not `ok`/,
    "手册没把「读 focused[]、别读 ok」写成一句话",
  );
  for (const reason of CANVAS_CONTRACT.focus.unframedReasons)
    assert.ok(section[0].includes(reason), `手册没写 ${reason} 这个原因`);
});

/* ─────────── page_away：字段名 / 错误码 / 退出码的唯一真相源 ─────────── */

const daemonSrc = readFileSync(path.join(packageRoot, "src", "daemon.mjs"), "utf8");
const clientSrc = readFileSync(path.join(packageRoot, "src", "client.mjs"), "utf8");
const daemonClean = stripComments(daemonSrc);

/** `const NAME = (args) => ({ … })` 的对象字面量正文。 */
function arrowObjectBody(clean, name) {
  const at = clean.indexOf(`const ${name} = (`);
  assert.ok(at >= 0, `源码里找不到 const ${name} = (`);
  const open = clean.indexOf("{", clean.indexOf("=>", at));
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(clean, i);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) return clean.slice(open + 1, i);
    }
  }
  throw new Error(`${name} 的对象字面量没有闭合`);
}

/**
 * 案底（本轮）：`pageAway` / `queuedCommands` / `pageLastSeenAt` / `resumeExpiresAt`
 * 和 `queued` / `outcome` / `requestId` 这些字段名，今天在守护进程、随包手册、灵影
 * 客户端、script-to-video 四处逐字手抄，没有任何共享常量。上游改一个名字，下游读到
 * `undefined` 就把「页面不在」当成「一切正常」继续发写命令 —— 失败是静默的。
 *
 * `PAGE_AWAY` 是发出去的那一份；这条闸把它钉在真正产生这些字段的代码上。
 */
test("PAGE_AWAY 的每个名字都来自 daemon.mjs / client.mjs 的源码", () => {
  // 错误码本身，以及它在两张表里的分类。
  assert.equal(PAGE_AWAY.code, "page_away");
  assert.match(daemonClean, /failure\("page_away"/, "守护进程不再发 page_away 了？");
  assert.equal(CANVAS_CONTRACT.cliExitCodes[PAGE_AWAY.code], PAGE_AWAY.exitCode);
  assert.equal(
    exitCode({ ok: false, error: { code: PAGE_AWAY.code } }),
    PAGE_AWAY.exitCode,
    "退出码与 cli.mjs 的分类对不上",
  );

  // status() 真的回这四个字段（`state,` 这种简写也算）。
  const statusBody = arrowObjectBody(daemonClean, "status");
  for (const [role, field] of Object.entries(PAGE_AWAY.statusFields))
    assert.match(
      statusBody,
      new RegExp(`\\b${field}\\s*[:,]`),
      `status() 里没有 ${field}（PAGE_AWAY.statusFields.${role}）`,
    );

  // pageAwayFailure() 真的回这些字段。
  const failureBody = functionBody(daemonClean, "pageAwayFailure");
  for (const [role, field] of Object.entries(PAGE_AWAY.errorFields))
    assert.match(
      failureBody,
      new RegExp(`\\b${field}\\s*[:,]`),
      `pageAwayFailure() 里没有 ${field}（PAGE_AWAY.errorFields.${role}）`,
    );
  // 反向：错误载荷里出现的字段都得在常量里，不能有「只有源码知道」的字段。
  const declared = new Set(Object.values(PAGE_AWAY.errorFields));
  const emitted = [
    ...new Set(
      [...failureBody.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?::|,|$)/gm)].map(
        (hit) => hit[1],
      ),
    ),
  ].filter((field) => field !== "code" && field !== "message" && field !== "return");
  assert.ok(emitted.length >= 5, "从 pageAwayFailure 里几乎没提取到字段 —— 这条闸在空转");
  for (const field of emitted)
    assert.ok(declared.has(field), `pageAwayFailure 回了 ${field}，PAGE_AWAY.errorFields 没列`);

  // outcome 的两个取值，以及两个时间常量。
  assert.match(failureBody, new RegExp(`outcome: "${PAGE_AWAY.outcomes.queued}"`));
  assert.match(failureBody, new RegExp(`outcome: "${PAGE_AWAY.outcomes.notSent}"`));
  const readMs = /const PAGE_AWAY_READ_MS = (\d+);/.exec(daemonSrc);
  assert.ok(readMs, "daemon.mjs 的 PAGE_AWAY_READ_MS 形状变了");
  assert.equal(PAGE_AWAY.readAnswerMs, Number(readMs[1]));
  const waitMs = /const DEFAULT_WAIT_MS = (\d+);/.exec(clientSrc);
  assert.ok(waitMs, "client.mjs 的 DEFAULT_WAIT_MS 形状变了");
  assert.equal(PAGE_AWAY.defaultWaitMs, Number(waitMs[1]));

  // 契约上也要挂着同一份对象：消费方从 `./contract` 拿到的就是它。
  assert.equal(CANVAS_CONTRACT.pageAway, PAGE_AWAY);
});

/**
 * 手册与常量同源：文档里出现的 page_away 字段名必须都是 `PAGE_AWAY` 里的名字。
 * 手册是弱模型唯一读得到的东西，它抄错一个字段名和代码改名一样致命。
 */
test("手册 page_away 小节里的字段名都在 PAGE_AWAY 里", () => {
  // 锚定行首：顶部的小节索引里会原样出现这个标题（那是一行索引，不是小节本身）。
  const section = /^## 命令卡住 \/ 页面刚升级：`page_away`[\s\S]*?(?=\n## )/m.exec(skillCommandsMd);
  assert.ok(section, "手册的 page_away 小节不见了");
  const names = new Set([
    ...Object.values(PAGE_AWAY.statusFields),
    ...Object.values(PAGE_AWAY.errorFields),
  ]);
  const quoted = [...section[0].matchAll(/`([a-z][A-Za-z]+)`/g)].map((hit) => hit[1]);
  const camel = quoted.filter((word) => /[A-Z]/.test(word));
  assert.ok(camel.length >= 4, "小节里几乎没提字段名了 —— 这条闸在空转");
  for (const field of camel)
    assert.ok(names.has(field), `手册写了 \`${field}\`，PAGE_AWAY 里没有这个名字`);
  // 反向：四个 status 字段一个都不能漏教。
  for (const field of Object.values(PAGE_AWAY.statusFields))
    assert.ok(section[0].includes(field), `手册没教 status.${field}`);
});

/* ───────────────── 随包发布的类型面：src/contract.d.mts ───────────────── */

/**
 * `src/contract.d.mts` 是 package.json 的 `"types"`，也就是**集成方唯一看得见的
 * 类型面**。它手写、不生成，而这个仓里的双向契约闸只钉 `contract.mjs` ↔
 * `agent-bridge/types.ts` —— **没有任何测试读过 .d.mts**（`pack.test.mjs` 只断言
 * 它被打进了 tarball）。于是它漂了两处都没人发现：`changes.notes` 还是三个值
 * （新增的 `frame_strays` / `frame_escaped` 没跟上），整个 `health` 键**一个字都
 * 没有声明** —— 下游 `C.health.issueKinds` 直接是 TypeScript 错误，或者更糟，
 * 在 `as any` 后面变成 undefined。
 *
 * 这条闸比那两处具体修复值钱：它把 .d.mts 与运行时对象**逐字**对上 —— 每一层对象
 * 字面量的键集合双向相等，每一个具名联合（`readonly [...]`）、每一个字符串/数字/
 * 布尔字面量取值逐一相等。类型面从此不可能悄悄落后于实现。
 */

/** 从 `at` 处的开括号开始，返回配对闭括号的下标（认字符串与转义）。 */
function matchBracket(text, at) {
  const open = text[at];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  assert.ok(close, `不是开括号 @${at}`);
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(text, i);
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  throw new Error(`未闭合的 ${open} @${at}`);
}

/** 顶层（不在任何括号 / 字符串里）的 `;` 处切开成一条条成员。 */
function splitMembers(body) {
  const out = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(body, i);
      continue;
    }
    if (c === "{" || c === "[") {
      i = matchBracket(body, i);
      continue;
    }
    if (c === ";") {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) out.push(tail);
  return out.map((m) => m.trim()).filter(Boolean);
}

/** `"a"` / `12` / `true` → 取值；别的（`number`、`string`…）→ undefined。 */
function literalValue(text) {
  const t = text.trim();
  if (/^"[^"]*"$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return undefined;
}

/**
 * 一个对象字面量体 → `{ keys, entries }`。`entries[key]` 是
 * `{ kind: "object"|"tuple"|"literal"|"opaque", … }`：`opaque` 表示那是个类型
 * （`Readonly<Record<…>>`、`typeof PAGE_AWAY`），只查键在不在，不查取值。
 */
function parseObjectBody(body) {
  const keys = [];
  const entries = {};
  for (const member of splitMembers(body)) {
    const hit = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]*)$/.exec(member);
    assert.ok(hit, `.d.mts 里看不懂的成员：${member.slice(0, 60)}`);
    const [, key, optional, rawType] = hit;
    keys.push(key);
    const type = rawType.trim();
    if (type.startsWith("{")) {
      entries[key] = { kind: "object", ...parseObjectBody(type.slice(1, matchBracket(type, 0))) };
      continue;
    }
    const tuple = /^readonly\s*\[([\s\S]*)\]$/.exec(type);
    if (tuple) {
      const items = tuple[1]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map(literalValue);
      if (items.every((item) => item !== undefined)) {
        entries[key] = { kind: "tuple", value: items };
        continue;
      }
    }
    const literal = literalValue(type);
    entries[key] =
      literal === undefined
        ? { kind: "opaque", optional: optional === "?" }
        : { kind: "literal", value: literal };
  }
  return { keys, entries };
}

/** `.d.mts` 里每个 `export declare const X: { … };` 的解析结果。 */
function declaredConsts(source) {
  const text = stripComments(source);
  const out = new Map();
  const re = /export\s+declare\s+const\s+([A-Za-z_$][\w$]*)\s*:\s*/g;
  for (let hit = re.exec(text); hit; hit = re.exec(text)) {
    const at = hit.index + hit[0].length;
    if (text[at] !== "{") continue; // `Readonly<Record<…>>` 这类整体不透明，跳过
    const end = matchBracket(text, at);
    out.set(hit[1], parseObjectBody(text.slice(at + 1, end)));
    re.lastIndex = end;
  }
  return out;
}

/** 声明的形状 vs 运行时对象，逐层双向。 */
function assertShape(at, declared, actual) {
  assert.deepEqual(
    [...declared.keys].sort(),
    Object.keys(actual).sort(),
    `${at} 的键集合与运行时对不上（.d.mts 落后了，或者多声明了一个不存在的键）`,
  );
  for (const key of declared.keys) {
    const entry = declared.entries[key];
    const value = actual[key];
    if (entry.kind === "object") {
      assert.equal(typeof value, "object", `${at}.${key} 声明成对象，运行时不是`);
      assertShape(`${at}.${key}`, entry, value);
    } else if (entry.kind === "tuple") {
      assert.deepEqual(value, entry.value, `${at}.${key} 的取值与 .d.mts 声明的元组对不上`);
    } else if (entry.kind === "literal") {
      assert.equal(value, entry.value, `${at}.${key} 的字面量取值与 .d.mts 对不上`);
    }
  }
}

const dtsSrc = readFileSync(path.join(packageRoot, "src", "contract.d.mts"), "utf8");

test("contract.d.mts 与 contract.mjs 逐字对齐（键集合双向，具名联合逐个取值）", () => {
  const declared = declaredConsts(dtsSrc);
  // 闸不能空转：两个对象常量都要真的解析出来，而且真的有东西可比。
  assert.deepEqual([...declared.keys()].sort(), [
    "CANVAS_CONTRACT",
    "DOCUMENTS",
    "LOCAL_TOOLS",
    "PAGE_AWAY",
    "SCENE3D",
  ]);
  assert.ok(declared.get("CANVAS_CONTRACT").keys.length >= 10);
  assertShape("CANVAS_CONTRACT", declared.get("CANVAS_CONTRACT"), CANVAS_CONTRACT);
  assertShape("PAGE_AWAY", declared.get("PAGE_AWAY"), PAGE_AWAY);
  assertShape("DOCUMENTS", declared.get("DOCUMENTS"), DOCUMENTS);
  assertShape("LOCAL_TOOLS", declared.get("LOCAL_TOOLS"), LOCAL_TOOLS);
  assertShape("SCENE3D", declared.get("SCENE3D"), SCENE3D);
});

/**
 * 上面那条按「对象字面量」比。`.d.mts` 里还有一处不是对象常量而是类型别名：
 * `CanvasContractNodeKind`。它是 `draftKeys` 的键，漏一个 kind = 一条草稿键被静默丢弃。
 */
test("contract.d.mts 的 CanvasContractNodeKind 就是 draftKeys 的键", () => {
  assert.deepEqual(
    literalUnion(stripComments(dtsSrc), "CanvasContractNodeKind").sort(),
    Object.keys(DRAFT_KEYS).sort(),
  );
});

/** `export declare const` 一个都不能少：运行时导出的常量都要有类型面。 */
test("contract.mjs 导出的每个常量在 .d.mts 里都有声明", () => {
  const exported = [
    ...stripComments(read("packages/canvas-cli/src/contract.mjs")).matchAll(
      /export\s+const\s+([A-Za-z_$][\w$]*)/g,
    ),
  ].map((hit) => hit[1]);
  assert.ok(exported.length >= 3, "没提取到 contract.mjs 的导出 —— 这条闸在空转");
  const declaredNames = new Set(
    [...stripComments(dtsSrc).matchAll(/export\s+declare\s+const\s+([A-Za-z_$][\w$]*)/g)].map(
      (hit) => hit[1],
    ),
  );
  for (const name of exported)
    assert.ok(declaredNames.has(name), `contract.mjs 导出了 ${name}，.d.mts 没有声明它`);
});

/* ───────────────────── 命令分级：tiers 与 policy 那几张表对齐 ───────────────────── */

/**
 * `spec.test.mjs` 钉的是「tiers 的键集 = CLI 子命令」和 level / timeoutTier 的自洽；
 * 这里钉的是它与**权限**的对齐 —— 谁能发、要不要用户先点头、apply 批里的哪两条
 * worker 连嵌都不能嵌。
 *
 * 为什么非钉不可：这四件事宿主要拿去配工具白名单。分级表说 worker 能发、
 * `enforceRequestPolicy` 说不能，结果是宿主放它过、守护进程再拒 —— 模型拿到的是
 * 一条「能力存在但被拒」的报错，而它唯一的修法是改措辞重试。
 */
const tierTable = CANVAS_CONTRACT.tiers;
const tierCommandEntries = Object.entries(tierTable).filter(([key]) => key !== "applyCommands");

test("tiers 的 mainOnly 就是 policy.mjs 的 MAIN_METHODS", () => {
  const declaredMainOnly = new Set();
  for (const [name, entry] of tierCommandEntries) {
    // 本地命令自己不发线协议；某个 flag 让它发 main 专用方法时（`export-jianying --draft-root` 的
    // jianying_roots_list / jianying_roots_touch），那几个方法登记在 `flagTiers[flag].methods` 上 ——
    // 它们同样要在这张双向表里有着落，否则「MAIN_METHODS 里有、分级表里没有」就漏了。
    for (const [flag, tier] of Object.entries(entry.flagTiers ?? {}))
      if (tier.mainOnly)
        for (const method of tier.methods) {
          assert.ok(
            MAIN_METHODS.has(method),
            `${name} --${flag} 标了 mainOnly，但 ${method} 不在 MAIN_METHODS 里`,
          );
          declaredMainOnly.add(method);
        }
    if (entry.local) continue;
    assert.equal(
      entry.mainOnly,
      MAIN_METHODS.has(entry.method),
      `${name}.mainOnly 与 MAIN_METHODS 对不上：宿主照分级表放行、守护进程再拒 = 模型只能原地猜`,
    );
    if (entry.mainOnly) declaredMainOnly.add(entry.method);
  }
  assert.deepEqual(
    [...declaredMainOnly].sort(),
    [...MAIN_METHODS].sort(),
    "MAIN_METHODS 里有方法在分级表里一条子命令都没有（或反过来）",
  );
});

test("tiers 的 approval 就是 policy.mjs 真正强制 approval 的那几个方法", () => {
  // 源码提取：`enforceRequestPolicy` 里「除了这几个方法，带 approval 就报错」那一段。
  const clause = /if \(\s*((?:method !== "\w+" &&\s*)+)Object\.hasOwn\(params, "approval"\)/.exec(
    policySrc,
  );
  assert.ok(clause, "policy.mjs 里「approval 只对某几个方法有效」那一段的形状变了");
  const enforced = [...clause[1].matchAll(/method !== "(\w+)"/g)].map((hit) => hit[1]).sort();
  assert.ok(enforced.length >= 2, "没提取到 approval 方法名 —— 这条闸在空转");
  const declared = [
    ...new Set(
      tierCommandEntries.filter(([, entry]) => entry.approval === true).map(([, e]) => e.method),
    ),
  ].sort();
  assert.deepEqual(
    declared,
    enforced,
    "分级表说要 approval 的方法与守护进程强制 approval 的方法对不上：少标一条 = 模型不问用户就花钱",
  );
});

/**
 * `flagTiers`：某个 flag 把一条本地命令换到另一档（今天只有 `export-jianying --draft-root`：直写用户的
 * 剪映草稿目录）。宿主按它决定「带这个 flag 时谁能发、要不要先问用户」，所以它的每个字段都要对得上代码：
 * flag 真是这条命令收的、level 合法、方法都在传输层白名单里、mainOnly 与方法是不是 main 专用一致。
 */
test("tiers 的 flagTiers：只挂在本地命令上，flag 真是它收的，方法与 mainOnly 与 policy 对得上", () => {
  const withFlagTiers = tierCommandEntries.filter(([, entry]) => entry.flagTiers);
  assert.deepEqual(
    withFlagTiers.map(([name]) => name),
    ["export-jianying"],
    "flagTiers 目前只有 export-jianying --draft-root 一处",
  );
  for (const [name, entry] of withFlagTiers) {
    assert.equal(
      entry.local,
      true,
      `${name} 不是本地命令，档位直接由 method 决定，不该有 flagTiers`,
    );
    for (const [flag, tier] of Object.entries(entry.flagTiers)) {
      assert.ok(COMMAND_SPEC[name].flags.includes(flag), `${name} 不收 --${flag}`);
      assert.match(tier.level, /^L[0-3]$/);
      assert.ok(Array.isArray(tier.methods) && tier.methods.length > 0);
      for (const method of tier.methods)
        assert.ok(METHODS.has(method), `${method} 不在 METHODS 里`);
      assert.equal(
        tier.mainOnly,
        tier.methods.some((method) => MAIN_METHODS.has(method)),
        `${name} --${flag}.mainOnly 与它发的方法是不是 main 专用对不上`,
      );
    }
  }
  const draftRoot = CANVAS_CONTRACT.tiers["export-jianying"].flagTiers["draft-root"];
  assert.deepEqual(draftRoot, {
    level: "L1",
    mainOnly: true,
    methods: ["jianying_roots_list", "jianying_roots_touch"],
    approvalWhen: "unregistered_root",
  });
  // 不带 --draft-root 时，export-jianying 仍是 L0 / 本地 / long。
  assert.equal(CANVAS_CONTRACT.tiers["export-jianying"].level, "L0");
  assert.deepEqual(CANVAS_CONTRACT.tiers["jianying-roots"], {
    level: "L0",
    method: "jianying_roots_list",
    mutation: false,
    mainOnly: true,
    approval: false,
    timeoutTier: "short",
  });
});

test("剪映草稿目录两个方法：都只有 main；list 不收参数，touch 只收 path / label 且有长度上限", () => {
  assert.ok(MAIN_METHODS.has("jianying_roots_list") && MAIN_METHODS.has("jianying_roots_touch"));
  assert.equal(READ_METHODS.has("jianying_roots_list"), false);
  assert.ok(MUTATIONS.has("jianying_roots_touch"));
  assert.equal(MUTATIONS.has("jianying_roots_list"), false);
  assert.deepEqual(JIANYING_ROOTS_TOUCH_FIELDS, ["path", "label"]);
  const refused = (role, method, params) => {
    try {
      enforceRequestPolicy(role, method, params);
      return null;
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(refused("worker", "jianying_roots_list", {}), "worker_forbidden");
  assert.equal(refused("worker", "jianying_roots_touch", { path: "/a/b" }), "worker_forbidden");
  assert.equal(refused("main", "jianying_roots_list", {}), null);
  assert.equal(refused("main", "jianying_roots_list", { limit: 5 }), "invalid_request");
  assert.equal(
    refused("main", "jianying_roots_touch", { path: "D:\\drafts", label: "公司" }),
    null,
  );
  assert.equal(refused("main", "jianying_roots_touch", {}), "invalid_request");
  assert.equal(refused("main", "jianying_roots_touch", { path: "  " }), "invalid_request");
  assert.equal(
    refused("main", "jianying_roots_touch", { path: "/a".repeat(201) }),
    "invalid_request",
  );
  assert.equal(
    refused("main", "jianying_roots_touch", { path: "/a", label: "x".repeat(41) }),
    "invalid_request",
  );
  assert.equal(
    refused("main", "jianying_roots_touch", { path: "/a", lable: "x" }),
    "invalid_request",
  );
  // 身份只来自会话：塞一个 userId / projectId 进来直接拒。
  assert.equal(
    refused("main", "jianying_roots_touch", { path: "/a", projectId: "p" }),
    "invalid_request",
  );
  assert.equal(
    refused("main", "jianying_roots_touch", { path: "/a", approval: {} }),
    "invalid_request",
  );
});

test("tiers.applyCommands 的键集就是 COMMAND_FIELDS，workerAllowed 就是 WORKER_BLOCKED_COMMANDS 取反", () => {
  const applyTiers = tierTable.applyCommands;
  assert.deepEqual(
    Object.keys(applyTiers).sort(),
    Object.keys(COMMAND_FIELDS).sort(),
    "apply 命令进了字段表却没进分级表（或反过来）",
  );
  const blocked = [];
  for (const [name, entry] of Object.entries(applyTiers)) {
    assert.equal(
      entry.workerAllowed,
      !WORKER_BLOCKED_COMMANDS.has(name),
      `applyCommands.${name}.workerAllowed 与 WORKER_BLOCKED_COMMANDS 对不上`,
    );
    assert.equal(typeof entry.destructive, "boolean", `applyCommands.${name}.destructive 不是布尔`);
    if (!entry.workerAllowed) blocked.push(name);
  }
  assert.deepEqual([...blocked].sort(), [...WORKER_BLOCKED_COMMANDS].sort());
  // 闸不能空转：破坏性名单空了就等于没标。
  const destructive = Object.keys(applyTiers)
    .filter((name) => applyTiers[name].destructive)
    .sort();
  assert.ok(destructive.includes("delete_node"), "delete_node 不再是破坏性命令了？");
  assert.ok(
    destructive.length >= 2 && destructive.length < 10,
    `破坏性标了 ${destructive.length} 条`,
  );
});

/**
 * 案底形状：`doc-index` 是**保留 id**，不是节点。`delete_node doc-index` 一条命令
 * 抹掉全画布的业务路径，没有任何提示，用户的 Ctrl+Z 也救不回来。手册里那句警告和
 * 页面侧的常量之间原本没有任何绑定 —— 页面改了名，手册和契约会一起把模型带到一个
 * 已经不存在的 id 上（或者更糟：带到一个真节点上）。
 */
test("delete_node.destructiveWhen 就是 doc-index.ts 的 INDEX_NODE_ID", () => {
  const docIndexSrc = read(`${BRIDGE}/doc-index.ts`);
  const hit = /export const INDEX_NODE_ID = "([^"]+)";/.exec(stripComments(docIndexSrc));
  assert.ok(hit, "doc-index.ts 的 INDEX_NODE_ID 形状变了（或它不再导出了）");
  assert.equal(
    CANVAS_CONTRACT.tiers.applyCommands.delete_node.destructiveWhen,
    hit[1],
    "契约里那个「删了就全没了」的 id 与页面侧的保留 id 对不上",
  );
  // 反向：手册也必须还在教这件事，否则模型根本读不到这条警告。
  assert.ok(
    skillCommandsMd.includes(hit[1]),
    `手册里一个字都没提 ${hit[1]} —— 那条最贵的警告不见了`,
  );
});

/** `export const` 一个都不能少：policy.mjs 运行时导出的常量都要有类型面。 */
test("policy.mjs 导出的每个常量在 policy.d.mts 里都有声明", () => {
  const exported = [
    ...stripComments(policySrc).matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g),
  ].map((hit) => hit[1]);
  assert.ok(exported.length >= 5, "没提取到 policy.mjs 的导出 —— 这条闸在空转");
  const policyDts = stripComments(
    readFileSync(path.join(packageRoot, "src", "policy.d.mts"), "utf8"),
  );
  const declaredNames = new Set(
    [...policyDts.matchAll(/export\s+declare\s+const\s+([A-Za-z_$][\w$]*)/g)].map((hit) => hit[1]),
  );
  for (const name of exported)
    assert.ok(declaredNames.has(name), `policy.mjs 导出了 ${name}，policy.d.mts 没有声明它`);
});

/**
 * 案底形状：手册 1600 行，宿主的文件读取工具会在中途截断，而且不会说缺了哪半份。
 * 模型拿半份当全份用，于是「这条命令不存在吧」这类判断就出现了。顶部那张小节索引
 * 是唯一的解药 —— 但它本身必须与真实标题一致，否则「按标题原文搜」搜不到，
 * 比没有索引更糟。索引里**不写行号**：行号随任何一次编辑失效且没有任何东西看管它。
 */
test("commands.md 顶部的小节索引与真实的 `## ` 标题双向对上（且不写行号）", () => {
  const block = /\n## 小节索引[^\n]*\n([\s\S]*?)\n## 铁律/.exec(skillCommandsMd);
  assert.ok(block, "commands.md 顶部的小节索引不见了 —— 模型只能整读，然后拿到半份");
  const rows = block[1].split("\n").filter((line) => line.startsWith("| `"));
  const headings = [...skillCommandsMd.matchAll(/^## (.+)$/gm)]
    .map((hit) => `## ${hit[1]}`)
    .filter((heading) => !/^## (?:\d+[a-z]?\.|小节索引)/.test(heading));
  assert.ok(headings.length >= 10, "没提取到一级小节标题 —— 这条闸在空转");
  for (const heading of headings)
    assert.ok(block[1].includes(heading), `小节索引漏了「${heading}」`);
  assert.equal(
    rows.length,
    headings.length,
    `索引列了 ${rows.length} 行，实际有 ${headings.length} 个小节（多出来的那行指向一个不存在的标题）`,
  );
  assert.equal(
    rows.some((row) => /第\s*\d+\s*行|:\d{3,}|\|\s*\d{3,}\s*\|/.test(row)),
    false,
    "索引行里出现了行号：行号随下一次编辑就失效，而且没有任何闸看管它",
  );
});

/**
 * 「主与 worker 各自能做什么」原本在 `# CLI command reference` 里面 —— 也就是弱模型
 * 多半读不到的那一半。它必须在**场景表**里：worker 该不该自己 `connect`、能不能
 * `run`，是模型发第一条命令之前就要知道的事。
 */
test("主与 worker 的权限小节在场景表里（不在参考手册那一半）", () => {
  const heading = "## Main and delegated worker sessions";
  assert.ok(skillCommandsMd.includes(heading), "主与 worker 的权限小节不见了");
  assert.ok(
    scenarioTable.includes(heading),
    "主与 worker 的权限小节又回到 `# CLI command reference` 里面去了 —— 弱模型读不到那一半",
  );
  // 它得真的讲清 worker 不能做什么，否则只是个空标题。
  const section = scenarioTable.slice(scenarioTable.indexOf(heading));
  for (const word of ["upload_asset", "export_output", "delegate"])
    assert.ok(section.includes(word), `worker 权限小节里没提 ${word}`);
});

/* ───────────────── doc@1 文档库：契约就是服务端生效的那一份 ───────────────── */

/**
 * `CANVAS_CONTRACT.documents` 不是一份说明书：服务端的校验（`apps/web/libs/documents/schema.ts`）
 * 直接 import 这个对象，所以这里钉两件事 —— 页面侧没有第二张表，且它的类型面（`DocumentDto` 的
 * 字段）与契约的 `fields` 逐字、同序一致。少钉一条，编剧 / 拉片 / 剧本转视频照着契约写入的东西就会
 * 被服务端按另一张表拒掉（或者更糟：面板里多出一个错字分组）。
 */
const documentsSchemaSrc = read("apps/web/libs/documents/schema.ts");

test("文档库的服务端校验 import 的就是契约的 DOCUMENTS 与 policy 的字段表，页面侧没有第二张表", () => {
  assert.match(
    documentsSchemaSrc,
    /import \{ DOCUMENTS \} from "[^"]*canvas-cli\/src\/contract\.mjs";/,
  );
  assert.match(
    documentsSchemaSrc,
    /import \{\s*DOCUMENTS_LIST_FIELDS,\s*DOCUMENTS_PUT_FIELDS,\s*\} from "[^"]*canvas-cli\/src\/policy\.mjs";/,
  );
  const clean = stripComments(documentsSchemaSrc);
  // 取值表只能来自契约：docType 的登记值一个都不许在源码里出现，栏 / 格式也不许写成数组字面量
  // （单个值当缺省用 —— `"reference"`、`"markdown"` —— 是用法，不是表）。
  for (const literal of ['"skeleton"', '"lap-report"', '"lap-ledger"', '"genre-strategy"'])
    assert.equal(clean.includes(literal), false, `schema.ts 里又抄了一份 docType 表（${literal}）`);
  assert.doesNotMatch(clean, /\[\s*"reference",\s*"script"\s*\]/, "schema.ts 里又抄了一份栏的表");
  assert.doesNotMatch(clean, /\[\s*"markdown",\s*"srt"/, "schema.ts 里又抄了一份格式表");
  // DocumentDto 的字段 = 契约的 fields，逐字同序。
  const block = /export interface DocumentDto \{([\s\S]*?)\n\}/.exec(clean);
  assert.ok(block, "schema.ts 的 DocumentDto 形状变了");
  const fields = [...block[1].matchAll(/^ {2}(\w+)\??:/gm)].map((hit) => hit[1]);
  assert.deepEqual(fields, DOCUMENTS.fields);
});

test("DOCUMENTS 的上限与 policy 同源；id 语法挡得住该挡的", () => {
  assert.equal(DOCUMENTS.idMaxLength, DOCUMENT_ID_MAX_LENGTH);
  assert.equal(DOCUMENTS.contentMaxChars, DOCUMENT_CONTENT_MAX_CHARS);
  assert.equal(CANVAS_CONTRACT.documents, DOCUMENTS);
  // id 上限 20：`doc:<id>@<version>` 放得进 30 字的节点标签（5 位版本号以内）。
  assert.ok(
    DOCUMENTS.nodeTagPrefix.length + DOCUMENTS.idMaxLength + 1 + 5 <=
      CANVAS_CONTRACT.limits["update_node.draft.assetTags"].itemMaxLength,
  );
  const id = new RegExp(DOCUMENTS.idPattern, "u");
  for (const ok of [
    "script:ep:01",
    "outline",
    "lap-report:狂飙01",
    "novel:k3x9:0001",
    "note:对标-分析",
  ])
    assert.ok(id.test(ok), `${ok} 应当合法`);
  for (const bad of ["Script:ep", "a::b", "script:", "x#1", "a@2", "a b", ":a", "3d:x"])
    assert.equal(id.test(bad), false, `${bad} 应当不合法`);
  // 剧本栏只收 script；反推剧本也是 script（来源在 source 字段），全局骨架不算剧本。
  assert.deepEqual(DOCUMENTS.scriptSectionDocTypes, ["script"]);
  assert.ok(DOCUMENTS.docTypes.includes("skeleton"));
  assert.ok(DOCUMENTS.fields.includes("source"));
  // 列表与写入的线协议字段就是契约的字段（去掉服务端决定的 version / contentSha / contentUrl / updatedAt；
  // contentUrl 是 0.16.2 起正文文件在 CDN 上的链接，A68）。
  const serverOwned = ["version", "contentSha", "contentUrl", "updatedAt"];
  assert.deepEqual(
    DOCUMENTS_PUT_FIELDS.filter((field) => !["expectVersion", "content"].includes(field)).sort(),
    DOCUMENTS.fields.filter((field) => !serverOwned.includes(field)).sort(),
  );
  for (const field of DOCUMENTS_LIST_FIELDS.filter(
    (key) => !["q", "limit", "offset"].includes(key),
  ))
    assert.ok(DOCUMENTS.fields.includes(field === "docType" ? "docType" : field), field);
});

/**
 * 拉片、编剧两边的产品验收都报过：commands.md 英文的 Hard limits 表还写着「≤ 1,000,000 characters」与
 * `invalid_request` "content must be a string of at most 1000000 characters"，与同一份手册的 Size 段（5 万字、
 * `too_large` 带 `chars` / `limitChars`）自相矛盾 —— Agent 按表拆篇就拆错了数。
 */
test("commands.md 的 Hard limits 表：docs 正文一行写的是契约的 contentMaxChars（50,000）、超了 too_large 带 chars / limitChars，与 Size 段一致；随包手册全文不再出现旧上限 1,000,000", () => {
  const cap = DOCUMENTS.contentMaxChars.toLocaleString("en-US");
  assert.equal(cap, "50,000");
  const limits = /\n## Hard limits every call is checked against\n([\s\S]*?)\n## /.exec(
    skillCommandsMd,
  );
  assert.ok(limits, "commands.md 的 Hard limits 一节不见了");
  const row = limits[1]
    .split("\n")
    .find((line) => /^\| `docs create` \/ `docs update` text +\|/.test(line));
  assert.ok(row, "Hard limits 表没有 docs 正文那一行");
  assert.match(row, new RegExp(`≤ ${cap} characters per document`));
  assert.match(row, /`too_large`[^|]*`chars`[^|]*`limitChars`/);
  assert.doesNotMatch(row, /invalid_request/, "docs 正文超长早就不是 invalid_request 了");
  const size = skillCommandsMd.slice(
    skillCommandsMd.indexOf("**Size.**"),
    skillCommandsMd.indexOf("**Folders.**"),
  );
  assert.match(size, new RegExp(`at most ${cap} characters`));
  assert.match(size, /`too_large`[^.]*`chars` and `limitChars`/);
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  for (const [name, text] of [
    ["commands.md", skillCommandsMd],
    ["SKILL.md", skill],
  ])
    for (const stale of ["1,000,000", "1000000", "1_000_000"])
      assert.equal(text.includes(stale), false, `${name} 还写着旧上限 ${stale}`);
});

test("DOCUMENTS.errors 里 0.16.2 新加的码都写进了随包手册（SKILL.md、commands.md）、CHANGELOG 与 doc@1 约定；页面桥原码透传", () => {
  const docs = {
    skill: read("packages/canvas-cli/skills/scenemint-canvas/SKILL.md"),
    commands: read("packages/canvas-cli/skills/scenemint-canvas/references/commands.md"),
    changelog: read("packages/canvas-cli/CHANGELOG.md"),
    convention: read("docs/conventions/doc.md"),
  };
  assert.equal(DOCUMENTS.errors.quotaExceeded, "quota_exceeded");
  const added = ["uploadFailed", "contentUnavailable", "quotaExceeded"].map(
    (key) => DOCUMENTS.errors[key],
  );
  for (const code of added)
    for (const [name, text] of Object.entries(docs))
      assert.match(text, new RegExp(`\\b${code}\\b`), `${name} 没写 ${code}`);
  // 页面桥：quota_exceeded 不折叠成 invalid_request（400 那一条之前就按码原样带回，带着 usedBytes / limitBytes）。
  const bridge = stripComments(read(`${BRIDGE}/documents.ts`));
  const quota = bridge.indexOf("DOC_QUOTA_EXCEEDED)");
  const invalid = bridge.indexOf('fail("invalid_request"');
  assert.ok(quota > 0 && invalid > quota, "quota_exceeded 要在 400 → invalid_request 之前原样带回");
});

/**
 * 错误码总表的名字与范围（最终验收建议 1–2）：它原叫「Every error code the page can return」，可页面桥还有十几个码不在表里
 * （`models` 的 `model_catalog_*`、媒体传输的 `media_*`、`bridge_missing`、配对 / 连接层的……），名不副实。表名改成它真正
 * 覆盖的范围 —— 画布命令（契约 bridgeErrors）+ 用页面登录态请求服务端的两条桥（文档库、剪映草稿目录）—— 并说清其它桥的码
 * 在各自章节；钉子钉住这个范围里的每个码。两条桥的码直接从源码 `fail(…)` 的第一个实参抽：字符串字面量照抄；常量
 * （`fail(DOC_QUOTA_EXCEEDED, …)`）按 schema.ts 的 `export const DOC_… = DOCUMENTS.errors.<键>` 解成码；转发上游码的
 * `fail(error.code, …)` 取前面 `error.code === DOC_…` 判过的那几个；认不出的写法、解不出的常量都直接红，不静默漏掉。
 */
test("错误码总表「Error codes: canvas commands, the document library and Jianying folders」：契约 DOCUMENTS.errors 与 bridgeErrors 的每个码、文档库 / 剪映草稿目录两条页面桥 fail(…) 出的每个码（字面量、常量、转发的上游码都抽）各占一行；表头一段说清其它桥的码在各自章节；DOCUMENTS.errors 的码 SKILL.md 与 PROTOCOL.md 也都写到了（.d.mts 由 assertShape 逐字对齐）", () => {
  assert.doesNotMatch(
    skillCommandsMd,
    /### Every error code the page can return/,
    "总表还叫「Every error code…」：它只覆盖画布命令、文档库与剪映草稿目录三条桥",
  );
  const heading = "### Error codes: canvas commands, the document library and Jianying folders";
  const at = skillCommandsMd.indexOf(heading);
  assert.ok(at > 0, "commands.md 里找不到错误码总表");
  const lines = skillCommandsMd.slice(at + heading.length).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  // 表头那一段：说清这张表的范围，以及其它桥（models、页面太旧的 bridge_missing、媒体传输 / 配对）的码不在这里。
  const lead = lines.slice(0, start).join("\n");
  assert.match(lead, /`CANVAS_CONTRACT\.bridgeErrors`/);
  assert.match(lead, /document library[\s\S]*Jianying draft folders/);
  assert.match(
    lead,
    /Other bridges have codes of their own, covered with their commands rather than here/,
  );
  assert.match(lead, /`model_catalog_unavailable`[\s\S]*`bridge_missing`/);
  const rows = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith("|")) break;
    rows.push(line);
  }
  // 码名里可以有数字（scene3d_conflict）。
  const tableCodes = new Set(
    rows.map((row) => /^\|\s*`([a-z0-9_]+)`/.exec(row)?.[1]).filter((code) => code !== undefined),
  );
  assert.ok(tableCodes.size >= 20, `总表只提取出 ${tableCodes.size} 个码 —— 这条闸在空转`);
  const docs = {
    "SKILL.md": read("packages/canvas-cli/skills/scenemint-canvas/SKILL.md"),
    "PROTOCOL.md": read("packages/canvas-cli/PROTOCOL.md"),
  };
  const codes = Object.values(DOCUMENTS.errors);
  assert.equal(codes.length, 6);
  const missing = [];
  for (const code of codes) {
    if (!tableCodes.has(code)) missing.push(`commands.md 总表缺 ${code}`);
    for (const [name, text] of Object.entries(docs))
      if (!text.includes(`\`${code}\``)) missing.push(`${name} 没写 ${code}`);
  }
  // 整合任务：页面桥的每个错误码（契约 bridgeErrors，含 run-tool 的 tool_not_found / tool_not_applicable），总表都各占一行。
  for (const code of Object.keys(CANVAS_CONTRACT.bridgeErrors))
    if (!tableCodes.has(code)) missing.push(`commands.md 总表缺 ${code}（bridgeErrors）`);
  // 文档库 / 剪映草稿目录两条桥的码不在契约里（兜底的 documents_unavailable / jianying_roots_unavailable、登录过期的
  // unauthorized、连接已关的 disconnected……），从源码 fail(…) 抽。兜底码写成多行 `fail(\n  "code",`：正则要跨空白认。
  const errorConstants = Object.fromEntries(
    [
      ...stripComments(read("apps/web/libs/documents/schema.ts")).matchAll(
        /export const (DOC_[A-Z_]+) = DOCUMENTS\.errors\.(\w+);/g,
      ),
    ].map(([, name, key]) => [name, DOCUMENTS.errors[key]]),
  );
  assert.ok(
    Object.values(errorConstants).filter(Boolean).length >= 6,
    "schema.ts 里解不出 DOC_… = DOCUMENTS.errors.… 常量 —— 这条闸在空转",
  );
  const constantCode = (file, name) => {
    assert.ok(errorConstants[name], `${file} 的 fail(${name}, …)：这个常量解不出码，钉子跟着改`);
    return errorConstants[name];
  };
  const failCodes = (file) => {
    const src = stripComments(read(`${BRIDGE}/${file}`));
    const found = new Set();
    for (const [, arg] of src.matchAll(/(?<!function )\bfail\(\s*([^,\s)]+)/g)) {
      if (/^"[a-z0-9_]+"$/.test(arg)) found.add(arg.slice(1, -1));
      else if (/^[A-Z][A-Z0-9_]*$/.test(arg)) found.add(constantCode(file, arg));
      else if (arg === "error.code") {
        // 转发上游码：转发的只会是前面 `error.code === 常量` 判过的那几个。
        const guarded = [...src.matchAll(/error\.code === ([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
        assert.ok(
          guarded.length > 0,
          `${file} 的 fail(error.code, …) 前面没有 error.code === 常量 的判断`,
        );
        for (const name of guarded) found.add(constantCode(file, name));
      } else assert.fail(`${file} 的 fail(${arg}, …)：认不出这个码的写法，钉子跟着改`);
    }
    return [...found];
  };
  const bridged = {
    "documents.ts": failCodes("documents.ts"),
    "jianying-roots.ts": failCodes("jianying-roots.ts"),
  };
  for (const [file, extracted] of Object.entries(bridged))
    assert.ok(extracted.length >= 4, `${file} 只抽出 ${extracted.length} 个码 —— 这条闸在空转`);
  // 字面量、多行字面量、常量（quota_exceeded）、转发的上游码（upload_failed / content_unavailable）都得抽到。
  for (const code of [
    "documents_unavailable",
    "unauthorized",
    "disconnected",
    "quota_exceeded",
    "upload_failed",
    "content_unavailable",
  ])
    assert.ok(
      bridged["documents.ts"].includes(code),
      `documents.ts 没抽出 ${code}：正则不认它的写法`,
    );
  for (const code of ["jianying_roots_unavailable", "unauthorized", "disconnected"])
    assert.ok(
      bridged["jianying-roots.ts"].includes(code),
      `jianying-roots.ts 没抽出 ${code}：正则不认它的写法`,
    );
  for (const [file, extracted] of Object.entries(bridged))
    for (const code of extracted)
      if (!tableCodes.has(code)) missing.push(`commands.md 总表缺 ${code}（${file}）`);
  assert.deepEqual([...new Set(missing)], []);
});

/**
 * 整合验收建议 1（a8b0798b）补的一句：`update_node` 写 `outputUrl: null` 与「清空媒体」同一口径 —— 换过图的站位图去掉
 * `replaced`、只留三键，下次 run-stills 照常补回同一个节点。手册、更新说明、约定都写了，却没有钉子；改这一段时最容易被
 * 顺手删掉（最终验收建议 2）。
 */
test("A71 补充：update_node 写 outputUrl:null 同样算清空 —— 6f、CHANGELOG 0.16.2 与约定修订 39（0.16.2 线的修订 30，合流顺延）都写着", () => {
  const scene6f = skillCommandsMd.slice(
    skillCommandsMd.indexOf("\n## 6f."),
    skillCommandsMd.indexOf("\n## 7."),
  );
  assert.match(
    scene6f,
    /清空即去掉 `replaced`（`stillOf` 只剩 `sceneNodeId` \/ `shotId` \/ `frame`），照常补回同一个节点。`update_node` 写 `outputUrl: null` 同样算清空。/,
    "6f 没写「update_node 写 outputUrl: null 同样算清空」",
  );
  const changelog = readFileSync(path.join(packageRoot, "CHANGELOG.md"), "utf8");
  const release = changelog.slice(changelog.indexOf("## 0.16.2"), changelog.indexOf("## 0.15.1"));
  assert.match(
    release,
    /clearing a replaced still drops its mark \(`sceneNodeId`, `shotId` and\s+`frame` stay; `update_node` writing `outputUrl: null` clears it the same way\)/,
    "CHANGELOG 0.16.2 没写 update_node 写 null 同样算清空",
  );
  const convention = read("docs/conventions/scene-3d.md");
  assert.match(
    convention,
    /〔修订 39〕[^\n]*换过图的被清空媒体即去掉 `replaced`[^\n]*`update_node` 写 `outputUrl: null` 同样算清空/,
    "约定修订 39 没写 update_node 写 null 同样算清空",
  );
});

test("文档库的文件夹汇总 documents_folders：只读、worker 能调，只收 section；folderIdPattern 认得出文件夹 id", () => {
  assert.ok(READ_METHODS.has("documents_folders"));
  assert.equal(MAIN_METHODS.has("documents_folders"), false);
  assert.equal(MUTATIONS.has("documents_folders"), false);
  const refused = (role, params) => {
    try {
      enforceRequestPolicy(role, "documents_folders", params);
      return null;
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(refused("worker", {}), null);
  assert.equal(refused("worker", { section: "reference" }), null);
  assert.equal(refused("main", { section: 3 }), "invalid_request");
  assert.equal(refused("main", { folder: "x" }), "invalid_request");
  assert.equal(refused("main", { projectId: "p" }), "invalid_request");
  const folderId = new RegExp(DOCUMENTS.folderIdPattern, "u");
  for (const ok of ["novel:k3x9", "lap-report:a1b2"]) assert.ok(folderId.test(ok), ok);
  for (const bad of ["novel:k3x9:0001", "novel", "novel:K3X9", "novel:abc", "Novel:k3x9"])
    assert.equal(folderId.test(bad), false, bad);
  // 文件夹 id 是文件夹里文档 id 的前两段：那样的文档 id 本身也合 idPattern。
  assert.ok(new RegExp(DOCUMENTS.idPattern, "u").test("novel:k3x9:0001"));
});

test("文档库四个方法：读 worker 能调，写 / 删只有 main；删除必须带点名这一篇的 approval", () => {
  assert.ok(READ_METHODS.has("documents_list") && READ_METHODS.has("documents_get"));
  assert.ok(MAIN_METHODS.has("documents_put") && MAIN_METHODS.has("documents_delete"));
  const refused = (role, method, params) => {
    try {
      enforceRequestPolicy(role, method, params);
      return null;
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(refused("worker", "documents_list", { section: "script" }), null);
  assert.equal(refused("worker", "documents_get", { id: "outline" }), null);
  assert.equal(
    refused("worker", "documents_put", { id: "outline", expectVersion: 1, content: "x" }),
    "worker_forbidden",
  );
  assert.equal(
    refused("worker", "documents_delete", {
      id: "outline",
      approval: { userApprovedDocumentIds: ["outline"] },
    }),
    "worker_forbidden",
  );
  assert.equal(refused("main", "documents_delete", { id: "outline" }), "approval_required");
  assert.equal(
    refused("main", "documents_delete", {
      id: "outline",
      approval: { userApprovedDocumentIds: ["other"] },
    }),
    "approval_required",
  );
  assert.equal(
    refused("main", "documents_delete", {
      id: "outline",
      approval: { userApprovedDocumentIds: ["outline"] },
    }),
    null,
  );
  assert.equal(
    refused("main", "documents_put", { expectVersion: 2, content: "x" }),
    "invalid_request",
  );
  assert.equal(
    refused("main", "documents_put", { id: "outline", expectVersion: 1, summery: "x" }),
    "invalid_request",
  );
  assert.equal(
    refused("main", "documents_put", {
      id: "outline",
      expectVersion: 1,
      content: "x".repeat(DOCUMENT_CONTENT_MAX_CHARS + 1),
    }),
    "too_large",
  );
  // 页面侧（与守护进程同一份 policy）与服务端同一个码、同一组字段：chars / limitChars。
  try {
    enforceRequestPolicy("main", "documents_put", {
      id: "outline",
      expectVersion: 1,
      content: "x".repeat(DOCUMENT_CONTENT_MAX_CHARS + 1),
    });
    assert.fail("5 万字以上应当被拒");
  } catch (error) {
    assert.deepEqual(error.toError(), {
      code: "too_large",
      message: `content is ${DOCUMENT_CONTENT_MAX_CHARS + 1} characters; one document holds at most ${DOCUMENT_CONTENT_MAX_CHARS}. Split it into several documents (for example one per episode), each under the limit`,
      chars: DOCUMENT_CONTENT_MAX_CHARS + 1,
      limitChars: DOCUMENT_CONTENT_MAX_CHARS,
    });
  }
  assert.equal(
    refused("main", "documents_put", { id: "outline", expectVersion: 1, content: 3 }),
    "invalid_request",
  );
  // 上限按换行统一成 LF 之后计（与服务端同一个口径）：CRLF 让原始长度超了、LF 口径正好在上限上的放行。
  assert.equal(
    refused("main", "documents_put", {
      id: "outline",
      expectVersion: 1,
      content: "x\r\n".repeat(DOCUMENT_CONTENT_MAX_CHARS / 2),
    }),
    null,
  );
  assert.equal(
    refused("main", "documents_put", {
      id: "outline",
      expectVersion: 1,
      content: `${"x\r\n".repeat(DOCUMENT_CONTENT_MAX_CHARS / 2)}x`,
    }),
    "too_large",
  );
  assert.equal(
    refused("main", "documents_get", { id: "x".repeat(DOCUMENT_ID_MAX_LENGTH + 1) }),
    "invalid_request",
  );
  assert.equal(refused("main", "documents_list", { projectId: "p" }), "invalid_request");
  assert.equal(
    refused("main", "documents_get", { id: "outline", approval: {} }),
    "invalid_request",
  );
  // 0.16.2：documents_get 可带 ifVersion（与这个版本相同就不回正文，`docs read --if-version`），正整数。
  assert.deepEqual(DOCUMENTS_GET_FIELDS, ["id", "ifVersion"]);
  assert.equal(refused("worker", "documents_get", { id: "outline", ifVersion: 3 }), null);
  for (const bad of [0, -1, 1.5, "3", null])
    assert.equal(
      refused("main", "documents_get", { id: "outline", ifVersion: bad }),
      "invalid_request",
      `ifVersion ${JSON.stringify(bad)}`,
    );
});

/**
 * 编剧验收：docs 的坏参数一个都不带 `error.path`（手册的错误码总表却说 `invalid_request` 的 `error.path` 点名字段）。
 * 守护进程与页面跑的是同一份 policy：它挡下的 documents_* 参数错误都要点名字段，与服务端的 400、CLI 的本地检查同一个口径。
 */
test("文档库四个方法的参数错误（守护进程 / 页面那一道 policy）都带 error.path 点名字段", () => {
  const wire = (method, params) => {
    try {
      enforceRequestPolicy("main", method, params);
      return null;
    } catch (error) {
      return error.toError();
    }
  };
  const id = "x".repeat(DOCUMENT_ID_MAX_LENGTH + 1);
  for (const [method, params, field] of [
    ["documents_put", { expectVersion: 0, summery: "x" }, "summery"],
    ["documents_put", { id, expectVersion: 0 }, "id"],
    ["documents_get", { id }, "id"],
    ["documents_delete", { id: "", approval: { userApprovedDocumentIds: [""] } }, "id"],
    ["documents_put", { id: "outline" }, "expectVersion"],
    ["documents_put", { expectVersion: 1 }, "expectVersion"],
    ["documents_put", { id: "outline", expectVersion: 1.5 }, "expectVersion"],
    ["documents_put", { id: "outline", expectVersion: 1, content: 3 }, "content"],
    ["documents_put", { id: "outline", expectVersion: 1, title: "长".repeat(1001) }, "title"],
    ["documents_put", { id: "outline", expectVersion: 1, sourceAgent: 3 }, "sourceAgent"],
    ["documents_put", { id: "outline", expectVersion: 1, assetTags: "白妍" }, "assetTags"],
    ["documents_put", { id: "outline", expectVersion: 1, episode: -1 }, "episode"],
    ["documents_list", { limit: 0 }, "limit"],
    ["documents_list", { offset: -1 }, "offset"],
    ["documents_list", { episode: null }, "episode"],
    ["documents_get", { id: "outline", ifVersion: 0 }, "ifVersion"],
    ["documents_get", { id: "outline", ifVersion: null }, "ifVersion"],
    ["documents_folders", { section: 3 }, "section"],
  ]) {
    const error = wire(method, params);
    assert.equal(error?.code, "invalid_request", `${method} ${JSON.stringify(params)}`);
    assert.equal(error.path, field, `${method} ${JSON.stringify(params)}：${error.message}`);
  }
  // 超长正文是 too_large（带 chars / limitChars），不是参数错误；删除没带同意是 approval_required —— 都不带 path。
  const long = wire("documents_put", {
    id: "outline",
    expectVersion: 1,
    content: "x".repeat(DOCUMENT_CONTENT_MAX_CHARS + 1),
  });
  assert.equal(long.code, "too_large");
  assert.equal(Object.hasOwn(long, "path"), false);
  const unapproved = wire("documents_delete", { id: "outline" });
  assert.equal(unapproved.code, "approval_required");
  assert.equal(Object.hasOwn(unapproved, "path"), false);
});

/* ───────────────────── run_tool 的本地免费工具（LOCAL_TOOLS） ───────────────────── */

/**
 * `LOCAL_TOOLS` 是页面直接 import 的那一份（`kinds` 与页面注册表的双向对齐在
 * tests/studio/canvas-annotate-text.test.ts 里钉：那边能 import 注册表，这边是纯 Node）。
 * 这里钉包内的三件事：分级表里 run-tool 的 `localKinds` 就是它（同一个数组，不是抄本）；
 * 页面的工具实现真的 import 它、没有第二张表；契约对象上挂的是同一个对象。
 */
test("tiers.run-tool.localKinds 就是 LOCAL_TOOLS.kinds（同一个数组），契约上的 localTools 是同一个对象", () => {
  assert.equal(CANVAS_CONTRACT.tiers["run-tool"].localKinds, LOCAL_TOOLS.kinds);
  assert.equal(CANVAS_CONTRACT.localTools, LOCAL_TOOLS);
  // run-tool 本身仍是 L2 付费档：本地 kind 是它的例外，不是把整条命令降档。
  assert.equal(CANVAS_CONTRACT.tiers["run-tool"].level, "L2");
  assert.equal(CANVAS_CONTRACT.tiers["run-tool"].approval, true);
  assert.ok(LOCAL_TOOLS.kinds.includes("annotate-image"));
  assert.equal(new Set(LOCAL_TOOLS.kinds).size, LOCAL_TOOLS.kinds.length);
});

test("tiers.run.localKinds 是节点 kind（scene-3d），不是工具 kind；run 本身仍是 L2 / --approved / 只有主会话", () => {
  const run = CANVAS_CONTRACT.tiers.run;
  assert.deepEqual(run.localKinds, ["scene-3d"]);
  // 节点 kind：每一个都是画布图里的 kind（DRAFT_KEYS 的键），且与 run-tool 的工具 kind 不相交。
  for (const kind of run.localKinds) {
    assert.ok(Object.hasOwn(DRAFT_KEYS, kind), `${kind} 不是节点 kind`);
    assert.equal(LOCAL_TOOLS.kinds.includes(kind), false, `${kind} 混进了工具 kind`);
  }
  assert.notEqual(run.localKinds, CANVAS_CONTRACT.tiers["run-tool"].localKinds);
  assert.equal(run.level, "L2");
  assert.equal(run.approval, true);
  assert.equal(run.mainOnly, true);
  // run-batch 没有自己的 localKinds：宿主按每个节点的 kind 套 run 的这张表。
  assert.equal("localKinds" in CANVAS_CONTRACT.tiers["run-batch"], false);
});

test("页面的本地工具实现 import 的就是契约的 LOCAL_TOOLS，没有第二张表", () => {
  const pixelTools = read("apps/web/libs/canvas/tools/image-pixel-tools.ts");
  assert.match(
    pixelTools,
    /import \{ LOCAL_TOOLS \} from "(?:\.\.\/)+packages\/canvas-cli\/src\/contract\.mjs";/,
  );
  assert.match(pixelTools, /LOCAL_TOOLS\.annotate\.text/);
  // 标注种类：契约 markKinds = 页面 AnnotateTool 联合 + text。
  const ops = stripComments(read("apps/web/libs/canvas/image-pixel-ops.ts"));
  assert.deepEqual([...literalUnion(ops, "AnnotateTool"), "text"], LOCAL_TOOLS.annotate.markKinds);
  assert.deepEqual(literalUnion(ops, "AnnotateTextAlign"), LOCAL_TOOLS.annotate.text.aligns);
  assert.match(pixelTools, /export const ANNOTATE_MAX_STROKES = 200;/);
  assert.equal(LOCAL_TOOLS.annotate.maxMarks, 200);
});

test("asset-sheet：页面的参数 / 版式 / 工具都 import 契约的 LOCAL_TOOLS；A30 字段数自洽；没有参照物档位表", () => {
  for (const file of [
    "asset-sheet/schema.ts",
    "asset-sheet/layout.ts",
    "tools/asset-sheet-tool.ts",
  ])
    assert.match(
      read(`apps/web/libs/canvas/${file}`),
      /import \{ LOCAL_TOOLS \} from "(?:\.\.\/)+packages\/canvas-cli\/src\/contract\.mjs";/,
      `${file} 没 import 契约的 LOCAL_TOOLS`,
    );
  const sheet = LOCAL_TOOLS.assetSheet;
  assert.ok(LOCAL_TOOLS.kinds.includes("asset-sheet"));
  // A30：人物 14 项、场景 9 项、道具 7 项；派生的键都在字段表里。
  assert.deepEqual(
    Object.fromEntries(sheet.assetKinds.map((kind) => [kind, sheet.fields[kind].length])),
    { character: 14, scene: 9, prop: 7 },
  );
  for (const kind of sheet.assetKinds) {
    for (const key of sheet.derivedFields[kind]) assert.ok(sheet.fields[kind].includes(key));
    assert.equal(new Set(sheet.fields[kind]).size, sheet.fields[kind].length);
  }
  assert.deepEqual(Object.keys(sheet.panels), sheet.assetKinds);
  // A57：每个资产美术只出一张图（run-tool 的 NODE-ID），primary 是它的名字、cells 是它从左到右装着什么。
  assert.deepEqual(sheet.panels, {
    character: {
      primary: "baselineSheet",
      cells: ["face", "threeView"],
      extra: ["face", "threeView"],
      combined: { baselineSheet: ["face", "threeView"] },
    },
    scene: { primary: "sceneSheet", cells: ["scene", "plan"], extra: [] },
    prop: { primary: "propSheet", cells: ["front", "back", "held"], extra: [] },
  });
  // 人物的 metadata.panels.baselineSheet 就是 primary 那一张（可以就是 NODE-ID），装的就是 cells；旧项目分开给的两张 = extra。
  assert.deepEqual(sheet.panels.character.combined, {
    [sheet.panels.character.primary]: sheet.panels.character.cells,
  });
  assert.deepEqual(sheet.panels.character.extra, sheet.panels.character.cells);
  for (const kind of ["scene", "prop"]) {
    assert.equal("combined" in sheet.panels[kind], false);
    assert.equal("refs" in sheet.panels[kind], false);
  }
  assert.ok(sheet.infoMaxHeightRatio > 0 && sheet.infoMaxHeightRatio <= 0.15);
  // A57：人物比例格的标尺人物回来了（scaleRefs）；户型图不再由画布画尺寸线（planAspectTolerance 没了）；外部参照物档位、
  // 比例轴、投影阈值仍没有（投影阈值在 scaleLineup，比例格量人像时用它的缺省值）。
  assert.deepEqual(Object.keys(sheet).sort(), [
    "assetKinds",
    "derivedFields",
    "fieldMaxChars",
    "fields",
    "geometryKeys",
    "heldModeMaxCm",
    "heldModes",
    "infoMaxHeightRatio",
    "locales",
    "panels",
    "scaleRefs",
  ]);
  assert.equal(
    existsSync(path.join(repoRoot, "apps/web/libs/canvas/asset-sheet/reference-objects.ts")),
    false,
  );
});

test("A57 道具 / 场景：一张图就是 NODE-ID；三格图右格几种与缺省分档、比例格标尺人物的上限在契约里，页面从契约取", () => {
  const sheet = LOCAL_TOOLS.assetSheet;
  // 右格三种（A46 补充、A57）：缺省按长边分档，除最后一档（在旁）外都有上限，且递增。
  assert.deepEqual(sheet.heldModes, ["handClose", "hand", "beside"]);
  assert.deepEqual(Object.keys(sheet.heldModeMaxCm), sheet.heldModes.slice(0, -1));
  assert.deepEqual(sheet.heldModeMaxCm, { handClose: 30, hand: 60 });
  // 标尺人物：1–2 个，名字 ≤ 20 字；身高差超过 noteHeightRatio 倍照画、notes 说明（不退回外部参照物）。
  assert.deepEqual(sheet.scaleRefs, { min: 1, max: 2, labelMaxChars: 20, noteHeightRatio: 4 });
  assert.ok(sheet.scaleRefs.min >= 1 && sheet.scaleRefs.min <= sheet.scaleRefs.max);
  const schema = read("apps/web/libs/canvas/asset-sheet/schema.ts");
  assert.match(schema, /SHEET\.heldModes/);
  assert.match(schema, /SHEET\.heldModeMaxCm/);
  assert.match(schema, /SHEET\.scaleRefs/);
  assert.match(schema, /SHEET\.panels\.character/);
  assert.match(
    read("apps/web/libs/canvas/tools/asset-sheet-tool.ts"),
    /SHEET\.scaleRefs\.noteHeightRatio/,
  );
  // 0.15.0 的 backRef / heldRef / panels.plan 撤销了：页面给了就拒并说明（不是悄悄不认识）。
  for (const key of ["backRef", "heldRef", "plan"])
    assert.match(schema, new RegExp(`${key}: \\\`metadata\\.(?:panels\\.)?${key} 撤销了`));
});

test("A40 剧内比例总表：scale-lineup 从契约取上限；16:9 画幅自洽", () => {
  const lineupSrc = read("apps/web/libs/canvas/scale-lineup.ts");
  assert.match(
    lineupSrc,
    /import \{ LOCAL_TOOLS \} from "(?:\.\.\/)+packages\/canvas-cli\/src\/contract\.mjs";/,
  );
  assert.match(lineupSrc, /LOCAL_TOOLS\.scaleLineup/);
  const l = LOCAL_TOOLS.scaleLineup;
  assert.ok(LOCAL_TOOLS.kinds.includes("scale-lineup"));
  assert.deepEqual(l.itemKinds, ["character", "creature", "prop"]);
  // 画幅：aspect 就是 width : height。
  const [aw, ah] = l.aspect.split(":").map(Number);
  assert.equal(l.width * ah, l.height * aw);
  assert.equal(l.aspect, "16:9");
  // 一排、一张的上限；缺省排数不超过上限；条数上限大于一张装得下的（多了出多张）。
  assert.ok(l.perRowMax >= 1 && l.rowsPerImageDefault >= 1);
  assert.ok(l.rowsPerImageDefault <= l.rowsPerImageMax);
  assert.ok(l.maxItems > l.perRowMax * l.rowsPerImageMax);
  assert.ok(l.maxHeightRatio > 1 && l.labelMaxChars >= 1);
  // 拍板 A45①（验收 2 问题 B）：道具 item 给 sizeCm，外框长边对应哪一边由 scaleAxis 指定，取值从契约取。
  assert.deepEqual(l.scaleAxes, ["l", "w", "h"]);
  assert.match(lineupSrc, /L\.scaleAxes/);
});

test("验收修复 2：脚下投影阈值（比例总表量主体外框用）与 warnings 的码在契约里，页面从契约取", () => {
  assert.match(
    read("apps/web/libs/canvas/asset-sheet/subject.ts"),
    /LOCAL_TOOLS\.scaleLineup\.floorShadow/,
  );
  const shadow = LOCAL_TOOLS.scaleLineup.floorShadow;
  assert.deepEqual(shadow, { minLevel: 180, maxChroma: 24, maxBandRatio: 0.08 });
  // 浅灰的下限要比「白」（236）低，否则没有像素能算投影；带高比例在 (0, 0.5]。
  assert.ok(shadow.minLevel < 236 && shadow.maxChroma >= 0);
  assert.ok(shadow.maxBandRatio > 0 && shadow.maxBandRatio <= 0.5);
  assert.ok(LOCAL_TOOLS.warningCodes.includes("floor_shadow_kept"));
  assert.equal(new Set(LOCAL_TOOLS.warningCodes).size, LOCAL_TOOLS.warningCodes.length);
});

test("拍板 A60：自传图（userSheet）的阈值、剪影原因与颜色在契约里，页面从契约取", () => {
  const src = read("apps/web/libs/canvas/asset-sheet/user-subject.ts");
  assert.match(
    src,
    /import \{ LOCAL_TOOLS \} from "(?:\.\.\/)+packages\/canvas-cli\/src\/contract\.mjs";/,
  );
  assert.match(src, /LOCAL_TOOLS\.userSheet/);
  assert.match(
    read("apps/web/libs/canvas/asset-sheet/silhouette.ts"),
    /LOCAL_TOOLS\.userSheet\.silhouetteColor/,
  );
  const u = LOCAL_TOOLS.userSheet;
  assert.deepEqual(u.silhouetteReasons, ["complex_background", "no_full_body", "incomplete"]);
  // 底色容差是一个通道差多少（0–255），均匀度是比例（0, 1]；站立全身人像的高 ÷ 宽上下限、占图高、贴边都是比例。
  assert.ok(Number.isInteger(u.bgTolerance) && u.bgTolerance >= 0 && u.bgTolerance <= 255);
  assert.ok(u.bgUniformity > 0 && u.bgUniformity <= 1);
  assert.ok(u.figureAspect.min >= 1 && u.figureAspect.min < u.figureAspect.max);
  assert.ok(u.minHeightRatio > 0 && u.minHeightRatio < 1);
  assert.ok(u.edgeMarginRatio >= 0 && u.edgeMarginRatio < 0.5);
  assert.match(u.silhouetteColor, /^#[0-9A-F]{6}$/);
});

test("验收修复 2：estimated 的几何参数键、图上文字的语言在契约里；与字段表自洽", () => {
  const sheet = LOCAL_TOOLS.assetSheet;
  assert.match(read("apps/web/libs/canvas/asset-sheet/schema.ts"), /SHEET\.geometryKeys/);
  assert.match(read("apps/web/libs/canvas/asset-sheet/schema.ts"), /SHEET\.locales/);
  assert.match(read("apps/web/libs/canvas/scale-lineup.ts"), /L\.locales/);
  assert.deepEqual(Object.keys(sheet.geometryKeys), sheet.assetKinds);
  // 几何参数键不能和字段键撞名（estimated 里一个键只能指一样东西）。
  for (const kind of sheet.assetKinds)
    for (const key of sheet.geometryKeys[kind]) assert.ok(!sheet.fields[kind].includes(key));
  // 默认中文（A38④）：第一个就是缺省。
  assert.equal(sheet.locales[0], "zh");
  assert.deepEqual(sheet.locales, LOCAL_TOOLS.scaleLineup.locales);
});

test("warning 码在契约里，页面产出的就是这几个（0.15.1 撤销 plan_aspect_mismatch：户型图由美术画在同一张图里）", () => {
  assert.equal("planAspectTolerance" in LOCAL_TOOLS.assetSheet, false);
  assert.deepEqual(LOCAL_TOOLS.warningCodes, ["floor_shadow_kept", "text_overflow"]);
  // 页面产出的每一个 warning 码都在契约的表里（不许有契约外的码）。
  const codes = new Set();
  for (const file of [
    "asset-sheet/layout.ts",
    "asset-sheet/subject.ts",
    "asset-sheet/front-view.ts",
    "tools/asset-sheet-tool.ts",
    "tools/image-pixel-tools.ts",
  ])
    for (const m of read(`apps/web/libs/canvas/${file}`).matchAll(/code: "([a-z_]+)"/g))
      codes.add(m[1]);
  assert.deepEqual([...codes].sort(), [...LOCAL_TOOLS.warningCodes].sort());
});

/* ───────────── scene3d@1 三维导演台：契约块与页面 reducer / types.ts / 手册对齐 ───────────── */

const SCENE3D_DIR = "apps/web/libs/canvas/scene-3d";
const scene3dActionsClean = stripComments(read(`${SCENE3D_DIR}/actions.ts`));
const scene3dChecksClean = stripComments(read(`${SCENE3D_DIR}/checks.ts`));

test("SCENE3D.ops：op 集合 = policy 的字段表 = 页面 Scene3dAction 联合；必填表的键齐全且都在字段表里", () => {
  // op 数由守护进程的字段表推导，不写死；「契约与手册一起改」由下一条（每个 op 都在手册里）保住。
  const ops = Object.keys(SCENE3D_ACTION_FIELDS);
  assert.ok(ops.length > 0, "SCENE3D_ACTION_FIELDS 提取为空");
  assert.deepEqual(Object.keys(SCENE3D.ops), ops);
  // 必填表是契约本地的一张（与 REQUIRED_FIELDS 同一个口径），它漏一个 op = 那个 op 什么都不必填。
  assert.deepEqual(
    declaredKeys(contractClean, "SCENE3D_REQUIRED").sort(),
    [...ops].sort(),
    "SCENE3D_REQUIRED 与 SCENE3D_ACTION_FIELDS 的 op 集合不一致：加 op 时两张表必须一起改",
  );
  for (const [op, entry] of Object.entries(SCENE3D.ops)) {
    for (const key of entry.required)
      assert.ok(entry.fields.includes(key), `${op}.${key} 必填，却不在 SCENE3D_ACTION_FIELDS 里`);
  }
  // 页面 reducer 的动作联合：多一个 op = 守护进程放行、reducer 不认；少一个 = reducer 认、没人放行。
  const union = unionMembers(typeBody(scene3dActionsClean, "Scene3dAction")).map((member) => {
    const op = /\bop\s*:\s*"([a-z][a-z0-9_]*)"/.exec(member);
    assert.ok(op, `Scene3dAction 的成员没有字面量 op：${member.slice(0, 60)}`);
    return op[1];
  });
  assert.deepEqual([...union].sort(), [...ops].sort(), "Scene3dAction 联合与契约的 op 集合对不上");
});

test("每个 scene3d op 都在 commands.md 的 `scene3d_apply` 小节的 op 表里有一行", () => {
  const start = skillCommandsMd.indexOf("\n### `scene3d_apply`\n");
  assert.ok(start >= 0, "commands.md 里没有 ### `scene3d_apply` 小节");
  const rest = skillCommandsMd.slice(start + 1);
  const end = rest.slice(1).search(/\n#{2,3} /);
  const section = end < 0 ? rest : rest.slice(0, end + 1);
  for (const op of Object.keys(SCENE3D_ACTION_FIELDS))
    assert.match(section, new RegExp(`^\\| \`${op}\` +\\|`, "m"), `commands.md 的 op 表缺 ${op}`);
});

test("SCENE3D.enums 与 apps/web/libs/canvas/types.ts 的联合 / 常量表逐字一致", () => {
  for (const [key, union] of [
    ["role", "Scene3DRole"],
    ["pose", "Scene3DPose"],
    ["arms", "Scene3DArms"],
    ["focusShape", "Scene3DFocusShape"],
    ["moveEase", "Scene3DMoveEase"],
    ["aspectRatio", "Scene3DAspectRatio"],
    // 0.16.2：静帧取镜头的哪一刻（run --frame、节点的 renderedFrame）。
    ["frame", "Scene3DStillFrame"],
  ])
    assert.deepEqual(SCENE3D.enums[key], literalUnion(canvasTypesClean, union), `enums.${key}`);
  // 守护进程判 run_node.frame 用的就是契约这一份（同一个数组，不是抄本）。
  assert.equal(SCENE3D.enums.frame, SCENE3D_STILL_FRAMES);
  assert.deepEqual(SCENE3D.enums.kind, constArray(canvasTypesSrc, "SCENE3D_OBJECT_KINDS"));
  assert.deepEqual(SCENE3D.enums.bodyType, constArray(canvasTypesSrc, "SCENE3D_HUMAN_BODY_TYPES"));
  assert.deepEqual(SCENE3D.enums.prefab, Object.keys(SCENE3D.prefabs));
  assert.equal(SCENE3D.enums.prefab.length, 24);
  // 别名只能指向词表里的名字，自己不能又是一个词（否则写入时解析成谁说不清）。
  for (const [alias, name] of Object.entries(SCENE3D.enums.aliases)) {
    assert.ok(SCENE3D.enums.prefab.includes(name), `别名 ${alias} 指向了词表外的 ${name}`);
    assert.equal(SCENE3D.enums.prefab.includes(alias), false, `别名 ${alias} 与词表重名`);
  }
  // 预制件的足迹 kind 是 add_object 能建的非人物 kind。
  for (const [name, prefab] of Object.entries(SCENE3D.prefabs))
    assert.ok(SCENE3D.enums.kind.includes(prefab.kind) && prefab.kind !== "human", `${name}.kind`);
});

test("SCENE3D 0.17.0 的词表 / 区间 / 上限与页面同源（types.ts 联合、run-node / timeline / anim-types 的常量）", () => {
  for (const [key, union] of [
    ["gait", "Scene3DGait"],
    ["shake", "Scene3DShake"],
    ["hand", "Scene3DHand"],
    ["gesture", "Scene3DGesture"],
  ])
    assert.deepEqual(SCENE3D.enums[key], literalUnion(canvasTypesClean, union), `enums.${key}`);
  const clean = (rel) => stripComments(read(`${SCENE3D_DIR}/${rel}`));
  assert.deepEqual(SCENE3D.enums.render, literalUnion(clean("timeline.ts"), "Scene3dRenderKind"));
  const sheet = /const SCENE3D_SHEET_FRAMES = \[([^\]]*)\] as const;/.exec(
    stripComments(read(`${BRIDGE}/run-node.ts`)),
  );
  assert.ok(sheet, "run-node.ts 的 SCENE3D_SHEET_FRAMES 形状变了");
  assert.deepEqual(SCENE3D.enums.sheetFrames, sheet[1].split(",").map(Number));
  const animTypes = clean("anim-types.ts");
  // 0.18.2（A102 ⑧）：进场 / 离场两个保留词（act 的 do）
  assert.deepEqual(
    SCENE3D.enums.actSentinels,
    ["KEEP", "NONE", "DROP", "ENTER", "EXIT"].map((name) => {
      const m = new RegExp(`export const SCENE3D_ACT_${name} = "([^"]+)";`).exec(animTypes);
      assert.ok(m, `anim-types.ts 的 SCENE3D_ACT_${name} 形状变了`);
      return m[1];
    }),
  );
  // 上限与故事秒区间页面直接取契约（不另写数），途经点 t 两端开：actions.ts 的两道判定。
  for (const key of ["acts", "viaPerAct", "viaPerShot"])
    assert.match(
      animTypes,
      new RegExp(`${key}: SCENE3D_LIMITS\\.${key},`),
      `anim-types 自带 ${key}`,
    );
  assert.match(animTypes, /time: SCENE3D_RANGES\.at,/);
  assert.deepEqual(SCENE3D.ranges.start, SCENE3D.ranges.at);
  const actions = clean("actions.ts");
  assert.match(actions, /t: numberIn\(\{ exclusiveMin: 0, max: 1 \}\)/);
  assert.match(actions, /if \(p\.t >= 1\) bad\(/);
  assert.deepEqual(SCENE3D.ranges.viaT, { exclusiveMin: 0, exclusiveMax: 1 });
  assert.deepEqual([SCENE3D.units.time, SCENE3D.units.shotProgress], ["s", "unit-interval"]);
});

/** 页面文件里每一条 add("<level>", "<code>", …)；文件不存在 = 空集。 */
const scene3dAddCalls = (file) => {
  const rel = `${SCENE3D_DIR}/${file}`;
  if (!existsSync(path.join(repoRoot, rel))) return { clean: "", hits: [] };
  const clean = stripComments(read(rel));
  return { clean, hits: [...clean.matchAll(/\badd\(\s*"([a-z]+)",\s*"([a-z_]+)"/g)] };
};

test("SCENE3D 三段自检码（D-69 / D-70）：每段只扫自己的文件；页面 ⊆ 契约恒查，契约 ⊆ 页面按段开关", () => {
  // 只比联合类型挡不住「类型里有、代码永远不发」，所以扫的是真正的 add(…) 调用。
  // health 段（checks.ts）两个方向恒开；framing / motion 段由页面文件导出 *_CODES_COMPLETE = true 打开
  // 「契约 ⊆ 页面」——framing.ts 在 B4 之前不存在（页面码是空集），motion.ts 在 B6 之前只发一部分。
  const segments = [
    { name: "health", file: "checks.ts", codes: SCENE3D.checks.healthCodes, flag: null },
    {
      name: "framing",
      file: "framing.ts",
      codes: SCENE3D.checks.framingCodes,
      flag: "FRAMING_CODES_COMPLETE",
    },
    {
      name: "motion",
      file: "motion.ts",
      codes: SCENE3D.checks.motionCodes,
      flag: "MOTION_CODES_COMPLETE",
    },
  ];
  for (const { name, file, codes, flag } of segments) {
    const { clean, hits } = scene3dAddCalls(file);
    const pageCodes = new Set(hits.map((hit) => hit[2]));
    if (name === "health") {
      // Contact checks are part of runScene3dChecks, with an emit(code, ...) helper.
      const contact = stripComments(read(`${SCENE3D_DIR}/contact-checks.ts`));
      for (const hit of contact.matchAll(/\bemit\(\s*"([a-z_]+)"/g)) pageCodes.add(hit[1]);
      assert.match(clean, /contactIssues\(scene\)/);
    }
    for (const code of pageCodes)
      assert.ok(codes.includes(code), `${file} 发了契约 ${name} 段没有的码 ${code}`);
    const complete =
      flag === null || new RegExp(`export const ${flag}\\s*=\\s*true\\b`).test(clean);
    if (complete)
      assert.deepEqual(
        [...pageCodes].sort(),
        [...codes].sort(),
        `契约 ${name} 段的码与 ${file} 真正报的码对不上`,
      );
  }
});

test("SCENE3D.checks 的码 / 档 / 豁免就是 checks.ts 真正发出来的那几个", () => {
  const { hits } = scene3dAddCalls("checks.ts");
  assert.ok(hits.length >= 13, `checks.ts 只提取到 ${hits.length} 条 add(…) —— 这条闸在空转`);
  assert.ok(SCENE3D.checks.healthCodes.includes("orbit_cam_ignored"));
  assert.deepEqual(
    [...new Set(hits.map((hit) => hit[1]))].sort(),
    [...SCENE3D.checks.healthLevels].sort(),
  );
  const literals = (name) => {
    const m = new RegExp(`type ${name} = ([^;]+);`).exec(scene3dChecksClean);
    assert.ok(m, `checks.ts 的 ${name} 形状变了`);
    return [...m[1].matchAll(/"([a-z]+)"/g)].map((hit) => hit[1]);
  };
  assert.deepEqual(SCENE3D.checks.healthLevels, literals("Scene3dHealthLevel"));
  assert.deepEqual(SCENE3D.checks.cutExemptions, literals("Scene3dCutExemption"));
  // 豁免的人话叫法也在契约里（0.16.1）：键 = cutExemptions，checks.ts 从契约取、不再自带一张字面量表。
  assert.deepEqual(Object.keys(SCENE3D.checks.cutExemptionLabels), SCENE3D.checks.cutExemptions);
  for (const label of Object.values(SCENE3D.checks.cutExemptionLabels))
    assert.ok(typeof label === "string" && label.length > 0);
  assert.match(scene3dChecksClean, /SCENE3D\.checks\.cutExemptionLabels/);
  for (const label of Object.values(SCENE3D.checks.cutExemptionLabels))
    assert.equal(
      scene3dChecksClean.includes(`"${label}"`),
      false,
      `checks.ts 又手抄了「${label}」`,
    );
});

test("SCENE3D.checks.motion*（0.17.0）：motion.ts 真在发、档 ⊆ motionLevels；health / motion 两段码不串文件（D-70）", () => {
  const { hits } = scene3dAddCalls("motion.ts");
  assert.ok(hits.length >= 1, "motion.ts 一条 add(…) 都没提取到 —— 这条闸在空转");
  for (const [, level] of hits)
    assert.ok(SCENE3D.checks.motionLevels.includes(level), `motion.ts 用了契约外的档 ${level}`);
  for (const [, , code] of hits)
    assert.ok(!SCENE3D.checks.healthCodes.includes(code), `motion.ts 发了 health 码 ${code}`);
  for (const [, , code] of scene3dAddCalls("checks.ts").hits)
    assert.ok(!SCENE3D.checks.motionCodes.includes(code), `checks.ts 发了 motion 码 ${code}`);
  // B6 起 8 个码全在发：motion.ts 置了 MOTION_CODES_COMPLETE，「契约 ⊆ 页面」由三段比对双向检查（D-69）。
  assert.match(
    scene3dAddCalls("motion.ts").clean,
    /export const MOTION_CODES_COMPLETE\s*=\s*true\b/,
  );
  assert.equal(SCENE3D.checks.motionCodes.length, 8);
  // 0.16.4 的 20 个（0.16.2 的 13 + 0.16.3 的 4 + 0.16.4 的 3）+ 列车 2 的 4 个（合流 D-91）+ B14 的撞色 1 个
  // + 0.18.2 的 sunk_in_floor 1 个（A102 ④：家具陷进地板盒子）。
  assert.equal(SCENE3D.checks.healthCodes.length, 26);
  for (const [key, value] of Object.entries(SCENE3D.checks.motionConstants))
    assert.ok(Number.isFinite(value) && value > 0, `motionConstants.${key}`);
});

test("SCENE3D.checks.framing* 与 framing.sizes（0.17.0）：三段码不相交、framing.ts 永不拦、阶梯有序且与常数同源", () => {
  const { framingCodes, framingConstants, healthCodes, motionCodes } = SCENE3D.checks;
  assert.equal(framingCodes.length, 8);
  // 码名是三段共用的一个命名空间：同名就说不清是哪一段报的、该不该拦。
  const all = [...healthCodes, ...framingCodes, ...motionCodes];
  assert.equal(new Set(all).size, all.length, "health / framing / motion 三段有重名的码");
  for (const [key, value] of Object.entries(framingConstants))
    assert.ok(Number.isFinite(value) && value > 0, `framingConstants.${key}`);
  // framing 只提醒：页面 framing.ts 一条 block 都不许发（文件不存在 = 空集，恒真；B4 起真查）。
  for (const [, level] of scene3dAddCalls("framing.ts").hits)
    assert.notEqual(level, "block", "framing.ts 发了 block：取景提醒永不拦出片");
  // 阶梯：先按切点从近到远（cutMin 严格递减、落到 0），再按画内高度（heightMin 严格递减、落到 0）；
  // 全景 / 远景的分界就是 framingConstants，两处不许各写一个数。
  const { sizes } = SCENE3D.framing;
  assert.equal(new Set(sizes.map((size) => size.name)).size, sizes.length, "景别词重名");
  const cut = sizes.filter((size) => size.cutMin !== null);
  const whole = sizes.filter((size) => size.cutMin === null);
  assert.deepEqual(sizes, [...cut, ...whole], "切点档必须排在不切档之前");
  for (const size of cut) assert.equal(size.heightMin, null, size.name);
  for (const [list, key] of [
    [cut, "cutMin"],
    [whole, "heightMin"],
  ]) {
    for (let i = 1; i < list.length; i++)
      assert.ok(list[i][key] < list[i - 1][key], `${list[i].name}.${key} 没有严格递减`);
    assert.equal(list.at(-1)[key], 0, `${key} 最后一档必须兜到 0`);
  }
  assert.equal(whole.find((size) => size.name === "全景").heightMin, framingConstants.FULL_MIN_H);
  assert.equal(whole.find((size) => size.name === "远景").heightMin, framingConstants.LONG_MIN_H);
  // 粗档五个，从近到远不回头。
  const coarse = ["特写", "近景", "中景", "全景", "远景"];
  const rank = sizes.map((size) => coarse.indexOf(size.coarse));
  assert.ok(
    rank.every((r, i) => r >= 0 && (i === 0 || r >= rank[i - 1])) && new Set(rank).size === 5,
    `粗档序列 ${rank} 不是五档从近到远各一段`,
  );
  for (const size of sizes)
    assert.ok(typeof size.body === "string" && size.body.length > 0, `${size.name}.body`);
});

test("SCENE3D 的破坏性 op、冲突码、动作数上限、id 长度与分级表 / 错误表 / policy 同源", () => {
  // 同一个数组：分级表与契约块不许各抄一份。
  assert.equal(
    CANVAS_CONTRACT.tiers.applyCommands.scene3d_apply.destructiveOps,
    SCENE3D.destructiveOps,
  );
  assert.equal(CANVAS_CONTRACT.tiers.applyCommands.scene3d_apply.destructive, true);
  for (const op of SCENE3D.destructiveOps) assert.ok(Object.hasOwn(SCENE3D.ops, op), op);
  assert.ok(Object.hasOwn(CANVAS_CONTRACT.bridgeErrors, SCENE3D.conflictCode));
  assert.equal(CANVAS_CONTRACT.bridgeErrors[SCENE3D.conflictCode].retryable, false);
  assert.equal(SCENE3D.limits.actionsPerCommand.max, SCENE3D_ACTIONS_MAX);
  assert.equal(SCENE3D.limits.actionsPerCommand.min, 1);
  assert.equal(CANVAS_CONTRACT.scene3d, SCENE3D);
  // 镜头 id 与对象 id 同一个语法：`run --shot` 的长度上限、idPattern、idMaxLength 三处一个数。
  const id = new RegExp(SCENE3D.idPattern);
  assert.ok(id.test("a".repeat(SCENE3D.limits.idMaxLength)));
  assert.equal(id.test("a".repeat(SCENE3D.limits.idMaxLength + 1)), false);
  assert.equal(CANVAS_CONTRACT.limits["run_node.shotId"].maxLength, SCENE3D.limits.idMaxLength);
});

test("SCENE3D.ranges.fov 覆盖 focal 区间在每种画幅上的换算结果（长边 36 mm，垂直角）", () => {
  // 反例：fov 若限 [10,120]，`focal:400` 在 16:9 上存成 2.9°，读出来再原样发回就被拒。
  const { fov, focal } = SCENE3D.ranges;
  for (const aspectRatio of SCENE3D.enums.aspectRatio) {
    const [w, h] = aspectRatio.split(":").map(Number);
    const aspect = w / h;
    const filmHeight = aspect >= 1 ? 36 / aspect : 36;
    for (const mm of [focal.min, focal.max]) {
      const vfov = (2 * Math.atan(filmHeight / (2 * mm)) * 180) / Math.PI;
      assert.ok(
        vfov >= fov.min && vfov <= fov.max,
        `${mm} mm @${aspectRatio} = ${vfov.toFixed(2)}°，不在 fov [${fov.min}, ${fov.max}] 里`,
      );
    }
  }
});

test("0.16.2 run-stills：上限、预算、跳过原因、分级在契约里，页面从契约取，守护进程那一侧同一个数", async () => {
  // 一次最多 = 一场的镜头上限 × 两帧；镜头清单的上限就是一场的镜头上限，id 长度就是 id 语法那个数。
  assert.equal(SCENE3D.limits.stillsPerRun, SCENE3D.limits.shots * SCENE3D.enums.frame.length);
  assert.equal(SCENE3D.limits.stillsPerRun, 120);
  assert.equal(CANVAS_CONTRACT.limits["run_stills.shotIds"].max, SCENE3D.limits.shots);
  assert.equal(CANVAS_CONTRACT.limits["run_stills.shotIds"].max, RUN_STILLS_SHOTS_MAX);
  assert.equal(CANVAS_CONTRACT.limits["run_stills.shotIds"].min, 1);
  assert.equal(
    CANVAS_CONTRACT.limits["run_stills.shotIds"].itemMaxLength,
    SCENE3D.limits.idMaxLength,
  );
  // 页面必须在守护进程的调用超时之内答复：预算到点时在渲的那张当场中止，留 30 s 给落地与回包。
  const timeout = /const callTimeoutMs = config\.callTimeoutMs \|\| (\d+);/.exec(daemonSrc);
  assert.ok(timeout, "daemon.mjs 的 callTimeoutMs 形状变了");
  assert.ok(SCENE3D.limits.stillsBudgetMs + 30000 <= Number(timeout[1]));
  // 回包 skipped[].reason 的封闭集合 = 页面 still-nodes.ts 的联合（回包类型从那里来）。
  assert.deepEqual(
    SCENE3D.stillSkipReasons,
    literalUnion(
      stripComments(read("apps/web/libs/canvas/scene-3d/still-nodes.ts")),
      "Scene3dStillSkipReason",
    ),
  );
  assert.deepEqual(RUN_STILLS_FIELDS, ["nodeId", "shotIds", "frames", "force", "approval"]);
  // 续跑（0.16.2）：已是最新的那几张进 skipped，原因 up_to_date；页面、契约同一个集合（上面那条 deepEqual 钉着）。
  assert.ok(SCENE3D.stillSkipReasons.includes("up_to_date"));
  // 换过图的（A71 修订）：原因 replaced，缺省跳过并点名；--force 连它们一起重出（没有单独的旗标）。
  assert.ok(SCENE3D.stillSkipReasons.includes("replaced"));
  // L2（沿用 Q4：要 --approved），但不花钱：宿主据 billable:false 不弹付费确认。别的命令都不带这个键。
  assert.deepEqual(CANVAS_CONTRACT.tiers["run-stills"], {
    level: "L2",
    method: "run_stills",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
    billable: false,
  });
  // run-shot-refs（0.18.0）同类：整条在浏览器里渲染（站位图 + 预演），它那一档在 shot-refs.test.mjs 里逐字钉住。
  for (const [name, entry] of tierCommandEntries)
    if (name !== "run-stills" && name !== "run-shot-refs")
      assert.equal(Object.hasOwn(entry, "billable"), false, `${name} 不该带 billable`);
  // 页面的上限与预算从契约取（vocab.ts），不是第二份手抄。
  const vocab = stripComments(read("apps/web/libs/canvas/scene-3d/vocab.ts"));
  assert.match(vocab, /SCENE3D_STILLS_PER_RUN = SCENE3D\.limits\.stillsPerRun;/);
  assert.match(vocab, /SCENE3D_STILLS_BUDGET_MS = SCENE3D\.limits\.stillsBudgetMs;/);
});

/**
 * 案底（0.16.2 验收建议 ⑤）：老页面（页面自带的那份 policy 还不认 run_stills）实际回的是 `method_not_allowed`
 * 「Unknown canvas method」—— 在查桥之前就拒了，本地连接里「桥没有 runStills → bridge_missing」那一支它走不到。
 * 文档原来三处都写 `bridge_missing`，Agent 照着等不来那个码。
 */
test("0.16.2 run-stills：文档里老页面的错误码是实际的 method_not_allowed，不是走不到的 bridge_missing", () => {
  const protocol = readFileSync(path.join(packageRoot, "PROTOCOL.md"), "utf8");
  const wire = /`run_stills` \(0\.16\.2[^\n]*/.exec(protocol);
  assert.ok(wire, "PROTOCOL.md 的 run_stills 一段不见了");
  assert.match(wire[0], /page older than the method answers `method_not_allowed`/);
  assert.doesNotMatch(wire[0], /page without the method answers `bridge_missing`/);
  const changelog = readFileSync(path.join(packageRoot, "CHANGELOG.md"), "utf8");
  const release = changelog.slice(changelog.indexOf("## 0.16.2"), changelog.indexOf("## 0.15.1"));
  assert.match(release, /A page older\s+than this CLI answers `method_not_allowed`/);
  assert.doesNotMatch(release, /has no `runStills` and answers `bridge_missing`/);
  const convention = read("docs/conventions/scene-3d.md");
  assert.match(convention, /老页面回 `method_not_allowed`「Unknown canvas method」/);
  assert.doesNotMatch(convention, /老页面没有 `runStills`（`bridge_missing`/);
  const bridge = read("docs/integrations/agent-bridge.md");
  assert.match(bridge, /老页面在本地连接\s*自带的 policy 那一步就回 `method_not_allowed`/);
  assert.doesNotMatch(bridge, /老页面没有它时本地\s*连接回 `bridge_missing`/);
});

/**
 * 案底（0.16.2 验收建议 ⑥）：三维节点上的 `run` 在浏览器里渲染、不扣费，却整条标成「每条 = 一次付费生成」；
 * 手册 L2 那一行也把 `run-stills` 列进「每条 = 一次付费生成」，自相矛盾。按 `run-tool.localKinds` 的先例，
 * `tiers.run.localKinds` 列出 run 不扣费的节点 kind（宿主据此不弹付费确认），不整条标 billable:false。
 */
test('0.16.2 tiers.run.localKinds = ["scene-3d"]：三维节点的 run 不扣费、仍是 L2 要 --approved；手册 L2 行不再说 run-stills 每条付费', () => {
  assert.deepEqual(CANVAS_CONTRACT.tiers.run, {
    level: "L2",
    method: "run_node",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
    localKinds: ["scene-3d"],
  });
  assert.ok(Object.keys(DRAFT_KEYS).includes("scene-3d"), "localKinds 里的得是画布的节点 kind");
  for (const [name, entry] of tierCommandEntries)
    if (name !== "run" && name !== "run-tool")
      assert.equal(Object.hasOwn(entry, "localKinds"), false, `${name} 不该带 localKinds`);
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const l2 = /^\| L2 +\|([^\n]*)$/m.exec(skill);
  assert.ok(l2, "SKILL.md 分级表没有 L2 行");
  assert.match(l2[1], /`run-stills`/);
  assert.doesNotMatch(l2[1], /每条 = 一次付费生成/, "L2 行又把不扣费的 run-stills 说成每条付费");
  // A81：机制口径写「不是生成扣费项」，不写「不花钱」（模型会照搬给用户）。
  assert.match(l2[1], /不是生成扣费项/);
  assert.match(skill, /`tiers\.run\.localKinds`/, "SKILL.md 没点出三维节点的 run 不扣费的契约出处");
});

/**
 * 案底（0.16.2 复验 2 建议 3）：CHANGELOG 0.16.2「Contract and policy」里两条列表粘成了一行
 * （`… "one paid generation each".- \`limits…`），渲染出来 `limits` 那条并进上一条、自己没了。
 * 每条列表项都得从行首起：句末标点后面紧跟「- 」的就是粘上的。
 */
test("0.16.2 CHANGELOG：列表项各占一行，没有两条粘在一起", () => {
  const changelog = readFileSync(path.join(packageRoot, "CHANGELOG.md"), "utf8");
  const release = changelog.slice(changelog.indexOf("## 0.16.2"), changelog.indexOf("## 0.15.1"));
  const glued = release.split("\n").filter((line) => /[.,;:)`'"*]- \S/.test(line));
  assert.deepEqual(glued, [], "有列表项粘在上一行末尾");
  assert.match(release, /^- `limits\["run_stills\.shotIds"\]` = /m, "limits 那条不是独立的列表项");
});

/**
 * 案底（0.16.2 复验 2 建议 4）：回包带 `duplicates` 时，SKILL 原来一个字没提 —— Agent 不知道那是什么、
 * 该连哪一个、要不要删。SKILL 得说清：多余的站位图节点原样没动、认的是人话里点名的那个；提醒用户删，自己不删。
 */
test("0.16.2 SKILL：讲了 run-stills 回包的 duplicates 是什么、Agent 怎么处理（提醒用户删多余的，不自己删）", () => {
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const desk = /\n## 三维导演台（scene-3d 节点）\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(desk, "SKILL.md 的三维导演台一节不见了");
  const said = /`duplicates`[^\n]*/.exec(desk[1]);
  assert.ok(said, "导演台一节没提 run-stills 回包的 duplicates");
  assert.match(said[0], /同一镜同一帧有不止一个站位图节点/);
  assert.match(said[0], /提醒用户删/);
  assert.match(said[0], /不要自己删/);
  const scene6f = skillCommandsMd.slice(
    skillCommandsMd.indexOf("\n## 6f."),
    skillCommandsMd.indexOf("\n## 7."),
  );
  assert.match(
    scene6f,
    /`duplicates`[^\n]*提醒用户删[^\n]*不要自己删/,
    "6f 没说 duplicates 怎么处理",
  );
});

/**
 * 案底（0.16.2 复验 2 建议 5）：关标签 / 浏览器进程没了之后，新开的标签页续不上原会话（配对凭据只存在那个标签页
 * 里），必须重新 connect；关标签后约 45 s（守护进程的租约）`status` 可能仍显示 connected。手册原来一律「等页面
 * 回来（status 是 connected）再发」，对这两种情况不成立：Agent 会一直等一个不会回来的页面。
 */
test("0.16.2 手册：出站位图途中页面离开 —— 刷新自动续上；关标签 / 浏览器没了要重新 connect；约 45 s 内 status 可能仍 connected；先 status 再定", () => {
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const scene6f = skillCommandsMd.slice(
    skillCommandsMd.indexOf("\n## 6f."),
    skillCommandsMd.indexOf("\n## 7."),
  );
  for (const [name, text] of [
    ["SKILL.md", skill],
    ["commands.md 6f", scene6f],
  ]) {
    assert.doesNotMatch(text, /两种都(一样处理：)?等页面回来/, `${name} 还在一律「等页面回来」`);
    assert.match(
      text,
      /关了标签页、浏览器被关或崩了[^\n]*续不上原会话/,
      `${name} 没说关标签续不上`,
    );
    assert.match(
      text,
      /重新 `connect` 配对，在新会话里[^\n]*原样再发一次/,
      `${name} 没说重新 connect 再重发`,
    );
    assert.match(text, /约 45 s 内[^\n]*`status` 可能仍显示 `connected`/, `${name} 没说 45 s 租约`);
    assert.match(text, /先发 `\["status"\]`/, `${name} 没说先 status`);
  }
  const connect = /\n## 连接画布\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(connect, "SKILL.md 的连接画布一节不见了");
  assert.match(
    connect[1],
    /关掉标签页、浏览器被关或崩了续不上/,
    "连接一节还说刷新或离开页面都不影响",
  );
  const refresh = /\n## Refresh and errors\n([\s\S]*?)\n## /.exec(skillCommandsMd);
  assert.ok(refresh, "手册的 Refresh and errors 一节不见了");
  assert.match(refresh[1], /cannot resume it/, "Refresh and errors 没说关标签 / 新浏览器续不上");
  assert.doesNotMatch(refresh[1], /Closing the tab for longer than the window ends the session/);
  // 约定 scene-3d.md 修订 37（0.16.2 线的修订 28，合流顺延）与手册同一个口径（整合任务：原来「两种都等页面回来后……」对关标签不成立）。
  const rev28 = /〔修订 37〕\*\*命令、上限与失败\*\*([^\n]*)/.exec(
    read("docs/conventions/scene-3d.md"),
  );
  assert.ok(rev28, "约定里找不到修订 37");
  assert.doesNotMatch(
    rev28[1],
    /两种都(一样处理：)?等页面回来/,
    "约定修订 37 还在一律「等页面回来」",
  );
  assert.match(rev28[1], /先看 `status`/, "约定修订 37 没说先看 status");
  assert.match(
    rev28[1],
    /刷新、或在同一个标签页里回到画布[^\n]*续上原会话/,
    "约定修订 37 没说刷新自动续上",
  );
  assert.match(
    rev28[1],
    /关了标签页、浏览器被关或崩了[^\n]*续不上原会话[^\n]*重新 `connect`/,
    "约定修订 37 没说关标签续不上、要重新 connect",
  );
  assert.match(
    rev28[1],
    /约 45 s 内[^\n]*`status` 可能仍显示 `connected`/,
    "约定修订 37 没说 45 s 租约",
  );
});

/**
 * 案底（0.16.2 复验 2 建议 2，拍板 A71；A71 修订 2026-09-30）：站位图被人或 Agent 换过图（`upload --into`、节点
 * 「替换文件」）之后，`stillOf` 原样留着，重发记 up_to_date、人话说「站位图都在」，场景一改或 `--force`，人换的图
 * 就被悄悄盖掉。现在标 `stillOf.replaced`、去掉 `sceneDigest`，run-stills 缺省跳过（`replaced`）并点名；用户让
 * 智能体重出就加 `--force`，连换过图的一起原地重出、标记清掉 —— 没有单独的 `--overwrite-replaced`。手册（SKILL、
 * 6f、Runs）、CHANGELOG、线协议说明、约定与集成说明都得写到，且哪儿都不再教那个旗标。
 */
test("0.16.2 A71：换过图的站位图 —— SKILL、6f、Runs、CHANGELOG、PROTOCOL 与约定都写了 replaced 与「--force 连它一起重出」，不再有 --overwrite-replaced", () => {
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const desk = /\n## 三维导演台（scene-3d 节点）\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(desk, "SKILL.md 的三维导演台一节不见了");
  assert.match(desk[1], /`replaced`/, "导演台一节没提跳过原因 replaced");
  assert.match(
    desk[1],
    /"--force"[^\n]*换过图的也原地重出/,
    "导演台一节没说 --force 连换过图的一起重出",
  );
  const scene6f = skillCommandsMd.slice(
    skillCommandsMd.indexOf("\n## 6f."),
    skillCommandsMd.indexOf("\n## 7."),
  );
  assert.match(scene6f, /`stillOf\.replaced`/);
  assert.match(scene6f, /"--force"[^\n]*换过图的也原地重出/);
  const runs = /\n## Runs, undo, and timelines\n([\s\S]*?)\n## /.exec(skillCommandsMd);
  assert.ok(runs, "手册的 Runs 小节不见了");
  assert.match(runs[1], /`run-stills [^`]*\[--force\] --approved`/);
  assert.match(runs[1], /reason `replaced`/);
  assert.match(
    runs[1],
    /`force:true` \/ `--force` renders it\s+again in place and clears\s+the mark/,
  );
  const changelog = readFileSync(path.join(packageRoot, "CHANGELOG.md"), "utf8");
  const release = changelog.slice(changelog.indexOf("## 0.16.2"), changelog.indexOf("## 0.15.1"));
  assert.match(release, /`stillOf\.replaced`/);
  assert.match(release, /`--force` renders it\s+again in place and clears\s+the mark/);
  const protocol = readFileSync(path.join(packageRoot, "PROTOCOL.md"), "utf8");
  assert.match(protocol, /`force:true` also renders it\s+again in place and clears\s+the mark/);
  const convention = read("docs/conventions/scene-3d.md");
  assert.match(convention, /〔修订 39〕[^\n]*`stillOf\.replaced`/);
  assert.match(convention, /^\| 39 +\|[^\n]*replaced/m, "约定的修订清单没有第 39 条");
  for (const [name, text] of [
    ["SKILL.md", skill],
    ["commands.md", skillCommandsMd],
    ["CHANGELOG 0.16.2", release],
    ["PROTOCOL.md", protocol],
    ["README.md", readFileSync(path.join(packageRoot, "README.md"), "utf8")],
    ["scene-3d.md", convention],
    ["docs/integrations/canvas-cli.md", read("docs/integrations/canvas-cli.md")],
    ["docs/integrations/agent-bridge.md", read("docs/integrations/agent-bridge.md")],
  ])
    assert.doesNotMatch(
      text,
      /overwrite-?replaced/i,
      `${name} 还在教已经去掉的 --overwrite-replaced`,
    );
});

/**
 * 整合验收建议 6（A71 修订的措辞）：`--force` 现在连换过图的一起盖掉，所以它跟着**用户的要求**走（用户让智能体重出 =
 * 显式意图），不再由「场景没改」来定、也不再「不动换过图的」。修订前的两句 —— SKILL 导演台一节「`--force` 只在场景
 * 没改却确实要重出时用」、6f「场景没改、却确实要重出同一批图……加 --force……换过图的不动」—— 会教智能体自己拿主意加
 * `--force`，把人换上去的图悄悄盖掉。
 */
test("A71 修订措辞：SKILL 导演台一节与 6f 都说 --force 只在用户要你重出时加（连换过图的一起盖掉），不再说「只在场景没改…时用」「换过图的不动」", () => {
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const desk = /\n## 三维导演台（scene-3d 节点）\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(desk, "SKILL.md 的三维导演台一节不见了");
  const scene6f = skillCommandsMd.slice(
    skillCommandsMd.indexOf("\n## 6f."),
    skillCommandsMd.indexOf("\n## 7."),
  );
  for (const [name, text] of [
    ["SKILL.md 导演台一节", desk[1]],
    ["commands.md 6f", scene6f],
  ]) {
    assert.doesNotMatch(text, /`--force` 只在场景没改/, `${name} 还说 --force 只在场景没改时用`);
    assert.doesNotMatch(text, /换过图的不动/, `${name} 还说加 --force 时换过图的不动`);
    assert.match(
      text,
      /用户要你重出[^\n]*"?--force"?/,
      `${name} 没把 --force 系在「用户要你重出」上`,
    );
  }
  assert.match(desk[1], /`--force` 只在用户要你重出时加/);
  assert.match(scene6f, /用户要你重出[^\n]*加 `"--force"`[^\n]*换过图的也一起盖掉/);
});

/* 下面两条钉的是随包手册：它们在文档写到 scene3d 之前是红的。 */

test("手册写到了 scene3d_apply 的错误码、error.next、read 的 /scene 与 run --shot", () => {
  assert.match(skillCommandsMd, /^\| `scene3d_conflict` +\|/m, "错误表没有 scene3d_conflict 一行");
  assert.match(
    skillCommandsMd,
    /currently for [^\n]*`scene3d_conflict`/,
    "error.next 那一段没列 scene3d_conflict",
  );
  assert.match(
    skillCommandsMd,
    /^\| `read` +\|[^\n]*\/scene/m,
    "Find and read 表的 read 行没写 /scene",
  );
  const runs = /\n## Runs, undo, and timelines\n([\s\S]*?)\n## /.exec(skillCommandsMd);
  assert.ok(runs, "手册的 Runs 小节不见了");
  assert.match(runs[1], /--shot/, "Runs 小节没写 run --shot");
});

test("手册写到了 0.16.2：SKILL 的导演台一节与 L2 行有 run-stills；6f 有可照抄的 argv；Runs 小节有 run-stills 与 --frame", () => {
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const desk = /\n## 三维导演台（scene-3d 节点）\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(desk, "SKILL.md 的三维导演台一节不见了");
  assert.match(desk[1], /\["run-stills","NODE-ID","--approved"\]/, "导演台一节没教 run-stills");
  assert.match(desk[1], /--frame/, "导演台一节没教 --frame");
  assert.match(skill, /^\| L2 +\|[^\n]*`run-stills`/m, "分级表 L2 行没列 run-stills");
  const scene6f = skillCommandsMd.slice(
    skillCommandsMd.indexOf("\n## 6f."),
    skillCommandsMd.indexOf("\n## 7."),
  );
  assert.ok(
    scene6f.includes('["run-stills", "NODE-ID", "--approved"]'),
    "6f 没有 run-stills 的 argv",
  );
  const runs = /\n## Runs, undo, and timelines\n([\s\S]*?)\n## /.exec(skillCommandsMd);
  assert.ok(runs, "手册的 Runs 小节不见了");
  assert.match(runs[1], /`run-stills /, "Runs 小节没写 run-stills");
  assert.match(runs[1], /--frame end/, "Runs 小节没写 run --frame");
});

/** `marker` 那一行之后（跳过空行）紧跟的那段引用块，去掉每行的 `>` 前缀。 */
function quoteAfter(text, marker) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(marker)) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (!lines[j]?.startsWith(">")) continue;
    const block = [];
    for (; j < lines.length && lines[j].startsWith(">"); j++)
      block.push(lines[j].replace(/^> ?/, ""));
    return block.join("\n").trim();
  }
  assert.fail(`找不到「${marker}」后面的引用块`);
}

test("SKILL.md 的自检立场与 docs/conventions/scene-3d.md 写进工具说明的原话逐字相同", () => {
  // 已拍板结论 4：工具说明用约定的原话。两边各写一版，迟早一边改了另一边没跟。
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const convention = read("docs/conventions/scene-3d.md");
  const stance = quoteAfter(skill, "自检立场");
  assert.ok(stance.length > 40, "SKILL.md 的自检立场引用块是空的");
  assert.equal(stance, quoteAfter(convention, "写进 Agent 工具说明的原话"));
});

test("SKILL.md 的取景立场与 docs/conventions/scene-3d.md 的「取景立场原话」逐字相同", () => {
  // 00-contract §10.4 的 framing 补句单独成段（不并进上面那段自检立场），同样两处一字不差。
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const stance = quoteAfter(skill, "取景立场");
  assert.ok(stance.includes("framing"), "SKILL.md 的取景立场引用块不对");
  assert.equal(stance, quoteAfter(read("docs/conventions/scene-3d.md"), "取景立场原话"));
});

/* ───────────── 0.16.1：hostText（宿主必须贴出的字段）与 packageVersion ───────────── */

/**
 * 数据块本身的形状：键集、每条只有 verbatim / visible 两个字符串数组、路径语法、不重复，以及
 * 「只由 CANVAS_CONTRACT 引用、守护进程闭包不读」。两道语义闸（无死路径、verbatim 与
 * formatScene3dSummary 逐字一致）在下面，读 `test/fixtures/host-text/` 的仓内夹具。
 */
test("hostText：18 个命令键，每条只有 verbatim / visible 两张不重复的路径表，路径是点语法", () => {
  assert.equal(CANVAS_CONTRACT.hostText, HOST_TEXT);
  const keys = Object.keys(HOST_TEXT);
  assert.equal(keys.length, 18);
  assert.ok(keys.includes("*"), "缺通配键 *（失败回包）");
  // 除 * 外每个键都是真的 CLI 子命令（分级表的键）。
  for (const key of keys.filter((name) => name !== "*"))
    assert.ok(Object.hasOwn(CANVAS_CONTRACT.tiers, key), `${key} 不是 CLI 子命令`);
  // 首段可以是回包本身是数组的 `[]`（list-canvases），其余每段是字段名，可带 `[]` 后缀。
  const PATH = /^(?:\[\]\.)?[A-Za-z][A-Za-z0-9]*(?:\[\])?(?:\.[A-Za-z][A-Za-z0-9]*(?:\[\])?)*$/;
  for (const [command, entry] of Object.entries(HOST_TEXT)) {
    assert.deepEqual(Object.keys(entry), ["verbatim", "visible"], command);
    const all = [...entry.verbatim, ...entry.visible];
    for (const p of all) assert.match(p, PATH, `${command}: ${p}`);
    assert.equal(new Set(all).size, all.length, `${command} 有重复登记的路径`);
  }
  // 失败回包的通配段：`hint` 在顶层，不在 error 里；下一步字段名是 next[]（不是 nextSteps）。
  assert.ok(HOST_TEXT["*"].visible.includes("hint"));
  assert.equal(HOST_TEXT["*"].visible.includes("error.hint"), false);
  assert.ok(HOST_TEXT["*"].visible.includes("error.next[].command"));
  assert.equal(JSON.stringify(HOST_TEXT).includes("nextSteps"), false);
});

test("host-text.mjs 在包内只由 contract.mjs 引用（守护进程闭包不读它）", () => {
  const dir = path.join(packageRoot, "src");
  const importers = readdirSync(dir)
    .filter((name) => name.endsWith(".mjs"))
    .filter((name) =>
      /from\s+["']\.\/host-text\.mjs["']/.test(readFileSync(path.join(dir, name), "utf8")),
    );
  assert.deepEqual(importers, ["contract.mjs"]);
});

test("scene3d-text.mjs 与契约单向：契约只再导出三个渲染函数、不从它取值，它也不 import 契约", () => {
  // 契约在画布首包里：两边互相 import、或契约从 scene3d-text 取任何值，打包器都会把摘要函数并进首包。
  const src = (name) => readFileSync(path.join(packageRoot, "src", name), "utf8");
  const contractImports = [
    ...src("contract.mjs").matchAll(/^(import|export)\b[^;]*?from\s+"\.\/scene3d-text\.mjs";/gms),
  ];
  assert.deepEqual(
    // 空白与尾逗号随格式化器折行变，不算形状。
    contractImports.map((m) => m[0].replace(/\s+/g, " ").replace(/, \}/, " }")),
    [
      'export { formatScene3dChecks, formatScene3dScene, formatScene3dSummary } from "./scene3d-text.mjs";',
    ],
  );
  assert.doesNotMatch(src("scene3d-text.mjs"), /from\s+"\.\/contract\.mjs"/);
  assert.equal(SCENE3D.checks.cutExemptionLabels, SCENE3D_CUT_EXEMPTION_LABELS);
});

test("packageVersion = package.json 的 version = cli.mjs 的 VERSION", () => {
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const cliSrc = readFileSync(path.join(packageRoot, "src", "cli.mjs"), "utf8");
  assert.equal(CANVAS_CONTRACT.packageVersion, pkg.version);
  assert.match(
    cliSrc,
    new RegExp(`^const VERSION = "${pkg.version.replace(/\./g, "\\.")}";$`, "m"),
  );
});

/* ───── hostText 的两道包内闸：无死路径；verbatim 与 formatScene3dSummary 逐字一致 ───── */

/**
 * 夹具是 0.16.1 页面在隔离栈上真跑出来的 CLI 回包（纯 JSON，会话 id / 本机路径打码），文件名
 * `<命令>-<情形>.json`；`err-*.json` 归通配键 `*`。每条登记路径必须在该命令至少一份夹具里解析得到
 * （`*` 段对所有 `ok:false` 的夹具解析），否则就是登记错了字段名 —— 宿主照着登记表去找，永远找不到。
 * 末段是数组（`pending[]`）时数组在就算解析到：空数组也证明字段名对。
 *
 * 两张豁免表，各自写明为什么：
 *  · PENDING_PATHS —— 页面还没有这个字段（由后续批次加）。它们**必须**仍解析不到：哪天夹具里出现了，
 *    这里红，提醒把它从表里删掉、让无死路径闸接管。
 *  · RARE_PATHS —— 今天就有、但隔离栈上造不出触发情形的字段（理由逐条写），显式跳过。
 */
const HOST_TEXT_FIXTURES = path.join(packageRoot, "test", "fixtures", "host-text");
/** 0.17.0 由 B3-integrate 页面发出、但仓内夹具还是 0.16.1 页面录的：等 Experience 用 0.17.0 页面重录。 */
const RERECORD_017 = "B3-integrate（0.17.0 页面重录夹具）";
const pending017 = (paths) =>
  paths.map((path) => ({ path, since: "0.17.0", ownerBatch: RERECORD_017 }));
/** 取景段由 B4 的页面发（本分支没有 B4 的页面代码）：B4 合入后用 0.17.0 页面重录。 */
const pendingFraming = (paths) =>
  paths.map((p) => ({ path: p, since: "0.17.0", ownerBatch: "B4（0.17.0 页面重录夹具）" }));
/** B14（L2 重跑缺陷 P4 / P8）页面才发的字段：等 L2 用 B14 页面重录夹具。 */
const pendingB14 = (paths) =>
  paths.map((p) => ({ path: p, since: "0.17.0", ownerBatch: "B14（L2 重录夹具）" }));
const PENDING_PATHS = {
  apply: [
    { path: "arrangeSummary", since: "0.16.1", ownerBatch: "B4" },
    { path: "arranged[].command", since: "0.16.1", ownerBatch: "B4" },
    { path: "arranged[].bounds", since: "0.16.1", ownerBatch: "B4" },
    ...pending017([
      "scene3d[].applied[].start",
      "scene3d[].applied[].dur",
      "scene3d[].applied[].to",
      "scene3d[].timeline.total",
      "scene3d[].renders.stale[]",
      "scene3d[].renders.fresh[]",
      "scene3d[].unchanged",
      "scene3d[].checks.motion[].code",
      "scene3d[].checks.motion[].level",
      "scene3d[].checks.motion[].message",
    ]),
    ...pendingB14(["scene3d[].applied[].seat", "scene3d[].applied[].fields[]"]),
    ...pendingFraming([
      "scene3d[].checks.framing[].shotId",
      "scene3d[].checks.framing[].code",
      "scene3d[].checks.framing[].message",
      "scene3d[].framing[].shotId",
    ]),
  ],
  read: [
    { path: "nodes[].headingDeg", since: "0.16.1", ownerBatch: "B4（B1 可延，延后）" },
    ...["sceneNodeId", "shotId", "output", "renderDigest", "stale", "orphan"].map((key) => ({
      path: `nodes[].scene3d.${key}`,
      since: "0.16.1",
      ownerBatch: "B3-integrate",
    })),
    ...["actor", "at"].map((key) => ({
      path: `nodes[].sceneWriter.${key}`,
      since: "0.16.1",
      ownerBatch: "待定（B1 步序无此项，见 errata）",
    })),
    ...["connected", "synced", "lastMessageAgoMs"].map((key) => ({
      path: `nodes[].collab.${key}`,
      since: "0.16.1",
      ownerBatch: "B1（可延：read NODE/collab）",
    })),
    ...pending017(["nodes[].rendersSummary"]),
    ...pending017(
      HOST_TEXT.read.visible.filter(
        (path) =>
          path.startsWith("nodes[].renders[].") ||
          path.startsWith("nodes[].timeline.") ||
          path.startsWith("nodes[].checks.motion["),
      ),
    ),
    ...pendingFraming(
      HOST_TEXT.read.visible.filter(
        (p) => p.startsWith("nodes[].checks.framing[") || p.startsWith("nodes[].framing["),
      ),
    ),
  ],
  snapshot: ["sceneNodeId", "shotId", "output"].map((key) => ({
    path: `nodes[].summary.scene3d.${key}`,
    since: "0.16.1",
    ownerBatch: "B3-integrate",
  })),
  run: [
    { path: "notes[]", since: "0.16.1", ownerBatch: "B3-integrate" },
    { path: "outputs[].result", since: "0.16.1", ownerBatch: "B3-integrate" },
    { path: "outputs[].created", since: "0.16.1", ownerBatch: "B3-integrate" },
    { path: "outputs[].reused", since: "0.16.1", ownerBatch: "B3-integrate" },
    { path: "outputs[].path", since: "0.16.1", ownerBatch: "B6" },
    { path: "outputs[].pathError.code", since: "0.16.1", ownerBatch: "B6" },
    // 列车 1 单镜失败回顶层 error（run_failed / invalid_request），多镜的 failed[] 随多镜一起来。
    ...[
      "shotId",
      "error.code",
      "error.retryable",
      "error.message",
      "error.next[].command",
      "error.next[].description",
      "error.checks.health[].code",
      "error.checks.health[].message",
    ].map((key) => ({ path: `failed[].${key}`, since: "0.16.1", ownerBatch: "B3-integrate" })),
    ...pending017([
      "outputs[].posterUrl",
      "outputs[].lastFrameUrl",
      "outputs[].durationMs",
      "timings.warmMs",
    ]),
  ],
  undo: [
    ...pending017(["scene3dSummary", "scene3d[].renders.stale[]"]),
    ...pendingB14(["scene3d[].sceneSummary"]),
  ],
  redo: [
    ...pending017(["scene3dSummary", "scene3d[].renders.stale[]"]),
    ...pendingB14(["scene3d[].sceneSummary"]),
  ],
  "run-batch": [{ path: "submitted[].local", since: "0.16.1", ownerBatch: "B4" }],
  resources: [{ path: "resources[].stale", since: "0.16.1", ownerBatch: "B3-integrate" }],
  "list-canvases": [{ path: "[].cliContract", since: "0.16.1", ownerBatch: "B6" }],
};
const NO_VIDEO_ON_STACK =
  "隔离栈的 file 桩拒收视频上传（url host is not allowed），时间线造不出片段；导出形状由 jianying-export*.test 覆盖";
const RARE_PATHS = {
  "*": { "error.currentOutputId": "要有候选产出；假网关不出媒体（SYNTHETIC_MEDIA_UNAVAILABLE）" },
  apply: {
    "focused[].reason": "无头浏览器里节点总能测到尺寸、相机总在，造不出 unmeasured / no_camera",
    "absorbed[]": "resize_group --absorb-strays 要体检判为压框的散节点，本次夹具没造出来",
  },
  "run-batch": {
    "submitted[].taskId": "批量提交在回包时还没拿到 taskId（异步提交），只有 nodeId",
    "skipped[].message": "只有少数跳过原因带 message，本次夹具的 succeeded / running 不带",
  },
  undo: {
    skipped: "要撤销栈项被守护跳过（人后来又改过同一处）",
    "undoneOps[].left[]":
      "要 Agent 建的下游节点之后被三维重渲落地整节点重写；隔离栈的 file 桩拒收视频上传，出不了预演卡",
    "left[]": "同 undoneOps[].left[]（那一回合只有被改写过的插入：all_skipped）",
    "orphanedClipIds[]": NO_VIDEO_ON_STACK,
    reset: "要页面在会话中途重载、撤销栈被清空",
    "scene3d[].fallback":
      "要撤销删空场景项（拆 map 前的老节点、或并发场景写的赢家撤销）；页面侧由 canvas-agent-bridge.test 的 H-B5-2 用例覆盖",
  },
  redo: { skipped: "同 undo", "orphanedClipIds[]": NO_VIDEO_ON_STACK },
  resources: {
    "resources[].outputId": "只在候选 / 历史行上有；假网关不出媒体，三维节点列车 1 只有 current 行",
  },
  changes: {
    truncated: "要变更缓冲溢出（buffer_dropped / feed_restarted）",
    truncatedReason: "同 truncated",
  },
  timeline: Object.fromEntries(
    [
      "clips[].id",
      "clips[].sourceId",
      "clips[].title",
      "clips[].sourceMissing",
      "orderApplied",
      "skipped[]",
      "shotIdMissing[]",
    ].map((key) => [key, NO_VIDEO_ON_STACK]),
  ),
  "export-jianying": Object.fromEntries(
    [
      "note",
      "dryRun",
      "outDir",
      "draftRoot",
      "projects[].name",
      "projects[].dir",
      "projects[].episode",
      "projects[].clips",
      "projects[].status",
      "warnings[]",
      "error.retry",
    ].map((key) => [key, NO_VIDEO_ON_STACK]),
  ),
};

/** 点路径 → 解析到的值（`[]` 段展开数组；末段是数组时数组在就算到）。 */
function resolveHostPath(value, segments) {
  if (segments.length === 0) return value === undefined ? [] : [value];
  const [segment, ...rest] = segments;
  const isArray = segment.endsWith("[]");
  const key = isArray ? segment.slice(0, -2) : segment;
  const next = key === "" ? value : value?.[key];
  if (!isArray) return next === undefined ? [] : resolveHostPath(next, rest);
  if (!Array.isArray(next)) return [];
  return rest.length === 0 ? [next] : next.flatMap((item) => resolveHostPath(item, rest));
}

function hostTextFixtures() {
  const commands = Object.keys(HOST_TEXT)
    .filter((key) => key !== "*")
    .sort((a, b) => b.length - a.length);
  const byCommand = Object.fromEntries(Object.keys(HOST_TEXT).map((key) => [key, []]));
  for (const name of readdirSync(HOST_TEXT_FIXTURES).filter((file) => file.endsWith(".json"))) {
    const command = name.startsWith("err-")
      ? "*"
      : commands.find((key) => name === `${key}.json` || name.startsWith(`${key}-`));
    assert.ok(
      command,
      `夹具 ${name} 对不上任何登记的命令（文件名 <命令>-<情形>.json，失败回包 err-*.json）`,
    );
    byCommand[command].push({
      name,
      reply: JSON.parse(readFileSync(path.join(HOST_TEXT_FIXTURES, name), "utf8")),
    });
  }
  return byCommand;
}

test("hostText 夹具：每个登记的命令至少一份；会话 id 与本机路径已打码", () => {
  const byCommand = hostTextFixtures();
  for (const [command, fixtures] of Object.entries(byCommand))
    assert.ok(fixtures.length > 0, `命令 ${command} 没有夹具`);
  for (const { name, reply } of Object.values(byCommand).flat()) {
    const text = JSON.stringify(reply);
    assert.doesNotMatch(text, /\/home\/|\/Users\/|[A-Z]:\\\\/, `${name} 带了本机路径`);
    for (const [, id] of text.matchAll(/"(?:sessionId|agentId)":"([^"]*)"/g))
      assert.match(id, /^(?:scenemint-cli:)?<session-id>$/, `${name} 的会话 id 没打码`);
    assert.doesNotMatch(text, /--session [0-9a-f]{8}-/, `${name} 的 --session 没打码`);
  }
});

test("hostText 无死路径：每条登记路径在该命令至少一份夹具里解析得到（豁免逐条写明理由）", () => {
  const byCommand = hostTextFixtures();
  const failures = Object.values(byCommand)
    .flat()
    .filter(({ reply }) => reply?.ok === false);
  for (const [command, entry] of Object.entries(HOST_TEXT)) {
    const fixtures = command === "*" ? failures : byCommand[command];
    const resolves = (p) =>
      fixtures.some(({ reply }) => resolveHostPath(reply, p.split(".")).length > 0);
    const pending = new Set((PENDING_PATHS[command] ?? []).map((item) => item.path));
    const rare = RARE_PATHS[command] ?? {};
    for (const p of [...entry.verbatim, ...entry.visible]) {
      if (pending.has(p)) {
        assert.equal(resolves(p), false, `${command}.${p} 页面已经有了：从 PENDING_PATHS 删掉`);
        continue;
      }
      if (Object.hasOwn(rare, p)) continue;
      assert.ok(resolves(p), `${command}.${p} 在 ${command} 的夹具里一次都解析不到（死路径）`);
    }
    // 豁免表只能豁免真登记过的路径，写错了名字的豁免等于没豁免。
    const registered = new Set([...entry.verbatim, ...entry.visible]);
    for (const p of [...pending, ...Object.keys(rare)])
      assert.ok(registered.has(p), `${command} 的豁免 ${p} 不是登记过的路径`);
  }
  for (const command of [...Object.keys(PENDING_PATHS), ...Object.keys(RARE_PATHS)])
    assert.ok(Object.hasOwn(HOST_TEXT, command), `豁免表里的 ${command} 不是 hostText 的键`);
});

test("hostText verbatim：apply 夹具的 scene3dSummary 与 formatScene3dSummary(scene3d) 逐字一致", () => {
  const applies = hostTextFixtures().apply.filter(
    ({ reply }) => reply.scene3dSummary !== undefined,
  );
  assert.ok(applies.length >= 3, "apply 夹具里带 scene3dSummary 的太少");
  // 建场 / 增量（改名、清掉 facing、按 prefab 推 kind）/ 带拦下 / 没等到同步的几份都得覆盖到。
  const text = applies.map(({ reply }) => reply.scene3dSummary).join("\n");
  for (const piece of [
    "改名 ",
    "清掉 off.facing（rotation.y 覆盖）",
    "按 prefab 画（kind=box）",
    "\n拦下：",
  ])
    assert.ok(text.includes(piece), `夹具里没有覆盖到「${piece}」`);
  for (const { name, reply } of applies)
    assert.equal(formatScene3dSummary(reply.scene3d), reply.scene3dSummary, name);
});

test("formatScene3dSummary：有取景提醒时表头另报条数，「0 处提醒」不再像和下面的 ⚠ 行矛盾（B4 I1）", () => {
  const base = {
    command: 0,
    nodeId: "s3d",
    sceneDigest: "0123456789abcdef",
    applied: [],
    checks: { health: [], axis: { applicable: false, ok: true, offside: [] }, cuts: [] },
  };
  const plain = formatScene3dSummary([base]);
  // 0.18.0（A87 ③）：基础行不再写越轴 / 跳切段，提醒段就是行尾
  assert.match(plain, /；0 处拦下，0 处提醒$/);
  const issue = {
    level: "warn",
    code: "subject_blocked",
    shotId: "shot-3",
    message: "boss 可能被 off 挡住",
  };
  const withFraming = formatScene3dSummary([
    { ...base, checks: { ...base.checks, framing: [issue, { ...issue, shotId: "shot-4" }] } },
  ]);
  assert.match(withFraming, /；0 处拦下，0 处提醒，取景 2 条提醒（不拦，见下）$/);
  // 算了取景但没有提醒：与没算时逐字相同
  assert.equal(formatScene3dSummary([{ ...base, checks: { ...base.checks, framing: [] } }]), plain);
});

test("formatScene3dSummary：动作打完场景没变（unchanged:true）的基础行不说「应用 N 个动作」（B9-FX-51）", () => {
  const base = {
    command: 0,
    nodeId: "s3d",
    sceneDigest: "0123456789abcdef",
    applied: [{ op: "update_shot", id: "shot-2" }],
    checks: { health: [], axis: { applicable: false, ok: true, offside: [] }, cuts: [] },
  };
  assert.match(formatScene3dSummary([base]), /^s3d：应用 1 个动作 → sceneDigest=0123456789abcdef/);
  const same = formatScene3dSummary([{ ...base, unchanged: true }]);
  assert.match(
    same,
    /^s3d：1 个动作打完场景没有变化（没写、不进撤销栈）→ sceneDigest=0123456789abcdef（下一批 baseDigest）；/,
  );
  assert.doesNotMatch(same, /应用 1 个动作/);
});

test("三维手册跟上页面行为：每镜一张卡、连卡不连三维节点、冲突先 read 现状、orbit+cam 自检会报", () => {
  const skillMd = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  for (const [name, text] of [
    ["commands.md", skillCommandsMd],
    ["SKILL.md", skillMd],
  ]) {
    // 0.17.0（B4）：每镜落一张卡，三维节点自己的输出口不随出片更新。还写着列车 1 的「一个节点只留一张静帧 /
    // 每镜复制一份三维节点」，Agent 会去 duplicate_node、或把三维节点连给 gen（gen 拿不到这次的静帧）。
    assert.doesNotMatch(
      text,
      /一个三维节点同一时刻只有一张静帧/,
      `${name} 还是列车 1 的单静帧写法`,
    );
    assert.match(text, /不是三维节点/, `${name} 没写给 gen 连的是卡片、不是三维节点`);
    assert.match(text, /不要重发 `run`/, `${name} 没写 pending[] 时不许重发 run`);
    // 冲突回包的整份 scene 宿主不贴：先 read 现状，不许再指向「回包里的 scene」。
    assert.doesNotMatch(text, /按回包里的 `?scene`? \/ `?sceneSummary`? 重新规划/, name);
  }
  assert.ok(CANVAS_CONTRACT.scene3d.checks.healthCodes.includes("orbit_cam_ignored"));
  assert.doesNotMatch(skillCommandsMd, /`cam` 不起作用，自检也不报/);
});

/** commands.md 里 `## <prefix>` 那一节（到下一个 `## ` 为止）。 */
function manualSection(prefix) {
  const start = skillCommandsMd.indexOf(`\n## ${prefix}`);
  assert.ok(start >= 0, `commands.md 没有「## ${prefix}」这一节`);
  const end = skillCommandsMd.indexOf("\n## ", start + 1);
  return skillCommandsMd.slice(start, end < 0 ? undefined : end);
}

test("0.17.0 手册：动画 / 出参考视频两节、新 flag 与读后缀进参考小节、提示词规范（G1）", () => {
  const skillMd = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const anim = manualSection("6g.");
  for (const op of ["add_act", "update_act", "remove_act"])
    assert.ok(anim.includes(`\`${op}\``), `6g 没写 ${op}`);
  for (const word of CANVAS_CONTRACT.scene3d.enums.actSentinels)
    assert.ok(anim.includes(`"${word}"`), `6g 没写保留词 ${word}`);
  for (const field of ["start", "via", "follow", "shake"])
    assert.ok(anim.includes(`\`${field}\``), `6g 没写镜头字段 ${field}`);
  for (const code of CANVAS_CONTRACT.scene3d.checks.motionCodes)
    assert.ok(anim.includes(`\`${code}\``), `6g 没写动作提醒码 ${code}`);
  for (const gesture of CANVAS_CONTRACT.scene3d.enums.gesture)
    assert.ok(anim.includes(`\`${gesture}\``), `6g 没写手势 ${gesture}`);

  const video = manualSection("6h.");
  // --await 是整条命令的墙钟秒数（不是每镜），视频建议 180（00-contract §6.2）。
  assert.ok(video.includes('"--await", "180"'), "6h 的出片 argv 没带 --await 180");
  assert.match(video, /\*\*整条命令\*\*/, "6h 没写 --await 是整条命令的预算");
  // G1 提示词规范：唯一参考句、禁用词、不设首尾帧、时长 max(4, ceil(dur))。
  assert.ok(video.includes("作为唯一的运镜 / 景别 / 站位参考，只作运动参考，不参考画面内容"));
  const banned = ["替换", "改成", "修改", "增加", "加上", "去掉", "删除", "延续", "延长", "续写"];
  assert.ok(video.includes(banned.join("、")), "6h 的禁用词表不全");
  assert.match(video, /不设首帧 \/ 尾帧/);
  assert.ok(video.includes("max(4, ceil("), "6h 没写生成时长取 max(4, ceil(dur))");
  // 例子里写给模型的提示词本身不许踩禁用词。
  for (const prompt of video.matchAll(/"prompt": "([^"]*)"/g))
    for (const word of banned)
      assert.ok(!prompt[1].includes(word), `6h 的例子提示词用了「${word}」`);

  const runs = /\n## Runs, undo, and timelines\n([\s\S]*?)\n## /.exec(skillCommandsMd)[1];
  for (const flag of ["--shots", "--render", "--frames", "--await", "--out-dir"])
    assert.ok(runs.includes(`\`${flag}`), `Runs 小节没写 run ${flag}`);
  assert.match(skillCommandsMd, /^\| `read` +\|[^\n]*`NODE\/renders`[^\n]*`NODE\/timeline`/m);
  assert.match(skillCommandsMd, /^\| `snapshot` +\|[^\n]*`edges`[^\n]*`edgeScope`/m);
  assert.match(skillMd, /--await 180/, "SKILL.md 没写出视频带 --await 180");
});

/**
 * M15：SKILL.md「命令分级」小节就是两个宿主逐字拷走的规则块，灵影的闸是估算 token ≤ 2500
 * （tests/pi-canvas-cli-rules.test.mts 的估算器：CJK 一字一 token，其余四字符一 token）。0.17.0 的
 * 预算取 PLAN §4 B6 验收与 steps.md ④ 的 2066（10-experience M15 写的是更松的 2100，两处不一致时取批次
 * 验收数，fix round 1 记在 impl.md）；超了先把非分级信息挪出去，不放宽 2500。
 */
test("SKILL.md 的命令分级小节（规则块）估算 token ≤ 2066", () => {
  const skillMd = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  const start = skillMd.indexOf("## 命令分级");
  const end = skillMd.indexOf("\n## ", start + 1);
  assert.ok(start >= 0 && end > start, "SKILL.md 的命令分级小节不见了");
  const block = skillMd.slice(start, end).replace(/\s+$/u, "");
  const cjk = [...block].filter((ch) => /[\u3000-\u9fff\uff00-\uffef]/u.test(ch)).length;
  const tokens = cjk + Math.round((block.length - cjk) / 4);
  assert.ok(tokens <= 2066, `规则块估算 ${tokens} token，超过 0.17.0 预算 2066`);
});

/**
 * 案底（2026-10-12 核查，A78 追加 ⑫）：身份色只在包的 `src/scene3d-identity.mjs` 里、没进契约，剧本转视频于是
 * 自己拷了一份（`.pi/lib/scene3d-identity.mjs`），哪边改了调色板或算法另一边都不知道 —— 提示词里「红色人偶对应某某」
 * 就和画面上的颜色对不上。0.16.4 起数据进 `SCENE3D.identity`、三个函数从 `./contract` 再导出，页面上色用的是同一个。
 */
test("0.16.4 身份色：SCENE3D.identity 就是实现那一份，./contract 再导出三个函数，算法照契约写的那样算", () => {
  const { identity } = SCENE3D;
  assert.equal(CANVAS_CONTRACT.scene3d.identity, identity);
  assert.deepEqual(
    identity.colors,
    IDENTITY_PALETTE.map(([hex]) => hex),
  );
  assert.deepEqual(
    identity.labels,
    IDENTITY_PALETTE.map(([, label]) => label),
  );
  assert.equal(identity.colors.length, 8);
  assert.equal(new Set(identity.colors).size, 8, "调色板里有重复的颜色");
  assert.equal(identity.hash, "fnv1a32-nfkc-trim-lower");
  // 契约写的算法自己算一遍：NFKC、去首尾空白、转小写，按码点 32 位 FNV-1a，对颜色数取余。
  const byContract = (name) => {
    let h = 0x811c9dc5;
    for (const c of name.normalize("NFKC").trim().toLowerCase())
      h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0;
    return identity.colors[h % identity.colors.length];
  };
  const names = ["甲", "乙", "丙", "人物", "chair", "Desk", "桌子", "𠀋字", "ＡＢＣ", "  table  "];
  const picked = new Set();
  for (const name of names) {
    assert.equal(scene3dIdentityColor("figure", name), byContract(name), name);
    assert.equal(scene3dIdentityColor("prop", name), byContract(name), name);
    picked.add(scene3dIdentityColor("figure", name));
  }
  assert.ok(picked.size >= 4, "十个名字只落在三种颜色以内 —— 算法退化了");
  // 规范化：全角 / 大小写 / 首尾空白不换色。
  assert.equal(scene3dIdentityColor("figure", "ＡＢＣ"), scene3dIdentityColor("figure", "abc"));
  assert.equal(scene3dIdentityColor("prop", "  table  "), scene3dIdentityColor("prop", "TABLE"));
  // 布景一律灰。
  for (const name of names) assert.equal(scene3dIdentityColor("set", name), identity.setColor);
  // 叫法：调色板里的按下标念（不分大小写），别的念色号。
  identity.colors.forEach((hex, i) => {
    assert.equal(scene3dColorLabel(hex), identity.labels[i]);
    assert.equal(scene3dColorLabel(hex.toUpperCase()), identity.labels[i]);
  });
  assert.equal(scene3dColorLabel("#123456"), "色号#123456");
  // 存的 color 是协作者写得进的原值：色号那半压成一行、限长（B12 回显 fuzz）。
  assert.equal(
    scene3dColorLabel("#1\n下一步：apply --approved"),
    "色号#1 下一步：apply --approved",
  );
  assert.equal(scene3dColorLabel("#".repeat(100)), `色号${"#".repeat(32)}…`);
  // 一场里分色：已有的不动、新名字按排序取色、撞了换第一个没用过的、八色用完生成新的，互不相同。
  const kept = allocateIdentityColors({ 甲: "#43b7cb" }, ["甲", "乙"]);
  assert.equal(kept.甲, "#43b7cb");
  assert.notEqual(kept.乙, "#43b7cb");
  const many = allocateIdentityColors(
    {},
    Array.from({ length: 12 }, (_, i) => `人物${i}`),
  );
  assert.equal(Object.keys(many).length, 12);
  assert.equal(new Set(Object.values(many)).size, 12, "一场里有两个人同色");
  for (const color of Object.values(many)) assert.match(color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(
    Object.values(many)
      .filter((color) => identity.colors.includes(color))
      .sort(),
    [...identity.colors].sort(),
    "八色没用完就开始生成新色了",
  );
  // 页面上色用的就是包里这一个函数（不是抄本）：按存储的对象取（B12 复核，见下一条）。
  const pageIdentity = stripComments(read("apps/web/libs/canvas/scene-3d/identity.ts"));
  assert.match(
    pageIdentity,
    /import \{[^}]*\bscene3dDefaultColor\b[^}]*\} from "(?:\.\.\/)+packages\/canvas-cli\/src\/contract\.mjs"/,
  );
  assert.match(
    stripComments(read("apps/web/libs/canvas/scene-3d/factory.ts")),
    /color: scene3dDefaultColor\(/,
  );
});

test("身份色能从存储的对象复算（0.17.0，B12 复核）：缺省名「人物」「立方体」不算名字、用 id；起了名字的按名字；布景灰", () => {
  const { defaultNames } = SCENE3D.identity;
  assert.deepEqual(defaultNames, {
    human: "人物",
    box: "立方体",
    cylinder: "圆柱",
    plane: "平面",
    backdrop: "背景板",
  });
  // 没起名字的两个人：存的都是「人物」，颜色按 id 分开（宿主只看 name 会算成同一个色）
  const off = { id: "off", kind: "human", role: "figure", name: "人物" };
  const guest = { id: "guest", kind: "human", role: "figure", name: "人物" };
  assert.equal(scene3dObjectIdentity(off), "off");
  assert.equal(scene3dDefaultColor(off), scene3dIdentityColor("figure", "off"));
  assert.notEqual(scene3dDefaultColor(off), scene3dIdentityColor("figure", "人物"));
  assert.equal(scene3dDefaultColor(guest), scene3dIdentityColor("figure", "guest"));
  // 起了名字的、预制件名当名字的：按名字
  assert.equal(scene3dObjectIdentity({ id: "boss", kind: "human", name: "掌柜" }), "掌柜");
  assert.equal(scene3dObjectIdentity({ id: "cup", kind: "cylinder", name: "cup" }), "cup");
  // 别的 kind 的缺省名不算缺省（人叫「立方体」照名字取）；布景一律灰
  assert.equal(scene3dObjectIdentity({ id: "a", kind: "human", name: "立方体" }), "立方体");
  assert.equal(
    scene3dDefaultColor({ id: "wall", kind: "box", role: "set", name: "墙" }),
    SCENE3D.identity.setColor,
  );
});

/**
 * B14 复核 M6：页面按本场避撞分色，prop5 存的是红色（按 id 算是青色、被 cup 占着），宿主拿 `scene3dDefaultColor`
 * 比就当成手改的打出 ` color=#e85d5d`，14 对象的 read 超 3 KB。`scene3dIsIdentityColor` 认得页面会给的每一种色。
 */
test("scene3dIsIdentityColor（0.17.0）：调色板八色、布景灰、八色用完后的黄金角色都是身份色；别的色、坏值不是", () => {
  for (const hex of SCENE3D.identity.colors) {
    assert.equal(scene3dIsIdentityColor(hex), true, hex);
    assert.equal(scene3dIsIdentityColor(hex.toUpperCase()), true, hex);
  }
  assert.equal(scene3dIsIdentityColor(SCENE3D.identity.setColor), true);
  // 九个以上不同的名字：分出来的每一个色（含黄金角色）都认
  const names = Array.from({ length: 40 }, (_, k) => `角色${k}`);
  const allocated = Object.values(allocateIdentityColors({}, names));
  assert.equal(new Set(allocated).size, 40);
  assert.ok(allocated.some((hex) => !SCENE3D.identity.colors.includes(hex)));
  for (const hex of allocated) assert.equal(scene3dIsIdentityColor(hex), true, hex);
  for (const other of ["#9aa1ab", "#123456", "red", "", null, undefined, 3])
    assert.equal(scene3dIsIdentityColor(other), false, String(other));
});

test("PROTOCOL.md 的 hostText 段点出 0.17.0 新登记的路径与 scene3dIsIdentityColor（B14 复核：宿主作者读协议看不到 undo 带了 sceneSummary）", () => {
  const protocolMd = readFileSync(path.join(packageRoot, "PROTOCOL.md"), "utf8");
  const section = protocolMd.slice(protocolMd.indexOf("## Rendering replies as text"));
  for (const [command, kind, p] of [
    ["undo", "verbatim", "scene3d[].sceneSummary"],
    ["redo", "verbatim", "scene3d[].sceneSummary"],
    ["apply", "visible", "scene3d[].applied[].seat"],
    ["apply", "visible", "scene3d[].applied[].fields[]"],
  ]) {
    assert.ok(HOST_TEXT[command][kind].includes(p), `${command}.${kind} ${p}`);
    assert.ok(section.slice(0, section.indexOf("\n## ")).includes(p), p);
  }
  assert.match(section, /scene3dIsIdentityColor/);
});

/**
 * 案底（2026-10-12 核查）：剧本转视频的产品场景（`s3d-ep01-P02`）只靠页面里一条正则隐藏，契约没写、手册还留着
 * 「三维节点自己的静帧（卡片缩略图）」「摆在三维节点右边」这类对产品场景不成立的旧句；站位图没出 / 被删后，人在
 * 画布上找不到它。0.16.4：判定进契约 `SCENE3D.embedded`，页面从契约取；手册写明；大纲在缺站位图时列出入口。
 * 0.18.1（A95，推翻 0.16.4 的隐藏）：判定留着（取景、三联、run 收不收），页面不再按它隐藏卡片——节点列表、几何
 * （框选 / 小地图 / 适配视图）都有它；大纲的缺图入口保留。
 */
test("产品场景的判定：契约 SCENE3D.embedded，页面从契约取；0.18.1 起不再隐藏卡片，大纲缺站位图时的入口保留", () => {
  assert.deepEqual(SCENE3D.embedded, {
    idPattern: "^s3d-ep[0-9]{2,4}-p[0-9]{2,4}$",
    idFlags: "i",
  });
  const rule = new RegExp(SCENE3D.embedded.idPattern, SCENE3D.embedded.idFlags);
  assert.ok(rule.test("s3d-ep01-P02") && rule.test("S3D-EP0001-p0002"));
  assert.ok(!rule.test("s3d-4a101807d6") && !rule.test("s3d-ep01-P02-S01"));
  const embedded = stripComments(read("apps/web/libs/canvas/scene-3d/embedded.ts"));
  assert.match(
    embedded,
    /new RegExp\(SCENE3D\.embedded\.idPattern, SCENE3D\.embedded\.idFlags\)/,
    "embedded.ts 没从契约取判定",
  );
  assert.doesNotMatch(embedded, /\/\^s3d-ep/, "embedded.ts 又手写了一条正则");
  // 0.18.1（A95）：不再隐藏——没有 visibleCanvasNodes / getVisibleNodeIds，节点同步不把它移出几何
  assert.doesNotMatch(embedded, /visibleCanvasNodes/, "embedded.ts 又按产品场景滤节点了");
  for (const file of [
    "apps/web/libs/canvas/canvas-store.ts",
    "apps/web/components/canvas/canvas-context.tsx",
    "apps/web/components/canvas/canvas-editor.tsx",
    "apps/web/components/canvas/engine/node-sync.ts",
  ]) {
    const text = stripComments(read(file));
    assert.doesNotMatch(text, /getVisibleNodeIds|visibleCanvasNodes/, `${file} 又在隐藏产品场景`);
  }
  assert.doesNotMatch(
    stripComments(read("apps/web/components/canvas/engine/node-sync.ts")),
    /isEmbeddedScene3d/,
    "node-sync 又把产品场景移出几何",
  );
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  for (const [name, text] of [
    ["SKILL.md", skill],
    ["commands.md", skillCommandsMd],
  ])
    assert.match(text, /SCENE3D\.embedded|scene3d\.embedded/, `${name} 没写产品场景的隐藏判定`);
  const outline = stripComments(read("apps/web/components/canvas/canvas-editor.tsx"));
  assert.match(outline, /embeddedScenesMissingStills\(graph\)/, "大纲没接缺站位图的导演台入口");
});

/**
 * 拍板 A81（用户 2026-10-12）：智能体对用户一律不说「免费 / 不花钱 / 零费用 / 不扣费」—— 用户知道调用模型要花钱，
 * 付费确认只在生图 / 生视频 / 生音频之前做。给模型看的手册、用法与变更日志里这类字眼会被照搬，改成「不是生成扣费项 /
 * 不进付费审批」的机制口径，并在 SKILL 里明令不对用户说。
 */
test("A81：随包手册、CLI 用法与契约里给模型看的不再说「免费 / 不花钱 / 零费用 / 不扣费」，SKILL 明令不对用户说", () => {
  const skill = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "SKILL.md"),
    "utf8",
  );
  assert.match(
    skill,
    /对用户不要说「免费」「不花钱」「零费用」「不扣费」（拍板 A81）/,
    "SKILL.md 没有明令不对用户说免费 / 不花钱",
  );
  const banned = /免费|不花钱|零费用|不扣费/;
  // 引号里的是在点名禁用的说法本身，不算。
  const withoutQuoted = (text) => text.replace(/「(?:免费|不花钱|零费用|不扣费)」/g, "");
  for (const [name, text] of [
    ["SKILL.md", skill],
    ["commands.md", skillCommandsMd],
    [
      "docs/integrations/canvas-cli.md 的 run-stills 一段",
      /`run-stills`[^\n]*billable:false[^\n]*/.exec(read("docs/integrations/canvas-cli.md"))?.[0] ??
        "",
    ],
  ]) {
    const hit = banned.exec(withoutQuoted(text));
    assert.equal(
      hit,
      null,
      `${name} 还有「${hit?.[0]}」：…${withoutQuoted(text).slice(Math.max(0, (hit?.index ?? 0) - 40), (hit?.index ?? 0) + 20)}…`,
    );
  }
  const english = /\bfree\b(?! space| row)|costs nothing|never charges?|nothing is charged/i;
  for (const [command, entry] of Object.entries(COMMAND_SPEC))
    for (const field of ["summary", "usage"])
      assert.doesNotMatch(
        String(entry[field] ?? ""),
        english,
        `${command}.${field} 还在说 free / costs nothing`,
      );
  const contractSrc = read("packages/canvas-cli/src/contract.mjs");
  const tierNotes = contractSrc.slice(
    contractSrc.indexOf("const TIERS = {"),
    contractSrc.indexOf("export const CANVAS_CONTRACT"),
  );
  assert.ok(tierNotes.length > 1000, "没切到 TIERS 那一段");
  assert.equal(
    banned.exec(withoutQuoted(tierNotes)),
    null,
    "契约 tiers 的说明还在说不扣费 / 不花钱",
  );
});
