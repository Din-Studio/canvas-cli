/**
 * 画布命令契约：20 条命令的字段（必填 / 可选）、每种节点 kind 的 draft 键白名单、
 * 枚举与数值区间、请求级硬上限、页面桥的错误码及其 `retryable`、CLI 对 `error.code`
 * 的退出码分类 —— 一处声明、随包发布，由 `test/contract.test.mjs` 逐条对着页面侧
 * 与本包的源码双向钉死。
 *
 * 为什么要有这份东西：同一套命令今天有四份手抄在描述它（本包自带的 Agent Skill、
 * script-to-video、seedance、灵影客户端的 tools.ts），已经漂到「两份文档对同一件事
 * 给相反答案」。可当场核对的一例：三份产品手册都把 `focus_node.fill` 写成「0–1，
 * 默认 0.5」，而页面的判定是 `!(fill > 0) || fill > 1`（`coerceAgentCommand` 的
 * `focus_node` 分支）—— `fill: 0` 是被拒的。照手册写的 Agent 拿到 `invalid_request`，
 * 而不是「铺满整屏」。
 * 更早的同形态事故（tests/studio/canvas-agent-bridge.test.ts 里仍在跑）：
 *  - `maxDuration`（gen）、`path`（media-upload）这类节点 kind 根本没有的 draft 键
 *    曾被**静默丢弃**：Agent 拿到 `ok:true`，值却没落地，一个 15 秒的视频照 4 秒生成。
 *    v2 §1 把它改成 `invalid_draft` 硬错、整批拒。
 *  - `realPersonMode` 从视频模型下线之后白名单晚了一步，「写了但没生效」又出现一次。
 *    白名单不是文档，是行为：晚一步就是一次白花钱的生成。
 *
 * 所以规则和隔壁 `spec.mjs` 那张表一样：**这里列的每一条都必须与代码逐字对得上，
 * 多一条少一条都报错**。只放能从源码机械提取的东西（字段名、键名、枚举、区间、
 * 错误码），一句散文都不放 —— 散文过不了闸门，而没有闸门的文档正是上面那些事故的成因。
 *
 * 为什么是 `.mjs` 而不是 `contract.json`：
 *  ① 命令字段直接 import 自 `policy.mjs` 的 `COMMAND_FIELDS` —— 守护进程真正用来
 *     「多给即报错」的那张表。字段名在包里因此只有一处；写成 JSON 就只能再抄一遍，
 *     那正是本轮要消灭的东西。
 *  ② 要 JSON 的消费方 `JSON.stringify(CANVAS_CONTRACT)` 就够了：全是纯数据，没有
 *     函数、没有 `undefined`。反过来 JSON 换不来 ①，也放不下这段说明。
 *
 * 依赖方向是单向的：`policy.mjs` 不 import 本文件。它已经被 vendor 进三个产品的
 * `.pi/vendor/canvas-cli/`，给它加一条 import 等于让那三份 vendor 目录同时缺文件。
 * 本文件是新增的，谁要谁带走。
 */

import { COMMAND_FIELDS, PROTOCOL_VERSION } from "./policy.mjs";

/**
 * `tidied[]` 怎么念成一句人话，是 `apply` / `tidy` 两条路径**共用**的契约的一部分：
 * 页面直接把 `tidySummary` 放进回包，CLI 只对老页面兜底，宿主把它拼进给模型看的
 * 那段文本。所以从这条已经发布的子路径（`@scenemint/canvas-cli/contract`）原样再
 * 导出一次，包外的集成方不必去猜实现文件在哪。
 */
export { formatTidySummary } from "./tidy-summary.mjs";

/**
 * v2 §1 —— 每种 kind 的 `apply*Draft`（apps/web/libs/canvas/commands.ts）真正读的
 * draft 键。与那几个函数逐字同步：列在这里却没人读，就是又一次静默丢弃。
 * 页面侧 `agent-bridge/apply.ts` 直接 import 这张表，包外也能拿到同一份。
 *
 * 标签两键（`assetTags` / `assetTagColors`）不走各 kind 的 applier，而是 `applyTagsDraft`
 * 统一处理（gen / media-upload / scene-3d / group 四种都有标签），所以每种可打标签的
 * kind 都在自己的键后面追加这两个键。`group` 除标签外没有可写字段（`applyNodeDraft`
 * 对它原样返回）。`image-gen` / `video-gen` 的 applier 其实读键，这里仍然留空 ——
 * 它们是迁移遗留的 kind，不在 `AgentNodeKind` 里，Agent 建不出也不该改；
 * 空白名单的含义是「这种节点的任何 draft 都拒」。
 */
export const DRAFT_KEYS = {
  gen: [
    "mode",
    "source",
    "outputType",
    "prompt",
    "modelId",
    "aspectRatio",
    "resolution",
    "quality",
    "outputFormat",
    "background",
    "promptExpansionMode",
    "imageCount",
    "negativePrompt",
    "stylePresetId",
    "userReferenceUrls",
    "duration",
    "generateAudio",
    "returnLastFrame",
    "omniReferenceTaskType",
    "inputs",
    "conversionSlots",
    "fileName",
    "mimeType",
    "outputUrl",
    "content",
    "assetTags",
    "assetTagColors",
  ],
  "media-upload": ["mediaType", "fileName", "mimeType", "outputUrl", "assetTags", "assetTagColors"],
  "scene-3d": ["outputMode", "assetTags", "assetTagColors"],
  // 组唯一能写的就是标签：其余任何 draft 键仍然是 invalid_draft。
  group: ["assetTags", "assetTagColors"],
  "image-gen": [],
  "video-gen": [],
};

/**
 * 每条命令的**必填**字段。可选字段不在这里重抄一遍 —— 它是
 * `COMMAND_FIELDS[type]` 减去这一行，所以「字段表里有、这里没声明必填」的键自动
 * 就是可选，两张表在结构上不可能互相矛盾。
 * 必填 / 可选的口径来自 `agent-bridge/types.ts` 的 `AgentCommand` 联合：
 * 写了 `?` 的是可选，其余必填。
 */
const REQUIRED_FIELDS = {
  add_node: ["kind", "position"],
  update_node: ["nodeId"],
  edit_text: ["nodeId", "field", "oldString", "newString"],
  move_node: ["nodeId", "position"],
  connect: ["source", "target", "targetHandle"],
  disconnect: ["edgeId"],
  delete_node: ["nodeId"],
  group_nodes: ["nodeIds"],
  ungroup: ["groupId"],
  set_viewport: ["viewport"],
  arrange: ["nodeIds", "layout"],
  align: ["nodeIds", "mode"],
  // 两个 id 列表都省略 = 整张画布，所以 tidy 一个必填字段都没有。CLI 那一层
  // 另外收紧成「全画布必须显式 --all」（spec.mjs 的 tidyCommand），桥层不收紧。
  tidy: [],
  // `fit:true` 与 `size` 二选一，页面侧 coerce 判「两个都没有」才拒，所以都不是必填。
  resize_group: ["nodeId"],
  duplicate_node: ["nodeId"],
  select_output: ["nodeId", "outputId"],
  adopt_output: ["nodeId", "url"],
  focus_node: ["nodeId"],
  upload_asset: ["path", "fileName", "mimeType", "bytesBase64"],
  export_output: ["nodeId", "path"],
};

/**
 * 两张表拼出的命令表。**按需构建**，而且一条都不抛：页面侧
 * `agent-bridge/apply.ts` 只 import 本模块的 `DRAFT_KEYS`，顶层建表意味着
 * `COMMAND_FIELDS` / `REQUIRED_FIELDS` 哪天对不上就抛在浏览器 chunk 的求值阶段 ——
 * 一次表格笔误换来整块画布不加载，而它本该只是 CI 里的一条红。
 *
 * 所以一致性断言全在 `test/contract.test.mjs`：这里「没声明必填字段」退化成
 * 「全是可选」，那边的双向断言（与 `AgentCommand` 联合逐字比、`required + optional`
 * 必须正好覆盖 `fields`、`REQUIRED_FIELDS` 的键集必须等于命令集）负责报红。
 */
function buildCommands() {
  const out = {};
  for (const [type, fields] of Object.entries(COMMAND_FIELDS)) {
    const required = REQUIRED_FIELDS[type] ?? [];
    out[type] = {
      fields: [...fields],
      required: [...required],
      optional: fields.filter((field) => !required.includes(field)),
    };
  }
  return out;
}

/**
 * 命令字段上的封闭取值集合。键是 `<命令>.<字段>`，值按页面侧的判定顺序原样排列。
 * 来源：`AgentNodeKind` / `AgentTextField`（agent-bridge/types.ts）、`EdgeTargetHandle`
 * （canvas/types.ts）、`ARRANGE_LAYOUTS` / `ALIGN_MODES`（canvas/layout-align.ts）、
 * `duplicate_node.layout` 的两个字面量（agent-bridge/apply.ts）。
 */
const ENUMS = {
  "add_node.kind": ["gen", "media-upload", "scene-3d"],
  "edit_text.field": ["prompt", "content", "title", "negativePrompt"],
  "connect.targetHandle": ["reference", "frameFirst", "frameLast", "prompt"],
  "arrange.layout": ["row", "column", "grid"],
  "align.mode": [
    "left",
    "right",
    "top",
    "bottom",
    "center_x",
    "center_y",
    "distribute_x",
    "distribute_y",
  ],
  "duplicate_node.layout": ["row", "column"],
  // `TIDY_SCOPES`（canvas/canvas-tidy.ts）：整理画布的作用域。
  "tidy.scope": ["all", "groups", "selection"],
};

/**
 * 命令字段上的数值区间与默认值。`exclusiveMin` 是「必须大于」——
 * `focus_node.fill` 就是这一栏存在的理由：三份手册写「0–1」，代码拒 `0`。
 * 缺省语义：只写 `min` 表示下界闭区间；`default` 只在代码里真有 `?? X` 时才写。
 */
const RANGES = {
  "arrange.nodeIds": { min: 1 },
  "arrange.gap": { min: 0 },
  "arrange.columns": { min: 1, integer: true },
  // 对齐要两个盒子，分布还得有中间那个才挪得动 —— ALIGN_MIN_NODES / DISTRIBUTE_MIN_NODES。
  "align.nodeIds": { min: 2, minForDistribute: 3 },
  "align.gap": { min: 0 },
  // 列表可以整个省略（= 全画布），但给了就必须非空：筛出 0 个 id 的作用域绝不能
  // 退化成「整理全部」。
  "tidy.nodeIds": { min: 1 },
  "tidy.groupIds": { min: 1 },
  "duplicate_node.count": { min: 1, max: 20, default: 1, integer: true },
  "focus_node.fill": { exclusiveMin: 0, max: 1, default: 0.5 },
  "set_viewport.viewport.zoom": { exclusiveMin: 0 },
  "upload_asset.bytesBase64": { maxDecodedBytes: 25 * 1024 * 1024 },
};

/**
 * 请求级硬上限 —— 不属于任何一条命令，而是 `apply` / `run_node` / `run_nodes`
 * 这三个 RPC 方法自己的边界，由 `enforceRequestPolicy` 在守护进程里挡。
 * `itemMaxLength` 是单个 id 的字符上限。
 */
const LIMITS = {
  "apply.commands": { min: 1, max: 1000 },
  "run_node.approval.userApprovedNodeIds": { min: 1, max: 1000, itemMaxLength: 1024 },
  "run_nodes.nodeIds": { min: 1, max: 1000, itemMaxLength: 1024 },
  "run_nodes.approval.userApprovedNodeIds": { min: 1, max: 1000, itemMaxLength: 1024 },
  "run_nodes.concurrency": { min: 1, max: 200, default: 24, integer: true },
  "run_tool.approval.userApprovedNodeIds": { min: 1, max: 1000, itemMaxLength: 1024 },
  "run_tool.kind": { maxLength: 128 },
  "run_tool.prompt": { maxLength: 4000 },
  "run_tool.resolution": { maxLength: 4000 },
  "run_tool.aspectRatio": { maxLength: 4000 },
  "run_tool.metadata": { maxKeys: 64 },
  "run_tool.title": { maxLength: 200 },
  // 节点 / 组的 draft.assetTags：条数与单条长度（commands.ts NODE_TAG_MAX / NODE_TAG_MAX_LENGTH）。
  "update_node.draft.assetTags": { max: 20, itemMaxLength: 30 },
  // v3 §12 `tasks`：节点筛选条数、每页行数（守护进程与页面同一口径）。
  "tasks.nodeIds": { min: 1, max: 200, itemMaxLength: 1024 },
  "tasks.limit": { min: 1, max: 500, default: 100, integer: true },
  /**
   * 下面两条是**标量**，不是 `{min,max}` 区间对象 —— 形状由消费方定：
   * script-to-video 的 `groupMinMembers()` / 收框判定拿到值直接 `Number(v)` 再
   * `Number.isInteger`，包成对象就是 `NaN`，于是静静退回它自己硬编码的那个数，
   * 契约等于没发。想加下界/默认值时请另起一个键，别把这两条改成对象。
   */
  // 一条 `group_nodes` 最少要几个成员。页面 2026-09 放宽到 1（apply.ts 的
  // 「group_nodes needs at least 1 existing, ungrouped, non-group node」），产品那边
  // 仍按旧口径 2 自我审查、把单成员的组整批跳过 —— 不发这个数字，放宽对产品永远不可见。
  "group_nodes.minMembers": 1,
  // 组框「太大」的判定比例：框面积 > 成员包围盒面积 × 这个数 = 巨框（canvas-tidy.ts 的
  // GROUP_OVERSIZE_RATIO）。画布自己按 3 判、产品按 1.5 收框，结果是用户特意留白的框
  // 被下一次 rebase 吃掉。判定只有一处，就是这里。
  "group.oversizeRatio": 3,
  // A5 `health`：明细表最多几条（`counts` 与判定范围永远是全量整张画布）。
  "health.maxIssues": { min: 1, max: 1000, default: 100, integer: true },
  /**
   * 两个节点算「叠住了」的下限：相交面积占**较小**那个节点面积的比例
   * （health.ts 的 `HEALTH_OVERLAP_MIN_RATIO`）。标量，和上面两条同一个理由 ——
   * 消费方拿到直接 `Number(v)`。比例而不是像素常数：画布上 498×280 的生成节点与
   * 用户拉到 4000 px 的大图共存，固定像素阈值对前者太松、对后者太紧。
   */
  "health.overlapMinRatio": 0.02,
};

/**
 * `health` 回包的封闭取值集合 —— 体检的**结论**面。
 *
 * 为什么值得单独发一组：`issues[].kind` 是下游唯一能分支的东西（哪些要报给用户、
 * 哪些要先问过人再动）。`stray_over_frame` 带的修复 argv 会**改成员归属**，
 * 而归属是用户的决定；产品若按 `kind` 之外的东西（比如 message 里的字眼）分支，
 * 一次文案调整就会让它自动收编用户的散图。
 *
 * 顺序就是 `severity`：明细表按它排，截断时留下的是最该先看的那些。
 * 由 `test/contract.test.mjs` 对着 `agent-bridge/types.ts` 的
 * `AgentHealthIssueKind` 联合与 health.ts 的 `SEVERITY` 逐字钉死。
 */
const HEALTH = {
  /** `AgentHealthIssue.kind`，按严重度从高到低。 */
  issueKinds: [
    "dangling_mention",
    "member_escaped",
    "group_frame_oversize",
    "stray_over_frame",
    "group_overlap",
    "node_overlap",
    "group_empty",
    "group_undersized",
  ],
  /**
   * 判定范围**永远是整张画布**：`scanned.nodes` 就是图上的节点数，没有 snapshot
   * 那种 `maxNodes` clamp。`truncated` / `omittedIssues` 只说「明细表没列全」。
   */
  scanIsWholeCanvas: true,
};

/**
 * `focus_node` 回包（`ApplyResult.focused[]`）的封闭取值集合 —— 取景的**结论**面。
 *
 * 案底：`focus_node` 是 20 条命令里唯一一条「效果不在文档里」的 —— 它动的是某一个
 * 浏览器里的相机，而它搭车的那一批写入无论如何都成功。取景没发生时（页面还没量到
 * 那个节点的几何，或者这个宿主压根没接相机），回包里**一个字都没有**、`ok:true`。
 * 于是 Agent 只能对用户说「已经定位过去了」，而用户的画面根本没动 —— 与
 * `tidied[]` 之前那档「已应用 1 条命令」是同一种静默失败。
 *
 * 两个原因必须分开，恢复动作不同：`unmeasured` 是这一次、这个节点没量到（等它进
 * 视野或重新 `snapshot` 后可能就行了），`no_camera` 是这个宿主永远不支持取景（换
 * 任何节点、重试多少次都一样，只能改口告诉用户自己去找）。
 * 由 `test/contract.test.mjs` 对着 `agent-bridge/types.ts` 的
 * `FocusUnframedReason` 联合与 `canvas.ts` 真正 push 的两个取值逐字钉死。
 */
const FOCUS = {
  /** `ApplyResult.focused[].reason`，只在 `framed:false` 时出现。 */
  unframedReasons: ["unmeasured", "no_camera"],
};

/**
 * **页面桥**返回的错误码与「同样的载荷再发一次还有可能成功吗」。`retryable: true`
 * 恰好是那三个瞬态码（`RETRYABLE_ERROR_CODES`，agent-bridge/types.ts）；其余一律
 * false。false 不等于「永久坏了」，而是「裸重试没有意义」—— 尤其 `unknown_outcome`：
 * 操作可能已经发生、只是回执丢了，重试会重复计费。
 *
 * **这不是 `error.code` 的全集，别拿它当查询表直接下标。** 同一个字段里还会出现
 * CLI / 守护进程自己的一套码 —— `not_connected`、`connection_failed`、
 * `invalid_argument`… `common.mjs` 的 `failure()` 造出的错误与页面转发上来的
 * （daemon.mjs 的 `finish(record, { ok:false, error })`）同形同字段，Agent 读到的是
 * 两个命名空间混在一个 `error.code` 里。`C.bridgeErrors[err.code].retryable` 撞上
 * `not_connected` 就是 TypeError。
 *
 * CLI 那一半这里不给 `retryable`：页面侧的 `RETRYABLE_ERROR_CODES` 在 CLI 侧没有
 * 对应的真相源，编一个出来就是一张没有闸门的表 —— 正是本文件存在的理由所反对的。
 * CLI 对这些码自己做的唯一一次分类是进程退出码，见下面的 `CLI_EXIT_CODES`。
 */
const BRIDGE_ERRORS = {
  not_installed: { retryable: false },
  canvas_not_found: { retryable: false },
  read_only: { retryable: false },
  invalid_request: { retryable: false },
  invalid_command: { retryable: false },
  invalid_draft: { retryable: false },
  too_large: { retryable: false },
  upload_unsupported: { retryable: false },
  unknown_outcome: { retryable: false },
  unresolved_mention: { retryable: false },
  node_not_found: { retryable: false },
  resource_not_found: { retryable: false },
  not_owned: { retryable: false },
  run_failed: { retryable: false },
  already_running: { retryable: true },
  approval_required: { retryable: false },
  node_running: { retryable: true },
  batch_not_found: { retryable: false },
  // run_tool：`kind` 不在页面的工具注册表里（拼错 / 老页面还没有这个工具），
  // 或这个工具用不到这个节点上（对着音频节点要「去字幕」）。两种都不可重试：
  // 回包会附上**这个节点当下适用的工具清单**，Agent 照着改 kind 再发。
  tool_not_found: { retryable: false },
  tool_not_applicable: { retryable: false },
  stale: { retryable: false },
  timeline_conflict: { retryable: false },
  timeline_busy: { retryable: true },
};

/**
 * `error.code` → CLI 进程退出码，逐字镜像 `exitCode()`（cli.mjs）。这是 CLI 对
 * `error.code` 做的唯一一次分类，而且是**跨两个命名空间**的：`too_large` /
 * `approval_required` / `unknown_outcome` 页面和 CLI 都会发。语义与随包 Skill 的
 * 命令手册一致：2 = 参数或文件边界，3 = 连接/认证（命令没送到页面），
 * 4 = 结果未知（可能已经发生，绝不自动重发）。
 *
 * 没列在这里的码一律落到 1（业务失败）—— 所以 1 这一桶里「等一会儿自己会好」和
 * 「绝不可重试」仍然混在一起，要分辨得看 `bridgeErrors[code].retryable`，而它只覆盖
 * 页面那一半。这两张表合起来才是 Agent 能拿到的判据；缺哪一张都会让下游空转。
 */
const CLI_EXIT_CODES = {
  unknown_outcome: 4,
  not_connected: 3,
  reconnecting: 3,
  page_away: 3,
  connection_failed: 3,
  connect_failed: 3,
  unauthorized: 3,
  invalid_origin: 3,
  invalid_pair_code: 3,
  disconnected: 3,
  session_not_found: 3,
  protocol_mismatch: 3,
  delegate_revoked: 3,
  invalid_argument: 2,
  invalid_json: 2,
  invalid_session: 2,
  invalid_path: 2,
  invalid_workspace: 2,
  workspace_boundary: 2,
  unsafe_session: 2,
  file_not_found: 2,
  file_exists: 2,
  too_large: 2,
  approval_required: 2,
};

/**
 * `changes` 回包的封闭取值集合。它是**感知**的契约：Agent 靠这几组字符串回答
 * 「我上次看过之后，画布上发生了什么、是谁干的、我这份增量能不能信」。
 *
 * 为什么值得单独发一组：
 *  · `epoch` / `cursor` —— **序号本身不是游标**。feed 住在页面里，刷新一次就从 0
 *    重建；等这条新 feed 自己也攒过了那个数字，「你错过了 57 条」和「发生了 23
 *    件事」就是**逐字相同**的回包（旧的 `sinceSeq > seq` 启发式在这里一言不发）。
 *    所以每次回包都带 `epoch` —— 这条 feed 实例的身份 —— 续读时原样带回
 *    `sinceEpoch`。对不上就是换了一条 feed，必须 truncated；**不带 epoch 的续读
 *    也一律按 truncated 回**：证明不了就不许说「没什么事」。`snapshot` 的回包同样
 *    带 `epoch`，否则「重新 snapshot 再接着走」是个闭不上的圈。
 *  · `truncatedReason` —— `truncated:true` 有两种成因，恢复动作相同（重新
 *    snapshot），但**读不到这个字段的消费方会把「feed 重启」当成「什么都没发生」**。
 *    页面刷新后 feed 从 0 重建，Agent 拿着旧的 `sinceSeq` 去问，回包是
 *    `{seq:0, entries:[]}` —— 不带原因就与「画布真的没动」逐字相同。
 *  · `actors` —— `page` 这一档是页面自己的自动写入（出图后自动扩框）。它以前
 *    被记成 `human`，产品于是对用户说「你改了这个组框」，而用户什么都没做。
 *    下游拿 `actor` 判断「要不要说这是用户改的」，多一档少一档都是错话。
 *  · `kinds` / `notes` —— `kind:"batch"` 的六个 note 语义完全不同
 *    （`quota_stop` 绝不可重发），手册里已经写明，这里给出封闭集合。
 *    前三个是页面自己的批次记账（`actor:"page"`）；`frame_strays` /
 *    `frame_escaped` 是**人**拖组框 / 拉手柄之后留下的错位事实
 *    （中心在框里却不是成员 / 是成员却跑到框外），带的是 `actor:"human"`。
 *    这条路以前只弹一句 toast、`changes` 里一条都不写 —— 人能稳定造出这种状态，
 *    而 Agent 永远看不见，只能自己对 snapshot 做几何运算才推得出来。
 *    `bulk_change` 不是谁写的「记账」，而是**一次事务动了很多节点**被合成的一条：
 *    一次自动扩框动 10 个成员 + 1 个框，逐个 key 发条目的话，协作者连落 20 张图
 *    就是 200+ 条自动条目，把人的真实编辑挤出 500 条缓冲。`nodeIds` 是这一条覆盖
 *    的全部节点，`actor` 是发起方（`page` / `human` / `remote` 都可能 —— 人自己
 *    一次删掉一片多选，就是 `human`）。它也是**唯一**会挂在 `batch` 以外的 kind
 *    上的 note：合并只在**同一种动作内部**发生，所以一次宽事务最多出 `add` /
 *    `delete` / `batch`（move/update 噪声）各一条。跨动作合并试过并回退了：那样
 *    人一次删 8 个以上节点，在 feed 里只剩一条分不出增删改的 `batch`。
 *
 * 由 `test/contract.test.mjs` 对着 `agent-bridge/types.ts` 的四个联合逐字钉死。
 */
const CHANGES = {
  /** `ChangeEntry.actor`。 */
  actors: ["human", "remote", "page"],
  /** `ChangeEntry.kind`。 */
  kinds: ["add", "update", "delete", "move", "batch"],
  /** `ChangeEntry.note`（除 `bulk_change` 外都只出现在 `kind:"batch"` 上）。 */
  notes: [
    "run_timeout",
    "batch_lost",
    "quota_stop",
    "frame_strays",
    "frame_escaped",
    "bulk_change",
  ],
  /** `ChangesResult.truncatedReason`，与 `truncated:true` 同时出现。 */
  truncatedReasons: ["buffer_dropped", "feed_restarted"],
  /**
   * 游标的**两个**部分与它们在各处的名字。别再只记 `seq`：单独一个序号无法证明
   * 自己还属于这条 feed，而页面刷新会让它从 0 重来。
   */
  cursor: {
    /** 回包里的序号字段（`changes` 与 `snapshot` 都有）。 */
    seq: "seq",
    /** 回包里的 feed 实例标识（`changes` 与 `snapshot` 都有）。 */
    epoch: "epoch",
    /** 续读时把 `seq` 放回这个请求字段。 */
    sinceSeq: "sinceSeq",
    /** 续读时把 `epoch` 放回这个请求字段；不带 = 一律 `feed_restarted`。 */
    sinceEpoch: "sinceEpoch",
    /** CLI 的两个 flag，逐字。 */
    flags: ["--since-seq", "--since-epoch"],
  },
  /** 环形缓冲保留的条数（`CHANGE_FEED_CAP`）：超出的老条目会被挤掉。 */
  cap: 500,
};

/**
 * 页面不在（`page_away`）这条路径上的**全部名字**：错误码、`status` 的四个字段、
 * 错误载荷的字段、`outcome` 的两个取值、退出码、两个时间常量。
 *
 * 为什么单独发一组常量：这些字符串今天在四处被逐字手抄 —— 守护进程
 * （`daemon.mjs` 的 `status()` / `pageAwayFailure()`）、随包手册（SKILL.md 与
 * commands.md 的 page_away 表）、灵影客户端的重连提示、script-to-video 的
 * 「页面不在就停手」判定。任何一处改名（`pageAway` → `awayFrom`、`queued` →
 * `isQueued`）在上游都是绿的，下游是**静默失效**：产品读到 `undefined`，把
 * 「页面不在」当成「一切正常」，继续发写命令。
 *
 * 所以下游不要再抄字符串，改成 `PAGE_AWAY.statusFields.away` 这样引用，并在自己的
 * 测试里对着它断言 —— 上游改名当场红。本文件这一份由 `test/contract.test.mjs`
 * 逐条对着 `daemon.mjs` / `client.mjs` 的源码钉死，所以它不会自己漂。
 */
export const PAGE_AWAY = {
  /** `error.code`。CLI 与页面桥都用这一个码。 */
  code: "page_away",
  /** `status` 结果里的字段名（`daemon.mjs` 的 `status()`）。 */
  statusFields: {
    /** 布尔：页面此刻不在（守护进程处于 `reconnecting`）。 */
    away: "pageAway",
    /** 数字：已排队、还没送到页面的写命令条数。 */
    queued: "queuedCommands",
    /** ISO 串或 null：最后一次听到页面。 */
    lastSeen: "pageLastSeenAt",
    /** ISO 串：过了它会话就结束（只在 `reconnecting` 时出现）。 */
    expires: "resumeExpiresAt",
  },
  /** `page_away` 错误载荷里的字段名（`daemon.mjs` 的 `pageAwayFailure()`）。 */
  errorFields: {
    retryable: "retryable",
    /** 布尔：true = 写命令已排队（**不要重发**），false = 读命令根本没发出去。 */
    queued: "queued",
    outcome: "outcome",
    /** 只有排队的写命令带：拿它再发一次 = 取结果，不会重跑。 */
    requestId: "requestId",
    state: "state",
    expires: "resumeExpiresAt",
    lastSeen: "pageLastSeenAt",
    /** 数字：此刻还排着队的命令数。 */
    pending: "pending",
  },
  /** `error.outcome` 的两个取值。 */
  outcomes: { queued: "queued", notSent: "not_sent" },
  /** 进程退出码（= `cliExitCodes.page_away`：连接类，命令没送到页面）。 */
  exitCode: 3,
  /** 只读命令最多阻塞这么久就回 `page_away`（`daemon.mjs` 的 `PAGE_AWAY_READ_MS`）。 */
  readAnswerMs: 5000,
  /** 写命令 `--wait-ms` 的默认值（`client.mjs` 的 `DEFAULT_WAIT_MS`）。 */
  defaultWaitMs: 30000,
};

export const CANVAS_CONTRACT = {
  /** `SceneMintAgentBridge.version` —— 页面暴露的桥版本。 */
  bridgeVersion: 3,
  /** 守护进程 ↔ 页面的线协议版本，与 `policy.mjs` 同一个常量。 */
  protocolVersion: PROTOCOL_VERSION,
  /**
   * 惰性（见 `buildCommands`）。getter 是自有可枚举属性，所以
   * `JSON.stringify(CANVAS_CONTRACT)`、`Object.keys`、`C.commands.add_node` 对消费方
   * 与原来那个普通字段没有任何区别。
   */
  get commands() {
    return buildCommands();
  },
  draftKeys: DRAFT_KEYS,
  enums: ENUMS,
  ranges: RANGES,
  limits: LIMITS,
  bridgeErrors: BRIDGE_ERRORS,
  cliExitCodes: CLI_EXIT_CODES,
  /** `changes` 的 actor / kind / note / truncatedReason 与缓冲上限，见 `CHANGES`。 */
  changes: CHANGES,
  /** `health` 的违例类别（按严重度）与「扫的是整张画布」这件事，见 `HEALTH`。 */
  health: HEALTH,
  /** `focus_node` 取景失败的两个原因，见 `FOCUS`。 */
  focus: FOCUS,
  /** 页面不在这条路径上的字段名 / 错误码 / 退出码，见 `PAGE_AWAY`。 */
  pageAway: PAGE_AWAY,
};
