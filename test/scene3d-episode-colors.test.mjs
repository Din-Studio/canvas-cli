import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateEpisodeIdentityColors,
  checkEpisodeIdentityColors,
  SCENE3D,
  scene3dColorLabel,
  scene3dIdentityColor,
  scene3dIsIdentityColor,
} from "../src/contract.mjs";

/**
 * 0.18.0 T6：按集身份色（A87 ④ / A88 ①）。可念的色扩到 12 个（人物用，主要人物整集固定），人物超过 12 个时一次性群演
 * 共用「灰色群演」，道具统一白 / 浅灰方块；同一身份跨场同色。页面给没写 color 的对象上色的名字算法（8 色）不动——
 * 改了等于给所有老场景换色；按集分色是产品显式写 color 用的。
 */

const { identity } = SCENE3D;

test("契约：可念的 12 色（前 8 个就是名字算法的调色板）、道具白 / 浅灰、群演灰，颜色与色名一一对应、互不重复", () => {
  assert.equal(identity.namedColors.length, 12);
  assert.equal(identity.namedLabels.length, 12);
  assert.deepEqual([...identity.namedColors.slice(0, 8)].sort(), [...identity.colors].sort());
  // 名字算法的 8 色原样不动（顺序是算法的一部分）
  assert.deepEqual(identity.colors, [
    "#e85d5d",
    "#36b89a",
    "#4c91ed",
    "#edb443",
    "#a475df",
    "#ef86ba",
    "#ef8945",
    "#43b7cb",
  ]);
  assert.deepEqual(identity.propColors, ["#f2f2f2", "#b9bec4"]);
  assert.deepEqual(identity.propLabels, ["白色", "浅灰色"]);
  assert.equal(identity.extrasLabel, "灰色");
  const every = [
    ...identity.namedColors,
    ...identity.propColors,
    identity.extrasColor,
    identity.setColor,
  ];
  assert.equal(new Set(every).size, every.length, "按集分色的颜色有重复，或撞了布景灰");
  for (const hex of every) assert.match(hex, /^#[0-9a-f]{6}$/);
  const labels = [...identity.namedLabels, ...identity.propLabels, identity.extrasLabel];
  assert.equal(new Set(labels).size, labels.length, "色名有重复");
});

test("scene3dColorLabel 念得出全部 12 色、道具两色与群演灰；scene3dIsIdentityColor 都认", () => {
  identity.namedColors.forEach((hex, i) => {
    assert.equal(scene3dColorLabel(hex), identity.namedLabels[i], hex);
    assert.equal(scene3dColorLabel(hex.toUpperCase()), identity.namedLabels[i], hex);
    assert.equal(scene3dIsIdentityColor(hex), true, hex);
  });
  identity.propColors.forEach((hex, i) => {
    assert.equal(scene3dColorLabel(hex), identity.propLabels[i]);
    assert.equal(scene3dIsIdentityColor(hex), true, hex);
  });
  assert.equal(scene3dColorLabel(identity.extrasColor), identity.extrasLabel);
  assert.equal(scene3dIsIdentityColor(identity.extrasColor), true);
  // 名字算法与原来的 8 个色名不变
  identity.colors.forEach((hex, i) => assert.equal(scene3dColorLabel(hex), identity.labels[i]));
  assert.equal(scene3dIdentityColor("figure", "掌柜"), scene3dIdentityColor("figure", " 掌柜 "));
  assert.equal(scene3dColorLabel("#123456"), "色号#123456");
});

const figure = (id, extra = {}) => ({ id, role: "figure", ...extra });
const prop = (id, extra = {}) => ({ id, role: "prop", ...extra });

test("人物 ≤ 12：人人一个可念的色、互不相同；主要人物先分（按给的顺序拿前几个色）", () => {
  const subjects = [
    figure("路人甲"),
    figure("主角", { main: true }),
    figure("师父", { main: true }),
    ...Array.from({ length: 9 }, (_, i) => figure(`配角${i}`)),
  ];
  const before = JSON.stringify(subjects);
  const out = allocateEpisodeIdentityColors(subjects);
  assert.equal(JSON.stringify(subjects), before, "不许改调用方的输入");
  assert.equal(out.colors.主角, identity.namedColors[0]);
  assert.equal(out.colors.师父, identity.namedColors[1]);
  assert.equal(out.colors.路人甲, identity.namedColors[2]);
  const colors = subjects.map((s) => out.colors[s.id]);
  assert.equal(new Set(colors).size, 12);
  for (const color of colors) assert.ok(identity.namedColors.includes(color), color);
  assert.equal(out.labels.主角, identity.namedLabels[0]);
  assert.deepEqual(out.extras, []);
  assert.deepEqual(out.overflow, []);
  // 同样的输入同样的结果；同一个 id 只分一次
  assert.deepEqual(allocateEpisodeIdentityColors([...subjects, figure("主角")]), out);
});

test("人物 ≤ 12 时群演也各有一个色；超过 12 个：一次性群演共用灰色群演，非群演还超出的也落到灰色、列进 overflow", () => {
  const few = allocateEpisodeIdentityColors([
    figure("甲", { main: true }),
    figure("群演1", { extra: true }),
  ]);
  assert.notEqual(few.colors.群演1, identity.extrasColor);
  const subjects = [
    ...Array.from({ length: 11 }, (_, i) => figure(`人物${i}`, i < 2 ? { main: true } : {})),
    ...Array.from({ length: 4 }, (_, i) => figure(`群演${i}`, { extra: true })),
  ];
  const out = allocateEpisodeIdentityColors(subjects);
  for (let i = 0; i < 4; i++) assert.equal(out.colors[`群演${i}`], identity.extrasColor);
  assert.equal(out.labels.群演0, "灰色");
  assert.deepEqual(out.extras, ["群演0", "群演1", "群演2", "群演3"]);
  const named = Array.from({ length: 11 }, (_, i) => out.colors[`人物${i}`]);
  assert.equal(new Set(named).size, 11);
  assert.deepEqual(out.overflow, []);
  const crowd = allocateEpisodeIdentityColors(
    Array.from({ length: 14 }, (_, i) => figure(`角色${i}`, i === 13 ? { main: true } : {})),
  );
  assert.equal(crowd.colors.角色13, identity.namedColors[0], "主要人物排在最后也先分色");
  assert.deepEqual(crowd.overflow, ["角色11", "角色12"]);
  assert.equal(crowd.colors.角色12, identity.extrasColor);
});

test("道具：白 / 浅灰交替；给了 scenes 时同一场里两件道具不同色（同场用得少的那个先）", () => {
  const plain = allocateEpisodeIdentityColors([prop("欠费单"), prop("茶杯"), prop("钥匙")]);
  assert.deepEqual(
    ["欠费单", "茶杯", "钥匙"].map((id) => plain.colors[id]),
    [identity.propColors[0], identity.propColors[1], identity.propColors[0]],
  );
  assert.equal(plain.labels.欠费单, "白色");
  assert.equal(plain.labels.茶杯, "浅灰色");
  // 不给 scenes 时第三件撞了第一件；给了 scenes，钥匙只和茶杯同场 → 取白色，茶杯取浅灰
  const scened = allocateEpisodeIdentityColors([
    prop("欠费单", { scenes: ["P01"] }),
    prop("茶杯", { scenes: ["P02"] }),
    prop("钥匙", { scenes: ["P02"] }),
  ]);
  assert.equal(scened.colors.欠费单, identity.propColors[0]);
  assert.notEqual(scened.colors.茶杯, scened.colors.钥匙);
});

test("previous（写在索引里的）照旧：补场时主要人物不换色，新来的只用没占的色", () => {
  const first = allocateEpisodeIdentityColors([figure("主角", { main: true }), figure("师父")]);
  const later = allocateEpisodeIdentityColors(
    [figure("新人", { main: true }), figure("主角", { main: true }), figure("师父")],
    first.colors,
  );
  assert.equal(later.colors.主角, first.colors.主角);
  assert.equal(later.colors.师父, first.colors.师父);
  assert.ok(![first.colors.主角, first.colors.师父].includes(later.colors.新人));
  assert.ok(identity.namedColors.includes(later.colors.新人));
});

test("checkEpisodeIdentityColors：同一身份跨场换了色报 color_drift；同一场两个人用同一个可念色报 color_shared；群演灰、道具色共用不报", () => {
  const ok = checkEpisodeIdentityColors([
    {
      scene: "P01",
      objects: [
        { id: "主角", role: "figure", color: "#e85d5d" },
        { id: "群演1", role: "figure", color: identity.extrasColor },
        { id: "群演2", role: "figure", color: identity.extrasColor },
        { id: "欠费单", role: "prop", color: identity.propColors[0] },
        { id: "茶杯", role: "prop", color: identity.propColors[0] },
        { id: "wall", role: "set", color: identity.setColor },
      ],
    },
    { scene: "P02", objects: [{ id: "主角", role: "figure", color: "#E85D5D" }] },
  ]);
  assert.deepEqual(ok, []);
  const issues = checkEpisodeIdentityColors([
    {
      scene: "P01",
      objects: [
        { id: "主角", role: "figure", color: "#e85d5d" },
        { id: "师父", role: "figure", color: "#4c91ed" },
      ],
    },
    {
      scene: "P02",
      objects: [
        { id: "主角", role: "figure", color: "#ef86ba" },
        { id: "师父", role: "figure", color: "#ef86ba" },
      ],
    },
  ]);
  assert.deepEqual(issues, [
    { code: "color_drift", id: "主角", colors: { P01: "#e85d5d", P02: "#ef86ba" } },
    { code: "color_drift", id: "师父", colors: { P01: "#4c91ed", P02: "#ef86ba" } },
    { code: "color_shared", scene: "P02", color: "#ef86ba", ids: ["主角", "师父"] },
  ]);
});
