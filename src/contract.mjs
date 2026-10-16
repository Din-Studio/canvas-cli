import { LAYOUT_POLICY } from './layout-policy.mjs';
/**
 * 画布命令契约：30 条命令的字段（必填 / 可选）、每种节点 kind 的 draft 键白名单、
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
  RUN_SHOT_REFS_BUDGET_MS,
  RUN_SHOT_REFS_CALL_MS,
  RUN_STILLS_SHOTS_MAX,
  SCENE3D_ACTION_FIELDS,
  SCENE3D_ACTIONS_MAX,
  SCENE3D_STILL_FRAMES,
} from "./policy.mjs";
import { HOST_TEXT } from "./host-text.mjs";
import { SCENE3D_CUT_EXEMPTION_LABELS } from "./scene3d-labels.mjs";
import {
  IDENTITY_DEFAULT_NAMES,
  IDENTITY_EXTRAS,
  IDENTITY_HASH,
  IDENTITY_NAMED,
  IDENTITY_PALETTE,
  IDENTITY_PROP_COLORS,
  IDENTITY_SET_COLOR,
} from "./scene3d-identity.mjs";

/**
 * `tidied[]` 怎么念成一句人话，是 `apply` / `tidy` 两条路径**共用**的契约的一部分：
 * 页面直接把 `tidySummary` 放进回包，CLI 只对老页面兜底，宿主把它拼进给模型看的
 * 那段文本。所以从这条已经发布的子路径（`@scenemint/canvas-cli/contract`）原样再
 * 导出一次，包外的集成方不必去猜实现文件在哪。
 */
export { formatTidySummary } from "./tidy-summary.mjs";

/**
 * `scene3d_apply` 回包的人话版（`apply.scene3dSummary`）同理：页面产、宿主可自己渲，用同一份。
 * 实现在 `./scene3d-text.mjs`（只再导出、不从它取值：契约在画布首包里，取值会把摘要函数带进首包）；
 * 豁免叫法两边都从 `./scene3d-labels.mjs` 取。
 */
// 0.17.0：再加场景紧凑投影与自检文本版（`read NODE/scene`、`read NODE/checks` 的人话版，宿主渲染层直接用）。
export { formatScene3dChecks, formatScene3dScene, formatScene3dSummary } from "./scene3d-text.mjs";

/**
 * 三维场景的身份色（0.16.4）：`scene3dIdentityColor(role, 名字)` 是页面给没写 `color` 的对象上色用的那一个函数，
 * `scene3dColorLabel` 给提示词念颜色、`allocateIdentityColors` 给一场里的一批名字分不撞的色。剧本转视频原来自己拷了
 * 一份，从这里取就不会漂；数据（调色板、布景灰、算法名）在 `SCENE3D.identity`。0.17.0 再加
 * `scene3dObjectIdentity` / `scene3dDefaultColor`：拿存储的对象复算页面给的颜色（缺省名不算名字，见 defaultNames）；
 * `scene3dIsIdentityColor`：存的色是不是页面会给的身份色（B14 起 add_object 按本场避撞分色，存的不一定是
 * `scene3dDefaultColor` 那个；宿主投影据此不打身份色）。
 */
// 0.18.0：按集分色（`allocateEpisodeIdentityColors`）与跨场同色校验（`checkEpisodeIdentityColors`），A87 ④ / A88 ①。
export {
  allocateEpisodeIdentityColors,
  allocateIdentityColors,
  checkEpisodeIdentityColors,
  scene3dColorLabel,
  scene3dDefaultColor,
  scene3dIdentityColor,
  scene3dIsIdentityColor,
  scene3dObjectIdentity,
} from "./scene3d-identity.mjs";

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
    "audioSpeaker",
    "audioInputData",
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
  scene3d_apply: ["nodeId", "baseDigest", "actions"],
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

/** `scene3d_apply` 一条的动作数：与 `SCENE3D.limits.actionsPerCommand` 是同一个对象，200 只写在 policy.mjs。 */
const SCENE3D_ACTIONS_MAX_LIMIT = { min: 1, max: SCENE3D_ACTIONS_MAX };

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
  // scene3d@1：一条 scene3d_apply 的动作数；`run --shot` 的镜头 id 长度（与 SCENE3D.idPattern 同一个 128）。
  "scene3d_apply.actions": SCENE3D_ACTIONS_MAX_LIMIT,
  "run_node.shotId": { maxLength: 128 },
  // 0.17.0：多镜出片的镜头清单（不重复；每个 id 与 run_node.shotId 同一个长度上限）。
  "run_node.shotIds": { min: 1, max: 60, itemMaxLength: 128 },
  // 0.16.2 run-stills：镜头清单（省略 = 全部镜头）最多一场的镜头数，每个 id 与 run --shot 同一个长度上限。
  // 一次最多几张、页面答复前的总预算在 SCENE3D.limits（stillsPerRun / stillsBudgetMs）。
  "run_stills.shotIds": { min: 1, max: RUN_STILLS_SHOTS_MAX, itemMaxLength: 128 },
  // 0.18.0 run-shot-refs：镜头清单同 run-stills（一场的镜头上限）；总预算封顶与调用等待在 SCENE3D.limits
  // （shotRefsBudgetMs / shotRefsCallMs）。
  "run_shot_refs.shotIds": { min: 1, max: RUN_STILLS_SHOTS_MAX, itemMaxLength: 128 },
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
 * 恰好是那几个瞬态码（`RETRYABLE_ERROR_CODES`，agent-bridge/types.ts）；其余一律
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
  // scene3d@1：`scene3d_apply.baseDigest` 与节点当前的 sceneDigest 不同（带 currentDigest）——
  // 场景被人或别的 Agent 改过了：重读、按新场景重新规划，绝不原样重发。
  scene3d_conflict: { retryable: false },
  // doc@1：`expectVersion` 对不上（带 currentVersion / currentSha：重读、在新版本上重做再写），
  // 与查无此文档。两种裸重试都没有意义。
  doc_conflict: { retryable: false },
  doc_not_found: { retryable: false },
  // 0.16.1：两个「等一下就会好」的瞬态码，可原样重发。都是页面那一半，不进 `CLI_EXIT_CODES`
  // （落兜底桶 1；能不能重试看这里的 `retryable`）。
  // render_interrupted：浏览器里的三维渲染被真瞬态打断（无帧推进的看门狗、WebGL 丢失、网络错、标签页被
  // 丢弃…）；原样重发，没变的镜头会复用。确定性失败（时长超限、能力探测失败）仍是 run_failed。
  render_interrupted: { retryable: true },
  // collab_offline：页面与协作服务器断开 / 还没同步完（或久无消息），写命令一个都没写
  // （`error.persisted:false`）；等几秒原样重发。只拦写命令，read 不拦。
  collab_offline: { retryable: true },
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
  /**
   * `ChangeEntry.note`（除 `bulk_change` 与 `undo_restored` 外都只出现在 `kind:"batch"` 上）。
   * `undo_restored`（0.17.0，B9-FX-56）挂在 `kind:"update"`、`fields:[]` 上：撤销把这个节点删空了（并发的整节点
   * 写让 yjs 无旧值可恢复），页面的撤销护栏随即原样写回——节点没变，不是「删了又新建」。
   */
  notes: [
    "run_timeout",
    "batch_lost",
    "quota_stop",
    "frame_strays",
    "frame_escaped",
    "bulk_change",
    "undo_restored",
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
 *  · `fields` —— 一份文档的全部字段（正文另读，不在列表里）。`version` / `contentSha` / `contentUrl` /
 *    `updatedAt` 由服务端写：每写一次 `version` +1，写入必须带 `expectVersion`，不一致回 `errors.conflict`。
 *    `contentUrl`（0.16.2，A68）是当前正文文件在 CDN 上的链接：每个版本的正文存成一个 UTF-8 `.md` 文件，
 *    拿到链接就能打开（外传即公开）；还没搬到 CDN 的旧文档为 null。正文照旧从 `docs read` 读，不要自己去取链接。
 *  · `idPattern` —— 用 `u` 标志编译：第一段小写 ASCII（`script`、`lap-report`），后面几段允许中文、
 *    字母、数字、`_` `-`。`#` 留给场次锚点（`script:ep:01#1-2`），`@` 留给 `id@version`，都不在 id 里。
 *  · `contentShaAlgorithm` —— 与画布 `read` 的 `contentSha` 同一个算法：FNV-1a 64 位，按 UTF-16
 *    码元，16 位小写十六进制；算之前换行统一成 LF（`\r\n` 与单独的 `\r` 都算一个换行）。
 *  · `nodeTagPrefix` —— 文档复制到画布的是一份**副本**（文本节点），标签记 `doc:<id>@<version>`；0.16.2（A68）起画布上
 *    这两个入口（面板拖拽、预览窗「复制到画布」）关着，前缀照旧发布。
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
    "contentUrl",
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
  /**
   * 各文本字段的字符上限、集号上限、`assetTags` 条数与单条长度；`uploadChapters`（0.16.2，A68 调度拍板 ②）：
   * 面板上传一部小说一次最多拆成多少章（一章一篇、一篇一个正文文件），超了回 400、请用户分卷上传。
   */
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
    uploadChapters: 2000,
  },
  contentShaAlgorithm: "fnv1a64-utf16-lf",
  nodeTagPrefix: "doc:",
  folderIdPattern: "^[a-z][a-z0-9-]*:[a-z0-9]{4}$",
  /**
   * 错误码（页面桥与 CLI 同一个码）：写入冲突（`expectVersion` 对不上）、查无此文档；0.16.2 起正文存成 CDN 文件
   * （A68），又多两个 —— `upload_failed`：正文文件没存上（HTTP 502，库里什么都没写），`content_unavailable`：
   * 正文文件取不回来（HTTP 502）。这两个都是上游一时不可用，原样再发一次可以成功。还有 `quota_exceeded`（0.16.2）：
   * 这次写入会让项目里没删的文档当前正文合计超过 50 MB（HTTP 400，什么都没写），带 `usedBytes`（写之前的合计）与
   * `limitBytes`（上限）—— 原样重发没用，要删掉不用的文档或把这一篇改短；只改元数据、把正文改短的写入不受它限制。
   * `too_large`（0.16.2 起文档库也用它）：一篇正文超过 `contentMaxChars`，带 `chars`（换行统一 LF 之后的长度）与
   * `limitChars` —— CLI 发出去之前、守护进程与页面的 policy、服务端（HTTP 413）同一个码、同一组字段；拆成几篇再写。
   */
  errors: {
    conflict: "doc_conflict",
    notFound: "doc_not_found",
    uploadFailed: "upload_failed",
    contentUnavailable: "content_unavailable",
    quotaExceeded: "quota_exceeded",
    tooLarge: "too_large",
  },
};

/**
 * `run_tool` 的**本地工具**：浏览器里算完、不经网关、不是生成扣费项的那些 kind（`read` 回包 `tools[]`
 * 里标 `billable:false`）。它们仍只有 main 能发、CLI 仍要 `--approved`（那是命令形状，不是付费同意）。
 *
 * 为什么发成契约：`kind` 的取值本来故意不在包里枚举（页面的三套注册表才是真相源）。本地工具是例外 ——
 * 宿主要据此决定「这一条要不要向用户确认扣费」，产品要照着拼 `metadata`（字号上限、字段键、面板名、
 * 分档边界这类数字），各抄一份就会漂。所以页面侧直接 import 这个对象（`image-pixel-tools.ts` 等），
 * `tests/studio` 把 `kinds` 钉在页面注册表里带 `local` 的全部 kind 上（双向）。
 *
 *  · `kinds` —— 本地工具 kind 的全集；`tiers["run-tool"].localKinds` 是同一个数组。
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
 * scene3d@1 —— 三维导演台（scene-3d 节点）的动作面：`scene3d_apply` 收的 13 个 op 与各自的
 * 字段 / 必填、词表、预制件足迹、数值区间、上限、id 语法、单位、digest 算法、三项自检的常数与码。
 * 约定全文在仓库 `docs/conventions/scene-3d.md`。
 *
 * 为什么是独立的一块而不进 `enums` / `ranges`：那两张表的键是 `<命令>.<字段>`（契约测试逐条核对
 * 字段在命令字段表里），动作的字段在命令的 `actions[]` 里面一层，放不进去。
 * 页面侧 `apps/web/libs/canvas/scene-3d/vocab.ts` 直接 import 这个对象（DRAFT_KEYS / LOCAL_TOOLS
 * 同一个先例），导演台与 Agent 共用的 reducer 按它校验，所以这里列的就是真正生效的那一份。
 *
 *  · `ops` —— 字段来自 `policy.mjs` 的 `SCENE3D_ACTION_FIELDS`（守护进程「多给即报错」用的那张表，
 *    字段名只写那一处）；`required` 是下面本地的一张表。
 *  · `enums.prefab` / `prefabs` —— 24 个常用陈设名词，每个带自定的公制足迹：`add_object {prefab:"counter"}`
 *    不给 `transform.scale` 就是 2.4 × 1 × 0.6 m。`prefab` 本身是开放字符串（≤ `prefabMaxLength`），
 *    词表外不拒、按 `kind` 画、自检提醒 `unknown_prefab`；`aliases` 在写入时解析成词表里的名字。
 *  · `ranges.fov` 是垂直视场角（度），覆盖 `focal` 区间在五种画幅上的全部换算结果（长边 36 mm）。
 *  · `units` —— 可绑定的 token，不写散文：线上（read 出 / apply 入）角度一律度，存储是弧度。
 *  · `digest` —— `sceneDigest` 的算法；`baseDigest` 写 `newSentinel` 只对本批前面 `add_node` 刚建的
 *    三维节点有效。
 *  · `checks` —— 自检的容差常数、数据健康的码与两档、接缝跳切的三种豁免；0.17.0 起加取景提醒
 *    （framing）的码与阈值、动画提醒（motion）的码、两档与阈值。
 *  · `framing.sizes` —— 景别阶梯（0.17.0）：词、粗档、切点 / 画内高度分数、身体部位说法。
 *  · `destructiveOps` —— 让东西消失的三个 op（删对象 / 删镜头 / 删动作）；`tiers.applyCommands.scene3d_apply.destructiveOps`
 *    是同一个数组。0.18.0 起 `remove` / `remove_shot` 只在打到人在导演台改过的对象 / 镜头（`humanEdit`）上时才要用户同意，
 *    没打标记的直接删、不进破坏性审批；`remove_act` 照旧先说给用户听。
 *  · `humanEdit`（0.18.0，A86 ④）—— 导演台写入时给动过的对象 / 镜头打的标记（`editedBy:"human"`，存在场景里；人给某人
 *    排动作也算动了那个人）。Agent 写不出也清不掉它。`approvalOps` 打在带它的东西上整批 `approval_required`，要用户同意后
 *    带 approval 重发（`approval.userApprovedNodeIds` 列这个三维节点；CLI `apply --approved`）。
 *
 * 不进契约的：人物看点偏移表与静帧像素 —— CLI 从不计算它们，进了契约，页面一校准就得再发包；
 * 它们留在页面 `vocab.ts`。
 */
const SCENE3D_PREFABS = {
  wall: { kind: "box", size: { x: 4, y: 2.7, z: 0.2 } },
  // plane 的 size.y 无意义，固定 1
  floor: { kind: "plane", size: { x: 6, y: 1, z: 6 } },
  door: { kind: "box", size: { x: 0.9, y: 2.1, z: 0.1 } },
  window: { kind: "box", size: { x: 1.2, y: 1.2, z: 0.1 } },
  pillar: { kind: "cylinder", size: { x: 0.4, y: 2.7, z: 0.4 } },
  stairs: { kind: "box", size: { x: 1.2, y: 1, z: 2 } },
  platform: { kind: "box", size: { x: 2, y: 0.3, z: 2 } },
  counter: { kind: "box", size: { x: 2.4, y: 1, z: 0.6 } },
  table: { kind: "box", size: { x: 1.4, y: 0.75, z: 0.8 } },
  desk: { kind: "box", size: { x: 1.4, y: 0.75, z: 0.7 } },
  chair: { kind: "box", size: { x: 0.5, y: 0.9, z: 0.5 } },
  stool: { kind: "cylinder", size: { x: 0.4, y: 0.45, z: 0.4 } },
  bench: { kind: "box", size: { x: 1.6, y: 0.45, z: 0.4 } },
  sofa: { kind: "box", size: { x: 2, y: 0.8, z: 0.9 } },
  bed: { kind: "box", size: { x: 1.5, y: 0.5, z: 2 } },
  shelf: { kind: "box", size: { x: 1, y: 2, z: 0.35 } },
  cabinet: { kind: "box", size: { x: 1, y: 1.8, z: 0.5 } },
  screen: { kind: "box", size: { x: 1.6, y: 0.9, z: 0.05 } },
  lamp: { kind: "cylinder", size: { x: 0.3, y: 1.6, z: 0.3 } },
  plant: { kind: "cylinder", size: { x: 0.6, y: 1.2, z: 0.6 } },
  tree: { kind: "cylinder", size: { x: 1.5, y: 5, z: 1.5 } },
  rock: { kind: "box", size: { x: 1, y: 0.6, z: 0.8 } },
  // 车头 +x
  car: { kind: "box", size: { x: 4.5, y: 1.5, z: 1.8 } },
  streetlamp: { kind: "cylinder", size: { x: 0.2, y: 4, z: 0.2 } },
};

/**
 * 每个 op 的**必填**字段（值可以是这个 op 允许的 null）。可选 = 字段表减去这一行，与
 * `REQUIRED_FIELDS` 同一个口径；还有几条「二选一」（add_shot 的 `fov` / `focal`、`cam` / `orbit`，
 * transform 等「至少改一样」）是页面侧 reducer 判的，不是单个字段的必填。
 */
const SCENE3D_REQUIRED = {
  // 0.16.1：kind 可省，由 prefab（含别名）的足迹 kind 或 role:"figure" 推出（页面回 applied[].kind）。
  add_object: ["role"],
  transform: ["id"],
  remove: ["id"],
  duplicate: ["id"],
  set_camera: ["id"],
  set_scene: [],
  set_figure: ["id"],
  set_axis: ["ends"],
  set_focus: ["id", "shape"],
  add_shot: ["look"],
  update_shot: ["id"],
  reorder_shots: ["order"],
  remove_shot: ["id"],
  // 0.17.0：调度动作。add_act 不给 id 时页面生成并回显。
  add_act: ["who", "at"],
  update_act: ["id"],
  remove_act: ["id"],
};

/**
 * 纯数据拼装、**一条都不抛**（与 `buildCommands` 同一个理由）：本块在浏览器 chunk 求值时就建，
 * 两张表哪天对不上，退化成「全是可选」，由 `test/contract.test.mjs` 报红。
 */
function buildScene3dOps() {
  const out = {};
  for (const [op, fields] of Object.entries(SCENE3D_ACTION_FIELDS))
    out[op] = { fields: [...fields], required: [...(SCENE3D_REQUIRED[op] ?? [])] };
  return out;
}

export const SCENE3D = {
  convention: "scene3d@1",
  ops: buildScene3dOps(),
  enums: {
    role: ["figure", "prop", "set"],
    kind: ["human", "box", "cylinder", "plane", "backdrop"],
    bodyType: ["standard", "tall", "short", "strong", "child"],
    pose: ["stand", "sit", "kneel", "crouch", "lie", "prone"],
    arms: ["down", "forward", "hold", "up", "cross", "back", "akimbo", "point"],
    focusShape: ["disc", "box", "ball", "stick"],
    moveEase: ["linear", "out"],
    aspectRatio: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    // 0.17.0（调度表与出片）。手势叫 shake_head、镜头手持叫 shake：同一批里两个词会同时出现（G3 C22）。
    gait: ["walk", "run"],
    shake: ["light", "medium", "heavy"],
    hand: ["right", "left"],
    gesture: ["wave", "nod", "shake_head", "bow", "beckon", "point_at"],
    /** `run_node.render`（缺省 still）与 `sheetFrames`（联系表格数，缺省 3，只对 sheet）。 */
    render: ["still", "video", "sheet"],
    sheetFrames: [3, 5, 9],
    /**
     * act 的保留词：放下 / 冻结朝向 / 回正（act 里 null 只在 update_act 表示「删字段」）；0.18.2 加进场 / 离场（`do` 的两个值，
     * 在场模型见 `SCENE3D.presence`）。
     */
    actSentinels: ["@keep", "@none", "@drop", "@enter", "@offstage"],
    /** 静帧取镜头的哪一刻（0.16.2 `run --frame`、节点的 `renderedFrame`）：`policy.mjs` 的同一个数组。 */
    frame: SCENE3D_STILL_FRAMES,
    prefab: Object.keys(SCENE3D_PREFABS),
    /** 别名 → 词表里的名字（`add_object` 写入时解析，存储里是解析后的名字）。 */
    aliases: {
      bar: "counter",
      nightstand: "table",
      armchair: "sofa",
      couch: "sofa",
      bookshelf: "shelf",
      rack: "shelf",
      wardrobe: "cabinet",
      fridge: "cabinet",
      tv: "screen",
      monitor: "screen",
      column: "pillar",
      step: "platform",
      stage: "platform",
      bush: "plant",
      truck: "car",
      lamppost: "streetlamp",
    },
  },
  prefabs: SCENE3D_PREFABS,
  ranges: {
    fov: { min: 2, max: 140 },
    focal: { min: 8, max: 400 },
    dur: { min: 0, max: 600 },
    moveT: { min: 0, max: 1 },
    orbitR: { exclusiveMin: 0, max: 1000 },
    coordinate: { min: -1000, max: 1000 },
    scale: { exclusiveMin: 0, max: 100 },
    gridSize: { min: 1, max: 200, integer: true },
    n: { min: 1, integer: true },
    // 0.17.0：act 的 at、镜头的 start（故事秒）；镜头途经点的 t（镜内进度，两端开区间）。
    at: { min: 0, max: 600 },
    start: { min: 0, max: 600 },
    viaT: { exclusiveMin: 0, exclusiveMax: 1 },
  },
  limits: {
    actionsPerCommand: SCENE3D_ACTIONS_MAX_LIMIT,
    objects: 100,
    cameras: 12,
    shots: 60,
    movesPerShot: 20,
    idMaxLength: 128,
    textMaxLength: 500,
    nameMaxLength: 60,
    prefabMaxLength: 64,
    // 0.17.0：一个场景的调度动作条数；镜头 / 一条 act 的途经点个数。
    acts: 200,
    viaPerShot: 8,
    viaPerAct: 8,
    /** `run-stills` 一次最多几张：一场的镜头上限 × 两帧（0.16.2）。 */
    stillsPerRun: 120,
    /**
     * `run-stills` 页面答复前的总预算（毫秒，0.16.2）：逐张渲，每张另有 25 s；到点时在渲的那张中止，
     * 它与没开始的进回包 `skipped`（reason `budget`），已出的照样回报。守护进程的调用超时是 120 s。
     */
    stillsBudgetMs: 90000,
    /**
     * `run-shot-refs` 页面答复前的总预算封顶（毫秒，0.18.0）：总预算按镜数算 —— 每镜两张站位图各 25 s、预演 15 s +
     * 每帧 250 ms —— 超过就封在这里（与 `run --await` 的上限同一个数）；到点时在渲的那一样中止，它与没开始的进
     * `skipped`（`budget`）并列进 `remaining`。= policy 的 `RUN_SHOT_REFS_BUDGET_MS`。
     */
    shotRefsBudgetMs: RUN_SHOT_REFS_BUDGET_MS,
    /**
     * 守护进程与 CLI 等一条 `run-shot-refs` 答复的时长（毫秒，0.18.0）：总预算封顶 + 15 s 收尾。别的方法照旧是会话的
     * 调用超时（120 s）。= policy 的 `RUN_SHOT_REFS_CALL_MS`。
     */
    shotRefsCallMs: RUN_SHOT_REFS_CALL_MS,
  },
  idPattern: "^[A-Za-z0-9_.-]{1,128}$",
  units: {
    length: "m",
    up: "y",
    ground: "y0",
    figureFacing: "pz",
    rotationWire: "deg",
    rotationStored: "rad",
    orbitAngleWire: "deg",
    orbitAngleStored: "rad",
    fov: "vertical-deg",
    focal: "mm-long-edge-36",
    wireDecimals: 4,
    // 0.17.0：at / start / dur 是故事秒；via[].t 是镜内进度（0 = 起幅，1 = 落幅）。
    time: "s",
    shotProgress: "unit-interval",
  },
  digest: { algorithm: "fnv1a64-utf16-sorted-json", newSentinel: "new" },
  checks: {
    constants: { AXIS_ON_LINE_M: 0.15, SUBJECT_CHANGE_M: 0.75, JUMP_CUT_DEG: 30, RESIZE_RATIO: 2 },
    healthCodes: [
      "body_penetration",
      "invalid_support",
      "held_conflict",
      "subshot_invalid",
      "missing_ref",
      "shot_missing_cam",
      "shot_missing_look",
      "shot_missing_fov",
      "axis_missing",
      "axis_invalid",
      "unknown_pose",
      "unknown_arms",
      "unknown_prefab",
      "untyped_objects",
      "duplicate_shot_n",
      "duplicate_id",
      // 0.16.1：镜头同时有 orbit 与 cam（或 to）时 orbit 生效、cam 被忽略（warn）。
      "orbit_cam_ignored",
      // 0.16.4：接触检查的三条提醒（warn，不拦）—— 坐姿没绑定座面、站着脚底离开 / 陷进脚下的支撑面、
      // 手里的东西（存储的位置）离手太远。
      "seat_unbound",
      "support_gap",
      "held_offset",
      // 0.17.0（动画；合流 D-91 排在 0.16.4 三条之后，0.16.4 的表是前缀）：缺 dur（出视频时 block，有调度表时 warn）、同一通道组动作重叠、持物不成立。
      "shot_missing_dur",
      "act_conflict",
      "hold_invalid",
      // 0.17.0（B9-FX-53）：box / cylinder 埋进地面超过自身高度的 25%（position.y 是中心，写 y=0 就半截在地下），warn。
      "object_below_ground",
      // B14（L2 P1）：同 role 的两个不同身份用着同一个身份色（老场景按名字取色会撞），warn；message 带换色动作。
      "identity_color_clash",
      // 0.18.2（A102 ④）：家具 / 道具底面陷进它脚下的地板盒子（`contact.floorSlab`）、修数据没落到地板顶面的，warn；
      // message 说陷进多深、带抬到地板顶面的 fix。
      "sunk_in_floor",
    ],
    healthLevels: ["block", "warn"],
    cutExemptions: ["moving", "resize", "subject"],
    /** 跳切豁免在人话里的叫法（自检 message 与 `scene3dSummary` 共用；键 = `cutExemptions`）。 */
    cutExemptionLabels: SCENE3D_CUT_EXEMPTION_LABELS,
    // 0.17.0：取景提醒（只提醒、永不拦；每 0.25 s 采样 + 每镜首帧与末帧）。cam_too_close / foreground_fill
    // 只在 `read NODE/framing` 的网格模式报。页面 framing.ts 发的码 ⊆ 这张表恒查；反方向由 framing.ts 的
    // FRAMING_CODES_COMPLETE 打开（D-69）。
    framingCodes: [
      "cam_inside",
      "cam_below_ground",
      "cam_too_close",
      "subject_out",
      "head_out",
      "subject_blocked",
      "foreground_fill",
      "framing_mismatch",
    ],
    // 全身在画内时投影身高占画高 ≥ FULL_MIN_H 为全景、≥ LONG_MIN_H 为远景、更小为大远景；机位离画内非主体
    // 对象表面 < TOO_CLOSE_M；画内地标被挡比例 ≥ BLOCKED（或眼被挡）算主体被挡；更近的非主体对象占画面
    // ≥ FOREGROUND_FILL 算前景压画面。本项目自拟，可改值不改名。
    framingConstants: {
      FULL_MIN_H: 0.45,
      LONG_MIN_H: 0.15,
      TOO_CLOSE_M: 0.3,
      BLOCKED: 0.5,
      FOREGROUND_FILL: 0.4,
    },
    // 0.17.0：动画提醒（只提醒、永不拦）。页面 motion.ts 发的码 ⊆ 这张表恒查；反方向（每个码都有人发）
    // 由 motion.ts 的 MOTION_CODES_COMPLETE 打开（D-69）——在那之前页面只发其中一部分。
    motionCodes: [
      "axis_motion",
      "figure_collision",
      "speed",
      "move_while_posed",
      "prop_unsupported",
      "cut_jump",
      "screen_direction",
      "act_unseen",
    ],
    motionLevels: ["warn", "info"],
    // 「持续」= 连续 ≥ 2 个 SAMPLE_S 采样点超限；单帧位移 FRAME_JUMP_M 按 24 fps 帧网格逐帧算（不在
    // 0.25 s 网格上算）；其余按 0.25 s 采样 + 每镜首帧与末帧。
    motionConstants: {
      WALK_MAX_MPS: 2.5,
      RUN_MAX_MPS: 8,
      CAMERA_MOVE_MAX_MPS: 6,
      CAMERA_TURN_MAX_DEG_S: 180,
      FRAME_JUMP_M: 0.5,
      CUT_JUMP_M: 0.3,
      CUT_JUMP_DEG: 45,
      SUPPORT_TOLERANCE_M: 0.05,
      FIGURE_RADIUS_M: 0.25,
      SAMPLE_S: 0.25,
      SUSTAIN_S: 0.25,
    },
  },
  // 0.17.0：景别阶梯（下游 s2v / seedance 的口径）。从近到远排，取第一条够得上的：切点身高分数（画框切在
  // 人物站姿等效身高的哪一处，头顶 ≈ 1、脚 = 0）≥ cutMin；全身在画内（不切）时按投影身高占画高 ≥ heightMin。
  // `coarse` 是粗档，`body` 是不会有歧义的身体部位说法。手册、页面、提示词用同一张表。
  framing: {
    sizes: [
      {
        name: "大特写",
        coarse: "特写",
        cutMin: 0.87,
        heightMin: null,
        body: "只有眼 / 嘴 / 手等局部",
      },
      { name: "特写", coarse: "特写", cutMin: 0.83, heightMin: null, body: "脸充满画框" },
      { name: "中近景", coarse: "近景", cutMin: 0.7, heightMin: null, body: "头与肩" },
      { name: "中景", coarse: "中景", cutMin: 0.52, heightMin: null, body: "腰部以上" },
      { name: "七分身", coarse: "中景", cutMin: 0.36, heightMin: null, body: "大腿中部以上" },
      { name: "中全景", coarse: "全景", cutMin: 0, heightMin: null, body: "接近全身" },
      { name: "全景", coarse: "全景", cutMin: null, heightMin: 0.45, body: "全身在画内" },
      { name: "远景", coarse: "远景", cutMin: null, heightMin: 0.15, body: "全身在画内，人物偏小" },
      {
        name: "大远景",
        coarse: "远景",
        cutMin: null,
        heightMin: 0,
        body: "全身在画内，人物很小、以环境为主",
      },
    ],
  },
  destructiveOps: ["remove", "remove_shot", "remove_act"],
  humanEdit: { field: "editedBy", value: "human", approvalOps: ["remove", "remove_shot"] },
  /**
   * apply 回包 `scene3d[].repairs[]`（0.18.0，A86 补充① / A88 ②）：页面在 scene3d_apply 落地之后、自检之前修的数据 ——
   * 只修不改导演意图（谁坐哪、谁站哪、谁拿什么）的，只修这一批动过的、人在导演台没改过的：`grounded` 家具 / 道具底面在
   * 地下 → 落地；`held_to_hand` 手里拿的东西存的位置离手 ≤ `HELD_SNAP_MAX_M` → 贴到手上（更远的照旧提醒 held_offset）；
   * `pushed_out` 人偶穿进家具 / 墙、水平挪 ≤ `PUSH_MAX_M` 就出来 → 沿最短方向推开（更深的不修，body_penetration 照旧拦下，
   * message 与 `fix` 给 `SUGGEST_MAX_M` 内最近的不穿模站位）；`camera_merged` 本批新建的机位与已有的一模一样 → 并进那一台。
   * 坐的东西没座面不改绑、不改站姿（invalid_support 的 message 给改法）。0.18.1（A97 修法 ③）：`figure_grounded` 站 / 蹲 /
   * 跪的人偶脚底离脚下的支撑面（地面、台子 / 台阶顶面、家具顶面）≤ `FIGURE_GROUND_MAX_M`（悬空或陷进去）→ 贴到那个面上
   * （transform.position.y）；更远的不修，support_gap 照旧提醒，message 与 `fix` 给贴面的坐标；坐、躺、趴不动。每条
   * `{code, id, field, from, to, reason}`，产品照它写回方案。
   */
  repairs: {
    codes: ["grounded", "figure_grounded", "held_to_hand", "pushed_out", "camera_merged"],
    constants: {
      PUSH_MAX_M: 0.1,
      HELD_SNAP_MAX_M: 0.3,
      SUGGEST_MAX_M: 2,
      FIGURE_GROUND_MAX_M: 0.1,
    },
  },
  /**
   * 在场模型（0.18.2，A102 ⑧）：同一场里有人中途进场、有人中途离场（同一个三维节点，前后几段的人物不一样）。
   *  · `figureField` —— 人物开场不在：`set_figure {id, offstage:true}`（存在 `figure.offstage`；`false` / `null` 清掉）。
   *  · `actField` / `enter` / `exit` —— 调度的进场 / 离场：`add_act {who, at, do:"@enter", to?, facing?}` 在故事第 `at` 秒
   *    出现在 `to`（点；不给就在他此刻的位置），面朝 `facing`（立刻，不转身）；`add_act {who, at, do:"@offstage"}` 在第 `at`
   *    秒离场。只给人物；进场那一条另外只收 `enterFields`（与 id / who / at / do / note），离场那一条只收 note。要走进来、
   *    坐下、拿东西另写调度（`at` 不早于进场）；人不在场时的调度照常求值（下一次出现就从那个状态接着）。
   *  · 进场前 / 离场后的那一刻（`notOnStage`）：不渲染（镜头静帧、站位图、预演、联系表、导演台放映）、不做穿模 / 接触自检、
   *    不进取景框（站位图按镜取景、取景提醒）、不参与越轴 / 接缝 / 动作提醒。导演台编辑时（不在放映）照样画出来，好选中。
   *  · `endFrameExclusive` —— 镜尾那一帧（k = 1，与下一镜开头是同一个故事时刻）不算正好在这一刻进场 / 离场的人：进场写在
   *    下一镜的入点、离场写在离场那一镜的入点，前一镜的结束站位图就不会多一个 / 少一个人。
   *  · 回包：`run-stills` / `run-shot-refs` 的 notes 每镜一句「镜 n：未出场：丙（S02 进场）」；`run-shot-refs` 的
   *    `shots[]` 那一镜有人不在场时带 `offstage:{start, end}`（两张站位图各自不在场的人物 id，按存储顺序）——站位图的颜色
   *    对照只列在场的人。read → apply 原样回写：`figure.offstage` 与 act 的 `do` 照存照读。
   *  · 没有 `offstage`、也没有 `do` 的场景行为与 0.18.1 逐像素一致。
   */
  presence: {
    figureField: "offstage",
    actField: "do",
    enter: "@enter",
    exit: "@offstage",
    enterFields: ["to", "facing"],
    notOnStage: ["render", "contact", "framing", "axis", "cuts", "motion"],
    endFrameExclusive: true,
  },
  /**
   * 接触检查的原话与改法（0.18.2，A102 ④）：拦下级的穿模（`body_penetration`）原话带**穿入深度**，坐着的人、调度帧里的
   * 穿模、陷进地板的家具给照抄就能发的 `fix`（一条 `scene3d_apply` 动作）。`read NODE`（含 `NODE/scene`、`NODE/checks`）、
   * apply 回包、`run-stills` / `run-shot-refs` 回包里的 `checks` 是同一份（同一份场景 → 同样的原话、同样的 fix）。
   *  · 深度 —— 人的骨段（骨盆→腰→颈→头、髋→膝→踝，与判拦同一几何）与实体的部件盒（家具按部件、收 2% 余量；圆柱按圆柱）
   *    沿分离方向的重叠量：每一对穿着的骨段 × 部件求最小分离距离，取最深的那一对；米，`depthDecimals` 位小数，写在「穿入
   *    <实体> 的<部件> 0.12 m」；舍成 0 的（不到 0.005 m）写「不足 0.01 m」，照样拦下（0.18.2 收尾，A105）。踝关节以下
   *    （脚掌）不在骨段里，所以站进 0.2 m 台子的人深度约 0.07 m（踝高约 0.12 m）。
   *  · `constants.SEAT_FACING_MAX_DEG` —— 坐着并绑了有正面的座面（chair / sofa / bed）的人，朝向（`facing` 或 rotation.y）
   *    与座面正面（座椅 rotation.y，正面 +z）差超过它、又穿进自己那件座椅时，原话点明「朝向偏离座面正面 N°」，`fix` 把座椅转到
   *    他的朝向（`{op:"transform", id:<座椅>, rotation:{y:<度>}}`）。座椅是导演的意图对象：只给建议，不自动转。
   *  · `constants.ACT_Y_MAX_M` —— 调度帧里才穿的（存储的站位不穿，走位把人带进去）：原话点名是哪条调度（id、几秒起、走到哪），
   *    走位终点 / 途经点落在被穿的东西上、那里的顶面不高于它（或那件是地板盒子 / platform / stairs）时，`fix` 给那条调度的
   *    `to` / `via` 写上顶面的 y（`{op:"update_act", id, to?, via?}`）；更高的（桌子、柜子）只说把终点挪出去，不给站上去的 y。
   *    进场那条（`presence.enter`）同样点名，写「进场，出现在 …」「落点」；开场不在、进场没写 to 的人出现在存储的站位上，
   *    原话点名那条进场、说是存储的站位穿（0.18.2 收尾，A105），站着穿模的建议站位只在他会出现在存储的站位上时给。
   *  · `floorSlab` —— 地板盒子：顶面水平（没转 x / z）的 box，`prefabs` 里的（floor）不论高矮，或 role 在 `plainRoles`、
   *    预制件缺省或在 `plainPrefabs`（platform）、高不超过 `plainMaxHeightM` 的。它的顶面算支撑面：站着的人脚底陷进它
   *    （不论多深）按它算 support_gap / 脚底贴面；家具、道具底面陷进它（中心在它上方）时修数据「落地」把底面落到它的顶面
   *    （repairs `grounded`），没自动修的报 `sunk_in_floor`（提醒，带抬高的 fix）；坐着的人腿穿进地板盒子、是因为他坐的那件
   *    陷进了地板时，穿模原话点明并给抬高那件座椅的 fix。顶面不低于 y = 0 的地板盒子埋一截在地下是有意的（顶面当地面）：
   *    不落地、不报 object_below_ground。
   *  · `fixes` —— `fix` 的四种写法（`target` 是 `id` 指的东西）：站着的人挪到最近的不穿模站位 / 贴到支撑面（0.18.0 起）、
   *    转座椅、抬家具、给调度写 y。
   */
  contact: {
    depthDecimals: 2,
    constants: { SEAT_FACING_MAX_DEG: 25, ACT_Y_MAX_M: 0.5 },
    floorSlab: {
      prefabs: ["floor"],
      plainRoles: ["set"],
      plainPrefabs: ["platform"],
      plainMaxHeightM: 0.3,
    },
    fixes: {
      standPosition: { op: "transform", fields: ["position"], target: "figure" },
      seatRotation: { op: "transform", fields: ["rotation"], target: "seat" },
      furnitureLift: { op: "transform", fields: ["position"], target: "furniture" },
      actY: { op: "update_act", fields: ["to", "via"], target: "act" },
    },
  },
  conflictCode: "scene3d_conflict",
  /**
   * `run-stills` 回包 `skipped[].reason`（0.16.2）：这几张没出 —— `budget` 总预算用完、`page_away` 画布页面离开
   * （这两种回包带 `remaining`：同一条命令再发一次接着出）、`cancelled` 被 `cancel` 打断或三维节点被删了、
   * `replaced` 站位图节点被人或 Agent 换过图（带 `nodeId`；`--force` 才连它一起重出、标记清掉，A71 修订）、
   * `up_to_date` 已有站位图节点而且出自当前场景（带 `nodeId`；续跑靠它只补没出的，`--force` 才重出）。
   */
  stillSkipReasons: ["budget", "cancelled", "page_away", "replaced", "up_to_date"],
  /**
   * `run-shot-refs`（0.18.0）每镜出的三样参考，也是出的顺序：开始站位图、结束站位图、预演（`epXX-PYY-SZZ运镜预演`）。
   * 回包 `shots[]` 每镜一行 `{shotId, n, start, end, previz, created, skipped, failed}`：`start` / `end` 是
   * `{nodeId, url}`、`previz` 是 `{nodeId, url, durationS}`（没出、也没有承接节点的是 null）；`created` 是这一次新建的那
   * 几样（原地刷新的不算）；`skipped[]` 是没出的那几样 `{part, reason, nodeId?}`（reason 取 `stillSkipReasons`）；
   * `failed[]` 是出了没成的 `{part, message}`。`remaining:[{shotId, part}]` 是被预算截断或页面离开、同一条命令再发
   * 一次会接着出的那几样。
   */
  shotRefParts: ["start", "end", "previz"],
  /**
   * 俯视站位图（0.18.0 起，A86 ② / A88 ③；0.18.1 拉近、固定 16:9，A96）：产品场景（`embedded`）的开始 / 结束站位图不按镜头
   * 机位取景，用一个四分之三俯视机位，只表达人物、道具的位置与远近（不是首尾帧、不带镜头机位）。
   *  · `camera` —— 「场景正面」：默认机位（`activeCameraId`，找不到取第一台）从它的看点往机位的水平方向（默认机位
   *    (0, 3, 8) 看 (0, 1, 0) 就是 +z）；没有机位、或机位竖直朝下时取 +z。机位从正面往观看者的右手边偏 `yawRightDeg`、
   *    俯角 `pitchDownDeg`、看这一镜取景框的中心，垂直视场角 `fovDeg`，按站位图画幅（`aspectRatio`）把框的 8 个角都收进
   *    画框（四边各留 `bounds.marginRatio`），取最近的距离；全员入画（见 `figureMarginRatio`）装不下时机位往后拉，并在
   *    画面平面里平移（看点跟着平移、方向不变）让全员上下左右居中。`directionPerScene`：同一场各镜方向一样（距离、看点可以不同）；
   *    `sharedPerShot`：同一镜开始与结束是同一个机位（两张之间可以直接比位置）。
   *  · `bounds` —— 取景框只框**本镜出场的人物 / 道具**（`subjects`：人物，与 role 为 prop、没有预制件的盒子 / 圆柱；家具 /
   *    布景照画、不参与取景框），取这一镜开始（k = 0）、结束（k = 1）两刻（`frames`）与子镜头各自的开始 / 结束
   *    （`cuts`）的并集：人物按骨架关节（含姿态、座面、前后倾、走位、调度表）外扩，道具按变换后的盒子（拿在手上的在手上）。
   *    「本镜出场」= 在这一镜自己的镜头机位里（场景画幅，开始 / 结束 / 子镜头边界与四分点）露进画框的，加上 look /
   *    lookTo / follow 点名的；一个都找不到就框本场全部人物 / 道具。横向（x / z）不足 `minSpanM` 的按中心撑到这么宽，
   *    竖向总包住地面。`excludeKinds` / `excludePrefabs`（墙、地面、背景板一类）只用来定地面网格的大小。
   *  · `figureMarginRatio` / `minFigureFraction` —— 先保证本镜出场的人物**全员完整入画**（含脚、含拿在手上的东西）：每个
   *    人偶的包围盒离画框四边至少画面高的 `figureMarginRatio`（5%），不许贴边、不许出画；在这个前提下沿同一方向尽量推近，
   *    让画面里最高的人偶（开始、结束两张各量）到画面高的 `minFigureFraction`（1/3）—— 这是目标、不是硬下限：人物分布太宽、
   *    推到 1/3 会有人贴边时全员入画优先，回包 notes 写「镜 n：本镜人物分布宽，人偶约占画面高 X%」（调度 2026-10-14 拍板）。
   *  · `aspectRatio` / `stillSize` / `previzSize` —— 站位图与产品场景的预演（`run --render video`、`run-shot-refs`）固定
   *    16:9，不跟场景画幅（视频节点仍按项目画幅）；导演台自己出的镜头机位静帧（`run --shots`）照旧按场景画幅。
   *  · `grid` —— 画地面网格（1 m 一格）；`labels` —— 不画任何名字标签：人偶与方块只用各自存储的 `color`。
   *  · `productDefault` —— 产品场景的 `run-stills`（与导演台给产品场景出站位图）缺省就用它；别的三维节点照旧按镜头机位。
   *  · `direction`（0.18.2，A100 修订 / A102 ⑨）—— 室内场被墙挡时**先换方向、再移机位、最后才剖墙**，整场选一次、每镜共用：
   *    ① 候选是默认方向（场景正面往右 `yawRightDeg`）起每 `stepDeg` 一档共 `candidates` 个，俯 `pitchDownDeg`，按离默认的
   *    角度从近到远试（同样近的两个，`openingPrefabs` 门 / 窗或没有遮挡物的敞开面那一侧先，再右侧先）；每镜照常取景，从
   *    机位向本镜出场的人物（开始、结束两刻的关节、头顶、脚底）与道具（盒心与 8 个角）各打一条视线，被遮挡物挡住的点占
   *    任一个人 / 道具的比例超过 `maxBlockedShare` 就算这一镜被挡；每一镜都不被挡的第一个方向就是本场的方向。遮挡物：
   *    `occluderPrefabs`（墙、门、窗、柱）或 role 在 `occluderRoles`、高超过 `occluderMinHeightM` 的盒子 / 圆柱 / 背景板
   *    （屏风、高柜、布景板、大尺寸显示墙；门窗按框画，框中间看得过去）。`screen` 是电视 / 显示器（`tv` / `monitor` 的
   *    别名，1.6 × 0.9 m）不是屏风，不在 `occluderPrefabs` 里：桌上的电视挡在机位前不换方向、不剖（0.18.2 收尾，A105）。
   *    ② 8 个方向都被挡：机位移进房间内侧——沿方向从取景框中心往外，到第一件遮挡物的足迹
   *    前 `insideMarginM` 为止（取景框外扩到不碰墙），俯角依次取 `insidePitchDeg`（最大 60°），每个俯角按同样的方向次序
   *    试，每一镜都框得下全员（`figureMarginRatio`）而且不被挡的第一个就用。③ 仍不行：保持默认方向，剖掉挡在机位前的
   *    遮挡物（`cutaway`：站位图里不画它们，那块像素是背景 / 地面网格；镜头机位静帧与预演不剖）。方向没换的（默认方向
   *    不被挡）与 0.18.1 逐像素相同；换了、移进室内或剖了墙，`run-stills` / `run-shot-refs` 回包 notes 写一句
   *    「本场俯视方向：…」（原因与结果）。
   */
  overview: {
    camera: {
      front: "activeCamera",
      fallbackFront: "+z",
      yawRightDeg: 30,
      pitchDownDeg: 45,
      fovDeg: 35,
      directionPerScene: true,
      sharedPerShot: true,
    },
    bounds: {
      frames: ["start", "end"],
      cuts: true,
      subjects: ["figure", "prop"],
      excludeKinds: ["plane", "backdrop"],
      excludePrefabs: ["wall", "floor", "door", "window", "pillar", "stairs", "platform"],
      marginRatio: 0.1,
      minSpanM: 3,
    },
    minFigureFraction: 1 / 3,
    figureMarginRatio: 0.05,
    aspectRatio: "16:9",
    stillSize: { width: 1920, height: 1080 },
    previzSize: { width: 1920, height: 1080 },
    grid: true,
    labels: false,
    productDefault: true,
    direction: {
      candidates: 8,
      stepDeg: 45,
      sharedPerScene: true,
      occluderPrefabs: ["wall", "door", "window", "pillar"],
      occluderRoles: ["set"],
      occluderMinHeightM: 1.2,
      maxBlockedShare: 0.25,
      openingPrefabs: ["door", "window"],
      insidePitchDeg: [45, 50, 55, 60],
      insideMarginM: 0.3,
    },
    cutaway: { mode: "hide", stationOnly: true },
  },
  /**
   * 产品场景的判定（0.16.4 进契约）：`kind` 是 `scene-3d`、id 合 `new RegExp(idPattern, idFlags)` 的节点是剧本转视频
   * 「一场一个」的建模数据（`s3d-ep01-P02`），每镜三样参考（两张站位图 + 预演）出自它。只看 id 与 kind，不看标题、标签。
   * 0.18.1 起（A95，推翻 0.16.4 的隐藏）它的卡片照常画、照常占位置（进框选、小地图、大纲），到它出的每张站位图 / 预演卡画
   * 一条不存储的归属虚线（按 `stillOf` / `previzOf` 推出，不是参考口连线、不进 graph.edges 与 mentionCandidates），卡片角上
   * 写「出自 <三维卡标题> · S01 开始」；这一场还缺站位图时大纲照旧列出它的导演台入口；站位图与预演卡的工具条都有「3D导演台」（预演卡停在那一镜开头）。
   * 判定只决定：站位图怎么取景（`overview`）、站位图与预演怎么落三联、`run` 不出它的静帧 / 联系表、`run-batch` 跳过它。
   * Agent 的 `ls` / `read` / `snapshot` 照常列出它。
   */
  embedded: { idPattern: "^s3d-ep[0-9]{2,4}-p[0-9]{2,4}$", idFlags: "i" },
  /**
   * 人物 / 道具的身份色（0.16.3 起页面就这样给没写 `color` 的对象上色，0.16.4 进契约）：同一个名字永远同一个颜色。
   *  · `colors` / `labels` —— 调色板与中文色名，按下标对应；顺序是算法的一部分。
   *  · `setColor` —— 布景（role `set`）一律这个灰。
   *  · `hash` —— 名字 → 下标：NFKC 规范化、去首尾空白、转小写，按码点做 32 位 FNV-1a，对颜色数取余。页面拿对象的
   *    `name`（`add_object` 没给就用 `prefab`），再没有用 `id`。
   *  · `defaultNames`（0.17.0）—— 没起名字的对象存的缺省名（按 kind）：存储里的 name 是它时不算名字、用 `id`
   *    （页面就是这样取的色；宿主只看存储的 name 会把几个「人物」算成同一个色，B12 复核）。
   * 实现就是 `./contract` 再导出的 `scene3dIdentityColor` / `scene3dColorLabel` / `allocateIdentityColors`，与
   * 拿存储的对象直接复算的 `scene3dObjectIdentity` / `scene3dDefaultColor`（0.17.0）。
   *  · 按集分色（0.18.0，A87 ④ / A88 ①）—— `namedColors` / `namedLabels`：可念的 12 个色（人物用），按分色先后排，前 8 个
   *    就是 `colors` 那 8 色；`propColors` / `propLabels`：道具统一的白 / 浅灰方块；`extrasColor` / `extrasLabel`：人物超过
   *    12 个时一次性群演共用的「灰色群演」。`scene3dColorLabel` 都念得出。产品用 `allocateEpisodeIdentityColors` 给一集分色、
   *    在 `add_object` 里显式写 `color`，`checkEpisodeIdentityColors` 查同一身份跨场同色；页面照存不改，没写 color 的对象
   *    仍按上面 8 色的名字算法上色（改它等于给所有老场景换色）。
   */
  identity: {
    colors: IDENTITY_PALETTE.map(([hex]) => hex),
    labels: IDENTITY_PALETTE.map(([, label]) => label),
    setColor: IDENTITY_SET_COLOR,
    hash: IDENTITY_HASH,
    defaultNames: IDENTITY_DEFAULT_NAMES,
    namedColors: IDENTITY_NAMED.map(([hex]) => hex),
    namedLabels: IDENTITY_NAMED.map(([, label]) => label),
    propColors: IDENTITY_PROP_COLORS.map(([hex]) => hex),
    propLabels: IDENTITY_PROP_COLORS.map(([, label]) => label),
    extrasColor: IDENTITY_EXTRAS[0],
    extrasLabel: IDENTITY_EXTRAS[1],
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
 * （`spec.mjs:27`），反过来再 import 一条就成环。所以 43 条子命令名在这里是手写的，
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
   * `frames` 同一档 —— 不改画布、不是生成扣费项、worker 也能发。下整段素材可能要很久，所以是 `long`。
   * **除 `--draft-root` 外只写 workspace**：`--draft-root` 直接写进用户机器上的剪映草稿目录（拍板 A6），
   * 另算一档（`flagTiers`）—— L1（写用户机器上的目录、不是生成扣费项；写进去的是新建的工程目录，不动别的，
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

  /* ── L1 可撤销的写：改画布文档，进 Agent 的撤销栈，不是生成扣费项 ── */
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
   * doc@1 文档库的写：原地改文档库（带 `--expect-version`），不是生成扣费项，只有 main 能发（worker 只读）。
   * 它**不进**画布的撤销栈，`undo` 撤不了：服务端每写一次留一个版本（历史都在），但回滚接口后续才提供
   * —— 今天退回只能拿改之前读到的旧文字再写一次。归 L1 是因为它是「不是生成扣费项、可再改回去」的写，不是
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

  /* ── L2 出图 / 生成，必须先拿到用户同意：多数一条 = 一次付费生成（本地出图的例外见 localKinds / billable） ── */
  run: {
    level: "L2",
    method: "run_node",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
    /**
     * 0.16.1：打在这些**节点 kind** 上的 `run` 在浏览器里本地渲染、不经网关、**不是生成扣费项**——宿主不向
     * 用户确认扣费（注意与 `run-tool.localKinds` 不同：那里是**工具 kind**）。档位不变：仍 L2、仍要
     * `--approved`（命令形状）、仍只有主会话能发。
     * 宿主怎么判：argv `run NODE` 看不出 kind，也不许按 `s3d-` 前缀猜 —— 先查自己的索引 / 最近一次
     * `read`、`ls --long` 的结果；都没有就先发一次 `read NODE`（L0），`nodes[0].kind` 在这里面就不问价。
     * `run-batch` 一批全是本地 kind 时不问价，混批只对非本地节点问。
     */
    localKinds: ["scene-3d"],
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
   * 0.16.2 —— 一场的站位图：三维节点逐镜出开始 / 结束两张静帧，每张落成一个独立图片节点（A67 ②）。
   * 沿用 Q4 留在 L2：要 `--approved`、只有 main 能发。`billable: false` 与下面 `run-tool.localKinds`
   * 同一个先例 —— 整条命令都在浏览器里渲染、不经网关、**不是生成扣费项**，宿主据此不向用户确认扣费；
   * `--approved` 是命令形状，不是付费同意。
   */
  "run-stills": {
    level: "L2",
    method: "run_stills",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
    billable: false,
  },
  /**
   * 0.18.0 —— 一场每镜三样参考（开始 / 结束站位图 + 预演）一条命令出齐：与 `run-stills` 同一档（L2、要 `--approved`、
   * 只有 main 能发、`billable: false` —— 整条在浏览器里渲染、不经网关、不是生成扣费项）。宿主写档的超时要够
   * `SCENE3D.limits.shotRefsCallMs`（255 s）。
   */
  "run-shot-refs": {
    level: "L2",
    method: "run_shot_refs",
    mutation: true,
    mainOnly: true,
    approval: true,
    timeoutTier: "wait",
    billable: false,
  },
  /**
   * `localKinds`：这些 kind 在浏览器里算完、不经网关、**不是生成扣费项**（= `LOCAL_TOOLS.kinds`，同一个数组）——
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
   * 一批 `apply` 里的 30 条命令各自的分级面。`workerAllowed` 是
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
    /**
     * 只在动作里含 `destructiveOps`（删对象 / 删镜头 / 删动作）时才让东西消失；其余动作都是可撤销的改动。0.18.0 起
     * `remove` / `remove_shot` 只在打到人在导演台改过的对象 / 镜头（`scene3d.humanEdit`）时要用户同意（页面不带 approval
     * 就整批 `approval_required`），没打标记的直接删、不必先问；`remove_act` 照旧先说给用户听。
     */
    scene3d_apply: {
      workerAllowed: true,
      destructive: true,
      destructiveOps: SCENE3D.destructiveOps,
    },
  },
};

export const CANVAS_CONTRACT = {
  /** 本契约随哪个包版本发布（= `package.json` 的 `version` = `cli.mjs` 的 `VERSION`，`test/pack.test.mjs` 三方对齐）。 */
  packageVersion: "0.18.3",
  layout: LAYOUT_POLICY,
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
  /** `run_tool` 的本地工具（不是生成扣费项）：kind 全集与各自 metadata 的上限 / 取值，见 `LOCAL_TOOLS`。 */
  localTools: LOCAL_TOOLS,
  /** scene3d@1 三维导演台：动作 op / 字段、词表、区间、上限、单位 token、digest 算法、自检常数与码，见 `SCENE3D`。 */
  scene3d: SCENE3D,
  /** 43 条 CLI 子命令 + 30 条 apply 命令各自的分级面，见 `TIERS`。 */
  tiers: TIERS,
  /** 宿主把回包压成文本时必须贴出的字段（逐字 / 可见两类），按命令登记，见 `host-text.mjs`。 */
  hostText: HOST_TEXT,
};
