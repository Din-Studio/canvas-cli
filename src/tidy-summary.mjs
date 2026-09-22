/**
 * `tidied[]` 的文本渲染 —— **包里的公共能力，不是 CLI 的私有函数**。
 *
 * 为什么必须在这里而不是 `cli.mjs` 里：`tidy` / `apply` 的 `tidied[]` 是「整理到底
 * 动了什么」的唯一出口（尤其是 `strays` —— 整理拒绝去动的出框 / 压框节点，是 Agent
 * 唯一能知道「这里需要人来处理」的通道）。而宿主把回包压成一句「已应用 N 条命令」
 * 时它整段丢失：真环境里实测过，`canvas_cli tidy` 的 JSON 里有 `tidySummary`，模型
 * 真正读到的那段文本里一个数字都没有；走 `canvas_apply`（产品最常走的那条）连
 * `tidySummary` 都没有，因为它当时只是 `cli.mjs` 私有的装饰。
 *
 * 所以渲染能力放在这一层：CLI 用它装饰回包，页面的 `apply` RPC 也用同一份把
 * `tidySummary` 直接放进结果里，两条路径给出的**逐字相同**的一句话，谁把它拼进
 * 文本都不必自己再实现一遍格式。
 */

/** 一条 tidy 一行：动了几个、收了几个框、哪些 id 没被动（strays 必须点名）。 */
export function formatTidySummary(tidied) {
  return (Array.isArray(tidied) ? tidied : [])
    .map((entry) => {
      const strays = Array.isArray(entry?.strays) ? entry.strays : [];
      const head = `tidy (commands[${entry?.command}]): moved ${entry?.moved ?? 0}, resized ${entry?.resized ?? 0}`;
      // 数量和 id 都写出来：只给数量的话，Agent 没法把「需要人处理的东西」指给用户。
      return strays.length === 0
        ? `${head}, no strays`
        : `${head}, ${strays.length} stray${strays.length === 1 ? "" : "s"} left untouched (a human must place them): ${strays.join(", ")}`;
    })
    .join("\n");
}
