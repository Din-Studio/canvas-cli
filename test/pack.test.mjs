import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec as execCommand, execFile } from "node:child_process";
import { promisify } from "node:util";
import { packageRoot, request } from "./helpers.mjs";

const exec = promisify(execFile);
const shell = promisify(execCommand);

/**
 * Windows only resolves `npm` through `npm.cmd`, and Node refuses to spawn a
 * `.cmd` without a shell (EINVAL since 18.20/20.12), so this test used to die
 * with ENOENT before reaching a single assertion. There it goes through a shell
 * as one quoted command line; every value is a path or literal flag this test
 * built itself. A trailing run of backslashes would escape the closing quote —
 * `packageRoot` ends in one — so it is doubled, which is how Windows argument
 * parsing reads a literal backslash in that position.
 */
const quoteForShell = (arg) => `"${String(arg).replace(/(\\+)$/, "$1$1")}"`;
const npm = (args, options) =>
  process.platform === "win32"
    ? shell(["npm.cmd", ...args].map(quoteForShell).join(" "), options)
    : exec("npm", args, options);

test(
  "npm tarball installs and runs without workspace or runtime dependencies",
  { timeout: 60000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scenemint-pack-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const npmrc = path.join(root, "npmrc");
    await fs.writeFile(npmrc, "");
    const npmEnv = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
      ),
      npm_config_userconfig: npmrc,
      npm_config_cache: path.join(root, "npm-cache"),
    };
    const { stdout } = await npm(
      ["pack", packageRoot, "--pack-destination", root, "--ignore-scripts", "--json"],
      { cwd: root, env: npmEnv },
    );
    const manifest = JSON.parse(stdout);
    const packed = Array.isArray(manifest) ? manifest[0] : manifest["@scenemint/canvas-cli"];
    assert.ok(packed.files.some((file) => file.path === "skills/scenemint-canvas/SKILL.md"));
    assert.ok(packed.files.some((file) => file.path === "src/daemon.mjs"));
    // 变更日志随包发：装了包的人要能就地看出「这一版相对上一版多了什么」，
    // 而不是回 monorepo 翻 git log。
    assert.ok(packed.files.some((file) => file.path === "CHANGELOG.md"));
    assert.ok(packed.files.some((file) => file.path === "src/policy.mjs"));
    assert.ok(packed.files.some((file) => file.path === "src/policy.d.mts"));
    // 契约随包发布才有意义：装了包的人必须拿得到它，而不是回去读 monorepo。
    assert.ok(packed.files.some((file) => file.path === "src/contract.mjs"));
    assert.ok(packed.files.some((file) => file.path === "src/contract.d.mts"));
    assert.ok(packed.files.some((file) => file.path === "src/host-argv.mjs"));
    assert.ok(packed.files.some((file) => file.path === "src/host.d.mts"));
    // 连接层子路径（./client ./session ./media ./common）连同它们的相对依赖
    // （connection-code / daemon / policy）必须整份进包，否则「装包代替 vendor」
    // 会在包外解析时才炸。
    for (const file of [
      "src/client.mjs",
      "src/session.mjs",
      "src/media.mjs",
      "src/common.mjs",
      "src/connection-code.mjs",
    ])
      assert.ok(
        packed.files.some((entry) => entry.path === file),
        `${file} missing from tarball`,
      );
    assert.ok(
      packed.files.every(
        (file) => !file.path.startsWith("test/") && !file.path.includes("node_modules"),
      ),
    );
    const prefix = path.join(root, "installation");
    await npm(
      [
        "install",
        "--prefix",
        prefix,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        path.join(root, packed.filename),
      ],
      { cwd: root, env: npmEnv },
    );
    const installed = path.join(prefix, "node_modules", "@scenemint", "canvas-cli");
    const executable = path.join(installed, "bin", "scenemint-canvas.mjs");
    const pkg = JSON.parse(await fs.readFile(path.join(installed, "package.json"), "utf8"));
    assert.equal(pkg.dependencies, undefined);
    // 变更日志进了包还不够：它必须真的写到**这一版**。0.11.0 / 0.12.0 两版发出去的时候
    // CHANGELOG 最新一段还停在 0.10.1，于是装了包的人在包里看不出自己装的是什么，
    // 只能回 monorepo 翻 git log —— 正是这份文件存在的理由被绕过去了。
    assert.match(
      await fs.readFile(path.join(installed, "CHANGELOG.md"), "utf8"),
      new RegExp(`^## ${pkg.version.replace(/\./g, "\\.")}$`, "m"),
      `CHANGELOG.md 里没有 "## ${pkg.version}" 这一段：改了版本号就写清这一版相对上一版多了什么`,
    );
    // 版本号是下游唯一能用来判断「装的这份有没有连接层子路径」的东西：解析失败时
    // 产品给操作者的处置就是「升到导出 ./client 的版本」。所以导出表面必须钉死在
    // 版本号上——0.6.0 就是反面教材，它先后以「只有 ./policy」和「+./contract」两种
    // 表面出现过，光看版本号推不出有没有某条子路径。加、删、改一条 exports 而不动
    // version，这条断言就红。
    const EXPORT_SURFACE = {
      "0.7.0": ["./client", "./common", "./contract", "./media", "./policy", "./session"],
      "0.8.0": ["./client", "./common", "./contract", "./host", "./media", "./policy", "./session"],
      // 0.8.1：新增 `tasks` 命令（谁提交的 / 状态 / 时间），导出表面不变。
      "0.8.1": ["./client", "./common", "./contract", "./host", "./media", "./policy", "./session"],
      // 0.9.0：第 20 条命令 `resize_group`、`tidy` 的 scope/fitFrames、契约新增
      // `group_nodes.minMembers` / `group.oversizeRatio` 两条标量 limit 与 `PAGE_AWAY`
      // 常量组（都在已有的 ./contract 子路径里），导出表面不变。
      "0.9.0": ["./client", "./common", "./contract", "./host", "./media", "./policy", "./session"],
      // 0.10.0：新增 `health` 读方法、`resize_group.absorbStrays`、`changes` 的
      // epoch 游标、`tidySummary` / `formatTidySummary`、契约的 changes / health
      // 两个块。全部落在已有子路径里，导出表面不变——所以光看这张表分不出
      // 0.9.0 和 0.10.0，下面的 VERSION_FEATURES 才是这一版的身份。
      "0.10.0": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.10.1：`focus_node` 取景结果回报（`ApplyResult.focused[]`）与契约的
      // `focus` 块。同样落在已有子路径里，导出表面不变。
      "0.10.1": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.11.0：新增 `run-tool`（节点工具条上的次级工具）、`read` 回包的 `tools[]`
      // （本地免费工具标 `billable:false`）、`timeline` 片段带 inMs/outMs。全部落在已有
      // 子路径里，导出表面不变；身份看下面 VERSION_FEATURES 的 runToolFields。
      "0.11.0": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.12.0：画布多了本地免费工具 `capture-frame`（run-tool 的 kind 之一，metadata.atMs / count）。
      // CLI 本身一行没改，导出表面与 0.11.0 相同。
      "0.12.0": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.13.0：`CANVAS_CONTRACT.tiers`（命令分级）与 policy 新导出的三张表
      // （READ_METHODS / MAIN_METHODS / WORKER_BLOCKED_COMMANDS）。全部落在已有的
      // ./contract 与 ./policy 子路径里，导出表面与 0.12.0 相同；身份看下面
      // VERSION_FEATURES 的 contractBlocks（多了 tiers）。
      "0.13.0": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.14.0：apply 29 条、timeline 新 op、`export-jianying` + `timeline_export`、tiers 新条目，
      // 全部落在已有的 ./contract 与 ./policy 子路径里。`src/jianying/` 随包发，但**不**开
      // `./jianying` 子路径（没有外部使用方），导出表面与 0.13.0 相同；身份看下面 VERSION_FEATURES。
      "0.14.0": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.15.0：契约新块 localTools（run_tool 本地免费工具：kind 全集、annotate 文字标注的上限、
      // asset-sheet 的面板 / 字段 / 手持图几种、scale-lineup 的分组、版式与投影阈值）与
      // tiers["run-tool"].localKinds，全部落在已有的 ./contract 子路径里，导出表面与 0.14.0 相同；身份看下面
      // VERSION_FEATURES。
      "0.15.0": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.15.1（A57）：只改了 localTools.assetSheet 的面板 / 键与 warningCodes（都在 ./contract 里），导出表面不变。
      "0.15.1": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
    };
    const surface = EXPORT_SURFACE[pkg.version];
    assert.ok(
      surface,
      `版本 ${pkg.version} 没在 EXPORT_SURFACE 里登记导出表面：改版本号的同时把这一版导出的子路径记下来`,
    );
    assert.deepEqual(
      Object.keys(pkg.exports).sort(),
      surface,
      `${pkg.version} 的 exports 变了却没换版本号：同一个版本号不能指代两种包表面`,
    );
    // 客户端的 stage 脚本把 package.json 的 version 和 cli.mjs 里的 const VERSION
    // 当凭证交叉核对，两处漂了会在随包带 CLI 那条链上炸，不在这里。
    assert.match(
      await fs.readFile(path.join(installed, "src", "cli.mjs"), "utf8"),
      new RegExp(`const VERSION = "${pkg.version.replace(/\./g, "\\.")}";`),
      "cli.mjs 的 VERSION 和 package.json 的 version 对不上",
    );
    const policyVersion = await exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { PROTOCOL_VERSION, enforceRequestPolicy } from "@scenemint/canvas-cli/policy"; enforceRequestPolicy("worker", "read", {}); console.log(PROTOCOL_VERSION);',
      ],
      { cwd: prefix },
    );
    assert.equal(policyVersion.stdout.trim(), "2");
    // `exports` 里的 "./contract" 子路径必须真的能解析，且拿到的是同一份 29 条命令。
    const contract = await exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { CANVAS_CONTRACT } from "@scenemint/canvas-cli/contract"; console.log(JSON.stringify({ commands: Object.keys(CANVAS_CONTRACT.commands).length, draftKinds: Object.keys(CANVAS_CONTRACT.draftKeys).length, bridgeErrors: Object.keys(CANVAS_CONTRACT.bridgeErrors).length, cliExitCodes: Object.keys(CANVAS_CONTRACT.cliExitCodes).length }));',
      ],
      { cwd: prefix },
    );
    assert.deepEqual(JSON.parse(contract.stdout), {
      commands: 29,
      draftKinds: 6,
      // +2 = run_tool 的 tool_not_found / tool_not_applicable；+2 = doc@1 的 doc_conflict / doc_not_found
      bridgeErrors: 25,
      // +1 = export-jianying --draft-root 的 draft_root_boundary（写进剪映草稿目录途中越界，退出码 2）
      cliExitCodes: 25,
    });
    // 导出表面（上面那张表）分不出 0.9.0 和 0.10.0：两版的 `exports` 逐字相同，
    // 新增的全在已有子路径**里面**。而下游按版本号重装时，消失的正是这些
    // ——`health` 不见了、`changes` 不带 epoch 了，且没有任何报错可指。所以功能
    // 面也要钉在版本号上：加一条命令 / 一个字段 / 一个契约块而不动 version，这里红。
    //
    // 下面几张表在多个版本里原样出现，抽出来免得每版抄一遍（都已排好序，与探针一致）。
    // 0.9.0 起到 0.13.0 的 20 条 apply 命令（`CANVAS_CONTRACT.commands` 的键）。
    const APPLY_COMMANDS_20 = [
      "add_node",
      "adopt_output",
      "align",
      "arrange",
      "connect",
      "delete_node",
      "disconnect",
      "duplicate_node",
      "edit_text",
      "export_output",
      "focus_node",
      "group_nodes",
      "move_node",
      "resize_group",
      "select_output",
      "set_viewport",
      "tidy",
      "ungroup",
      "update_node",
      "upload_asset",
    ];
    // 0.14.0 在上面 20 条之外新增的 9 条（F059-B）。
    const APPLY_COMMANDS_29 = [
      ...APPLY_COMMANDS_20,
      "add_to_group",
      "clear_output",
      "delete_output",
      "duplicate_nodes",
      "recover_deleted",
      "remove_from_group",
      "reset_status",
      "select",
      "split_output",
    ].sort();
    // 0.13.0 的 35 条 CLI 子命令（`CANVAS_CONTRACT.tiers` 除 `applyCommands` 以外的键）。
    const CLI_SUBCOMMANDS_35 = [
      "apply",
      "cancel",
      "cancel-batch",
      "changes",
      "connect",
      "delegate",
      "disconnect",
      "download",
      "frames",
      "grep",
      "health",
      "help",
      "inspect-media",
      "list-canvases",
      "ls",
      "models",
      "operations",
      "read",
      "redo",
      "resize-group",
      "resources",
      "revoke",
      "run",
      "run-batch",
      "run-tool",
      "skill-path",
      "snapshot",
      "status",
      "stop",
      "tasks",
      "tidy",
      "timeline",
      "turn-end",
      "undo",
      "upload",
    ];
    // 0.13.0 起 `./policy` 导出的 READ_METHODS（worker 也能调的只读方法）。
    const READ_METHODS_0_13 = [
      "changes",
      "end_turn",
      "grep",
      "health",
      "list_canvases",
      "ls",
      "media_chunk",
      "media_info",
      "model_catalog",
      "read",
      "resources",
      "snapshot",
      "tasks",
    ];
    // 0.14.0 画布认得的四件图片本地工具（F059-A）；它们在页面的工具注册表里，CLI 契约里没有这张表，
    // 这一版的身份是随包的 skill 手册（references/commands.md §6c）教了它们的 `--kind` 写法。
    const IMAGE_TOOL_KINDS = ["crop-image", "grid-split", "flip-image", "annotate-image"];
    // 0.15.0 画布认得的两件资产 / 比例总表本地工具（F086，scale-lineup 是 A40；顶视站位标注图按 A26 修订 2
    // 弃用，发版前已移除）；同上，这一版的身份之一是随包手册教了它们的 `--kind` 写法（references/commands.md §6e）。
    const ASSET_TOOL_KINDS = ["asset-sheet", "scale-lineup"];
    // 0.13.0 起 `./policy` 导出的 MAIN_METHODS（只有主会话能调的方法；worker 调就是 worker_forbidden）。
    const MAIN_METHODS_0_13 = [
      "cancel_batch",
      "cancel_node",
      "operations",
      "redo",
      "run_node",
      "run_nodes",
      "run_tool",
      "timeline",
      "undo",
    ];
    // 0.14.0 起才探：CLI 自己的用法（`help` 回包的 commands）教没教这几个旗标。它们只在 CLI 里解析、
    // 不进契约，删掉一个而不动版本号，下面的探针就红。
    const USAGE_FLAGS = {
      "docs ls": ["--folders"],
      "docs read": ["--folder", "--out-dir"],
      "export-jianying": ["--draft-root"],
    };
    // 0.14.0 之前这三条命令都还没有，用法里一个旗标也不会有。
    const USAGE_FLAGS_NONE = { "docs ls": [], "docs read": [], "export-jianying": [] };
    const VERSION_FEATURES = {
      "0.10.0": {
        contractBlocks: [
          "bridgeErrors",
          "bridgeVersion",
          "changes",
          "cliExitCodes",
          "commands",
          "draftKeys",
          "enums",
          "health",
          "limits",
          "pageAway",
          "protocolVersion",
          "ranges",
        ],
        protocolVersion: 2,
        bridgeVersion: 3,
        resizeGroupFields: ["nodeId", "size", "fit", "absorbStrays"],
        changesCursorFlags: ["--since-seq", "--since-epoch"],
        changesNotes: [
          "run_timeout",
          "batch_lost",
          "quota_stop",
          "frame_strays",
          "frame_escaped",
          "bulk_change",
        ],
        truncatedReasons: ["buffer_dropped", "feed_restarted"],
        healthIssueKinds: 8,
        healthLimits: ["health.maxIssues", "health.overlapMinRatio"],
        healthFields: ["maxIssues", "groupMinMembers"],
        healthIsRead: true,
        formatTidySummary: "function",
        // 0.10.0 没有 focus 块：探针用 `?? null` 读，所以这一版的真实取值就是 null。
        // 把它写出来而不是省略，是为了让「这一版没有」和「这张表忘了登记」分得开。
        focusUnframedReasons: null,
        runToolFields: null,
        // 0.14.0 起才探的几项：这一版的真实取值（没有 tiers、policy 不导出 READ_METHODS / TIMELINE_*）。
        applyCommands: APPLY_COMMANDS_20,
        cliSubcommands: null,
        tierApplyCommands: null,
        exportJianyingTier: null,
        readMethods: null,
        timelineOps: null,
        timelineFields: null,
        runToolImageKinds: [],
        mainMethods: null,
        usageFlags: USAGE_FLAGS_NONE,
      },
      // 0.10.1：`focus_node` 不再静默 —— `ApplyResult.focused[]` 如实回报取景有没有
      // 发生（`framed`），没发生时给出原因（`unmeasured` / `no_camera`），契约新增
      // `focus` 块。纯加法：命令数、字段、协议版本一个都没动。
      "0.10.1": {
        contractBlocks: [
          "bridgeErrors",
          "bridgeVersion",
          "changes",
          "cliExitCodes",
          "commands",
          "draftKeys",
          "enums",
          "focus",
          "health",
          "limits",
          "pageAway",
          "protocolVersion",
          "ranges",
        ],
        protocolVersion: 2,
        bridgeVersion: 3,
        resizeGroupFields: ["nodeId", "size", "fit", "absorbStrays"],
        changesCursorFlags: ["--since-seq", "--since-epoch"],
        changesNotes: [
          "run_timeout",
          "batch_lost",
          "quota_stop",
          "frame_strays",
          "frame_escaped",
          "bulk_change",
        ],
        truncatedReasons: ["buffer_dropped", "feed_restarted"],
        healthIssueKinds: 8,
        healthLimits: ["health.maxIssues", "health.overlapMinRatio"],
        healthFields: ["maxIssues", "groupMinMembers"],
        healthIsRead: true,
        formatTidySummary: "function",
        focusUnframedReasons: ["unmeasured", "no_camera"],
        // 0.10.1 还没有 run_tool：policy 里没有 RUN_TOOL_FIELDS，探针读成 null。
        runToolFields: null,
        // 0.14.0 起才探的几项：这一版的真实取值（没有 tiers、policy 不导出 READ_METHODS / TIMELINE_*）。
        applyCommands: APPLY_COMMANDS_20,
        cliSubcommands: null,
        tierApplyCommands: null,
        exportJianyingTier: null,
        readMethods: null,
        timelineOps: null,
        timelineFields: null,
        runToolImageKinds: [],
        mainMethods: null,
        usageFlags: USAGE_FLAGS_NONE,
      },
      // 0.11.0：`run_tool` 方法 + RUN_TOOL_FIELDS（approval 必带、title / metadata 可选），
      // 契约 bridgeErrors 多了 tool_not_found / tool_not_applicable。其余与 0.10.1 相同。
      "0.11.0": {
        contractBlocks: [
          "bridgeErrors",
          "bridgeVersion",
          "changes",
          "cliExitCodes",
          "commands",
          "draftKeys",
          "enums",
          "focus",
          "health",
          "limits",
          "pageAway",
          "protocolVersion",
          "ranges",
        ],
        protocolVersion: 2,
        bridgeVersion: 3,
        resizeGroupFields: ["nodeId", "size", "fit", "absorbStrays"],
        changesCursorFlags: ["--since-seq", "--since-epoch"],
        changesNotes: [
          "run_timeout",
          "batch_lost",
          "quota_stop",
          "frame_strays",
          "frame_escaped",
          "bulk_change",
        ],
        truncatedReasons: ["buffer_dropped", "feed_restarted"],
        healthIssueKinds: 8,
        healthLimits: ["health.maxIssues", "health.overlapMinRatio"],
        healthFields: ["maxIssues", "groupMinMembers"],
        healthIsRead: true,
        formatTidySummary: "function",
        focusUnframedReasons: ["unmeasured", "no_camera"],
        runToolFields: [
          "nodeId",
          "kind",
          "prompt",
          "resolution",
          "aspectRatio",
          "metadata",
          "title",
          "approval",
        ],
        // 0.14.0 起才探的几项：这一版的真实取值（没有 tiers、policy 不导出 READ_METHODS / TIMELINE_*）。
        applyCommands: APPLY_COMMANDS_20,
        cliSubcommands: null,
        tierApplyCommands: null,
        exportJianyingTier: null,
        readMethods: null,
        timelineOps: null,
        timelineFields: null,
        runToolImageKinds: [],
        mainMethods: null,
        usageFlags: USAGE_FLAGS_NONE,
      },
      // 0.12.0：与 0.11.0 同一份契约；新增的 capture-frame 是画布工具注册表的事，CLI 契约不变。
      "0.12.0": {
        contractBlocks: [
          "bridgeErrors",
          "bridgeVersion",
          "changes",
          "cliExitCodes",
          "commands",
          "draftKeys",
          "enums",
          "focus",
          "health",
          "limits",
          "pageAway",
          "protocolVersion",
          "ranges",
        ],
        protocolVersion: 2,
        bridgeVersion: 3,
        resizeGroupFields: ["nodeId", "size", "fit", "absorbStrays"],
        changesCursorFlags: ["--since-seq", "--since-epoch"],
        changesNotes: [
          "run_timeout",
          "batch_lost",
          "quota_stop",
          "frame_strays",
          "frame_escaped",
          "bulk_change",
        ],
        truncatedReasons: ["buffer_dropped", "feed_restarted"],
        healthIssueKinds: 8,
        healthLimits: ["health.maxIssues", "health.overlapMinRatio"],
        healthFields: ["maxIssues", "groupMinMembers"],
        healthIsRead: true,
        formatTidySummary: "function",
        focusUnframedReasons: ["unmeasured", "no_camera"],
        runToolFields: [
          "nodeId",
          "kind",
          "prompt",
          "resolution",
          "aspectRatio",
          "metadata",
          "title",
          "approval",
        ],
        // 0.14.0 起才探的几项：这一版的真实取值（没有 tiers、policy 不导出 READ_METHODS / TIMELINE_*）。
        applyCommands: APPLY_COMMANDS_20,
        cliSubcommands: null,
        tierApplyCommands: null,
        exportJianyingTier: null,
        readMethods: null,
        timelineOps: null,
        timelineFields: null,
        runToolImageKinds: [],
        mainMethods: null,
        usageFlags: USAGE_FLAGS_NONE,
      },
      // 0.13.0：契约多了 `tiers` 块（35 条 CLI 子命令 + 20 条 apply 命令的分级面），
      // policy 多导出 READ_METHODS / MAIN_METHODS / WORKER_BLOCKED_COMMANDS 三张表。
      // 命令数、字段、协议版本一个都没动 —— 纯加法，所以只有 contractBlocks 变了。
      "0.13.0": {
        contractBlocks: [
          "bridgeErrors",
          "bridgeVersion",
          "changes",
          "cliExitCodes",
          "commands",
          "draftKeys",
          "enums",
          "focus",
          "health",
          "limits",
          "pageAway",
          "protocolVersion",
          "ranges",
          "tiers",
        ],
        protocolVersion: 2,
        bridgeVersion: 3,
        resizeGroupFields: ["nodeId", "size", "fit", "absorbStrays"],
        changesCursorFlags: ["--since-seq", "--since-epoch"],
        changesNotes: [
          "run_timeout",
          "batch_lost",
          "quota_stop",
          "frame_strays",
          "frame_escaped",
          "bulk_change",
        ],
        truncatedReasons: ["buffer_dropped", "feed_restarted"],
        healthIssueKinds: 8,
        healthLimits: ["health.maxIssues", "health.overlapMinRatio"],
        healthFields: ["maxIssues", "groupMinMembers"],
        healthIsRead: true,
        formatTidySummary: "function",
        focusUnframedReasons: ["unmeasured", "no_camera"],
        runToolFields: [
          "nodeId",
          "kind",
          "prompt",
          "resolution",
          "aspectRatio",
          "metadata",
          "title",
          "approval",
        ],
        // 0.14.0 起才探的几项：这一版的真实取值。
        applyCommands: APPLY_COMMANDS_20,
        cliSubcommands: CLI_SUBCOMMANDS_35,
        tierApplyCommands: APPLY_COMMANDS_20,
        exportJianyingTier: null,
        readMethods: READ_METHODS_0_13,
        timelineOps: null,
        timelineFields: null,
        runToolImageKinds: [],
        mainMethods: MAIN_METHODS_0_13,
        usageFlags: USAGE_FLAGS_NONE,
      },
      // 0.14.0（F059 A / B / D / F 合并）：
      //  · run_tool 图片四件本地工具 crop-image / grid-split / flip-image / annotate-image（页面侧，
      //    skill 手册 §6c 教写法 → runToolImageKinds）；
      //  · apply 20 → 29 条，新增 add_to_group / clear_output / delete_output / duplicate_nodes /
      //    recover_deleted / remove_from_group / reset_status / select / split_output（applyCommands），
      //    tiers.applyCommands 跟着多了这 9 条；
      //  · timeline 新 op trim / split / cut / restore，新字段 episode / dedupeBySource / baseLayout 等
      //    （回包的 layoutDigest 就是 baseLayout 要带回的值），policy 新导出 TIMELINE_OPS / TIMELINE_FIELDS；
      //  · 本地子命令 export-jianying（tiers 第 36 条，L0 / local / long）与只读方法 timeline_export
      //    （进 READ_METHODS，worker 也能调）；
      //  · 项目文档库 doc@1（feat/doc-library）：契约新块 documents；子命令 docs ls / read / create / update /
      //    delete（tiers 新 5 条：ls / read L0、worker 也能调，create / update L1、delete L3，都只主会话）；
      //    只读方法 documents_list / documents_get / documents_folders 进 READ_METHODS，写方法
      //    documents_put / documents_delete 进 MAIN_METHODS；docs ls --folders 列文件夹、
      //    docs read --folder --out-dir 整个文件夹存成本地文件（usageFlags）；
      //  · 剪映草稿目录（feat/jianying-draft-root）：子命令 jianying-roots（tiers 新 1 条，L0、只主会话）；
      //    export-jianying --draft-root 直写用户的剪映草稿目录（tiers["export-jianying"].flagTiers["draft-root"]：
      //    L1、只主会话、表外目录要 --approved）；页面桥 jianying_roots_list / jianying_roots_touch 进 MAIN_METHODS。
      // 契约块多了 documents（tiers 共 42 条子命令）；协议版本、桥版本不变。
      "0.14.0": {
        contractBlocks: [
          "bridgeErrors",
          "bridgeVersion",
          "changes",
          "cliExitCodes",
          "commands",
          "documents",
          "draftKeys",
          "enums",
          "focus",
          "health",
          "limits",
          "pageAway",
          "protocolVersion",
          "ranges",
          "tiers",
        ],
        protocolVersion: 2,
        bridgeVersion: 3,
        resizeGroupFields: ["nodeId", "size", "fit", "absorbStrays"],
        changesCursorFlags: ["--since-seq", "--since-epoch"],
        changesNotes: [
          "run_timeout",
          "batch_lost",
          "quota_stop",
          "frame_strays",
          "frame_escaped",
          "bulk_change",
        ],
        truncatedReasons: ["buffer_dropped", "feed_restarted"],
        healthIssueKinds: 8,
        healthLimits: ["health.maxIssues", "health.overlapMinRatio"],
        healthFields: ["maxIssues", "groupMinMembers"],
        healthIsRead: true,
        formatTidySummary: "function",
        focusUnframedReasons: ["unmeasured", "no_camera"],
        runToolFields: [
          "nodeId",
          "kind",
          "prompt",
          "resolution",
          "aspectRatio",
          "metadata",
          "title",
          "approval",
        ],
        applyCommands: APPLY_COMMANDS_29,
        cliSubcommands: [
          ...CLI_SUBCOMMANDS_35,
          "docs create",
          "docs delete",
          "docs ls",
          "docs read",
          "docs update",
          "export-jianying",
          "jianying-roots",
        ].sort(),
        tierApplyCommands: APPLY_COMMANDS_29,
        exportJianyingTier: {
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
        readMethods: [
          ...READ_METHODS_0_13,
          "documents_folders",
          "documents_get",
          "documents_list",
          "timeline_export",
        ].sort(),
        timelineOps: [
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
        ],
        timelineFields: [
          "op",
          "baseRevision",
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
        ],
        runToolImageKinds: IMAGE_TOOL_KINDS,
        mainMethods: [
          ...MAIN_METHODS_0_13,
          "documents_delete",
          "documents_put",
          "jianying_roots_list",
          "jianying_roots_touch",
        ].sort(),
        usageFlags: USAGE_FLAGS,
      },
      // 0.15.0（F086）：CLI 的命令、字段、方法一个都没动；变的是契约 ——
      //  · 新块 localTools（= LOCAL_TOOLS 导出）：run_tool 本地免费 kind 的全集（多了 asset-sheet /
      //    scale-lineup）、annotate-image 的标注种类（多了 text）与文字上限、asset-sheet 的面板 / A30 字段；
      //  · tiers["run-tool"].localKinds：宿主据此知道哪些 kind 不扣费（与 localTools.kinds 同一个数组）；
      //  · 随包手册 §6e 教了 asset-sheet / scale-lineup 的写法（runToolAssetKinds）。
      //  · localTools.assetSheet.panels：人物可以只给一张基准设定图（combined.baselineSheet，A38①）；道具 =
      //    正面 + 背面（refs.backRef）+ 手持 / 在旁图（refs.heldRef，A46）。
      //  · localTools.assetSheet 的键集（assetSheetKeys：geometryKeys、locales、heldModes 等）；拍板 A46 之后没有
      //    参照物档位、剧内标尺资产、比例轴、投影阈值这几块（设定图不画比大小格）。
      //  · localTools.assetSheet.heldModes / heldModeMaxCm：道具手持图的三种与缺省分档（assetSheetHeldModes）。
      //  · localTools.scaleLineup：剧内比例总表的条数、分排、比例阈值、16:9 画幅、locales、道具 item 的比例轴
      //    scaleAxes（A45①）与脚下投影阈值（A40）；
      //  · 回包 warnings 的码在 localTools.warningCodes。
      // 下面最后九项（localToolKinds / annotateMarkKinds / runToolLocalKindsTier / runToolAssetKinds /
      // assetSheetPanels / scaleLineup / assetSheetKeys / localToolWarningCodes / assetSheetHeldModes）从 0.15.0
      // 起才探；0.14.0 及更早的条目按发版规矩不改（它们只在版本号等于自己时才被比对）。
      "0.15.0": {
        contractBlocks: [
          "bridgeErrors",
          "bridgeVersion",
          "changes",
          "cliExitCodes",
          "commands",
          "documents",
          "draftKeys",
          "enums",
          "focus",
          "health",
          "limits",
          "localTools",
          "pageAway",
          "protocolVersion",
          "ranges",
          "tiers",
        ],
        protocolVersion: 2,
        bridgeVersion: 3,
        resizeGroupFields: ["nodeId", "size", "fit", "absorbStrays"],
        changesCursorFlags: ["--since-seq", "--since-epoch"],
        changesNotes: [
          "run_timeout",
          "batch_lost",
          "quota_stop",
          "frame_strays",
          "frame_escaped",
          "bulk_change",
        ],
        truncatedReasons: ["buffer_dropped", "feed_restarted"],
        healthIssueKinds: 8,
        healthLimits: ["health.maxIssues", "health.overlapMinRatio"],
        healthFields: ["maxIssues", "groupMinMembers"],
        healthIsRead: true,
        formatTidySummary: "function",
        focusUnframedReasons: ["unmeasured", "no_camera"],
        runToolFields: [
          "nodeId",
          "kind",
          "prompt",
          "resolution",
          "aspectRatio",
          "metadata",
          "title",
          "approval",
        ],
        applyCommands: APPLY_COMMANDS_29,
        cliSubcommands: [
          ...CLI_SUBCOMMANDS_35,
          "docs create",
          "docs delete",
          "docs ls",
          "docs read",
          "docs update",
          "export-jianying",
          "jianying-roots",
        ].sort(),
        tierApplyCommands: APPLY_COMMANDS_29,
        exportJianyingTier: {
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
        readMethods: [
          ...READ_METHODS_0_13,
          "documents_folders",
          "documents_get",
          "documents_list",
          "timeline_export",
        ].sort(),
        timelineOps: [
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
        ],
        timelineFields: [
          "op",
          "baseRevision",
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
        ],
        runToolImageKinds: IMAGE_TOOL_KINDS,
        mainMethods: [
          ...MAIN_METHODS_0_13,
          "documents_delete",
          "documents_put",
          "jianying_roots_list",
          "jianying_roots_touch",
        ].sort(),
        usageFlags: USAGE_FLAGS,
        localToolKinds: [
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
        annotateMarkKinds: ["pen", "rect", "circle", "arrow", "text"],
        runToolLocalKindsTier: true,
        runToolAssetKinds: ASSET_TOOL_KINDS,
        // asset-sheet 的面板（含 A38① 人物的基准设定图 combined.baselineSheet、A46 道具的背面 / 手持图 refs）。
        assetSheetPanels: {
          character: {
            primary: "fullBody",
            extra: ["face", "threeView"],
            combined: { baselineSheet: ["face", "threeView"] },
          },
          scene: { primary: "scene", extra: ["plan"] },
          prop: { primary: "front", extra: [], refs: { backRef: "back", heldRef: "held" } },
        },
        // A40：剧内比例总表。
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
        // asset-sheet 契约块的键集（A46 之后没有参照物 / 标尺资产 / 比例轴 / 投影阈值）与 warnings 的码。
        assetSheetKeys: [
          "assetKinds",
          "derivedFields",
          "fieldMaxChars",
          "fields",
          "geometryKeys",
          "heldModeMaxCm",
          "heldModes",
          "infoMaxHeightRatio",
          "locales",
          "panels",
          "planAspectTolerance",
        ],
        localToolWarningCodes: ["floor_shadow_kept", "plan_aspect_mismatch", "text_overflow"],
        // A46 补充：道具手持 / 在旁图的三种与缺省分档（长边 ≤ 30 / ≤ 60 / 更长）。
        assetSheetHeldModes: {
          heldModes: ["handClose", "hand", "beside"],
          heldModeMaxCm: { handClose: 30, hand: 60 },
        },
      },
    };
    // 0.15.1（拍板 A57，F086 设定图第三版）：CLI 的命令、字段、方法、契约块都没动，变的是 localTools 里的三处 ——
    //  · assetSheet.panels：每个资产美术只出一张图（run-tool 的 NODE-ID）：人物 primary = baselineSheet（脸部特写 +
    //    带头三视图，cells；旧项目分开的两张仍是 extra / combined），道具 propSheet（前 / 后 / 手持或在旁三格），场景
    //    sceneSheet（场景 / 户型两格）；道具的 refs（backRef / heldRef）与场景的 extra plan 撤销；
    //  · assetSheet 的键集：多了 scaleRefs（人物比例格的标尺人物），少了 planAspectTolerance；
    //  · warningCodes：少了 plan_aspect_mismatch。
    //  · 新块 localTools.userSheet（拍板 A60）：用户自传图抠站立全身人像的阈值、退成剪影的原因码与剪影颜色
    //    （asset-sheet 的 scaleRefs[i].userSheet、scale-lineup 的 items[i].userSheet 用它）。
    // 新探两项 assetSheetScaleRefs（localTools.assetSheet.scaleRefs）与 userSheet（localTools.userSheet）；其余与
    // 0.15.0 同（0.15.0 条目按发版规矩不改）。
    VERSION_FEATURES["0.15.1"] = {
      ...VERSION_FEATURES["0.15.0"],
      assetSheetPanels: {
        character: {
          primary: "baselineSheet",
          cells: ["face", "threeView"],
          extra: ["face", "threeView"],
          combined: { baselineSheet: ["face", "threeView"] },
        },
        scene: { primary: "sceneSheet", cells: ["scene", "plan"], extra: [] },
        prop: { primary: "propSheet", cells: ["front", "back", "held"], extra: [] },
      },
      assetSheetKeys: [
        "assetKinds",
        "derivedFields",
        "fieldMaxChars",
        "fields",
        "geometryKeys",
        "heldModeMaxCm",
        "heldModes",
        "infoMaxHeightRatio",
        "locales",
        "panels",
        "scaleRefs",
      ],
      localToolWarningCodes: ["floor_shadow_kept", "text_overflow"],
      assetSheetScaleRefs: { min: 1, max: 2, labelMaxChars: 20, noteHeightRatio: 4 },
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
    const features = VERSION_FEATURES[pkg.version];
    assert.ok(
      features,
      `版本 ${pkg.version} 没在 VERSION_FEATURES 里登记功能面：同一个版本号不能指代两棵树，改 API 就改版本号，并把这一版认得的命令 / 字段 / 契约块记下来`,
    );
    const probe = await exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'import { readFileSync } from "node:fs";',
          'import { execFileSync } from "node:child_process";',
          'import { CANVAS_CONTRACT, formatTidySummary } from "@scenemint/canvas-cli/contract";',
          'import * as policy from "@scenemint/canvas-cli/policy";',
          "const { HEALTH_FIELDS, enforceRequestPolicy } = policy;",
          'const commandsMd = readFileSync("node_modules/@scenemint/canvas-cli/skills/scenemint-canvas/references/commands.md", "utf8");',
          `const usage = JSON.parse(execFileSync(process.execPath, [${JSON.stringify(executable)}, "help"], { encoding: "utf8" })).commands ?? {};`,
          // 只认语法里的旗标：不含「|」的圆括号是说明文字（`(repeatable)`、`(--out / --out-dir only save …)`），
          // 由内向外整段删掉再比 —— 语法里删了 `--out-dir`、只剩说明还提到它，这里就红；带「|」的二选一组
          // `(--file … | --text …)` 仍算语法。再按空白与 [ ] | ( ) , 切开逐个比，`--folder` 不会被 `--folders` 冒充。
          'const syntax = (text) => { for (let prev; prev !== text; ) { prev = text; text = text.replace(/\\([^()|]*\\)/g, " "); } return text; };',
          'const taught = (command, flag) => syntax(usage[command] ?? "").split(/[\\s[\\]|(),]+/).includes(flag);',
          "let healthIsRead = true;",
          'try { enforceRequestPolicy("worker", "health", {}); } catch { healthIsRead = false; }',
          "console.log(JSON.stringify({",
          "  contractBlocks: Object.keys(CANVAS_CONTRACT).sort(),",
          "  protocolVersion: CANVAS_CONTRACT.protocolVersion,",
          "  bridgeVersion: CANVAS_CONTRACT.bridgeVersion,",
          "  resizeGroupFields: CANVAS_CONTRACT.commands.resize_group.fields,",
          "  changesCursorFlags: CANVAS_CONTRACT.changes?.cursor?.flags ?? null,",
          "  changesNotes: CANVAS_CONTRACT.changes?.notes ?? null,",
          "  truncatedReasons: CANVAS_CONTRACT.changes?.truncatedReasons ?? null,",
          "  healthIssueKinds: CANVAS_CONTRACT.health?.issueKinds?.length ?? 0,",
          '  healthLimits: Object.keys(CANVAS_CONTRACT.limits).filter((key) => key.startsWith("health.")),',
          "  healthFields: HEALTH_FIELDS,",
          "  healthIsRead,",
          "  formatTidySummary: typeof formatTidySummary,",
          "  focusUnframedReasons: CANVAS_CONTRACT.focus?.unframedReasons ?? null,",
          "  runToolFields: policy.RUN_TOOL_FIELDS ?? null,",
          "  applyCommands: Object.keys(CANVAS_CONTRACT.commands).sort(),",
          '  cliSubcommands: CANVAS_CONTRACT.tiers ? Object.keys(CANVAS_CONTRACT.tiers).filter((key) => key !== "applyCommands").sort() : null,',
          "  tierApplyCommands: CANVAS_CONTRACT.tiers?.applyCommands ? Object.keys(CANVAS_CONTRACT.tiers.applyCommands).sort() : null,",
          '  exportJianyingTier: CANVAS_CONTRACT.tiers?.["export-jianying"] ?? null,',
          "  readMethods: policy.READ_METHODS ? [...policy.READ_METHODS].sort() : null,",
          "  timelineOps: policy.TIMELINE_OPS ?? null,",
          "  timelineFields: policy.TIMELINE_FIELDS ?? null,",
          `  runToolImageKinds: ${JSON.stringify(IMAGE_TOOL_KINDS)}.filter((kind) => commandsMd.includes(\`"--kind", "\${kind}"\`)),`,
          "  mainMethods: policy.MAIN_METHODS ? [...policy.MAIN_METHODS].sort() : null,",
          `  usageFlags: Object.fromEntries(Object.entries(${JSON.stringify(USAGE_FLAGS)}).map(([command, flags]) => [command, flags.filter((flag) => taught(command, flag))])),`,
          // 0.15.0 起才探的九项（见 VERSION_FEATURES["0.15.0"] 的说明；更早的条目没有这九个键，按发版规矩不改）。
          "  localToolKinds: CANVAS_CONTRACT.localTools?.kinds ?? null,",
          "  annotateMarkKinds: CANVAS_CONTRACT.localTools?.annotate?.markKinds ?? null,",
          '  runToolLocalKindsTier: Array.isArray(CANVAS_CONTRACT.localTools?.kinds) && CANVAS_CONTRACT.tiers?.["run-tool"]?.localKinds === CANVAS_CONTRACT.localTools.kinds,',
          `  runToolAssetKinds: ${JSON.stringify(ASSET_TOOL_KINDS)}.filter((kind) => commandsMd.includes(\`"--kind", "\${kind}"\`)),`,
          "  assetSheetPanels: CANVAS_CONTRACT.localTools?.assetSheet?.panels ?? null,",
          "  scaleLineup: CANVAS_CONTRACT.localTools?.scaleLineup ?? null,",
          "  assetSheetKeys: CANVAS_CONTRACT.localTools?.assetSheet ? Object.keys(CANVAS_CONTRACT.localTools.assetSheet).sort() : null,",
          "  localToolWarningCodes: CANVAS_CONTRACT.localTools?.warningCodes ?? null,",
          "  assetSheetHeldModes: CANVAS_CONTRACT.localTools?.assetSheet ? { heldModes: CANVAS_CONTRACT.localTools.assetSheet.heldModes ?? null, heldModeMaxCm: CANVAS_CONTRACT.localTools.assetSheet.heldModeMaxCm ?? null } : null,",
          // 0.15.1 起才探（A57：人物比例格的标尺人物）；更早的条目没有这个键，按发版规矩不改。
          "  assetSheetScaleRefs: CANVAS_CONTRACT.localTools?.assetSheet?.scaleRefs ?? null,",
          // 0.15.1 起才探（A60：用户自传图）；更早的条目没有这个键，按发版规矩不改。
          "  userSheet: CANVAS_CONTRACT.localTools?.userSheet ?? null,",
          "}));",
        ].join("\n"),
      ],
      { cwd: prefix },
    );
    assert.deepEqual(JSON.parse(probe.stdout), features, `${pkg.version} 的功能面变了却没换版本号`);
    // 连接层子路径：产品去掉 vendor 之后就是这四条 import。它们必须在一个干净 prefix 里
    // 从包名解析成功、拿到期望的导出名，并且真的能跑——ESM 是急切链接的，所以一旦
    // client→session→policy→common 之间有哪条不是相对路径，import 这一步就先炸；
    // 再调一次 readSession 证明跨模块的常量（common.UUID / CliError）在包外也活着。
    const lib = await exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'import { call, connect, sessionRequest } from "@scenemint/canvas-cli/client";',
          'import { readSession } from "@scenemint/canvas-cli/session";',
          'import { download, frames, inspectMedia } from "@scenemint/canvas-cli/media";',
          'import { CliError, UUID } from "@scenemint/canvas-cli/common";',
          'import { injectSession, extractPayload } from "@scenemint/canvas-cli/host";',
          'const kinds = (values) => values.map((value) => typeof value).join(",");',
          'const rejected = await readSession("not-a-uuid").then(() => null, (error) => error);',
          "console.log(JSON.stringify({",
          "  client: kinds([call, connect, sessionRequest]),",
          "  session: kinds([readSession]),",
          "  media: kinds([download, frames, inspectMedia]),",
          '  common: [typeof CliError, UUID instanceof RegExp].join(","),',
          '  crossModule: [rejected instanceof CliError, rejected?.code].join(","),',
          '  host: [injectSession(["status"], "s").join(" "), (await extractPayload(["apply", "--json", "{\\"commands\\":[{\\"type\\":\\"tidy\\"}]}"], { readFile: () => "" })).commands.length].join(","),',
          "}));",
        ].join("\n"),
      ],
      { cwd: prefix },
    );
    assert.deepEqual(JSON.parse(lib.stdout), {
      client: "function,function,function",
      session: "function",
      media: "function,function,function",
      common: "function,true",
      crossModule: "true,invalid_session",
      host: "status --session s,1",
    });
    const help = JSON.parse(
      (await exec(process.execPath, [executable, "help"], { cwd: root })).stdout,
    );
    assert.equal(help.name, "scenemint-canvas");
    const skill = JSON.parse(
      (await exec(process.execPath, [executable, "skill-path"], { cwd: root })).stdout,
    );
    assert.match(
      await fs.readFile(path.join(skill.path, "SKILL.md"), "utf8"),
      /name: scenemint-canvas/,
    );
    const workspace = path.join(root, "workspace");
    await fs.mkdir(workspace);
    const env = { ...process.env, SCENEMINT_CANVAS_HOME: path.join(root, "userdata") };
    const session = JSON.parse(
      (
        await exec(
          process.execPath,
          [
            executable,
            "connect",
            "--origin",
            "http://localhost:3000",
            "--name",
            "Installed package",
            "--workspace",
            workspace,
          ],
          { env, cwd: root },
        )
      ).stdout,
    );
    t.after(async () => {
      const saved = await fs
        .readFile(
          path.join(env.SCENEMINT_CANVAS_HOME, "sessions", `${session.sessionId}.json`),
          "utf8",
        )
        .catch(() => null);
      if (saved)
        await request(session.endpoint, "/v1/stop", {
          headers: { Authorization: `Bearer ${JSON.parse(saved).cliToken}` },
          body: {},
        }).catch(() => {});
    });
    const status = JSON.parse(
      (
        await exec(process.execPath, [executable, "status", "--session", session.sessionId], {
          env,
          cwd: root,
        })
      ).stdout,
    );
    assert.equal(status.agentName, "Installed package");
    assert.equal(status.state, "awaiting_pair");
    const stop = JSON.parse(
      (
        await exec(process.execPath, [executable, "disconnect", "--session", session.sessionId], {
          env,
          cwd: root,
        })
      ).stdout,
    );
    assert.equal(stop.stopped, true);
  },
);
