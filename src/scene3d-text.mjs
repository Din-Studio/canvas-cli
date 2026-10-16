/**
 * `scene3d_apply` 回包的人话版 —— **包里的公共能力**，先例 `tidy-summary.mjs`。
 *
 * 宿主把回包压成文本时，模型真正读到的常常只有 `apply.scene3dSummary` 这一段：下一批要接的
 * `sceneDigest`、改名、拦下 / 提醒的原话、跳切，都得在这里面。页面直接把它放进回包
 * （`agent-bridge/canvas.ts` 相对路径 import 本文件），宿主要自己渲染时 import 同一份
 * （`@scenemint/canvas-cli/contract` 再导出），两边给出**逐字相同**的文本 —— `hostText`
 * 的 verbatim 闸（`test/contract.test.mjs`）拿仓内夹具逐字比对的就是这个函数。
 *
 * 只出基础行；取景 / 动作 / 产物行由页面在后续批次拼接（00-contract §2.2）。
 */
import { SCENE3D_CUT_EXEMPTION_LABELS } from "./scene3d-labels.mjs";
import { echoId, echoShotN, echoText, echoUrl } from "./echo.mjs";
export {
  ID_UNAVAILABLE,
  LINE_BREAK,
  URL_UNAVAILABLE,
  echoId,
  echoMessage,
  echoProse,
  echoShotN,
  echoText,
  echoUrl,
} from "./echo.mjs";

/** 一段里最多列几条（warn / 跳切 / 豁免 / 改名各自）；整段要守住 ≤24 行、≤2 KB。 */
const LIST_MAX = 5;

function listed(items, show) {
  const head = items.slice(0, LIST_MAX).map(show).join("；");
  return items.length > LIST_MAX ? `${head}；等 ${items.length} 处` : head;
}

/**
 * 每条 report 一行：
 * `<nodeId>：应用 N 个动作 → sceneDigest=<d>（下一批 baseDigest）；改名 a→b；<b> 处拦下，<w> 处提醒（<code>：<message>），取景 <f> 条提醒（不拦，见下）；
 * 清掉 <id>.facing（rotation.y 覆盖）；<id> 按 prefab 画（kind=<kind>）`（没有的段不出）。0.18.0 起不再写越轴与跳切 / 豁免
 * （A87 ③：只在出预演的回包 notes[] 里提醒）。页面修过数据（`repairs`）另起一行「修数据 N 处…」；有拦下再另起一行列原话。
 */
export function formatScene3dSummary(reports) {
  return reports
    .map((report) => {
      const { health } = report.checks;
      const blocks = health.filter((issue) => issue.level === "block");
      const warns = health.filter((issue) => issue.level !== "block");
      const renames = report.applied.filter((a) => a.requestedId !== undefined);
      const parts = [
        // 动作打完场景一字不差：页面没写、不进撤销栈（B9-FX-51）
        report.unchanged
          ? `${report.nodeId}：${report.applied.length} 个动作打完场景没有变化（没写、不进撤销栈）→ sceneDigest=${report.sceneDigest}（下一批 baseDigest）`
          : `${report.nodeId}：应用 ${report.applied.length} 个动作 → sceneDigest=${report.sceneDigest}（下一批 baseDigest）`,
      ];
      if (renames.length > 0)
        parts.push(`改名 ${listed(renames, (a) => `${a.requestedId}→${a.id}`)}`);
      // 「N 处提醒」只数健康；有取景提醒时另报条数，免得下面紧跟的「镜n ⚠」行像是和它矛盾
      const framing = report.checks.framing ?? [];
      parts.push(
        `${blocks.length} 处拦下，${warns.length} 处提醒` +
          (warns.length > 0
            ? `（${listed(warns, (issue) => `${issue.code}：${issue.message}`)}）`
            : "") +
          (framing.length > 0 ? `，取景 ${framing.length} 条提醒（不拦，见下）` : ""),
      );
      // 0.18.0（A87 ③）：越轴、接缝 < 30° 与站位图无关、不拦，只在出预演（run --render video）的回包 notes[] 里提醒；
      // 这里不再说（结构化的 checks.axis / checks.cuts 照旧在回包里）。
      for (const a of report.applied) {
        if (a.cleared?.includes("facing")) parts.push(`清掉 ${a.id}.facing（rotation.y 覆盖）`);
      }
      for (const a of report.applied) {
        if (a.kind !== undefined)
          parts.push(
            a.kind === "human"
              ? `${a.id} 按 role:figure 推为 human`
              : `${a.id} 按 prefab 画（kind=${a.kind}）`,
          );
      }
      const lines = [parts.join("；")];
      // 0.18.0：页面落地之后修的数据（scene3d[].repairs）——一行点名，细节与原因在 repairs[]
      const repairs = Array.isArray(report.repairs) ? report.repairs : [];
      if (repairs.length > 0)
        lines.push(
          `修数据 ${repairs.length} 处（只修数据、不改站位意图；照 scene3d[].repairs 写回方案）：${listed(repairs, repairText)}`,
        );
      if (blocks.length > 0) lines.push(`拦下：${blocks.map((issue) => issue.message).join("；")}`);
      return lines.join("\n");
    })
    .join("\n");
}

/** 修数据一条的短说法（id 过 {@link echoId}；改前 → 改后照 repairs[] 的值）。 */
function repairText(repair) {
  const id = echoId(repair.id);
  switch (repair.code) {
    case "grounded":
      return `${id} 落地（y ${num(repair.from)}→${num(repair.to)}）`;
    case "figure_grounded":
      return `${id} 脚底贴面（y ${num(repair.from)}→${num(repair.to)}）`;
    case "held_to_hand":
      return `${id} 贴到手上`;
    case "pushed_out":
      return `${id} 推开到 ${point(repair.to)}`;
    case "camera_merged":
      return `机位 ${id} 并进 ${echoId(repair.to)}`;
    default:
      return `${id} ${echoId(repair.code)}`;
  }
}

/** 米 / 度：最多两位小数，去掉尾零（-0 记 0）。 */
function num(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "?";
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
function point(p) {
  return p && typeof p === "object" ? `(${num(p.x)},${num(p.y)},${num(p.z)})` : "?";
}
/** 看点 / 朝向 / 目标：对象 id 原样，点写坐标。 */
function target(t) {
  return typeof t === "string" ? t : point(t);
}
const list = (value) => (Array.isArray(value) ? value : []);
/** 人物字段 / 起止状态的值：数写数（lean 是度数），id 原样，点写坐标。 */
function shownValue(value) {
  return typeof value === "number" ? num(value) : target(value);
}

function objectLine(o) {
  const parts = [`- ${o.id}`];
  if (typeof o.name === "string" && o.name && o.name !== o.id) parts[0] += `「${o.name}」`;
  // 人物一定是 role:figure，只写 kind；其余写角色 + kind / 预制件。
  parts.push(
    o.kind === "human" && o.role === "figure"
      ? "human"
      : `${o.role ?? "?"} ${o.kind ?? "?"}${o.prefab ? `/${o.prefab}` : ""}`,
  );
  const t = o.transform ?? {};
  parts.push(`@${point(t.position)}`);
  if (t.rotation && (t.rotation.x || t.rotation.y || t.rotation.z))
    parts.push(
      t.rotation.x || t.rotation.z ? `转${point(t.rotation)}°` : `转${num(t.rotation.y)}°`,
    );
  if (t.scale && (t.scale.x !== 1 || t.scale.y !== 1 || t.scale.z !== 1))
    parts.push(`缩放${point(t.scale)}`);
  if (o.human?.bodyType && o.human.bodyType !== "standard") parts.push(`体型 ${o.human.bodyType}`);
  for (const [key, value] of Object.entries(o.figure ?? {}))
    if (key === "offstage") {
      // 0.18.2 在场模型：开场不在（等 do:"@enter" 进场）
      if (value === true) parts.push("开场不在");
    } else if (value !== undefined && value !== null) parts.push(`${key} ${shownValue(value)}`);
  // 0.18.0：人在导演台改过的对象（editedBy:"human"）——remove 删它要用户同意
  if (o.editedBy === "human") parts.push("人改过");
  return parts.join(" ");
}

/**
 * 起止状态（0.16.3 `states`）：`起止 f1 pose stand→sit seat ·→chair`——一端没写是 `·`，写 null（清掉）是 `清掉`。
 */
function statesText(states) {
  const end = (value) => (value === undefined ? "·" : value === null ? "清掉" : shownValue(value));
  return list(states)
    .map((state) => {
      const from = state?.from && typeof state.from === "object" ? state.from : {};
      const to = state?.to && typeof state.to === "object" ? state.to : {};
      const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
      return [
        String(state?.who ?? "?"),
        ...keys.map((k) => `${k} ${end(from[k])}→${end(to[k])}`),
      ].join(" ");
    })
    .join(" / ");
}

/**
 * 一镜一行；分了子镜头（0.16.3 `cuts`）的，紧跟着每个子镜头一行（`- 子镜头n …`，同一套写法，子镜头不再嵌套）——一段镜头里
 * 机位按子镜头换，只看段的那一行会读成一个机位拍到底。
 */
function shotLines(s) {
  const cuts = list(s.cuts);
  return [shotLine(s, "镜"), ...cuts.map((cut) => shotLine({ ...cut, cuts: undefined }, "子镜头"))];
}

function shotLine(s, label) {
  // 镜号只认整数（同 echoShotN）：存的 n 是协作者写得进的原值
  const head = `- ${label}${Number.isInteger(s.n) ? s.n : "?"} ${s.id}${s.framing ? ` ${s.framing}` : ""}：`;
  const parts = [];
  if (s.orbit)
    parts.push(
      `环绕 ${point(s.orbit.center)} r${num(s.orbit.r)} ${num(s.orbit.from)}°→${num(s.orbit.to)}°${s.orbit.y !== undefined ? ` 高${num(s.orbit.y)}` : ""}`,
    );
  else if (s.cam) parts.push(`机位 ${point(s.cam)}`);
  if (s.via?.length)
    parts.push(`途经 ${s.via.map((v) => `${num(v.t)}:${point(v.cam)}`).join(" ")}`);
  if (s.to) parts.push(`→ ${point(s.to)}`);
  parts.push(`看 ${target(s.look)}${s.lookTo !== undefined ? `→${target(s.lookTo)}` : ""}`);
  parts.push(`fov ${num(s.fov)}${s.fovTo !== undefined ? `→${num(s.fovTo)}` : ""}`);
  if (s.dur !== undefined) parts.push(`${num(s.dur)} s`);
  if (s.start !== undefined) parts.push(`入点 ${num(s.start)} s`);
  if (s.follow) parts.push(`跟 ${s.follow}`);
  if (s.shake) parts.push(`手持 ${s.shake}`);
  if (s.moves?.length) parts.push(`偷位 ${s.moves.length} 处`);
  if (s.onAxis) parts.push("轴上");
  if (list(s.states).length) parts.push(`起止 ${statesText(s.states)}`);
  if (list(s.cuts).length) parts.push(`分 ${s.cuts.length} 个子镜头（见下）`);
  // 0.18.0：人在导演台改过的镜头（editedBy:"human"）——remove_shot 删它要用户同意
  if (s.editedBy === "human") parts.push("人改过");
  return head + parts.join("，");
}

const ACT_KEYS = [
  "gait",
  "pose",
  "arms",
  "armL",
  "armR",
  "facing",
  "gaze",
  "hold",
  "hand",
  "gesture",
];
function actLine(a) {
  const parts = [
    `- ${a.id} ${a.who} @${num(a.at)} s${a.dur !== undefined ? ` ${num(a.dur)} s` : ""}：`,
  ];
  const what = [];
  // 0.18.2 在场模型：进场（出现在 to）/ 离场
  if (a.do === "@enter") what.push(`进场${a.to !== undefined ? ` 在 ${target(a.to)}` : ""}`);
  else if (a.do === "@offstage") what.push("离场");
  else if (a.do !== undefined) what.push(`do ${target(a.do)}`);
  if (a.to !== undefined && a.do === undefined) what.push(`走到 ${target(a.to)}`);
  if (a.via?.length) what.push(`途经 ${a.via.map(point).join(" ")}`);
  for (const key of ACT_KEYS) if (a[key] !== undefined) what.push(`${key} ${target(a[key])}`);
  parts[0] += what.join("，");
  if (a.note) parts.push(`（${a.note}）`);
  return parts.join("");
}

/**
 * 场景投影 / 自检文本回显的名字、id、镜号、原话都是任何协作者写得进的画布数据：每行各自压成一行再拼，
 * 一个带换行的值多伪造不出一行（B11-int 复核）。
 */
function oneLineEach(lines) {
  return lines.map((line) => echoText(line, Infinity)).join("\n");
}

/** 场景投影里回显的每个文本值（名字、id、引用、词、note……）至多几个字。 */
const SCENE_VALUE_MAX = 200;

/**
 * 场景投影的入口闸：场景里的每个字符串（含对象键）先过 {@link echoText}——压成一行、限长——再拼行。投影回显的
 * 几十个字段都是协作者写得进的存储原值，逐个字段去挡总会漏一个（B11 fuzz：5000 字的名字 / id / 词原样进了
 * 投影）；在入口一次挡住，新加的字段也跟着挡。
 */
function echoScene(value) {
  if (typeof value === "string") return echoText(value, SCENE_VALUE_MAX);
  if (Array.isArray(value)) return value.map(echoScene);
  if (!value || typeof value !== "object") return value;
  // 键名压完撞名的（`pose` 与 `pose\n`）加 #n，不让后一个悄悄盖掉前一个（同 s2v echoSafeReply）
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    let shown = echoText(key, SCENE_VALUE_MAX);
    for (let n = 2; Object.hasOwn(out, shown); n += 1)
      shown = `${echoText(key, SCENE_VALUE_MAX)}#${n}`;
    out[shown] = echoScene(v);
  }
  return out;
}

/**
 * `read NODE/scene` 的场景（线上形，角度为度）的紧凑投影（0.17.0，00-contract §12）：一行概况，再一对象一行
 * （id、名字、角色、kind / 预制件、脚点、转角、缩放、体型与人物姿态）、一机位一行、一镜一行（镜号、取景、机位或
 * 环绕、途经、落幅、看点、fov、时长、入点、跟拍、手持、偷位、起止状态；分了子镜头的后面一个子镜头一行）、
 * 一条调度动作一行。宿主不必再把整份 JSON 贴给模型
 * （14 对象 6 镜的紧凑 JSON 就 5 KB）。认不出的字段不出，缺的值写 `?`。
 */
export function formatScene3dScene(raw) {
  const scene = echoScene(raw);
  const objects = list(scene?.objects);
  const cameras = list(scene?.cameras);
  const shots = list(scene?.shots);
  const acts = list(scene?.blocking);
  const head = [
    `画幅 ${scene?.aspectRatio ?? "?"}`,
    `对象 ${objects.length} 个，机位 ${cameras.length} 台（当前 ${scene?.activeCameraId ?? "?"}），镜头 ${shots.length} 个，调度动作 ${acts.length} 条`,
  ];
  if (Array.isArray(scene?.axis)) head.push(`轴线 ${scene.axis.join("↔")}`);
  const lines = [head.join("；")];
  if (objects.length) lines.push("对象：", ...objects.map(objectLine));
  if (cameras.length)
    lines.push(
      "机位：",
      ...cameras.map(
        (c) =>
          `- ${c.id}${c.name ? `「${c.name}」` : ""} ${point(c.position)}→${point(c.target)} fov ${num(c.fov)}`,
      ),
    );
  if (shots.length) lines.push("镜头：", ...shots.flatMap(shotLines));
  if (acts.length) lines.push("调度：", ...acts.map(actLine));
  return oneLineEach(lines);
}

/**
 * 自检（`checks`：health / axis / cuts，0.17.0 起可带 framing / motion）的文本版：一行结论，再逐条原话。
 * `scene3dSummary` 只给计数与前几条，这里给全（`read NODE/checks` 的人话版）；立场同手册「自检立场」——
 * 越轴、跳切、取景、动作提醒都是镜头设计的发现，照原话报给用户。
 */
export function formatScene3dChecks(checks) {
  const health = list(checks?.health);
  const cuts = list(checks?.cuts);
  const framing = list(checks?.framing);
  const motion = list(checks?.motion);
  const blocks = health.filter((issue) => issue.level === "block");
  const lines = [
    `自检：${blocks.length} 处拦下，${health.length - blocks.length} 处提醒` +
      (checks?.framing !== undefined ? `；取景提醒 ${framing.length} 处` : "") +
      (checks?.motion !== undefined ? `；动作提醒 ${motion.length} 处` : ""),
  ];
  for (const issue of health)
    lines.push(
      `- [${issue.level}] ${issue.code}：${issue.message}${issue.path ? `（${issue.path}）` : ""}`,
    );
  if (checks?.axis) lines.push(`越轴：${checks.axis.message}`);
  for (const cut of cuts)
    lines.push(
      `切 镜${echoShotN(cut.from, cut.fromId)}→镜${echoShotN(cut.to, cut.toId)} ${num(cut.angle)}°${cut.jump ? " 跳切" : ""}${
        cut.exempt ? `（豁免：${SCENE3D_CUT_EXEMPTION_LABELS[cut.exempt] ?? cut.exempt}）` : ""
      }：${cut.message}`,
    );
  for (const issue of framing)
    lines.push(
      `- 取景 ${issue.shotId == null ? "当前机位" : echoId(issue.shotId)} [${issue.code}]${
        Array.isArray(issue.t) ? ` ${num(issue.t[0])}–${num(issue.t[1])} s` : ""
      }：${issue.message}`,
    );
  for (const issue of motion)
    lines.push(
      `- 动作 [${issue.level}] ${issue.code}：${issue.message}${issue.path ? `（${issue.path}）` : ""}`,
    );
  return oneLineEach(lines);
}

const RENDER_LABEL = { still: "静帧", video: "预演", sheet: "联系表" };

/**
 * `read NODE/renders` 的人话版（`rendersSummary`，hostText verbatim）：一行一个产物，镜号、产物、状态、卡片 id
 * 与 url / 过期 / 错误（含 next 的第一条 argv）同在一行，宿主截断剩余 JSON 时也对得上。页面拼它，CLI 拿同一份
 * 结构化 `renders[]` 重拼一遍盖掉页面那段（老页面没过 echo 也挡住；B11-F2-1：逐值替换会被两个值的先后顺序绕过）。
 * 回显的画布数据：shotId / 卡片 id 过 {@link echoId}，url 过 {@link echoUrl}，页面写的错误原话与 argv 压成一行。
 */
export function formatScene3dRenders(rows) {
  return rows
    .map((row) => {
      const shot = Number.isInteger(row?.n)
        ? `镜${row.n}`
        : row?.shotId !== null && row?.shotId !== undefined
          ? `${echoId(row.shotId)}（镜头已删）`
          : "整场";
      const output =
        row?.frame === "end"
          ? "结束站位"
          : Object.hasOwn(RENDER_LABEL, row?.output)
            ? RENDER_LABEL[row.output]
            : "产物";
      const head = `${shot} ${output} ${echoText(row?.state, 16)} ${echoId(row?.nodeId)}`;
      if (row?.state === "landed")
        return `${head} ${row.url === null ? "（无 url）" : echoUrl(row.url)} stale=${row.stale === true}`;
      if (row?.state === "rendering") return `${head} 渲染中，稍后再 read`;
      const next = row?.error?.next?.[0]?.command;
      const line = (text) => echoText(text, Number.POSITIVE_INFINITY);
      return `${head} [${line(row?.error?.code ?? "run_failed")}] ${line(row?.error?.message)}${
        next ? `；下一步：${line(next)}` : ""
      }`;
    })
    .join("\n");
}
