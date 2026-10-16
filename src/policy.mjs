/** Shared by the authenticated daemon and browser. No Node or host APIs. */
export const PROTOCOL_VERSION = 2;

/**
 * 只读方法（分级表的 L0）：worker 也能调，不进撤销栈、不花钱。
 * 导出是因为「哪些命令是只读的」这件事有四份手抄在描述它（SKILL.md、commands.md、
 * 产品规则块、宿主的工具白名单）；从这里读就不会再漂。
 */
export const READ_METHODS = new Set([
  "list_canvases",
  "snapshot",
  // A5 —— 体检：只读、幂等，判定全在页面侧算。worker 也能调（读路径一律对 viewer 开放）。
  "health",
  "ls",
  "read",
  "grep",
  "resources",
  "model_catalog",
  "changes",
  "end_turn",
  "media_info",
  "media_chunk",
  "tasks",
  // F059-F —— 剪映工程导出（`export-jianying`）读整条时间线：每段带 src 与转场 / 字幕 / 音量。
  // 只读、不花钱，worker 也能调；`timeline`（含 list）仍然只有 main 能发 —— 这条只给导出用，
  // 没有任何写的形态。
  "timeline_export",
  // doc@1 —— 文档库的读（`docs ls` / `docs read`）：worker 也能调；写和删只有 main。
  "documents_list",
  "documents_get",
  // doc@1 —— 文件夹汇总（`docs ls --folders`、`docs read --folder` 找文件夹）：只读，worker 也能调。
  "documents_folders",
]);
/**
 * `tasks`（v3 §12）的参数面：只读、worker 也能调。字段名与页面侧
 * `AgentTasksRequest`（agent-bridge/types.ts）逐字一致；多给即报错，与 apply 命令同规矩。
 * `scope` 只放宽**列表**（project / all 把别的画布的任务列出来），别的命令对那些
 * 画布上的节点一律无效——那是页面桥按配对画布挡的，这里不用再挡。
 */
export const TASKS_FIELDS = ["scope", "nodeIds", "status", "submitter", "since", "limit", "after"];
/**
 * `health`（A5）的参数面。`maxIssues` 只截**明细表**，每一类的计数与判定范围
 * 永远是整张画布 —— 这一点由页面侧保证，这里只挡形状。
 */
export const HEALTH_FIELDS = ["maxIssues", "groupMinMembers"];
/**
 * `timeline` 的参数面：op 与全部字段（字段名与页面侧 `TimelineRequest` 逐字一致）。
 * 这里只挡「认不认识」；op ↔ 字段的搭配、取值范围、CAS 都在页面侧
 * （agent-bridge/timeline.ts 的 TIMELINE_SHAPE）判，一份表不抄两遍。
 */
export const TIMELINE_OPS = [
  "list",
  "set",
  "append",
  "remove",
  "reorder",
  "clear",
  "trim",
  "split",
  "cut",
  "restore",
];
export const TIMELINE_FIELDS = [
  "op",
  "baseRevision",
  // cut 必填；split / trim / restore 可选：上一次回包里的 layoutDigest（含裁剪；revision 不含）。
  "baseLayout",
  "clips",
  "index",
  "sort",
  "dedupeBySource",
  "episode",
  "clipIds",
  "order",
  "clipId",
  "inMs",
  "outMs",
  "reset",
  "atMs",
  "previousClips",
];
/** add_shot / update_shot 共用的镜头字段（`focal` / `focalTo` 是 `fov` / `fovTo` 的焦距写法）。 */
const SCENE3D_SHOT_FIELDS = [
  "n",
  "title",
  "framing",
  "dur",
  "pace",
  "beat",
  "lens",
  "intent",
  "cam",
  "look",
  "fov",
  "focal",
  "to",
  "lookTo",
  "fovTo",
  "focalTo",
  "moveEase",
  "orbit",
  "moves",
  "states",
  "cuts",
  "onAxis",
  // 0.17.0（动画）：故事入点、途经点、跟拍、抖动（取值与哪些还没实现由页面判）
  "start",
  "via",
  "follow",
  "shake",
];
/**
 * add_act / update_act 共用的调度动作字段（0.17.0；保留词 @keep / @none / @drop 由页面判）。0.18.2（A102 ⑧，在场模型）加
 * `do`：`"@enter"` 进场 / `"@offstage"` 离场（契约 `SCENE3D.presence`，取值与「进场那一条只收 to / facing」由页面判）。
 */
const SCENE3D_ACT_FIELDS = [
  "who",
  "at",
  "dur",
  "to",
  "via",
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
  "note",
  "do",
];
/**
 * scene3d@1 —— `scene3d_apply.actions[]` 每种 op 收的字段（不含 `op`）。页面侧的动作 reducer
 * （`apps/web/libs/canvas/scene-3d/actions.ts`，导演台与 Agent 共用）经 `contract.mjs` 的
 * `SCENE3D.ops` 读的就是这一份，字段名在仓里只有这一处。守护进程这里只挡「认不认识」：
 * 词表、区间、点的形状、依赖场景的校验都在页面侧判。
 */
export const SCENE3D_ACTION_FIELDS = {
  add_object: ["id", "role", "kind", "prefab", "name", "transform", "color", "bodyType"],
  // B14：`color` 换身份色（撞色提醒 identity_color_clash 给的改法）。
  transform: ["id", "position", "rotation", "scale", "color"],
  remove: ["id"],
  duplicate: ["id", "newId"],
  set_camera: ["id", "name", "position", "target", "fov", "focal", "active"],
  set_scene: ["aspectRatio", "gridSize"],
  set_figure: [
    "id",
    "pose",
    "arms",
    "armL",
    "armR",
    "facing",
    "gaze",
    "seat",
    "lean",
    "heldL",
    "heldR",
    "bodyType",
    // 0.18.2（A102 ⑧）：开场不在（true；false / null 清掉），契约 `SCENE3D.presence.figureField`。
    "offstage",
  ],
  set_axis: ["ends"],
  set_focus: ["id", "shape"],
  add_shot: ["id", ...SCENE3D_SHOT_FIELDS],
  // 可选字段给 null = 删掉（look / fov / n 除外，页面侧判）。
  update_shot: ["id", ...SCENE3D_SHOT_FIELDS],
  reorder_shots: ["order"],
  remove_shot: ["id"],
  add_act: ["id", ...SCENE3D_ACT_FIELDS],
  // 可选字段给 null = 删掉（与 update_shot 一致）；「放下 / 冻结朝向 / 回正」用保留词，不用 null。
  update_act: ["id", ...SCENE3D_ACT_FIELDS],
  remove_act: ["id"],
};
/**
 * `apply` 没给 `--label` 时 CLI 填的缺省标签。页面认得它：这一步在 `operations` 里改叫按命令推出的摘要
 * （`scene3d_apply ep01-茶馆：update_shot shot-2 等 2 个动作`，与 `undoneOps[].label` 同一份），不然每一行都叫
 * 这一句、分不出哪一步做了什么（B14 P3）。CLI 照旧填它：更早的页面要求 `label` 非空。
 */
export const CLI_APPLY_DEFAULT_LABEL = "CLI canvas edit";
/** 一条 `scene3d_apply` 最多几个动作（下界 1）。200 在包里只写在这里一处。 */
export const SCENE3D_ACTIONS_MAX = 200;
/**
 * 三维节点的静帧取镜头的哪一刻（0.16.2）：`start` = 镜头开头那一刻（k = 0，不带 frame 的 run --shot 出的就是它），
 * `end` = 走位与运镜都到位的那一刻（k = 1，与接缝检查取前镜结束帧同一套求值）。`run --frame`、
 * 节点的 `renderedFrame` 用它；契约的 `SCENE3D.enums.frame` 就是这一个数组。
 */
export const SCENE3D_STILL_FRAMES = ["start", "end"];
/**
 * `run_node` 的参数面：多给即报错，与 run_tool / tasks 同规矩 —— 拼错一个 `shotID` 页面只会
 * 当它没给，然后按第一镜出片。三维节点：`shotId`（CLI `run --shot`）/ `shotIds` / `allShots` 三选一
 * 挑镜头，`render` 挑产物（still | video | sheet），`sheetFrames` 是联系表格数（0.17.0），`frame`（CLI
 * `run --frame`，0.16.2）挑静帧取那一镜的开头还是镜尾。这里只挡形状（`frame` 另按 SCENE3D_STILL_FRAMES 挡
 * 词表，0.16.2 起如此）；依赖场景的判定（镜头存不存在、三选一、render 枚举、frame 只配静帧）在页面。
 */
export const RUN_NODE_FIELDS = [
  "nodeId",
  "approval",
  "clearCandidates",
  "shotId",
  "shotIds",
  "allShots",
  "render",
  "sheetFrames",
  "frame",
];
/** `run_node.shotIds` 最多几个（每个 1–128 字符、不重复）。 */
const RUN_NODE_SHOT_IDS_MAX = 60;
/**
 * `run_stills`（0.16.2，CLI `run-stills`）的参数面：一场的站位图逐张渲、每张落成一个独立图片节点。
 * `shotIds` 省略 = 全部镜头（按镜头表顺序），`frames` 省略 = 开头与镜尾两帧（`SCENE3D_STILL_FRAMES`）。
 * `force`（CLI `--force`，布尔）：缺省时已是最新的那几张（已有站位图节点、出自当前场景）与被人或 Agent 换过图的
 * 站位图（A71）不再出，续跑只补没出的；true 就全部重出，换过图的也原地盖掉、标记清掉（A71 修订：用户让智能体重出
 * 就是显式意图）。多给即报错；`approval` 必带（沿用 Q4：三维节点出图不花钱，`--approved` 是命令形状）。
 * 镜头在不在、一次多少张（`SCENE3D.limits.stillsPerRun`）由页面对着当前场景判。与 `run` 的按镜 s3i- 静帧卡
 * 并存（D-87）：站位图是给下游消费方的独立图片节点，镜头卡是按镜候选。
 */
export const RUN_STILLS_FIELDS = ["nodeId", "shotIds", "frames", "force", "approval"];
/** `run_stills.shotIds` 最多几个 —— 一场的镜头上限（契约 `SCENE3D.limits.shots`，契约测试钉住同一个数）。 */
export const RUN_STILLS_SHOTS_MAX = 60;
/**
 * `run_shot_refs`（0.18.0，CLI `run-shot-refs`）的参数面：一场每镜三样参考（开始站位图、结束站位图、预演）一条命令
 * 出齐 —— 每镜按序出开始 → 结束 → 预演，页面单渲染槽串行。`shotIds` 省略 = 全部镜头（按镜头表顺序，1..60 个、
 * 不重复，与 `run_stills` 同一个上限）；`force`（CLI `--force`，布尔）：缺省时已是最新的（sceneDigest + 画法版本）
 * 与被人或 Agent 换过的（站位图 A71、预演卡的视频）不再出，续跑只补没出的；true 就全部原地重出。没有选帧 / 选产物
 * 的参数：每镜三样都出（只要其中一样用 `run-stills` / `run --render video`）。多给即报错；`approval` 必带（同
 * `run_stills`：在浏览器里渲染、不是生成扣费项，`--approved` 是命令形状）。
 */
export const RUN_SHOT_REFS_FIELDS = ["nodeId", "shotIds", "force", "approval"];
/**
 * `run_shot_refs` 页面总预算的封顶（毫秒）：按镜数算（每镜两张站位图各 25 s + 预演 15 s + 每帧 250 ms），超过就封在
 * 这里 —— 与 `run --await` 的上限同一个数，整条命令约 255 s，低于两宿主写档的 300 s。到点时在渲的那一样中止，它与
 * 没开始的进回包（`budget`，列进 `remaining`，同一条命令再发一次接着出）。契约 `SCENE3D.limits.shotRefsBudgetMs`。
 */
export const RUN_SHOT_REFS_BUDGET_MS = 240000;
/**
 * 守护进程与 CLI 等 `run_shot_refs` 答复的时长（毫秒）：总预算封顶 + 15 s 收尾（停下在渲的那一样、把逐镜的部分回包
 * 送回来）。会话的 `callTimeoutMs`（缺省 120 s）比它短时，这一个方法放宽到它（`methodCallTimeoutMs`）。契约
 * `SCENE3D.limits.shotRefsCallMs`。
 */
export const RUN_SHOT_REFS_CALL_MS = RUN_SHOT_REFS_BUDGET_MS + 15000;
/**
 * 一条调用在守护进程（送达后的计时器）与 CLI 套接字上最多等多久：缺省就是会话的 `base`（callTimeoutMs）；
 * `run_shot_refs` 的页面预算按镜数算、能到 240 s，放宽到 `RUN_SHOT_REFS_CALL_MS`（会话本来就更长的不缩短）。
 */
export function methodCallTimeoutMs(method, base) {
  return method === "run_shot_refs" ? Math.max(base, RUN_SHOT_REFS_CALL_MS) : base;
}
/**
 * `run_nodes`（CLI `run-batch`）的参数面（0.17.0 起多给即报错）：批量里的三维节点按 `allShots + still`
 * 出，所以这里**不加**三维参数。
 */
export const RUN_NODES_FIELDS = [
  "nodeIds",
  "groupId",
  "concurrency",
  "rerunSucceeded",
  "clearCandidates",
  "approval",
];
/**
 * doc@1 —— 项目文档库（画布左栏「文档库」；CLI `docs ls / read / create / update / delete`）四个
 * 线协议方法的参数面。文档库是**唯一源数据**：没有本地镜像、没有同步，读就是读库，改就是带版本号
 * 原地改。字段名与页面侧 HTTP 接口 `/api/studio/projects/{projectId}/documents` 逐字一致：页面桥原样
 * 转发，服务端再按 `CANVAS_CONTRACT.documents` 做语义校验（栏、docType 取值、id 语法、各字段长度）。
 * 这里只挡「认不认识」与形状 —— 多给即报错，与 timeline / tasks 同规矩：拼错一个 `summery` 不能被
 * 静默丢掉，然后 Agent 以为摘要写上了。服务端校验直接 import 这几张表
 * （`apps/web/libs/documents/schema.ts`），字段名在仓里只有这一处。
 *
 * `documents_put` 带 `id` = 按这个 id 写（`expectVersion:0` 新建，否则原地更新）；不带 `id` =
 * 新建、由服务端按 doc@1 的规则起 id（此时 `expectVersion` 必须是 0）。
 */
export const DOCUMENTS_LIST_FIELDS = [
  "section",
  "docType",
  "episode",
  "folder",
  "q",
  "limit",
  "offset",
];
/** 单篇读：`id`；`ifVersion`（0.16.2）= 手上的版本，与当前版本相同时页面回 `notModified`、不传正文。 */
export const DOCUMENTS_GET_FIELDS = ["id", "ifVersion"];
/**
 * `documents_folders`（文件夹汇总：上传的小说一部一个文件夹）的参数面：只有 `section`（不给 = 两栏都列）。
 * 页面桥回 `{ok, items:[{section, name, id, count, updatedAt}]}`；`id` 是文件夹里文档共同的
 * `<docType>:<键>` 前缀（契约 `DOCUMENTS.folderIdPattern`），认不出来是 null。
 */
export const DOCUMENTS_FOLDERS_FIELDS = ["section"];
export const DOCUMENTS_PUT_FIELDS = [
  "id",
  "expectVersion",
  "section",
  "folder",
  "docType",
  "series",
  "episode",
  "scene",
  "title",
  "format",
  "content",
  "sourceAgent",
  "source",
  "assetTags",
  "derivedFrom",
  "summary",
];
/** 软删一份文档：`approval` 必带（`{ userApprovedDocumentIds: [id] }`），`expectVersion` 可选。 */
export const DOCUMENTS_DELETE_FIELDS = ["id", "expectVersion", "approval"];
/**
 * 文档 id 的字符上限。20 不是随手定的：文档复制到画布的副本节点带标签 `doc:<id>@<version>`，
 * 而节点标签一条最多 30 字（`LIMITS["update_node.draft.assetTags"].itemMaxLength`）——
 * 4（`doc:`）+ 20 + 1（`@`）+ 5 位版本号正好 30。id 再长，副本的来源标签就放不下了。
 * （复制到画布的两个入口 0.16.2 / A68 起关着，上限照旧按它定。）
 */
export const DOCUMENT_ID_MAX_LENGTH = 20;
/**
 * 正文上限，按 JS 字符串长度（UTF-16 码元）计：守护进程、页面、服务端同一个数。0.16.2 起 5 万字（A66 / A68：
 * 正文存成 CDN 文件，一篇一个文件；之前是 100 万字 —— 钉着旧版本的产品本地预检与它的守护进程照旧放行，超过 5 万字的
 * 由页面侧的这一道（页面跑的是新版 policy）先拒掉，到不了服务端）。超了是 `too_large`，带 `chars`（这次的长度，换行
 * 统一 LF 之后数）与 `limitChars`：CLI 发出去之前、守护进程、页面、服务端（HTTP 413）同一个码、同一组字段。
 */
export const DOCUMENT_CONTENT_MAX_CHARS = 50000;
/** `documents_list` 一页最多几份（`limit` 的上界；缺省 50）。 */
export const DOCUMENTS_LIST_MAX_LIMIT = 200;
const TASKS_SCOPES = ["canvas", "project", "all"];
const TASKS_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"];
const TASKS_SUBMITTERS = ["me", "agent", "human"];
/**
 * 只有 main 能调的方法（分级表的 `mainOnly`）：worker 发它们一律 `worker_forbidden`。
 * 与 `READ_METHODS` 同理导出 —— `contract.mjs` 的 `tiers` 正是拿它对齐的。
 */
export const MAIN_METHODS = new Set([
  "cancel_batch",
  "run_node",
  "run_nodes",
  "run_tool",
  // 0.16.2 —— 一场的站位图（`run-stills`）：和 run_node 一样只有主会话能发。
  "run_stills",
  // 0.18.0 —— 一场每镜三样参考一条命令出齐（`run-shot-refs`）：同上。
  "run_shot_refs",
  "cancel_node",
  "undo",
  "redo",
  "operations",
  "timeline",
  // doc@1 —— 文档库的写（`docs create` / `docs update`）与删（`docs delete`）：worker 只读。
  "documents_put",
  "documents_delete",
  // 剪映草稿目录（拍板 A6）：用户登记的那 5 条本机路径。读（`jianying-roots`）也只许 main ——
  // 那是用户机器上的目录，直写它是主会话的事，子代理不能查、不能导；记住一条（`export-jianying
  // --draft-root` 导出成功之后）是写。
  "jianying_roots_list",
  "jianying_roots_touch",
]);
/**
 * `jianying_roots_touch`（记住一条剪映草稿目录）的参数面：多给即报错。`path` 必填、≤ 400 字，
 * `label` 可选、≤ 40 字 —— 与页面侧 `@libs/jianying/draft-roots` 的 `MAX_DRAFT_ROOT_PATH_LENGTH` /
 * `MAX_DRAFT_ROOT_LABEL_LENGTH` 同一个数（policy 不 import 页面代码）；绝对路径、去重、挤掉最久没用的
 * 由服务端按那一份纯函数判。`jianying_roots_list` 没有参数。
 */
export const JIANYING_ROOTS_TOUCH_FIELDS = ["path", "label"];
/**
 * `run_tool` 的参数面。工具 = 节点工具条上的次级操作（人声分离 / 超清 / 抠图 / 重绘…），
 * 页面侧按 `kind` 去 `libs/canvas/tools` 的注册表查 `ToolSpec` 再提交。
 *
 * **它和 `run_node` 一样花钱**，所以同样强制 `approval`：这里不因为「只是个工具」就放松。
 * `kind` 的合法取值**故意不在这里枚举** —— 那张表在页面侧（三套注册表：视频/音频 aux、
 * 图片编辑、以及主生成），包这一层再抄一份必然漂移；认不出的 kind 由页面回
 * `tool_not_found` 并附上可用清单。这一层只挡形状。
 */
export const RUN_TOOL_FIELDS = [
  "nodeId",
  "kind",
  "prompt",
  "resolution",
  "aspectRatio",
  "metadata",
  "title",
  "approval",
];
/** Exported so `contract.mjs` can build its command table from THIS object: the
 *  list the daemon rejects extra fields against and the list the package
 *  publishes are then the same one, and cannot drift. */
export const COMMAND_FIELDS = {
  add_node: ["id", "kind", "position", "title", "draft"],
  update_node: ["nodeId", "title", "draft", "expect"],
  edit_text: ["nodeId", "field", "oldString", "newString", "replaceAll"],
  move_node: ["nodeId", "position"],
  connect: ["source", "target", "targetHandle"],
  disconnect: ["edgeId"],
  delete_node: ["nodeId"],
  group_nodes: ["nodeIds", "title", "id"],
  ungroup: ["groupId"],
  set_viewport: ["viewport"],
  arrange: ["nodeIds", "layout", "gap", "columns", "anchor"],
  align: ["nodeIds", "mode", "gap"],
  tidy: ["nodeIds", "groupIds", "scope", "fitFrames"],
  resize_group: ["nodeId", "size", "fit", "absorbStrays"],
  duplicate_node: ["nodeId", "count", "position", "layout"],
  select_output: ["nodeId", "outputId", "expectOutputId"],
  delete_output: ["nodeId", "outputId", "expectOutputId"],
  split_output: ["nodeId", "outputId", "position"],
  clear_output: ["nodeId"],
  reset_status: ["nodeId"],
  add_to_group: ["groupId", "nodeIds"],
  remove_from_group: ["nodeId"],
  duplicate_nodes: ["nodeIds", "offset"],
  recover_deleted: ["nodeIds"],
  select: ["nodeIds"],
  adopt_output: ["nodeId", "url"],
  focus_node: ["nodeId", "nodeIds", "all", "fill"],
  upload_asset: [
    "path",
    "fileName",
    "mimeType",
    "bytesBase64",
    "position",
    "title",
    "id",
    "targetNodeId",
  ],
  export_output: ["nodeId", "path", "resourceId"],
  // scene3d@1：动作各自的字段在 SCENE3D_ACTION_FIELDS。
  scene3d_apply: ["nodeId", "baseDigest", "actions"],
};
/**
 * worker 连**嵌在 apply 批里**都不能发的 apply 命令。两类：越出画布的（一条把本地
 * 文件搬上来，一条把结果写下去），和按主会话处理的删除 / 恢复类（删一条候选、清空
 * 一个节点的全部产出、把「最近删除」里的东西放回画布 —— 这些都是用户要先知道的事，
 * 由主会话去问）。`tiers.applyCommands[*].workerAllowed` 就是它的取反。
 */
export const WORKER_BLOCKED_COMMANDS = new Set([
  "upload_asset",
  "export_output",
  "delete_output",
  "clear_output",
  "recover_deleted",
]);
const RESERVED = [
  "role",
  "actor",
  "scope",
  "canvasId",
  "projectId",
  "agentId",
  "turnId",
  "sessionId",
  "parentSessionId",
];

export class RequestPolicyError extends Error {
  /** `extra`：错误载荷里 code / message 之外的字段（`too_large` 的 `chars` / `limitChars`），平铺进 `toError()`。 */
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
  toError() {
    return { code: this.code, message: this.message, ...this.extra };
  }
}
const fail = (code, message, extra) => {
  throw new RequestPolicyError(code, message, extra);
};
function object(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function checkNestedCommandData(value, role, depth = 0) {
  if (depth > 40) fail("invalid_request", "Command nesting exceeds 40 levels");
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) checkNestedCommandData(item, role, depth + 1);
    return;
  }
  if (!object(value)) fail("invalid_request", "Command data must be plain JSON");
  if (role === "worker" && WORKER_BLOCKED_COMMANDS.has(value.type)) {
    fail(
      "worker_forbidden",
      `Delegated workers cannot embed ${[...WORKER_BLOCKED_COMMANDS].join(" / ")} commands`,
    );
  }
  for (const [key, item] of Object.entries(value)) {
    if (["commands", "__proto__", "prototype", "constructor"].includes(key)) {
      fail("invalid_request", `Nested or unsafe command field: ${key}`);
    }
    checkNestedCommandData(item, role, depth + 1);
  }
}

const DOCUMENT_TEXT_MAX = 1000;
/**
 * doc@1 四个方法的形状：多给即报错、类型对、长度不离谱。语义（栏 / docType 取值、id 语法、
 * 各字段的精确上限）由服务端按 `CANVAS_CONTRACT.documents` 判 —— 包这一层只挡「明显不是这个
 * 形状」的请求，免得一个 36 MiB 的错字段走到页面才被拒。worker 能不能调在上面按
 * READ_METHODS / MAIN_METHODS 判过了。参数错误都带 `path`（错在哪个字段），与服务端的 400、
 * CLI 自己的本地检查同一个口径。
 */
function checkDocumentsParams(method, params) {
  const invalid = (path, message) => fail("invalid_request", message, { path });
  const fields = {
    documents_list: DOCUMENTS_LIST_FIELDS,
    documents_get: DOCUMENTS_GET_FIELDS,
    documents_folders: DOCUMENTS_FOLDERS_FIELDS,
    documents_put: DOCUMENTS_PUT_FIELDS,
    documents_delete: DOCUMENTS_DELETE_FIELDS,
  }[method];
  if (!fields) fail("method_not_allowed", "Unknown canvas method");
  for (const key of Object.keys(params))
    if (!fields.includes(key)) invalid(key, `Unexpected ${method} field: ${key}`);
  const id = params.id;
  const idOk = typeof id === "string" && id !== "" && id.length <= DOCUMENT_ID_MAX_LENGTH;
  if ((method === "documents_get" || method === "documents_delete") && !idOk)
    invalid("id", `${method} requires id (at most ${DOCUMENT_ID_MAX_LENGTH} characters)`);
  if (method === "documents_put" && id !== undefined && !idOk)
    invalid("id", `id must be a document id of at most ${DOCUMENT_ID_MAX_LENGTH} characters`);
  const integer = (key, min, max = Number.MAX_SAFE_INTEGER) => {
    const value = params[key];
    if (
      value !== undefined &&
      value !== null &&
      (!Number.isInteger(value) || value < min || value > max)
    )
      invalid(key, `${key} must be an integer between ${min} and ${max}`);
  };
  integer("episode", 0, 9999);
  integer("offset", 0);
  integer("limit", 1, DOCUMENTS_LIST_MAX_LIMIT);
  integer("expectVersion", 0);
  // documents_get：手上的版本（0.16.2，`docs read --if-version`）。与当前版本相同，页面回 notModified、不传正文。
  integer("ifVersion", 1);
  if (params.ifVersion === null) invalid("ifVersion", "ifVersion must be an integer");
  if (params.episode === null && method === "documents_list")
    invalid("episode", "episode must be an integer");
  if (method === "documents_put") {
    if (!Number.isInteger(params.expectVersion))
      invalid("expectVersion", "documents_put requires expectVersion (0 creates a document)");
    if (id === undefined && params.expectVersion !== 0)
      invalid(
        "expectVersion",
        "documents_put without id creates a document: expectVersion must be 0",
      );
    // 上限按换行统一成 LF 之后的长度计（`\r\n` / 单独的 `\r` 算一个字符），与服务端存的形态同一个口径。
    // 超了是 too_large（带 chars / limitChars），与服务端的 413 同一个码：产品据此拆篇，不是改请求的写法。
    if (params.content !== undefined) {
      if (typeof params.content !== "string")
        invalid(
          "content",
          `content must be a string of at most ${DOCUMENT_CONTENT_MAX_CHARS} characters`,
        );
      const chars = params.content.replace(/\r\n?/g, "\n").length;
      if (chars > DOCUMENT_CONTENT_MAX_CHARS)
        fail(
          "too_large",
          `content is ${chars} characters; one document holds at most ${DOCUMENT_CONTENT_MAX_CHARS}. Split it into several documents (for example one per episode), each under the limit`,
          { chars, limitChars: DOCUMENT_CONTENT_MAX_CHARS },
        );
    }
    if (
      params.assetTags !== undefined &&
      params.assetTags !== null &&
      (!Array.isArray(params.assetTags) ||
        params.assetTags.length > 100 ||
        params.assetTags.some((tag) => typeof tag !== "string" || tag.length > DOCUMENT_TEXT_MAX))
    )
      invalid("assetTags", "assetTags must be an array of at most 100 strings");
  }
  for (const key of [
    "section",
    "docType",
    "folder",
    "q",
    "series",
    "scene",
    "title",
    "format",
    "sourceAgent",
    "source",
    "derivedFrom",
    "summary",
  ]) {
    const value = params[key];
    if (value === undefined || (value === null && method === "documents_put")) continue;
    if (typeof value !== "string" || value.length > DOCUMENT_TEXT_MAX)
      invalid(key, `${key} must be a string of at most ${DOCUMENT_TEXT_MAX} characters`);
  }
  if (method === "documents_delete") {
    // 删除要用户点头：approval 必须点名这一篇（与 run / apply --approved 同一个语义 —— Agent 声明
    // 它**已经**从用户那里拿到的授权，不是给自己开的票）。
    const approval = params.approval;
    if (
      !object(approval) ||
      Object.keys(approval).some((key) => key !== "userApprovedDocumentIds") ||
      !Array.isArray(approval.userApprovedDocumentIds) ||
      approval.userApprovedDocumentIds.length !== 1 ||
      approval.userApprovedDocumentIds[0] !== id
    )
      fail(
        "approval_required",
        "documents_delete requires approval.userApprovedDocumentIds naming this document after the user agreed to delete it",
      );
  }
}

/** Role comes from daemon authentication, never from caller-controlled params.
 * Approval is the Agent's declaration of already-granted user authorization;
 * it is not a cryptographic proof that a separate confirmation UI was used. */
export function enforceRequestPolicy(role, method, params) {
  if (role !== "main" && role !== "worker")
    fail("invalid_role", "Expected an authenticated main or worker role");
  if (!object(params)) fail("invalid_request", "params must be a plain object");
  for (const key of RESERVED) {
    // `tasks.scope` 是三个字面量之一（canvas / project / all），只放宽只读列表的范围，
    // 与被保留的身份字段 `scope`（宿主注入的作用域对象）同名不同物；它的取值在下面校。
    if (key === "scope" && method === "tasks") continue;
    if (Object.hasOwn(params, key))
      fail("invalid_request", `${key} is controlled by the authenticated session`);
  }
  if (!READ_METHODS.has(method) && !MAIN_METHODS.has(method) && method !== "apply") {
    fail("method_not_allowed", "Unknown canvas method");
  }
  if (role === "worker" && MAIN_METHODS.has(method)) {
    fail(
      "worker_forbidden",
      `Delegated workers cannot call ${method}; ask the parent Agent to perform it`,
    );
  }
  if (
    method !== "run_node" &&
    method !== "run_nodes" &&
    method !== "run_tool" &&
    method !== "run_stills" &&
    method !== "run_shot_refs" &&
    Object.hasOwn(params, "approval") &&
    method !== "apply" &&
    method !== "documents_delete"
  ) {
    fail(
      "invalid_request",
      "approval is only accepted for run_node / run_nodes / run_tool / run_stills / run_shot_refs, a bulk-delete apply and documents_delete",
    );
  }
  if (method.startsWith("documents_")) checkDocumentsParams(method, params);
  if (method === "apply" && Object.hasOwn(params, "approval")) {
    // 批量删除的同意（超过 5 个节点或含组，页面按界面删除确认的门槛判定），以及 0.18.0 起删人在导演台改过的
    // 三维对象 / 镜头的同意（列那个三维节点）。**可选**：小删除、没打人改标记的删除不需要它，所以它不进 tiers 的
    // approval 档。worker 不能替用户点这个头 —— 删除类按主会话处理。
    if (role === "worker")
      fail(
        "worker_forbidden",
        "Delegated workers cannot approve a bulk delete; ask the parent Agent",
      );
    const approval = params.approval;
    if (
      !object(approval) ||
      Object.keys(approval).some((key) => key !== "userApprovedNodeIds") ||
      !Array.isArray(approval.userApprovedNodeIds) ||
      approval.userApprovedNodeIds.length < 1 ||
      approval.userApprovedNodeIds.length > 1000 ||
      approval.userApprovedNodeIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 1024,
      )
    )
      fail(
        "invalid_request",
        "apply approval must be { userApprovedNodeIds: [...] } naming every delete_node target and every scene3d_apply node whose removals need it",
      );
  }
  if (method === "run_nodes") {
    // 守护进程只能校 nodeIds 那一半（groupId 要页面展开）；approval 本身的形状与
    // 「每个 nodeId 都在清单里」在这里挡，展开后的全量清单页面再校一次。
    const approval = params.approval;
    const nodeIds = params.nodeIds;
    const hasGroup = typeof params.groupId === "string" && params.groupId.trim().length > 0;
    const hasNodes = Array.isArray(nodeIds) && nodeIds.length > 0;
    if (!hasGroup && !hasNodes)
      fail("invalid_request", "run_nodes requires nodeIds and/or groupId");
    if (
      hasNodes &&
      (nodeIds.length > 1000 ||
        nodeIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 1024))
    )
      fail("invalid_request", "nodeIds must be 1..1000 non-empty strings");
    if (
      params.concurrency !== undefined &&
      (!Number.isInteger(params.concurrency) || params.concurrency < 1 || params.concurrency > 200)
    )
      fail("invalid_request", "concurrency must be an integer between 1 and 200");
    if (params.rerunSucceeded !== undefined && typeof params.rerunSucceeded !== "boolean")
      fail("invalid_request", "rerunSucceeded must be a boolean");
    if (params.clearCandidates !== undefined && typeof params.clearCandidates !== "boolean")
      fail("invalid_request", "clearCandidates must be a boolean");
    if (
      !object(approval) ||
      Object.keys(approval).some((key) => key !== "userApprovedNodeIds") ||
      !Array.isArray(approval.userApprovedNodeIds) ||
      approval.userApprovedNodeIds.length < 1 ||
      approval.userApprovedNodeIds.length > 1000 ||
      approval.userApprovedNodeIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 1024,
      ) ||
      (hasNodes && nodeIds.some((id) => !approval.userApprovedNodeIds.includes(id)))
    ) {
      fail(
        "approval_required",
        "run_nodes requires approval.userApprovedNodeIds explicitly containing every target node ID after user authorization",
      );
    }
    // 白名单排在 approval 之后（与 run_node 同理）：三维参数打在批量上不能被静默丢掉。
    for (const key of Object.keys(params))
      if (!RUN_NODES_FIELDS.includes(key))
        fail("invalid_request", `Unexpected run_nodes field: ${key}`);
  }
  if (method === "run_node") {
    if (params.clearCandidates !== undefined && typeof params.clearCandidates !== "boolean")
      fail("invalid_request", "clearCandidates must be a boolean");
    const approval = params.approval;
    if (
      !object(approval) ||
      Object.keys(approval).some((key) => key !== "userApprovedNodeIds") ||
      !Array.isArray(approval.userApprovedNodeIds) ||
      approval.userApprovedNodeIds.length < 1 ||
      approval.userApprovedNodeIds.length > 1000 ||
      approval.userApprovedNodeIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 1024,
      ) ||
      typeof params.nodeId !== "string" ||
      !approval.userApprovedNodeIds.includes(params.nodeId)
    ) {
      fail(
        "approval_required",
        "run_node requires approval.userApprovedNodeIds explicitly containing the target node ID after user authorization",
      );
    }
    // 字段白名单排在 approval 之后：缺 / 错 approval 一律先答 approval_required（PROTOCOL 的承诺），
    // `{nodeId, approved:true}` 这种错写不能变成一句「Unexpected run_node field: approved」。
    for (const key of Object.keys(params))
      if (!RUN_NODE_FIELDS.includes(key))
        fail("invalid_request", `Unexpected run_node field: ${key}`);
    if (
      params.shotId !== undefined &&
      (typeof params.shotId !== "string" || !params.shotId.trim() || params.shotId.length > 128)
    )
      fail("invalid_request", "shotId must be a non-empty string of at most 128 characters");
    if (
      params.shotIds !== undefined &&
      (!Array.isArray(params.shotIds) ||
        params.shotIds.length < 1 ||
        params.shotIds.length > RUN_NODE_SHOT_IDS_MAX ||
        params.shotIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 128) ||
        new Set(params.shotIds).size !== params.shotIds.length)
    )
      fail(
        "invalid_request",
        `shotIds must be 1..${RUN_NODE_SHOT_IDS_MAX} distinct non-empty strings of at most 128 characters`,
      );
    if (params.allShots !== undefined && params.allShots !== true)
      fail("invalid_request", "allShots must be true when given");
    if (params.render !== undefined && typeof params.render !== "string")
      fail("invalid_request", "render must be a string");
    if (params.sheetFrames !== undefined && !Number.isInteger(params.sheetFrames))
      fail("invalid_request", "sheetFrames must be an integer");
    if (params.frame !== undefined && !SCENE3D_STILL_FRAMES.includes(params.frame))
      fail("invalid_request", `frame must be ${SCENE3D_STILL_FRAMES.join(" or ")}`);
  }
  if (method === "run_stills") {
    // 与 run_node 同一道闸、同一个顺序：缺 / 错 approval 先答 approval_required，再按字段表与形状拒。
    const approval = params.approval;
    if (
      !object(approval) ||
      Object.keys(approval).some((key) => key !== "userApprovedNodeIds") ||
      !Array.isArray(approval.userApprovedNodeIds) ||
      approval.userApprovedNodeIds.length < 1 ||
      approval.userApprovedNodeIds.length > 1000 ||
      approval.userApprovedNodeIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 1024,
      ) ||
      typeof params.nodeId !== "string" ||
      !approval.userApprovedNodeIds.includes(params.nodeId)
    ) {
      fail(
        "approval_required",
        "run_stills requires approval.userApprovedNodeIds explicitly containing the target node ID after user authorization",
      );
    }
    for (const key of Object.keys(params))
      if (!RUN_STILLS_FIELDS.includes(key))
        fail("invalid_request", `Unexpected run_stills field: ${key}`);
    if (!params.nodeId.trim() || params.nodeId.length > 1024)
      fail("invalid_request", "run_stills requires nodeId");
    const shotIds = params.shotIds;
    if (shotIds !== undefined) {
      if (
        !Array.isArray(shotIds) ||
        shotIds.length < 1 ||
        shotIds.length > RUN_STILLS_SHOTS_MAX ||
        shotIds.some(
          (shotId) => typeof shotId !== "string" || !shotId.trim() || shotId.length > 128,
        )
      )
        fail(
          "invalid_request",
          `shotIds must be 1..${RUN_STILLS_SHOTS_MAX} non-empty strings of at most 128 characters`,
        );
      if (new Set(shotIds).size !== shotIds.length)
        fail("invalid_request", "shotIds must not repeat a shot");
    }
    const frames = params.frames;
    if (
      frames !== undefined &&
      (!Array.isArray(frames) ||
        frames.length < 1 ||
        frames.length > SCENE3D_STILL_FRAMES.length ||
        frames.some((frame) => !SCENE3D_STILL_FRAMES.includes(frame)) ||
        new Set(frames).size !== frames.length)
    )
      fail(
        "invalid_request",
        `frames must be 1..${SCENE3D_STILL_FRAMES.length} of ${SCENE3D_STILL_FRAMES.join(", ")}, without repeats`,
      );
    if (params.force !== undefined && typeof params.force !== "boolean")
      fail("invalid_request", "force must be a boolean");
  }
  if (method === "run_shot_refs") {
    // 与 run_stills 同一道闸、同一个顺序：缺 / 错 approval 先答 approval_required，再按字段表与形状拒。
    const approval = params.approval;
    if (
      !object(approval) ||
      Object.keys(approval).some((key) => key !== "userApprovedNodeIds") ||
      !Array.isArray(approval.userApprovedNodeIds) ||
      approval.userApprovedNodeIds.length < 1 ||
      approval.userApprovedNodeIds.length > 1000 ||
      approval.userApprovedNodeIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 1024,
      ) ||
      typeof params.nodeId !== "string" ||
      !approval.userApprovedNodeIds.includes(params.nodeId)
    ) {
      fail(
        "approval_required",
        "run_shot_refs requires approval.userApprovedNodeIds explicitly containing the target node ID after user authorization",
      );
    }
    for (const key of Object.keys(params))
      if (!RUN_SHOT_REFS_FIELDS.includes(key))
        fail("invalid_request", `Unexpected run_shot_refs field: ${key}`);
    if (!params.nodeId.trim() || params.nodeId.length > 1024)
      fail("invalid_request", "run_shot_refs requires nodeId");
    const shotIds = params.shotIds;
    if (shotIds !== undefined) {
      if (
        !Array.isArray(shotIds) ||
        shotIds.length < 1 ||
        shotIds.length > RUN_STILLS_SHOTS_MAX ||
        shotIds.some(
          (shotId) => typeof shotId !== "string" || !shotId.trim() || shotId.length > 128,
        )
      )
        fail(
          "invalid_request",
          `shotIds must be 1..${RUN_STILLS_SHOTS_MAX} non-empty strings of at most 128 characters`,
        );
      if (new Set(shotIds).size !== shotIds.length)
        fail("invalid_request", "shotIds must not repeat a shot");
    }
    if (params.force !== undefined && typeof params.force !== "boolean")
      fail("invalid_request", "force must be a boolean");
  }
  if (method === "run_tool") {
    // 字段面「多给即报错」，和 health / tasks 同规矩：静默丢弃一个参数意味着 Agent
    // 以为自己传了 prompt、实际跑的是没有 prompt 的那一版，然后为一次错误的生成付了钱。
    for (const key of Object.keys(params))
      if (!RUN_TOOL_FIELDS.includes(key))
        fail("invalid_request", `Unexpected run_tool field: ${key}`);
    if (typeof params.nodeId !== "string" || !params.nodeId.trim())
      fail("invalid_request", "run_tool requires nodeId");
    if (typeof params.kind !== "string" || !params.kind.trim())
      fail("invalid_request", "run_tool requires kind (the toolbar tool id, e.g. separate-vocal)");
    if (params.kind.length > 128) fail("invalid_request", "kind is too long");
    if (params.title !== undefined) {
      if (typeof params.title !== "string" || !params.title.trim())
        fail("invalid_request", "title must be a non-empty string");
      if (params.title.length > 200) fail("invalid_request", "title is too long");
    }
    for (const key of ["prompt", "resolution", "aspectRatio"]) {
      if (params[key] === undefined) continue;
      if (typeof params[key] !== "string") fail("invalid_request", `${key} must be a string`);
      if (params[key].length > 4000) fail("invalid_request", `${key} is too long`);
    }
    if (params.metadata !== undefined) {
      // 模型声明的参数（光照角度、旋转角度 …）：这里只挡「是个平面 JSON 对象」，
      // 取值按页面侧的模型 schema 校（那才是真相源，包这一层抄一份必然漂）。
      if (!object(params.metadata)) fail("invalid_request", "metadata must be a plain object");
      if (Object.keys(params.metadata).length > 64)
        fail("invalid_request", "metadata has too many keys");
      checkNestedCommandData(params.metadata, role);
    }
    const approval = params.approval;
    if (
      !object(approval) ||
      Object.keys(approval).some((key) => key !== "userApprovedNodeIds") ||
      !Array.isArray(approval.userApprovedNodeIds) ||
      approval.userApprovedNodeIds.length < 1 ||
      approval.userApprovedNodeIds.length > 1000 ||
      approval.userApprovedNodeIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 1024,
      ) ||
      !approval.userApprovedNodeIds.includes(params.nodeId)
    ) {
      fail(
        "approval_required",
        "run_tool requires approval.userApprovedNodeIds explicitly containing the target node ID after user authorization",
      );
    }
  }
  if (method === "jianying_roots_list") {
    // 查的是会话这个用户自己登记的那几条，没有任何参数：多给即报错。
    for (const key of Object.keys(params))
      fail("invalid_request", `Unexpected jianying_roots_list field: ${key}`);
  }
  if (method === "jianying_roots_touch") {
    for (const key of Object.keys(params))
      if (!JIANYING_ROOTS_TOUCH_FIELDS.includes(key))
        fail("invalid_request", `Unexpected jianying_roots_touch field: ${key}`);
    if (typeof params.path !== "string" || !params.path.trim() || params.path.length > 400)
      fail(
        "invalid_request",
        "jianying_roots_touch requires path (an absolute path, at most 400 characters)",
      );
    if (
      params.label !== undefined &&
      (typeof params.label !== "string" || params.label.length > 40)
    )
      fail("invalid_request", "label must be a string of at most 40 characters");
  }
  if (method === "timeline_export") {
    // 作用域（哪张画布）由已认证的会话决定，这个方法本身没有参数。多给即报错，与 health /
    // tasks 同规矩：静默丢弃一个参数意味着调用方以为自己筛了某一集、实际拿回整条轨道。
    for (const key of Object.keys(params))
      fail("invalid_request", `Unexpected timeline_export field: ${key}`);
  }
  if (method === "health") {
    // 只读命令，但字段面同样「多给即报错」：静默丢弃一个参数意味着 Agent 以为自己
    // 把明细表调大了、实际拿回默认的 100 条，然后照着半张表下结论。
    for (const key of Object.keys(params))
      if (!HEALTH_FIELDS.includes(key)) fail("invalid_request", `Unexpected health field: ${key}`);
    if (
      params.maxIssues !== undefined &&
      (!Number.isInteger(params.maxIssues) || params.maxIssues < 1 || params.maxIssues > 1000)
    )
      fail("invalid_request", "maxIssues must be an integer between 1 and 1000");
    if (
      params.groupMinMembers !== undefined &&
      (!Number.isInteger(params.groupMinMembers) || params.groupMinMembers < 0)
    )
      fail("invalid_request", "groupMinMembers must be a non-negative integer");
  }
  if (method === "timeline") {
    // 多给即报错：拼错一个 `clipID` 页面只会当它没给，然后报一句不相干的「缺 clipId」。
    for (const key of Object.keys(params))
      if (!TIMELINE_FIELDS.includes(key))
        fail("invalid_request", `Unexpected timeline field: ${key}`);
    if (params.op !== undefined && !TIMELINE_OPS.includes(params.op))
      fail("invalid_request", `timeline op must be one of ${TIMELINE_OPS.join(", ")}`);
  }
  if (method === "tasks") {
    for (const key of Object.keys(params))
      if (!TASKS_FIELDS.includes(key)) fail("invalid_request", `Unexpected tasks field: ${key}`);
    if (params.scope !== undefined && !TASKS_SCOPES.includes(params.scope))
      fail("invalid_request", "scope must be canvas, project or all");
    for (const [key, max] of [
      ["nodeIds", 200],
      ["status", TASKS_STATUSES.length],
    ]) {
      const list = params[key];
      if (
        list !== undefined &&
        (!Array.isArray(list) ||
          list.length < 1 ||
          list.length > max ||
          list.some((id) => typeof id !== "string" || !id.trim() || id.length > 1024))
      )
        fail("invalid_request", `${key} must be 1..${max} non-empty strings`);
    }
    if (params.status !== undefined && params.status.some((s) => !TASKS_STATUSES.includes(s)))
      fail("invalid_request", `status must be one of ${TASKS_STATUSES.join(", ")}`);
    if (params.submitter !== undefined && !TASKS_SUBMITTERS.includes(params.submitter))
      fail("invalid_request", "submitter must be me, agent or human");
    if (
      params.since !== undefined &&
      (typeof params.since !== "string" || !Number.isFinite(Date.parse(params.since)))
    )
      fail("invalid_request", "since must be an ISO timestamp");
    if (
      params.limit !== undefined &&
      (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 500)
    )
      fail("invalid_request", "limit must be an integer between 1 and 500");
    if (params.after !== undefined && (typeof params.after !== "string" || !params.after))
      fail("invalid_request", "after must be the nextAfter cursor of a previous page");
  }
  if (method === "apply") {
    if (
      !Array.isArray(params.commands) ||
      params.commands.length === 0 ||
      params.commands.length > 1000
    ) {
      fail("invalid_request", "apply requires 1..1000 commands");
    }
    for (const command of params.commands) {
      if (
        !object(command) ||
        typeof command.type !== "string" ||
        !Object.hasOwn(COMMAND_FIELDS, command.type)
      ) {
        fail("invalid_request", "Unknown or nested apply command");
      }
      if (role === "worker" && WORKER_BLOCKED_COMMANDS.has(command.type)) {
        fail(
          "worker_forbidden",
          `Delegated workers cannot apply ${command.type}; use scoped media reads or ask the parent Agent`,
        );
      }
      for (const key of Object.keys(command)) {
        if (key !== "type" && !COMMAND_FIELDS[command.type].includes(key)) {
          fail("invalid_request", `Unexpected ${command.type} field: ${key}`);
        }
      }
      if (command.type === "scene3d_apply") {
        // 动作这一层同样「多给即报错」：认 op、认这个 op 的字段；取值由页面侧 reducer 判。
        if (
          !Array.isArray(command.actions) ||
          command.actions.length < 1 ||
          command.actions.length > SCENE3D_ACTIONS_MAX
        )
          fail("invalid_request", `scene3d_apply requires 1..${SCENE3D_ACTIONS_MAX} actions`);
        for (const action of command.actions) {
          if (
            !object(action) ||
            typeof action.op !== "string" ||
            !Object.hasOwn(SCENE3D_ACTION_FIELDS, action.op)
          )
            fail("invalid_request", "Unknown scene3d action op");
          for (const key of Object.keys(action))
            if (key !== "op" && !SCENE3D_ACTION_FIELDS[action.op].includes(key))
              fail("invalid_request", `Unexpected scene3d ${action.op} field: ${key}`);
        }
      }
      checkNestedCommandData(command, role);
    }
  }
}
