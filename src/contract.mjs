/**
 * 画布命令契约：29 条命令的字段（必填 / 可选）、每种节点 kind 的 draft 键白名单、
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

import {
  COMMAND_FIELDS,
  DOCUMENT_CONTENT_MAX_CHARS,
  DOCUMENT_ID_MAX_LENGTH,
  DOCUMENTS_LIST_MAX_LIMIT,
  PROTOCOL_VERSION,
} from "./policy.mjs";

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
  delete_output: ["nodeId", "outputId"],
  split_output: ["nodeId", "outputId"],
  clear_output: ["nodeId"],
  reset_status: ["nodeId"],
  add_to_group: ["groupId", "nodeIds"],
  remove_from_group: ["nodeId"],
  duplicate_nodes: ["nodeIds"],
  // 省略 = 恢复缓冲里的全部（界面的「恢复最近删除」按钮）。
  recover_deleted: [],
  select: ["nodeIds"],
  adopt_output: ["nodeId", "url"],
  // `nodeId` / `nodeIds` / `all:true` 三选一，页面侧 coerce 判「不是恰好一个」才拒，所以都不是必填。
  focus_node: [],
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
  "focus_node.nodeIds": { min: 1 },
  "add_to_group.nodeIds": { min: 1 },
  "duplicate_nodes.nodeIds": { min: 1 },
  // 给了就必须非空：筛出 0 个 id 的恢复绝不能退化成「全部恢复」。
  "recover_deleted.nodeIds": { min: 1 },
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
  // 批量删除的同意（可选；删除超过 `apply.bulkDeleteThreshold` 个节点或含带成员的组时必需）。
  "apply.approval.userApprovedNodeIds": { min: 1, max: 1000, itemMaxLength: 1024 },
  // 界面删除确认的门槛（selection-delete.ts 的 BULK_DELETE_CONFIRM_THRESHOLD）：一批删除
  // **超过**这么多节点、或含带成员的组，就要 `approval`。标量，理由同下面两条。
  "apply.bulkDeleteThreshold": 5,
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
 * 案底：`focus_node` 曾是 20 条命令里唯一一条「效果不在文档里」的（后来加的 `select`
 * 是第二条，回包 `selected[]` 同理）—— 它动的是某一个
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
  /** `ApplyResult.selected[].reason`，只在 `shown:false` 时出现：这个宿主没接编辑器选区。 */
  unshownReasons: ["no_selection"],
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
  // doc@1：`expectVersion` 对不上（带 currentVersion / currentSha：重读、在新版本上重做再写），
  // 与查无此文档。两种裸重试都没有意义。
  doc_conflict: { retryable: false },
  doc_not_found: { retryable: false },
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
  // `export-jianying --draft-root`：写进剪映草稿目录的途中，某一级被换成了符号链接 / 真实位置跑出了草稿目录。
  draft_root_boundary: 2,
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

/**
 * doc@1 —— 各智能体共用的一份「文档」结构：剧本、大纲、全局骨架、人物档案、镜头表、拉片报告、
 * 用户上传的小说这类文字产物，归**项目**（同项目下所有画布共享），存在服务端的项目文档库里。
 * 文档库是**唯一源数据**：没有本地镜像、没有同步 —— 画布左栏「文档库」看的、CLI
 * `docs ls / read / create / update / delete` 读写的，都是同一份。约定全文在仓库
 * `docs/conventions/doc.md`。
 *
 * 为什么发成契约而不是只写在约定文档里：编剧、拉片、剧本转视频三个产品都要按同一张 docType 表、
 * 同一个 id 语法、同一种 contentSha 算法写入 —— 各抄一份，第一次改表就会有一家静默写出服务端
 * 拒收（或者更糟：面板里多出一个错字分组）的东西。服务端校验（`apps/web/libs/documents/schema.ts`）
 * 直接 import 这个对象，所以这里列的就是真正生效的那一份。
 *
 *  · `sections` —— 面板的两栏：`reference`（参考资料）与 `script`（剧本，要拿去生产的剧本）。
 *    `scriptSectionDocTypes` 是能进剧本栏的类型（只有 `script`）；`script` 类型也可以放进参考资料
 *    （例如要清洗重写的源剧本）。不给栏时：`script` 进剧本栏，其余进参考资料。
 *  · `docTypes` —— 顺序就是面板里的分组顺序。全局骨架 `skeleton` 是参考资料、不算剧本（拍板 A16）；
 *    反推剧本也是 `script`，来源写在 `source` 字段里（A14）；用户上传的小说是 `novel`，一部小说一个
 *    `folder`，每章一份（A17）；`note` 收其它上传的参考资料。**加一个取值不升约定版本号**（读者要
 *    忽略不认识的类型），但得先登记进这张表：服务端只收表里的值。
 *  · `fields` —— 一份文档的全部字段（正文另读，不在列表里）。`version` / `contentSha` / `updatedAt`
 *    由服务端写：每写一次 `version` +1，写入必须带 `expectVersion`，不一致回 `errors.conflict`。
 *  · `idPattern` —— 用 `u` 标志编译：第一段小写 ASCII（`script`、`lap-report`），后面几段允许中文、
 *    字母、数字、`_` `-`。`#` 留给场次锚点（`script:ep:01#1-2`），`@` 留给 `id@version`，都不在 id 里。
 *  · `contentShaAlgorithm` —— 与画布 `read` 的 `contentSha` 同一个算法：FNV-1a 64 位，按 UTF-16
 *    码元，16 位小写十六进制；算之前换行统一成 LF（`\r\n` 与单独的 `\r` 都算一个换行）。
 *  · `nodeTagPrefix` —— 从文档库拖到画布的是一份**副本**（文本节点），标签记 `doc:<id>@<version>`。
 *  · `folderIdPattern` —— 文件夹（上传的小说一部一个）的 id：文件夹里起出来的文档 id 都是
 *    `<docType>:<4 位键>:<四位序号>`（`novel:k3x9:0001`），前两段就是这个文件夹的 id（`novel:k3x9`）。
 *    `docs ls --folders` 列出来、`docs read --folder <名或 id>` 认它；文件夹名也认，但重名时只有 id 分得开。
 */
export const DOCUMENTS = {
  convention: "doc@1",
  sections: ["reference", "script"],
  scriptSectionDocTypes: ["script"],
  docTypes: [
    "skeleton",
    "outline",
    "characters",
    "bible",
    "breakdown",
    "script",
    "asset-list",
    "extras",
    "genre-strategy",
    "shotlist",
    "lap-ledger",
    "lap-report",
    "lap-outline",
    "novel",
    "note",
  ],
  formats: ["markdown", "srt", "json"],
  fields: [
    "id",
    "section",
    "folder",
    "docType",
    "series",
    "episode",
    "scene",
    "title",
    "format",
    "version",
    "contentSha",
    "sourceAgent",
    "source",
    "assetTags",
    "derivedFrom",
    "updatedAt",
    "summary",
  ],
  idPattern: "^[a-z][a-z0-9-]*(?::[\\p{L}\\p{N}_-]+)*$",
  idMaxLength: DOCUMENT_ID_MAX_LENGTH,
  contentMaxChars: DOCUMENT_CONTENT_MAX_CHARS,
  listMaxLimit: DOCUMENTS_LIST_MAX_LIMIT,
  /** 各文本字段的字符上限、集号上限、`assetTags` 条数与单条长度。 */
  limits: {
    folder: 100,
    series: 100,
    title: 200,
    scene: 40,
    sourceAgent: 60,
    source: 500,
    summary: 500,
    derivedFrom: 40,
    episodeMax: 9999,
    assetTags: 100,
    assetTagLength: 60,
  },
  contentShaAlgorithm: "fnv1a64-utf16-lf",
  nodeTagPrefix: "doc:",
  folderIdPattern: "^[a-z][a-z0-9-]*:[a-z0-9]{4}$",
  /** 写入冲突（`expectVersion` 对不上）与查无此文档的错误码；页面桥与 CLI 同一个码。 */
  errors: { conflict: "doc_conflict", notFound: "doc_not_found" },
};

/**
 * `run_tool` 的**本地免费工具**：浏览器里算完、不经网关、不扣费的那些 kind（`read` 回包 `tools[]`
 * 里标 `billable:false`）。它们仍只有 main 能发、CLI 仍要 `--approved`（那是命令形状，不是付费同意）。
 *
 * 为什么发成契约：`kind` 的取值本来故意不在包里枚举（页面的三套注册表才是真相源）。本地工具是例外 ——
 * 宿主要据此决定「这一条要不要向用户确认扣费」，产品要照着拼 `metadata`（字号上限、字段键、面板名、
 * 分档边界这类数字），各抄一份就会漂。所以页面侧直接 import 这个对象（`image-pixel-tools.ts` 等），
 * `tests/studio` 把 `kinds` 钉在页面注册表里带 `local` 的全部 kind 上（双向）。
 *
 *  · `kinds` —— 本地免费 kind 的全集；`tiers["run-tool"].localKinds` 是同一个数组。
 *  · `warningCodes` —— 出了图但结果可能不对时，回包 `outputs[i].meta.warnings` 里的
 *    `{code, message}` 用这些码（不拦出图；`message` 是给人看的说明与改法）：
 *    - `floor_shadow_kept`：scale-lineup 某个资产、或 asset-sheet 比例格里某个人脚下那条浅灰低饱和带切得拿不准 ——
 *      像投影（比脚宽或扁）、但高过 `scaleLineup.floorShadow.maxBandRatio`，没当投影切（若它就是投影，这个资产被画矮
 *      了）；或者只像一条（只比脚宽、或只扁），也当投影切了（若它其实是浅色的鞋底 / 鞋子，这个资产被画高了）。
 *      `message` 说是哪一种。
 *    - `text_overflow`：图上的字放不下 —— annotate-image 的文字标注比图还宽 / 高（超出的部分被裁掉）。
 *    （0.15.1 撤销了 `plan_aspect_mismatch`：场景的户型图由美术画在同一张图里，画布不再画尺寸线，也就不再比它的比例。）
 *  · `annotate` —— `annotate-image` 的标注种类与文字标注（`kind:"text"`）的上限：`maxChars` 按字（码点）计，
 *    `\n` 分行不超过 `maxLines`；`size` 是字号占图片长边的比例（缺省 `sizeDefault`，上限 `sizeMax`）；
 *    `aligns` 是锚点的三种含义（文字框左上角 / 上边中点 / 右上角）。中文用随画布发的 Noto Sans SC 子集。
 *  · `assetSheet` —— `asset-sheet`：把一个资产拼成**一张**参考图（拍板 A28 修订：一个资产一张图，这张图就是喂给视频
 *    模型的参考图）。第三版（拍板 A57 与补充，0.15.1）：每个资产美术只出**一张**图，就是 run-tool 的 NODE-ID，合成图不重排
 *    它，只在旁边 / 底下加东西 ——
 *      人物 = 整张基准设定图（左脸部特写、右**带头**三视图；等比缩到一排高，不拆）+ **比例格** + 底部信息块。比例格 =
 *        本人物的正面视图与 1–2 个标尺人物（`metadata.scaleRefs`）的正面视图按身高换算、同一个每厘米像素并排，共用一根
 *        竖尺，脚下写名字与身高；不用外部参照物，身高差得多也不退回，照同一比例画、回包 `notes` 说明。正面视图从带头三视图
 *        按列空隙取**第一个人像**（标尺人物同法；旧项目给的是单张派生全身图就取整张的主体），取不出回 run_failed 点名是哪张。
 *      道具 = 三格图（左正面、中背面、右按长边三档：手部特写捧着 / 不露脸的人手持 / 不露脸的普通人在旁）等宽 + 底部尺寸
 *        信息块；右格的人不是剧中角色（A46 补充 2）。
 *      场景 = 两格图（左场景图、右顶视户型图，室外为俯瞰图）等宽 + 底部尺寸面积信息块。
 *    - `panels[kind]`：`primary` = run-tool 的 NODE-ID 那张图叫什么，`cells` = 它从左到右装着什么（美术照这个出图）。
 *      `extra` / `combined`（只有人物有）是 `metadata.panels` 里能点名的图：`combined.baselineSheet` = 整张基准设定图
 *      （可以就是 NODE-ID；是另一张时左段放它、比例格从 NODE-ID 取正面 —— 旧项目 NODE-ID 是派生全身）；`extra` =
 *      旧项目分开的脸部特写 + 三视图两张（左段照 0.15.0 拼成两格）。道具、场景不收 `metadata.panels`。
 *      0.15.0 的道具 `backRef` / `heldRef` 与场景 `panels.plan` 撤销了，给了就 invalid_request 并说明现在怎么给。
 *    - `scaleRefs`：人物比例格的标尺人物，`metadata.scaleRefs` 给 `min`–`max` 个 `{nodeId | fileId, heightCm, label,
 *      userSheet?}`（他们的基准设定图、身高、脚下写的名字，≤ `labelMaxChars` 字；`userSheet:true` = 他那张是用户自传的
 *      图，按下面 `userSheet` 抠人像或画剪影）；缺身高 invalid_request 点名是哪个。最高 ÷ 最矮
 *      超过 `noteHeightRatio` 倍时照同一比例画（矮的会很小），回包 `notes` 说明。没给就只有本人物与竖尺。
 *    - `fields[kind]`：信息块的字段键（A30），**顺序就是信息块里的显示顺序**（全局统一）。值由调用方从
 *      资产清单传进 `metadata.fields`；`derivedFields` 里的键不收，由几何参数派生（人物身高 ← `heightCm`、
 *      道具长×宽×高 ← `sizeCm`、场景长×宽 ← `sceneSize`），比例格里画的高矮和信息块写的数字因此只有一个来源。
 *    - `geometryKeys[kind]`：这个 kind 收的几何参数（人物 `heightCm`、场景 `sceneSize`、道具 `sizeCm`，都必给）。
 *    - `metadata.estimated`（A38③：剧本没写、盘点时估的数）：`geometryKeys[kind]` 与这个 kind 的非派生字段键里
 *      挑，每个都要真给了值；信息块里对应的数值后缀「（估）」（英文「 (est.)」）。场景的 `sceneSize` 估了，由它
 *      算出来的面积也带「（估）」。
 *    - `locales`：图上文字的语言（缺省 `zh`；产品按剧本台词占比最大的语言传 `metadata.locale`，拍板 A55）——信息块的
 *      字段名、「（估）」、道具那条「右图」、比例格里没给名字时的「本人物」都跟着换；字段的值与名字原样上图。
 *    - `heldModes` / `heldModeMaxCm`：道具三格图右格是哪一种（图里不用剧中任何角色）—— `handClose` 手部特写捧着（只有
 *      手）、`hand` 胸口以下双手持物（不露脸）、`beside` 背影 / 侧影的素色普通人在旁或使用中（不露脸）。`metadata.heldMode`
 *      省略时按 `sizeCm` 的长边判：≤ `heldModeMaxCm.handClose`（30 cm）→ handClose，≤ `heldModeMaxCm.hand`（60 cm）→
 *      hand，更长 → beside。它只影响信息块里那一条「右图」的措辞，拼法不变。
 *    - `infoMaxHeightRatio`：底部信息块的高度不超过整张图高的这个比例（版式克制：这张图要进视频参考）。
 *      `metadata.withInfo:false` 去掉信息块；比例格一并只留人像（`metadata.stripScaleText` 缺省跟着 withInfo:false：名字、
 *      身高、竖尺、刻度、标高虚线、地线都不画，人的位置与大小不变，回包 `scale.stripped`；显式给 true / false 为准）。
 *  · `scaleLineup` —— `scale-lineup`：剧内比例总表（拍板 A40）。`items`（1–`maxItems` 个，每个
 *    `{nodeId | fileId, heightCm | sizeCm + scaleAxis?, label, kind?}`，kind ∈ `itemKinds`，缺省 character；人物 / 生物
 *    给身高 `heightCm`，道具（`kind:"prop"`）给长 × 宽 × 高 `sizeCm {l, w, h}`（拍板 A45①，与资产清单同一组数）：
 *    图上主体外框的**像素长边**对应 l / w / h 里最大的那个（`scaleAxis` ∈ `scaleAxes` 可指定对应哪一个），另一边按
 *    外框宽高比推 —— 横放的 1 m 长剑画成 1 m 长、不会被当成 1 m 高）按大小从小到大排成一排、
 *    地线对齐，每排左边一根刻度尺，每个下方标名字与身高；一排最多 `perRow` 个（缺省也是上限 `perRowMax`），多了
 *    自动均分成几排（7 → 4 + 3），一张图最多 `rowsPerImage` 排（缺省 `rowsPerImageDefault`，上限
 *    `rowsPerImageMax`），再多出多张；最高与最矮相差超过 `maxHeightRatio` 倍的不放进同一张图、按比例拆开（回包
 *    `notes` 说明）；相邻几张合起来不超过这个倍数的共用一个每厘米像素与刻度（跨张也能直接比）。`groups`（下标
 *    数组的数组，与 `perRow` 二选一）手动指定每排放谁。画幅 `aspect`（`width` × `height`）。每个资产取哪一块（拍板 A57，
 *    0.15.1，与 asset-sheet 的比例格同一份代码）：人物 item 给**基准设定图**节点（左脸部特写、右带头三视图的横图），
 *    工具按列空隙跳过脸部特写、取三视图的第一个人像（产品图取不出不整表失败：那一项画剪影、notes 说原因，A60）；旧项目给的单张派生全身图（竖图，或
 *    只有一个人）仍取整张的主体；生物 item 同人物（新版生物设定图也是特写 + 带头三视图，取正面；四足、带翅的正面宽，
 *    宽 ÷ 高的上限放宽到 2；单张的生物图照旧整张）；道具 item 给三格图（左正面、中背面、右手持或在旁）取左格正面（按
 *    空隙取第一块），单张道具图取整张。人物 / 生物每个还有一条从头顶引到竖尺、标着身高的虚线（拍板 A57 补充 2）。
 *    取出来的那一块按主体外框（非白像素）裁；`floorShadow` 是量外框时切掉脚下投影的
 *    缺省阈值 ——「浅灰低饱和」= 三通道里最小的
 *    ≥ `minLevel` 且最大 − 最小 ≤ `maxChroma`；外框底部只剩这种像素的连续几行，还得长得像落在地上的投影 —— 比紧挨着
 *    它上面的脚明显更宽（左右外沿 ≥ 1.25 倍）或者扁（带高 ≤ 带宽的 1/5），占一条就算（验收 3 问题 1：跟脚差不多宽的
 *    窄投影、露在脚下高一截的投影也得认）—— 才当投影切掉，只占一条的切了也回包 warning `floor_shadow_kept`；浅灰的
 *    鞋、浅色长靴、裙摆跟上面的腿差不多宽、不扁，是主体的一部分，不切也不报（验收 2 问题 C）。像投影的带高超过外框
 *    高的 `maxBandRatio` 就不切、同样回包 `floor_shadow_kept`；`metadata.floorShadow` 可以只改其中几项，或给 false 不切。
 *    NODE-ID 只决定成图
 *    落在哪个节点旁边（任一张已出图的图片节点）；几张时全部上传完一起落下。`locales`：图上标题的语言
 *    （`metadata.locale`，缺省 zh；名字原样上图）。
 *  · `userSheet` —— 用户自传的图（拍板 A60 定稿、A61）：**自传资产不拼合成图**（asset-sheet 的 NODE-ID 带
 *    `metadata.userSheet:true` 回 invalid_request，那张原图整张就是视频参考）；只在 asset-sheet 的
 *    `scaleRefs[i].userSheet:true`（自传的标尺人物）与 scale-lineup 的 `items[i].userSheet:true` 里用。不用任何模型：
 *    ① 图边一圈（两像素宽）与中位色每个通道差不到 `bgTolerance` 的占 `bgUniformity` 以上 = 底色均匀，从图边
 *    flood-fill 抹掉相连的底色；不均匀 → 剪影 `complex_background`；② 按连通块找站立全身人像（高 ÷ 宽在
 *    `figureAspect` 之间、至少占图高 `minHeightRatio`、底边在下半张，正 / 侧 / 背都行，取面积最大），没有 →
 *    `no_full_body`；脚下投影照产品图那套切（`scaleLineup.floorShadow`，底色上「比底色暗、不改色相」的像素算投影色）；
 *    ③ 顶 / 底离图边至少 `edgeMarginRatio`、头顶上方没被别的格子紧挨着压着、有头（顶是圆的、
 *    比身子窄），不然 → `incomplete`（生物不看高宽比与头）。取不出就画按身高缩放的中性灰（`silhouetteColor`）剪影，
 *    照样写名字身高、画标高虚线；自传道具一律画按 `sizeCm` 的圆角方框。`metadata.userSheetBg: {tolerance?,
 *    uniformity?}` 改底色的两个阈值。回包 `meta.subjects[]` 列出调用方要统一处理的那几项 —— 每个自传的（带
 *    `userSheet: true`）与比例总表里产品图取不出正面 / 左格、退成剪影的（没有 `userSheet`）：`label`、`kind`、
 *    `nodeId` / `fileId`、`source: "figure" | "silhouette"`、`reason`（自传的取自 `silhouetteReasons`，产品图的是取不出
 *    的原因码，如 `loose_parts`、`headless`、`merged`、`blank`）。asset-sheet 的产品图标尺人物取不出仍 run_failed。
 */
export const LOCAL_TOOLS = {
  warningCodes: ["floor_shadow_kept", "text_overflow"],
  kinds: [
    "trim-audio",
    "trim-video",
    "capture-frame",
    "crop-image",
    "grid-split",
    "flip-image",
    "annotate-image",
    "asset-sheet",
    "scale-lineup",
  ],
  annotate: {
    markKinds: ["pen", "rect", "circle", "arrow", "text"],
    maxMarks: 200,
    text: {
      maxChars: 200,
      maxLines: 10,
      sizeDefault: 0.03,
      sizeMax: 0.3,
      aligns: ["left", "center", "right"],
    },
  },
  assetSheet: {
    assetKinds: ["character", "scene", "prop"],
    panels: {
      character: {
        primary: "baselineSheet",
        cells: ["face", "threeView"],
        extra: ["face", "threeView"],
        combined: { baselineSheet: ["face", "threeView"] },
      },
      scene: { primary: "sceneSheet", cells: ["scene", "plan"], extra: [] },
      prop: { primary: "propSheet", cells: ["front", "back", "held"], extra: [] },
    },
    fields: {
      character: [
        "name",
        "aliases",
        "gender",
        "age",
        "height",
        "weight",
        "build",
        "species",
        "skinTone",
        "hair",
        "eyeColor",
        "features",
        "outfit",
        "props",
      ],
      scene: [
        "name",
        "setting",
        "area",
        "size",
        "ceilingHeight",
        "orientation",
        "keyObjects",
        "entrances",
        "era",
      ],
      prop: ["name", "size", "unit", "weight", "material", "color", "usage"],
    },
    derivedFields: { character: ["height"], scene: ["size"], prop: ["size"] },
    geometryKeys: { character: ["heightCm"], scene: ["sceneSize"], prop: ["sizeCm"] },
    fieldMaxChars: 120,
    locales: ["zh", "en"],
    heldModes: ["handClose", "hand", "beside"],
    heldModeMaxCm: { handClose: 30, hand: 60 },
    scaleRefs: { min: 1, max: 2, labelMaxChars: 20, noteHeightRatio: 4 },
    infoMaxHeightRatio: 0.15,
  },
  scaleLineup: {
    itemKinds: ["character", "creature", "prop"],
    maxItems: 48,
    perRowMax: 6,
    rowsPerImageDefault: 2,
    rowsPerImageMax: 3,
    maxHeightRatio: 25,
    labelMaxChars: 20,
    aspect: "16:9",
    width: 2400,
    height: 1350,
    locales: ["zh", "en"],
    scaleAxes: ["l", "w", "h"],
    floorShadow: { minLevel: 180, maxChroma: 24, maxBandRatio: 0.08 },
  },
  userSheet: {
    bgTolerance: 24,
    bgUniformity: 0.6,
    figureAspect: { min: 2, max: 5 },
    minHeightRatio: 0.4,
    edgeMarginRatio: 0.01,
    silhouetteReasons: ["complex_background", "no_full_body", "incomplete"],
    silhouetteColor: "#9AA0A6",
  },
};

/**
 * 命令分级（v2 §4）—— 「这条命令属于哪一档、能不能让 worker 发、要不要用户先点头、
 * 宿主该给它多长超时」。
 *
 * 为什么放进契约而不是只写在技能手册里：这四件事今天各有一份手抄在描述它 ——
 * 包自带的 SKILL.md、产品的 `.pi` 副本、宿主注入的规则块、宿主自己的工具白名单。
 * 手抄之间已经出过「手册说写命令都能 `--wait`、宿主硬拒 `--wait`」这种互相矛盾的档，
 * 模型同时拿到两个相反答案只能原地猜。分级是**数据**，不是散文：从这里读，四份就没有
 * 各自漂的余地。
 *
 * 这里是**纯数据**，刻意不 import `spec.mjs`：依赖方向是 `spec.mjs → contract.mjs`
 * （`spec.mjs:27`），反过来再 import 一条就成环。所以 42 条子命令名在这里是手写的，
 * 「它就是 `COMMAND_SPEC` 的键集」这件事由 `test/spec.test.mjs` 双向钉死。
 *
 * 字段：
 *  · `level` —— L0 只读 / L1 可撤销的写 / L2 花钱 / L3 不可撤销的边界动作。
 *  · `method` —— 线协议方法名（`common.mjs` 的 `METHODS`）；`local:true` 的 13 条
 *    根本不发线协议（帮助、会话生命周期、媒体传输、剪映工程导出在 CLI 本地就返回了），它们的
 *    `method` 是 `null`，给它们标 `mutation` / `mainOnly` 没有真值可对，所以不标。
 *  · `flagTiers` —— 只有本地命令可能有：某个 flag 把这条命令换到另一档（今天只有
 *    `export-jianying --draft-root`）。键是 flag 名（不带 `--`），值给那一档的 `level` / `mainOnly`、
 *    它会发的线协议方法 `methods`（`MAIN_METHODS` 里只被本地命令用到的方法在这里登记，
 *    `test/contract.test.mjs` 把它们算进 mainOnly 的双向对齐），以及 `approvalWhen`：什么时候要
 *    `--approved`（不是付费同意，所以不进 `approval` 那一栏）。
 *  · `mutation` —— 是否进撤销栈 / 改状态（= `MUTATIONS.has(method)`）。
 *  · `mainOnly` —— worker 发它会 `worker_forbidden`（= `MAIN_METHODS.has(method)`）。
 *  · `approval` —— 必须带 `approval.userApprovedNodeIds`，也就是「用户已经同意付费」。
 *  · `timeoutTier` —— `short` 秒级；`long` 媒体分片传输，宿主超时要放宽；
 *    `wait` 接受 `--wait` / `--wait-ms`，页面不在时会排队，可能一直阻塞到恢复窗口
 *    结束 —— 宿主有权拒绝这个 flag，拒了就用 `--request-id` 取结果。
 *    宿主那边通常只有「读档 / 写档」两档，映射就一句话：`timeoutTier === "short"`
 *    才是读档，`long` 与 `wait` 一律走写档。要从这张表推，别另手抄一份命令名单 ——
 *    手抄的名单已经把 `turn-end`（`mutation:true`、会排队的写命令）漏进过读档，
 *    连带着「写命令被杀之后把 argv 带回来」这类只认写档的兜底也一起落空。
 */
const TIERS = {
  /* ── L0 只读：不改任何东西，worker 全部可发 ── */
  help: { level: "L0", local: true, method: null, timeoutTier: "short" },
  "skill-path": { level: "L0", local: true, method: null, timeoutTier: "short" },
  status: { level: "L0", local: true, method: null, timeoutTier: "short" },
  download: { level: "L0", local: true, method: null, timeoutTier: "long" },
  "inspect-media": { level: "L0", local: true, method: null, timeoutTier: "long" },
  frames: { level: "L0", local: true, method: null, timeoutTier: "long" },
  /**
   * 剪映工程导出：读画布（只读的 `timeline_export`）+ 往 workspace 写文件，和 `download` /
   * `frames` 同一档 —— 不改画布、不花钱、worker 也能发。下整段素材可能要很久，所以是 `long`。
   * **除 `--draft-root` 外只写 workspace**：`--draft-root` 直接写进用户机器上的剪映草稿目录（拍板 A6），
   * 另算一档（`flagTiers`）—— L1（写用户机器上的目录、不花钱；写进去的是新建的工程目录，不动别的，
   * 不要了删掉即可）、只有 main 能发（要读 / 写用户登记的草稿目录：`jianying_roots_list` /
   * `jianying_roots_touch` 都是 main 专用），目录不在用户登记的草稿目录里时要 `--approved`
   * （`approvalWhen:"unregistered_root"`：智能体先把完整路径念给用户、用户同意）。
   */
  "export-jianying": {
    level: "L0",
    local: true,
    method: null,
    timeoutTier: "long",
    flagTiers: {
      "draft-root": {
        level: "L1",
        mainOnly: true,
        methods: ["jianying_roots_list", "jianying_roots_touch"],
        approvalWhen: "unregistered_root",
      },
    },
  },
  "list-canvases": {
    level: "L0",
    method: "list_canvases",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  ls: {
    level: "L0",
    method: "ls",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  read: {
    level: "L0",
    method: "read",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  grep: {
    level: "L0",
    method: "grep",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  snapshot: {
    level: "L0",
    method: "snapshot",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  health: {
    level: "L0",
    method: "health",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  resources: {
    level: "L0",
    method: "resources",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  models: {
    level: "L0",
    method: "model_catalog",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  tasks: {
    level: "L0",
    method: "tasks",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  changes: {
    level: "L0",
    method: "changes",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  /**
   * 剪映草稿目录（拍板 A6）：读用户登记的那几条（`jianying_roots_list`），再在本机看在不在、像不像
   * 草稿根。只读，但**只有 main 能查**：那是用户机器上的目录，直写它（`export-jianying --draft-root`）
   * 是主会话的事，子代理不能查、不能导。
   */
  "jianying-roots": {
    level: "L0",
    method: "jianying_roots_list",
    mutation: false,
    mainOnly: true,
    approval: false,
    timeoutTier: "short",
  },
  /** 只读，但**只有 main 能看**：撤销历史与时间线是主会话的身份面。 */
  operations: {
    level: "L0",
    method: "operations",
    mutation: false,
    mainOnly: true,
    approval: false,
    timeoutTier: "short",
  },
  /** `timeline list` 是读；别的 op 会写，所以它和写命令一样排队（timeoutTier `wait`）。 */
  timeline: {
    level: "L0",
    method: "timeline",
    mutation: false,
    mainOnly: true,
    approval: false,
    timeoutTier: "wait",
  },
  /** doc@1 文档库的读：worker 也能发。`docs read --out` 只是往 workspace 存一份临时阅读副本。 */
  "docs ls": {
    level: "L0",
    method: "documents_list",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },
  "docs read": {
    level: "L0",
    method: "documents_get",
    mutation: false,
    mainOnly: false,
    approval: false,
    timeoutTier: "short",
  },

  /* ── L1 可撤销的写：改画布文档，进 Agent 的撤销栈，不花钱 ── */
  apply: {
    level: "L1",
    method: "apply",
    mutation: true,
    mainOnly: false,
    approval: false,
    timeoutTier: "wait",
  },
  tidy: {
    level: "L1",
    method: "apply",
    mutation: true,
    mainOnly: false,
    approval: false,
    timeoutTier: "wait",
  },
  "resize-group": {
    level: "L1",
    method: "apply",
    mutation: true,
    mainOnly: false,
    approval: false,
    timeoutTier: "wait",
  },
  undo: {
    level: "L1",
    method: "undo",
    mutation: true,
    mainOnly: true,
    approval: false,
    timeoutTier: "wait",
  },
  redo: {
    level: "L1",
    method: "redo",
    mutation: true,
    mainOnly: true,
    approval: false,
    timeoutTier: "wait",
  },
  "turn-end": {
    level: "L1",
    method: "end_turn",
    mutation: true,
    mainOnly: false,
    approval: false,
    timeoutTier: "wait",
  },
  /**
   * doc@1 文档库的写：原地改文档库（带 `--expect-version`），不花钱，只有 main 能发（worker 只读）。
   * 它**不进**画布的撤销栈，`undo` 撤不了：服务端每写一次留一个版本（历史都在），但回滚接口后续才提供
   * —— 今天退回只能拿改之前读到的旧文字再写一次。归 L1 是因为它是「不花钱、可再改回去」的写，不是
   * 说 `undo` 能撤。
   */
  "docs create": {
    level: "L1",
    method: "documents_put",
    mutation: true,
    mainOnly: true,
    approval: false,
    timeoutTier: "wait",
  },
  "docs update": {
    level: "L1",
    method: "documents_put",
    mutation: true,
    mainOnly: true,
    approval: false,
    timeoutTier: "wait",
  },

  /* ── L2 花钱：每条 = 一次付费生成，必须先拿到用户同意 ── */
  run: {
    level: "L2",
    method: "run_node",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
  },
  "run-batch": {
    level: "L2",
    method: "run_nodes",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
  },
  /**
   * `localKinds`：这些 kind 在浏览器里算完、不经网关、**不扣费**（= `LOCAL_TOOLS.kinds`，同一个数组）——
   * 宿主据此不向用户确认扣费；仍只有 main 能发，CLI 仍要 `--approved`（命令形状）。其余 kind 都是 L2。
   */
  "run-tool": {
    level: "L2",
    method: "run_tool",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
    localKinds: LOCAL_TOOLS.kinds,
  },

  /* ── L3 不可撤销的边界动作：撤销栈救不回，或动的是连接身份 / workspace 文件 ── */
  cancel: {
    level: "L3",
    method: "cancel_node",
    mutation: true,
    mainOnly: true,
    approval: false,
    timeoutTier: "wait",
  },
  "cancel-batch": {
    level: "L3",
    method: "cancel_batch",
    mutation: true,
    mainOnly: true,
    approval: false,
    timeoutTier: "wait",
  },
  connect: { level: "L3", local: true, method: null, timeoutTier: "short" },
  disconnect: { level: "L3", local: true, method: null, timeoutTier: "short" },
  stop: { level: "L3", local: true, method: null, timeoutTier: "short" },
  delegate: { level: "L3", local: true, method: null, timeoutTier: "short" },
  revoke: { level: "L3", local: true, method: null, timeoutTier: "short" },
  /** 本地读文件 + 线上 `apply{upload_asset}`：worker 不能发，所以是 L3。 */
  upload: { level: "L3", local: true, method: null, timeoutTier: "wait" },
  /**
   * doc@1 软删一篇文档：面板里就看不到了，删掉的东西不在任何人的撤销栈里（服务端留着正文历史，
   * 但能不能找回不是 Agent 能决定的事），所以是 L3，要用户先同意（`--approved`，线上是
   * `approval.userApprovedDocumentIds`）。这个同意是「删」的同意，不是付费同意，所以 `approval`
   * 这一栏（= 付费档）仍是 false。
   */
  "docs delete": {
    level: "L3",
    method: "documents_delete",
    mutation: true,
    mainOnly: true,
    approval: false,
    timeoutTier: "wait",
  },

  /**
   * 一批 `apply` 里的 29 条命令各自的分级面。`workerAllowed` 是
   * `policy.mjs` 的 `WORKER_BLOCKED_COMMANDS` 取反（worker 连嵌在批里都不行）。
   *
   * `destructive` 的含义窄而确定：**这条命令会让画布上已经存在的东西消失**，
   * 发之前要先说给用户听。`destructiveWhen` 是「只在打到这个 id 上时才是灾难」——
   * `delete_node` 打在 `doc-index` 上会一次抹掉全画布的业务路径，用户的 Ctrl+Z 也
   * 救不回来（真值在 `apps/web/libs/canvas/agent-bridge/doc-index.ts` 的
   * `INDEX_NODE_ID`，`contract.test.mjs` 双向钉死）。
   */
  applyCommands: {
    add_node: { workerAllowed: true, destructive: false },
    update_node: { workerAllowed: true, destructive: false },
    edit_text: { workerAllowed: true, destructive: false },
    move_node: { workerAllowed: true, destructive: false },
    connect: { workerAllowed: true, destructive: false },
    disconnect: { workerAllowed: true, destructive: false },
    delete_node: { workerAllowed: true, destructive: true, destructiveWhen: "doc-index" },
    group_nodes: { workerAllowed: true, destructive: false },
    /** 组框本身消失（成员留着）—— 比 `delete_node` 安全，但仍然少了一个节点。 */
    ungroup: { workerAllowed: true, destructive: true },
    set_viewport: { workerAllowed: true, destructive: false },
    arrange: { workerAllowed: true, destructive: false },
    align: { workerAllowed: true, destructive: false },
    /** 裸 `{"type":"tidy"}` = 整张画布重排，动用户手摆的东西；CLI 的 `tidy --scope` 才是安全那条。 */
    tidy: { workerAllowed: true, destructive: true },
    resize_group: { workerAllowed: true, destructive: false },
    duplicate_node: { workerAllowed: true, destructive: false },
    select_output: { workerAllowed: true, destructive: false },
    /** 删掉一条候选 / 历史：撤销救得回，但它是删除类，按主会话处理。 */
    delete_output: { workerAllowed: false, destructive: true },
    split_output: { workerAllowed: true, destructive: false },
    /** 节点的全部产出（主输出、候选、历史）一次清空。 */
    clear_output: { workerAllowed: false, destructive: true },
    reset_status: { workerAllowed: true, destructive: false },
    add_to_group: { workerAllowed: true, destructive: false },
    /** 剩不到 2 个成员时组框整个解散（`dissolved[]`）—— 与 `ungroup` 同档。 */
    remove_from_group: { workerAllowed: true, destructive: true },
    duplicate_nodes: { workerAllowed: true, destructive: false },
    /** 把「最近删除」放回画布：不丢东西，但改的是用户删掉的决定，按主会话处理。 */
    recover_deleted: { workerAllowed: false, destructive: false },
    select: { workerAllowed: true, destructive: false },
    adopt_output: { workerAllowed: true, destructive: false },
    focus_node: { workerAllowed: true, destructive: false },
    upload_asset: { workerAllowed: false, destructive: false },
    export_output: { workerAllowed: false, destructive: false },
  },
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
  /** doc@1 项目文档库：docType 表、字段、id 语法、上限、contentSha 算法，见 `DOCUMENTS`。 */
  documents: DOCUMENTS,
  /** `run_tool` 的本地免费工具：kind 全集与各自 metadata 的上限 / 取值，见 `LOCAL_TOOLS`。 */
  localTools: LOCAL_TOOLS,
  /** 42 条 CLI 子命令 + 29 条 apply 命令各自的分级面，见 `TIERS`。 */
  tiers: TIERS,
};
