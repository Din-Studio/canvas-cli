/**
 * 三维场景里人物 / 道具的身份色：同一个名字永远同一个颜色，人和 Agent、画布与剧本转视频的提示词说的是同一种色。
 * 契约 `SCENE3D.identity` 的数据取自这里，`./contract` 再导出下面三个函数（0.16.4），下游 import 它们、
 * 不再自带一份（剧本转视频曾经拷过一份）。
 */

import { echoText } from "./echo.mjs";

/** 调色板：hex 与中文色名按下标对应；顺序是「名字 → 颜色」算法的一部分，改了等于给所有人换色。 */
export const IDENTITY_PALETTE = Object.freeze([
  ["#e85d5d", "红色"],
  ["#36b89a", "绿色"],
  ["#4c91ed", "蓝色"],
  ["#edb443", "黄色"],
  ["#a475df", "紫色"],
  ["#ef86ba", "粉色"],
  ["#ef8945", "橙色"],
  ["#43b7cb", "青色"],
]);
/** 布景（role `set`）一律这个灰，不按名字取色。 */
export const IDENTITY_SET_COLOR = "#697681";

/**
 * 按集分色（0.18.0，A87 ④ / A88 ①）：可念的 12 个色，按分色的先后排（主要人物先拿前面的）。前 8 个就是上面名字算法的
 * 调色板（换了顺序，名字算法照旧用上面那张表）；后 4 个是新加的，在深色画面（#17171a）上看得清、彼此与前 8 个按
 * CIEDE2000 都差 16 以上，名字也是常说的色名。页面给没写 color 的对象上色仍只用上面 8 色的名字算法 —— 改它等于给所有
 * 老场景换色；这几张表给产品显式写 color 用（`allocateEpisodeIdentityColors`）。
 */
export const IDENTITY_NAMED = Object.freeze([
  ["#e85d5d", "红色"],
  ["#4c91ed", "蓝色"],
  ["#edb443", "黄色"],
  ["#36b89a", "绿色"],
  ["#a475df", "紫色"],
  ["#ef8945", "橙色"],
  ["#ef86ba", "粉色"],
  ["#43b7cb", "青色"],
  ["#a0623a", "棕色"],
  ["#b5d334", "黄绿色"],
  ["#3a7d44", "墨绿色"],
  ["#c3b091", "卡其色"],
]);
/** 道具统一的白 / 浅灰方块（A87 ④）：按出场先后交替，同一场里尽量不同色。 */
export const IDENTITY_PROP_COLORS = Object.freeze([
  ["#f2f2f2", "白色"],
  ["#b9bec4", "浅灰色"],
]);
/** 人物超过 12 个时一次性群演共用的「灰色群演」（A87 ④）：与布景灰、道具浅灰分得开。 */
export const IDENTITY_EXTRAS = Object.freeze(["#9097a0", "灰色"]);
/** 名字 → 调色板下标的算法名（契约 `SCENE3D.identity.hash`）：见 `scene3dIdentityColor`。 */
export const IDENTITY_HASH = "fnv1a32-nfkc-trim-lower";

/**
 * 名字 → 颜色：名字做 NFKC 规范化、去首尾空白、转小写，按码点做 32 位 FNV-1a，对调色板长度取余。
 * 布景回 `IDENTITY_SET_COLOR`。
 */
export function scene3dIdentityColor(role, identity) {
  if (role === "set") return IDENTITY_SET_COLOR;
  let h = 2166136261;
  for (const c of String(identity).normalize("NFKC").trim().toLowerCase()) {
    h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  }
  return IDENTITY_PALETTE[h % IDENTITY_PALETTE.length][0];
}
/**
 * 没起名字的对象存的缺省名（页面 `createScene3DObject` 按 kind 给）：取身份色时它不算名字——几个都叫「人物」的人
 * 会撞成一个色——退到 `id`（契约 `SCENE3D.identity.defaultNames`，0.17.0）。
 */
export const IDENTITY_DEFAULT_NAMES = Object.freeze({
  human: "人物",
  box: "立方体",
  cylinder: "圆柱",
  plane: "平面",
  backdrop: "背景板",
});

/**
 * 存储的对象 → 取身份色用的那个字符串：`name`；没有、或是它 kind 的缺省名（没起名字时页面存的那个）→ `id`。
 * 宿主拿存储的场景就能复算页面给的颜色（B12 复核：只看存储的 name，缺省名「人物」的几个人算出来与页面不同色）。
 */
export function scene3dObjectIdentity(object) {
  const name = typeof object?.name === "string" ? object.name.trim() : "";
  const fallback = Object.hasOwn(IDENTITY_DEFAULT_NAMES, object?.kind)
    ? IDENTITY_DEFAULT_NAMES[object.kind]
    : undefined;
  return name && name !== fallback ? object.name : String(object?.id ?? fallback ?? "");
}

/** 没写 `color` 的对象页面给它的颜色（= `scene3dIdentityColor(role, scene3dObjectIdentity(object))`）。 */
export function scene3dDefaultColor(object) {
  return scene3dIdentityColor(object?.role, scene3dObjectIdentity(object));
}

/**
 * 颜色的中文叫法（提示词里「红色人偶对应某某」用）；不在调色板里回 `色号#rrggbb`。`color` 是画布上存的原值、任何
 * 协作者都写得进（迁移只认字符串）：色号那半过回显闸（压成一行、≤ 32 个码点），带换行的 color 在提示词里伪造不出
 * 「下一步：…」那一行（B12 回显 fuzz）。
 */
export function scene3dColorLabel(color) {
  const key = String(color).toLowerCase();
  // 0.18.0：按集分色的 12 个可念色、道具白 / 浅灰、群演灰都念得出（前 8 个与调色板同色同名）
  return (
    [...IDENTITY_NAMED, ...IDENTITY_PROP_COLORS, IDENTITY_EXTRAS].find(
      ([hex]) => hex.toLowerCase() === key,
    )?.[1] ?? `色号${echoText(color, 32)}`
  );
}

/**
 * 一场里给一批名字分色、互不撞：已有的照旧；新名字按排序逐个取 `scene3dIdentityColor`，撞了换调色板里第一个
 * 没用过的，八色用完按黄金角在色环上生成新的。
 */
export function allocateIdentityColors(previous = {}, identities = []) {
  const result = { ...previous },
    used = new Set(Object.values(previous));
  for (const identity of [...new Set(identities)].sort()) {
    if (result[identity]) continue;
    let color = scene3dIdentityColor("figure", identity);
    if (used.has(color)) color = IDENTITY_PALETTE.find(([c]) => !used.has(c))?.[0];
    if (!color) {
      let n = Object.keys(result).length;
      do color = goldenColor(n++);
      while (used.has(color));
    }
    result[identity] = color;
    used.add(color);
  }
  return result;
}

/** 八色用完后的第 n 个色：按黄金角在色环上取（饱和 0.65、亮度 0.55）。 */
function goldenColor(n) {
  const h = (n * 137.508) % 360,
    s = 0.65,
    l = 0.55;
  const a = s * Math.min(l, 1 - l),
    f = (t) => {
      const k = (t + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
        .toString(16)
        .padStart(2, "0");
    };
  return "#" + f(0) + f(8) + f(4);
}
/** 黄金角色列到第几个（一场至多 100 个对象，分色时 n 从已有的身份数起）。 */
const GOLDEN_LISTED = 256;
let identityColors = null;
/**
 * 这个颜色是不是页面会给的身份色：调色板八色、布景灰、八色用完后的黄金角色（0.17.0，B14 复核 M6）。页面给没写
 * `color` 的对象按本场避撞分色，存的色不一定是按名字算的那个（`scene3dDefaultColor`）——宿主的紧凑投影用它判
 * 「身份色不打、手改的才打」，不用复算整场的分色顺序。
 */
export function scene3dIsIdentityColor(color) {
  identityColors ??= new Set([
    ...IDENTITY_PALETTE.map(([hex]) => hex),
    IDENTITY_SET_COLOR,
    ...Array.from({ length: GOLDEN_LISTED }, (_, n) => goldenColor(n)),
    // 0.18.0：产品按集显式写的那几种也是身份色（宿主投影不当成手改的打出来）
    ...IDENTITY_NAMED.map(([hex]) => hex),
    ...IDENTITY_PROP_COLORS.map(([hex]) => hex),
    IDENTITY_EXTRAS[0],
  ]);
  return typeof color === "string" && identityColors.has(color.toLowerCase());
}

const NAMED_HEX = IDENTITY_NAMED.map(([hex]) => hex);
const PROP_HEX = IDENTITY_PROP_COLORS.map(([hex]) => hex);
/** 这个颜色在按集分色里叫什么（不在表里 → undefined）。 */
const episodeLabel = (hex) =>
  [...IDENTITY_NAMED, ...IDENTITY_PROP_COLORS, IDENTITY_EXTRAS].find(([h]) => h === hex)?.[1];

/**
 * 一集的身份色（0.18.0，A87 ④ / A88 ①），给产品显式写 `add_object.color` 用；不改任何场景里存的颜色。
 * `subjects`：这一集出场的人物与道具，按重要度排（主要人物在前也行，`main` 会先分）——
 * `{id, role: "figure" | "prop", main?: true, extra?: true, scenes?: string[]}`；`id` 是跨场稳定的身份（同一个 id 只分一次，
 * 后出现的同 id 忽略），`scenes` 是它出场的场（道具同场避色用）。
 *  · 人物：可念的 12 色按 `IDENTITY_NAMED` 的顺序分，`main` 的先分、其余按给的顺序；出场人物不超过 12 个时人人一色（群演
 *    也是）；超过 12 个时一次性群演（`extra`）共用「灰色群演」，非群演仍超出 12 个的也落到灰色、列进 `overflow`。
 *  · 道具：白 / 浅灰两色：同场的道具里用得少的那个先，没有同场的（或没给 `scenes`）按整集用得少的交替。
 *  · 布景：布景灰（一般不用传）。
 *  · `previous`：已经分过的 `{id: color}`（产品写进索引的）照旧——补场、重跑时谁都不换色；新来的人物只用没被占的可念色。
 * 返回 `{colors: {id: hex}, labels: {id: 色名}, extras: [id…], overflow: [id…]}`（`extras` 是共用灰色群演的人物）。
 * 同样的输入永远同样的输出。
 */
export function allocateEpisodeIdentityColors(subjects = [], previous = {}) {
  const seen = new Set();
  const list = [];
  for (const subject of subjects) {
    const id = subject?.id;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    list.push(subject);
  }
  const colors = {};
  const kept = (id) =>
    typeof previous?.[id] === "string" && /^#[0-9a-f]{6}$/i.test(previous[id])
      ? previous[id].toLowerCase()
      : undefined;
  const figures = list.filter((s) => s.role === "figure");
  const crowded = figures.length > NAMED_HEX.length;
  const extras = [];
  const overflow = [];
  for (const s of list) {
    const old = kept(s.id);
    if (old) colors[s.id] = old;
  }
  const used = new Set(figures.flatMap((s) => (colors[s.id] ? [colors[s.id]] : [])));
  const ordered = [
    ...figures.filter((s) => s.main === true),
    ...figures.filter((s) => s.main !== true),
  ];
  for (const s of ordered) {
    if (colors[s.id]) continue;
    if (crowded && s.extra === true) {
      colors[s.id] = IDENTITY_EXTRAS[0];
      extras.push(s.id);
      continue;
    }
    const free = NAMED_HEX.find((hex) => !used.has(hex));
    if (free) {
      colors[s.id] = free;
      used.add(free);
    } else {
      colors[s.id] = IDENTITY_EXTRAS[0];
      overflow.push(s.id);
    }
  }
  const props = list.filter((s) => s.role === "prop");
  const scenesOf = (s) => new Set(Array.isArray(s.scenes) ? s.scenes : []);
  for (const s of props) {
    if (colors[s.id]) continue;
    const mine = scenesOf(s);
    const assigned = props.filter((o) => colors[o.id] !== undefined);
    const score = (hex) => [
      assigned.filter((o) => colors[o.id] === hex && [...scenesOf(o)].some((sc) => mine.has(sc)))
        .length,
      assigned.filter((o) => colors[o.id] === hex).length,
    ];
    colors[s.id] = [...PROP_HEX].sort((a, b) => {
      const [sa, ga] = score(a);
      const [sb, gb] = score(b);
      return sa - sb || ga - gb || PROP_HEX.indexOf(a) - PROP_HEX.indexOf(b);
    })[0];
  }
  for (const s of list) if (!colors[s.id]) colors[s.id] = scene3dIdentityColor(s.role, s.id);
  const labels = Object.fromEntries(
    Object.entries(colors).map(([id, hex]) => [id, episodeLabel(hex) ?? scene3dColorLabel(hex)]),
  );
  // 按给的顺序回（previous 里有、这次没给的不回）
  const pick = (record) => Object.fromEntries(list.map((s) => [s.id, record[s.id]]));
  return { colors: pick(colors), labels: pick(labels), extras, overflow };
}

/**
 * 校验一集的身份色（0.18.0）：`scenes` 是 `[{scene, objects: [{id, role, color}]}]`（各场三维节点存的对象，或产品写进
 * 索引的那份）。同一个身份（`id`）在两场里颜色不同 → `{code: "color_drift", id, colors: {场: 色}}`；同一场里两个不同的人物
 * 用着同一个可念色 → `{code: "color_shared", scene, color, ids}`（灰色群演、道具白 / 浅灰共用是设计如此，不报）。颜色按小写比。
 */
export function checkEpisodeIdentityColors(scenes = []) {
  const byId = new Map();
  const issues = [];
  const shared = [];
  for (const entry of scenes) {
    const scene = String(entry?.scene ?? "");
    const objects = Array.isArray(entry?.objects) ? entry.objects : [];
    const holders = new Map();
    for (const o of objects) {
      if (typeof o?.id !== "string" || typeof o.color !== "string") continue;
      if (o.role === "set") continue;
      const color = o.color.toLowerCase();
      const seenColors = byId.get(o.id) ?? new Map();
      if (!seenColors.has(scene)) seenColors.set(scene, color);
      byId.set(o.id, seenColors);
      if (o.role === "figure" && NAMED_HEX.includes(color)) {
        const ids = holders.get(color) ?? [];
        if (!ids.includes(o.id)) ids.push(o.id);
        holders.set(color, ids);
      }
    }
    for (const [color, ids] of holders)
      if (ids.length > 1) shared.push({ code: "color_shared", scene, color, ids });
  }
  for (const [id, perScene] of byId)
    if (new Set(perScene.values()).size > 1)
      issues.push({ code: "color_drift", id, colors: Object.fromEntries(perScene) });
  return [...issues, ...shared];
}
