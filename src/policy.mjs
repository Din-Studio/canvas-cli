/** Shared by the authenticated daemon and browser. No Node or host APIs. */
export const PROTOCOL_VERSION = 2;

const READ_METHODS = new Set([
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
const TASKS_SCOPES = ["canvas", "project", "all"];
const TASKS_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"];
const TASKS_SUBMITTERS = ["me", "agent", "human"];
const MAIN_METHODS = new Set([
  "cancel_batch",
  "run_node",
  "run_nodes",
  "run_tool",
  "cancel_node",
  "undo",
  "redo",
  "operations",
  "timeline",
]);
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
  adopt_output: ["nodeId", "url"],
  focus_node: ["nodeId", "fill"],
  upload_asset: ["path", "fileName", "mimeType", "bytesBase64", "position", "title", "id"],
  export_output: ["nodeId", "path", "resourceId"],
};
const WORKER_BLOCKED_COMMANDS = new Set(["upload_asset", "export_output"]);
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
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  toError() {
    return { code: this.code, message: this.message };
  }
}
const fail = (code, message) => {
  throw new RequestPolicyError(code, message);
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
      "Delegated workers cannot embed upload_asset or export_output commands",
    );
  }
  for (const [key, item] of Object.entries(value)) {
    if (["commands", "__proto__", "prototype", "constructor"].includes(key)) {
      fail("invalid_request", `Nested or unsafe command field: ${key}`);
    }
    checkNestedCommandData(item, role, depth + 1);
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
    Object.hasOwn(params, "approval")
  ) {
    fail("invalid_request", "approval is only accepted for run_node / run_nodes / run_tool");
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
      checkNestedCommandData(command, role);
    }
  }
}
