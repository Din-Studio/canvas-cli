// 回显闸（B9-FX-15 / B11）：画布数据（任何协作者都写得进）回显进人话段、argv 或整段原话前过这里。
// 单独成文件：页面首包里的 agent-bridge/types.ts、tidy-summary.mjs 只要这几个小函数，不必把整份 scene3d-text.mjs
// （场景投影 / 自检 / 渲染行的排版）拉进画布首包；scene3d-text.mjs 原样再导出，包内外的老引用不变。

/**
 * 回显时压掉的字符：控制字符（含 VT / FF / FS / GS / RS / NEL）、行 / 段分隔符、双向控制符（U+061C、U+200E/F、
 * U+202A–202E、U+2066–2069），以及零宽空格 U+200B、词连接符 U+2060、BOM U+FEFF——后三个看不见，却能把「--approved」
 * 贴在一个看不出的词边界上（B11 复核）。ZWJ / ZWNJ（U+200C/D）留着：emoji 与印度系文字要用。
 */
const ECHO_FOLD =
  /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]+/gu;

/**
 * 断行：Unicode / Python `splitlines` 认的每一种行终止符（LF、CR、VT、FF、FS、GS、RS、NEL、U+2028、U+2029）。
 * echoMessage 的「⏎」、resendCommand 的「做不成单行」、fuzz 的拆行都用这一个类（B11 复核）。
 */
// oxlint-disable-next-line eslint/no-control-regex -- line terminators are what this matches
export const LINE_BREAK = /[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/u;

/** 按码点截到 `max`（不劈开代理对：UTF-8 宿主写不出半个 emoji），超了补「…」。 */
function clip(text, max) {
  if (text.length <= max) return text;
  const points = [...text];
  return points.length > max ? `${points.slice(0, max).join("")}…` : text;
}

/**
 * 人话段（hostText verbatim：`rendersSummary` / `sceneSummary`）里回显的画布数据是任何协作者都能写的：
 * 一个带换行的值就能在 Agent 的上下文里多伪造一行（假的渲染行、假的「下一步：apply … --approved」）。
 * 回显前把 {@link ECHO_FOLD} 里的字符压成空格（一行变不成两行），按码点限长（B9-FX-15）。
 */
export function echoText(value, max = 200) {
  return clip(
    String(value ?? "")
      .replace(ECHO_FOLD, " ")
      .trim(),
    max,
  );
}

/**
 * 整段回显成一个字段的自由文本（`error.message`、节点的 `lastError.message`）：断行（{@link LINE_BREAK}）处写成
 * 「⏎」而不是空格——看得出原来断过行，值里的「下一步：… --approved」/「（系统）…」也到不了一行的行首（B11 fuzz）；
 * 其余压掉的字符写成空格；按码点限长。只管断行：一个本身就以「下一步」开头的值照样以它开头，所以宿主贴这类字段
 * 必须带标签（s2v 写「-- lastError (…): 」）。
 */
export function echoMessage(value, max = 400) {
  const text = String(value ?? "")
    .replace(ECHO_FOLD, (run) => (LINE_BREAK.test(run) ? " ⏎ " : " "))
    .trim();
  return clip(text, max);
}

/**
 * 与 argv 同在一行的人话值（「产物过期：<卡片标题>……要更新就再 run 出：run … --approved」里的标题）：
 * {@link echoText} 之外再去掉 shell 引号、反引号、`$` 与反斜杠；不跟在字母 / 数字后面的一串 `-` 整串换成「‐」
 * （U+2010）——协作者写的标题在那一行拼不出 `--json` / `--approved` 这样的词（空格、全角括号、冒号后面都算词首），
 * 也开不了引号（B11 fuzz）。普通标题（`ep01-茶馆 · 镜2`）原样。
 */
export function echoProse(value, max = 200) {
  return echoText(value, max)
    .replace(/['"`$\\]/g, "")
    .replace(/(?<![\p{L}\p{N}])-+/gu, (dashes) => "\u2010".repeat(dashes.length));
}

/** url 回显不了时写的那句。 */
export const URL_UNAVAILABLE = "（url 不可用）";

/**
 * 回显的 url：只认规整的 http(s) URL —— 等于自己的规范形式（没有空白、控制字符与非 ASCII，这些都会被
 * 百分号编码），≤ 2048 字符；否则写 {@link URL_UNAVAILABLE}（B9-FX-15）。
 */
export function echoUrl(url) {
  if (typeof url !== "string" || url.length > 2048) return URL_UNAVAILABLE;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.href === url)
      return url;
  } catch {
    // 不是 URL：落到下面
  }
  return URL_UNAVAILABLE;
}

/** id 回显不了时写的那句。 */
export const ID_UNAVAILABLE = "（id 不可用）";

/**
 * 回显的镜头 id / 卡片 id：只认页面会生成、会收的 id 文法（同 `SCENE3D.idPattern`：ASCII 字母数字与 `_ . -`，
 * ≤ 128）；别的写 {@link ID_UNAVAILABLE}。只压换行挡不住同一行里伪造的「下一步：apply … --approved」——
 * id 是任何协作者都写得进的画布数据，文法里连空格、引号都没有（B11-F2-2）。结构化字段照旧给原值。
 */
const ECHO_ID = /^[A-Za-z0-9_.-]{1,128}$/;
export function echoId(value) {
  return typeof value === "string" && ECHO_ID.test(value) ? value : ID_UNAVAILABLE;
}

/**
 * 回显的镜号：镜号 n 与镜头 id 一样是任何协作者写得进的存储原值（readScene 不逐项校验）——只认整数，
 * 不是整数就写过了 {@link echoId} 的镜头 id。带换行的 n 伪造不出「下一步：… --approved」那一行（B11-int 复核）。
 */
export function echoShotN(n, shotId) {
  return Number.isInteger(n) ? String(n) : echoId(shotId);
}
