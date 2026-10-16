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
      // 0.16.2（叠在 0.15.1 之上；纳入作者自己的 0.16.1 B1，并增加文档库 CDN，并进这一版）：契约新块 scene3d、
      // documents 块多了 contentUrl / 四个错误码 / limits.uploadChapters，policy 新导出（SCENE3D_ACTION_FIELDS /
      // SCENE3D_ACTIONS_MAX / RUN_NODE_FIELDS / SCENE3D_STILL_FRAMES / RUN_STILLS_FIELDS / RUN_STILLS_SHOTS_MAX）、
      // 第 30 条 apply 命令 scene3d_apply、`run --shot` / `--frame`、`run-stills`、`docs read --if-version`，全部落在
      // 已有的 ./contract 与 ./policy 子路径里，导出表面与 0.15.1 相同；身份看下面 VERSION_FEATURES。
      "0.16.2": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.16.1（B1 补丁）：契约新块 hostText / packageVersion 与几处加项都在 ./contract 里，导出表面不变。
      "0.16.1": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
      // 0.17.0（未 tag 起点，B3-integrate）：act op、run_node 多镜字段、动画自检码，导出表面不变。
      "0.17.0": [
        "./client",
        "./common",
        "./contract",
        "./host",
        "./media",
        "./policy",
        "./session",
      ],
    };
    // 0.16.3（scene3d_apply 多收六个字段、自检多四个码）与 0.16.4（只补登记，见 VERSION_FEATURES）：都落在已有的
    // ./contract 与 ./policy 子路径里，导出表面与 0.16.2 相同。
    EXPORT_SURFACE["0.16.3"] = EXPORT_SURFACE["0.16.2"];
    EXPORT_SURFACE["0.16.4"] = EXPORT_SURFACE["0.16.2"];
    // 0.18.0（站位图 / 预演 / 先修数据再自检，T1–T7）：新块、新函数、run-shot-refs 都落在已有的 ./contract 与 ./policy
    // 子路径里，导出表面与 0.17.0 相同。
    EXPORT_SURFACE["0.18.0"] = EXPORT_SURFACE["0.17.0"];
    // 0.18.1（三维卡照常显示、站位图按镜拉近与 16:9、脚底贴面）：只改 ./contract 里已有的块，导出表面与 0.18.0 相同。
    EXPORT_SURFACE["0.18.1"] = EXPORT_SURFACE["0.18.0"];
    // 0.18.2（A102 ④ ⑧ ⑨：穿模原话与改法、在场模型、俯视方向三级）：新块落在已有的 ./contract 与 ./policy 里，导出表面
    // 与 0.18.1 相同。
    EXPORT_SURFACE["0.18.2"] = EXPORT_SURFACE["0.18.1"];
    EXPORT_SURFACE["0.18.3"] = EXPORT_SURFACE["0.18.2"];
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
    // `exports` 里的 "./contract" 子路径必须真的能解析，且拿到的是同一份 30 条命令。
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
      commands: 30,
      draftKinds: 6,
      // +2 = run_tool 的 tool_not_found / tool_not_applicable；+2 = doc@1 的 doc_conflict / doc_not_found；
      // +1 = scene3d@1 的 scene3d_conflict；+2 = 0.16.1 的 render_interrupted / collab_offline（不进 cliExitCodes）
      bridgeErrors: 28,
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
    // 0.16.2 新增的第 30 条（scene3d@1 三维导演台）。
    const APPLY_COMMANDS_30 = [...APPLY_COMMANDS_29, "scene3d_apply"].sort();
    // 0.16.2 起 scene3d_apply 的 13 个动作 op（契约 scene3d.ops 与 policy SCENE3D_ACTION_FIELDS 的键）。
    const SCENE3D_OPS = [
      "add_object",
      "add_shot",
      "duplicate",
      "remove",
      "remove_shot",
      "reorder_shots",
      "set_axis",
      "set_camera",
      "set_figure",
      "set_focus",
      "set_scene",
      "transform",
      "update_shot",
    ];
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
    // 0.16.2 起 `run` 多教 `--shot` / `--frame`，新命令 `run-stills` 教 `--shots` / `--frames` / `--force`（换过图的
    // 也由它重出，A71 修订），`docs read` 多教一个 `--if-version`（A68：没变就不传正文）；探针按这一张比
    // （上面两张表给更早的条目用，按发版规矩不改；更早的条目只在版本号等于自己时才被比对）。
    const USAGE_FLAGS_0_16 = { ...USAGE_FLAGS, run: ["--shot"] };
    // 0.17.0 起 `run` / `snapshot` 多教的带值旗标（单独一个探针键，上面几张表给更早的条目用，按发版规矩不改）。
    const USAGE_FLAGS_0_17 = {
      run: ["--shot", "--shots", "--render", "--frames", "--await", "--out-dir"],
      snapshot: ["--edges"],
    };
    const USAGE_FLAGS_0_16_2 = {
      ...USAGE_FLAGS,
      "docs read": [...USAGE_FLAGS["docs read"], "--if-version"],
      run: ["--shot", "--frame"],
      "run-stills": ["--shots", "--frames", "--force"],
    };
    // 0.16.2 的 scene3d_apply 各 op 字段（`./policy` 的 SCENE3D_ACTION_FIELDS，契约 scene3d.ops[op].fields 同一份）。
    // 0.16.2 条目只探了 op 的集合（scene3dOps / scene3dActionOps），没探字段，于是 0.16.3 在 add_shot / update_shot
    // 上加 states / cuts、在 set_figure 上加 seat / lean / heldL / heldR 而功能面一个键都没变（核查 2026-10-12）。
    // 0.16.3 起逐 op 探字段（scene3dActionFields），这张表只用来写出 0.16.3 相对 0.16.2 的真实差异。
    const SCENE3D_SHOT_FIELDS_0_16_2 = [
      "id",
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
      "onAxis",
    ];
    const SCENE3D_ACTION_FIELDS_0_16_2 = {
      add_object: ["id", "role", "kind", "prefab", "name", "transform", "color", "bodyType"],
      transform: ["id", "position", "rotation", "scale"],
      remove: ["id"],
      duplicate: ["id", "newId"],
      set_camera: ["id", "name", "position", "target", "fov", "focal", "active"],
      set_scene: ["aspectRatio", "gridSize"],
      set_figure: ["id", "pose", "arms", "armL", "armR", "facing", "gaze", "bodyType"],
      set_axis: ["ends"],
      set_focus: ["id", "shape"],
      add_shot: SCENE3D_SHOT_FIELDS_0_16_2,
      update_shot: SCENE3D_SHOT_FIELDS_0_16_2,
      reorder_shots: ["order"],
      remove_shot: ["id"],
    };
    // 0.16.3：镜头的起止人物状态 states 与子镜头 cuts（插在 moves 之后、onAxis 之前），人物的座面 seat、躯干前后倾
    // lean、左右手持物 heldL / heldR（插在 gaze 之后、bodyType 之前）——字段表里的顺序就是 policy 的顺序。
    const withShotStates = (fields) => [
      ...fields.slice(0, -1),
      "states",
      "cuts",
      fields[fields.length - 1],
    ];
    const SCENE3D_ACTION_FIELDS_0_16_3 = {
      ...SCENE3D_ACTION_FIELDS_0_16_2,
      set_figure: [
        ...SCENE3D_ACTION_FIELDS_0_16_2.set_figure.slice(0, -1),
        "seat",
        "lean",
        "heldL",
        "heldR",
        "bodyType",
      ],
      add_shot: withShotStates(SCENE3D_SHOT_FIELDS_0_16_2),
      update_shot: withShotStates(SCENE3D_SHOT_FIELDS_0_16_2),
    };
    // 0.16.2 的自检数据健康码（契约 scene3d.checks.healthCodes）；0.16.3 在最前面加了人与家具接触的四个码。
    const SCENE3D_HEALTH_CODES_0_16_2 = [
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
      "orbit_cam_ignored",
    ];
    const SCENE3D_HEALTH_CODES_0_16_3 = [
      "body_penetration",
      "invalid_support",
      "held_conflict",
      "subshot_invalid",
      ...SCENE3D_HEALTH_CODES_0_16_2,
    ];
    // 0.16.4 在最后加了接触检查的三条提醒（warn）。
    const SCENE3D_HEALTH_CODES_0_16_4 = [
      ...SCENE3D_HEALTH_CODES_0_16_3,
      "seat_unbound",
      "support_gap",
      "held_offset",
    ];
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
    // 0.16.2（叠在 0.15.1 之上；纳入作者自己的 0.16.1 B1 与文档库 CDN，与镜尾帧 / 站位图并成这一版，
    // A67 / A68 / A70），协议 2 / 桥 3 不变，0.15.1 的 localTools（A57 / A60）原样带着 ——
    //  · 三维导演台 S1–S4（F012/F048，scene3d@1）：第 30 条 apply 命令 scene3d_apply（applyCommands /
    //    tierApplyCommands；分级面带 destructiveOps）；契约新块 scene3d（= SCENE3D 导出：13 个 op 与字段、词表、
    //    预制件、区间、上限、单位、digest、自检）；bridgeErrors 多了 scene3d_conflict；policy 新导出
    //    SCENE3D_ACTION_FIELDS / SCENE3D_ACTIONS_MAX / RUN_NODE_FIELDS（run_node 多给即报错）；
    //    CLI `run --shot SHOT-ID`（run_node.shotId）。
    //  · 镜尾帧与站位图（A67 ②）：CLI `run --frame start|end`（run_node.frame；runNodeFields 多了 frame）、policy
    //    新导出 SCENE3D_STILL_FRAMES、契约 scene3d.enums.frame（同一个数组）；第 43 条子命令 `run-stills`（wire
    //    方法 run_stills，mainOnly，tiers 带 billable:false）；policy 新导出 RUN_STILLS_FIELDS / RUN_STILLS_SHOTS_MAX；
    //    契约 limits["run_stills.shotIds"]、scene3d.limits.stillsPerRun / stillsBudgetMs、scene3d.stillSkipReasons
    //    （续跑 up_to_date、换过图的 replaced；RUN_STILLS_FIELDS 含 force，换过图的也由它重出）；三维节点的 run
    //    不扣费：tiers.run.localKinds = ["scene-3d"]（runTier）。
    //  · 文档库正文改存 CDN 文件（A68）：契约 documents.fields 多了 contentUrl（在 contentSha 之后）；documents.errors
    //    多了 uploadFailed / contentUnavailable / quotaExceeded（单项目 50 MB 超了，HTTP 400，带 usedBytes /
    //    limitBytes）/ tooLarge；policy DOCUMENTS_GET_FIELDS 多了 ifVersion（CLI `docs read --if-version N`，没变就
    //    不回正文）；documents.contentMaxChars 1,000,000 → 50,000（值变更，不是加法：旧钉包本地预检放行、页面侧
    //    校验拒）；documents.limits.uploadChapters 2000。
    //  · usageFlags：run 多了 --shot / --frame，run-stills 三个（--shots / --frames / --force），docs read 多了 --if-version。
    // scene3dOps 起往后的各项都从 0.16.2 起才探；更早的条目按发版规矩不改。
    VERSION_FEATURES["0.16.2"] = {
      ...VERSION_FEATURES["0.15.1"],
      contractBlocks: [...VERSION_FEATURES["0.15.1"].contractBlocks, "scene3d"].sort(),
      applyCommands: APPLY_COMMANDS_30,
      tierApplyCommands: APPLY_COMMANDS_30,
      cliSubcommands: [...VERSION_FEATURES["0.15.1"].cliSubcommands, "run-stills"].sort(),
      mainMethods: [...VERSION_FEATURES["0.15.1"].mainMethods, "run_stills"].sort(),
      usageFlags: USAGE_FLAGS_0_16_2,
      // 三维导演台 S1–S4（scene3d@1）：13 个 op、破坏性 op 与分级表同一份、冲突码不可重试、
      // run_node 的字段白名单（镜尾帧多了 frame）、digest 算法与哨兵、fov 区间放宽到 [2, 140]。
      scene3dOps: SCENE3D_OPS,
      scene3dDestructiveOps: ["remove", "remove_shot"],
      scene3dConflict: { retryable: false },
      scene3dTierDestructiveOps: ["remove", "remove_shot"],
      runNodeFields: ["nodeId", "approval", "clearCandidates", "shotId", "frame"],
      scene3dActionOps: SCENE3D_OPS,
      scene3dDigest: { algorithm: "fnv1a64-utf16-sorted-json", newSentinel: "new" },
      scene3dFovRange: { min: 2, max: 140 },
      // 镜尾帧与站位图（A67 ②）。
      scene3dStillFrames: ["start", "end"],
      scene3dFrameEnum: ["start", "end"],
      runStillsFields: ["nodeId", "shotIds", "frames", "force", "approval"],
      runStillsTier: {
        level: "L2",
        method: "run_stills",
        mutation: true,
        mainOnly: true,
        approval: true,
        timeoutTier: "wait",
        billable: false,
      },
      runStillsShotIdsLimit: { min: 1, max: 60, itemMaxLength: 128 },
      scene3dStillLimits: { stillsPerRun: 120, stillsBudgetMs: 90000 },
      scene3dStillSkipReasons: ["budget", "cancelled", "page_away", "replaced", "up_to_date"],
      // 三维节点的 run 不扣费：tiers.run.localKinds（与 run-tool.localKinds 同一个先例）。
      runTier: {
        level: "L2",
        method: "run_node",
        mutation: true,
        mainOnly: true,
        approval: true,
        timeoutTier: "wait",
        localKinds: ["scene-3d"],
      },
      // 文档库正文改存 CDN 文件（A68）。
      documentsGetFields: ["id", "ifVersion"],
      // 单篇上限从 100 万字收到 5 万字（A66 保留：值变更，CHANGELOG 标 Changed）。
      documentsContentMaxChars: 50000,
      // 小说一次上传最多 2000 章（A68 调度拍板 ②）。
      documentsUploadChapters: 2000,
      documentsFields: [
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
      documentsErrors: {
        conflict: "doc_conflict",
        notFound: "doc_not_found",
        uploadFailed: "upload_failed",
        contentUnavailable: "content_unavailable",
        quotaExceeded: "quota_exceeded",
        tooLarge: "too_large",
      },
      // 三维导演台的两条上限（最终验收补钉）：一批 scene3d_apply 最多 200 个动作（policy 的 SCENE3D_ACTIONS_MAX）、
      // run --shot 的镜头 id 最长 128 字 —— 改了就是功能面变了，要换版本号。
      scene3dApplyActionsLimit: { min: 1, max: 200 },
      runNodeShotIdLimit: { maxLength: 128 },
    };
    // 0.16.1（B1 补丁：守护进程闭包与 0.16.0 逐字节相同）：命令、apply 命令、op、字段、旗标都没动 ——
    //  · 契约新块 hostText（宿主必须贴出的字段，按 CLI 子命令登记）与 packageVersion；
    //  · bridgeErrors 多了 render_interrupted / collab_offline（可重试，不进 cliExitCodes）；
    //  · tiers.run.localKinds = ["scene-3d"]（节点 kind：本地渲染、不扣费）；
    //  · draftKeys.gen 多了 audioSpeaker；scene3d.checks 多了 cutExemptionLabels。
    //  · ./contract 再导出 formatScene3dSummary（scene3d_apply 回包的人话版，页面与宿主共用）。
    // 最后六项从 0.16.1 起才探；更早的条目按发版规矩不改。
    VERSION_FEATURES["0.16.0"] = {
      ...VERSION_FEATURES["0.15.1"],
      contractBlocks: [...VERSION_FEATURES["0.15.1"].contractBlocks, "scene3d"].sort(),
      applyCommands: APPLY_COMMANDS_30,
      tierApplyCommands: APPLY_COMMANDS_30,
      usageFlags: USAGE_FLAGS_0_16,
      // scene3d@1（0.16.0 起才探）：13 个 op、破坏性 op 与分级表同一份、冲突码不可重试、
      // run_node 的字段白名单、digest 算法与哨兵、fov 区间放宽到 [2, 140]。
      scene3dOps: SCENE3D_OPS,
      scene3dDestructiveOps: ["remove", "remove_shot"],
      scene3dConflict: { retryable: false },
      scene3dTierDestructiveOps: ["remove", "remove_shot"],
      runNodeFields: ["nodeId", "approval", "clearCandidates", "shotId"],
      scene3dActionOps: SCENE3D_OPS,
      scene3dDigest: { algorithm: "fnv1a64-utf16-sorted-json", newSentinel: "new" },
      scene3dFovRange: { min: 2, max: 140 },
    };
    VERSION_FEATURES["0.16.1"] = {
      ...VERSION_FEATURES["0.16.0"],
      contractBlocks: [
        ...VERSION_FEATURES["0.16.0"].contractBlocks,
        "hostText",
        "packageVersion",
      ].sort(),
      hostTextCommands: [
        "*",
        "apply",
        "changes",
        "connect",
        "export-jianying",
        "health",
        "list-canvases",
        "ls",
        "read",
        "redo",
        "resources",
        "run",
        "run-batch",
        "snapshot",
        "status",
        "tasks",
        "timeline",
        "undo",
      ],
      runLocalNodeKinds: ["scene-3d"],
      draftKeysGenHasAudioSpeaker: true,
      packageVersion: "0.16.1",
      cutExemptionLabels: { moving: "运动镜", resize: "景别跨档", subject: "换主体" },
      // `scene3dSummary` 的渲染从页面搬进包（src/scene3d-text.mjs），经 ./contract 再导出（tidy 先例）。
      formatScene3dSummary: "function",
    };
    // Combined release retains B1 host reply requirements alongside independent start/end stills.
    const b1 = VERSION_FEATURES["0.16.1"];
    Object.assign(VERSION_FEATURES["0.16.2"], {
      contractBlocks: [
        ...VERSION_FEATURES["0.16.2"].contractBlocks,
        "hostText",
        "packageVersion",
      ].sort(),
      hostTextCommands: b1.hostTextCommands,
      runLocalNodeKinds: b1.runLocalNodeKinds,
      draftKeysGenHasAudioSpeaker: b1.draftKeysGenHasAudioSpeaker,
      packageVersion: "0.16.2",
      cutExemptionLabels: b1.cutExemptionLabels,
      formatScene3dSummary: b1.formatScene3dSummary,
    });
    // 0.16.3（test 03189f8b / e9d0913d，Codex 149ed0f3 带进来的新面；发版时 CHANGELOG 写成「Wire/export surfaces are
    // unchanged」、这里只改了 packageVersion —— 不实，2026-10-12 核查补登）。相对 0.16.2 的真实差异：
    //  · scene3d_apply：add_shot / update_shot 多收 states（≤ 20 条 {who, from?, to?}，起止人物状态）与 cuts
    //    （1..60 个子镜头，各带正的 dur），set_figure 多收 seat / lean（−45..45 度）/ heldL / heldR —— 守护进程按
    //    `./policy` 的 SCENE3D_ACTION_FIELDS 放行，老守护进程回「Unexpected scene3d <op> field」，老页面回
    //    invalid_request（所以画布必须先于用这些字段的剧本转视频 3.35.x 部署）；
    //  · 契约 scene3d.checks.healthCodes 多四个「拦下」档的码：body_penetration（人体穿进实体家具）、
    //    invalid_support（座面目标不能坐）、held_conflict（同一件东西被两个人拿着）、subshot_invalid（子镜头时长
    //    合计与段时长不一致）。
    // 新探两项 scene3dActionFields（逐 op 的字段表）与 scene3dHealthCodes；更早的条目按发版规矩不改。
    VERSION_FEATURES["0.16.3"] = {
      ...VERSION_FEATURES["0.16.2"],
      packageVersion: "0.16.3",
      scene3dActionFields: SCENE3D_ACTION_FIELDS_0_16_3,
      scene3dHealthCodes: SCENE3D_HEALTH_CODES_0_16_3,
    };
    // 0.16.4（A78，2026-10-12 核查修复）：在 0.16.3 之上只做加法 —— 补登记 0.16.3 漏登的那几项（上一条），功能面
    // 其余与 0.16.3 相同。
    //  · 身份色进契约（A78 追加 ⑫）：新块 scene3d.identity（调色板 colors / labels、布景灰 setColor、算法名 hash），
    //    ./contract 再导出 scene3dIdentityColor / scene3dColorLabel / allocateIdentityColors —— 剧本转视频改读这里。
    //  · 产品场景的隐藏判定进契约（A78 ⑥）：新块 scene3d.embedded（idPattern / idFlags，页面 0.16.3 起就按它隐藏）。
    //  · 接触检查全身采样（A78 ⑧ 补充、A83）：scene3d.checks.healthCodes 末尾多三个提醒码 seat_unbound（坐姿没绑定
    //    座面）、support_gap（站着脚底离开 / 陷进支撑面）、held_offset（手里的东西离手太远）。
    // 最后三项从 0.16.4 起才探。
    VERSION_FEATURES["0.16.4"] = {
      ...VERSION_FEATURES["0.16.3"],
      packageVersion: "0.16.4",
      scene3dHealthCodes: SCENE3D_HEALTH_CODES_0_16_4,
      scene3dIdentity: {
        colors: [
          "#e85d5d",
          "#36b89a",
          "#4c91ed",
          "#edb443",
          "#a475df",
          "#ef86ba",
          "#ef8945",
          "#43b7cb",
        ],
        labels: ["红色", "绿色", "蓝色", "黄色", "紫色", "粉色", "橙色", "青色"],
        setColor: "#697681",
        hash: "fnv1a32-nfkc-trim-lower",
      },
      scene3dIdentityFunctions: "function,function,function",
      scene3dEmbedded: { idPattern: "^s3d-ep[0-9]{2,4}-p[0-9]{2,4}$", idFlags: "i" },
    };
    // 0.17.0（列车 2）在镜头字段末尾加的动画字段，与调度动作 add_act / update_act 的字段（policy 的顺序）。
    const SCENE3D_SHOT_ANIM_FIELDS_0_17 = ["start", "via", "follow", "shake"];
    const SCENE3D_ACT_FIELDS_0_17 = [
      "id",
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
    ];
    // 0.17.0（B3-integrate 起点 + B6 收口；守护进程闭包变了：policy.mjs、daemon.mjs 的 packageVersion）：
    //  · scene3d op 16 个（+ add_act / update_act / remove_act），remove_act 进破坏性 op（分级表同一份）；
    //  · run_node 收 shotIds / allShots / render / sheetFrames；run_nodes 的参数面多给即报错；
    //  · scene3d.checks 的 healthCodes +3（16 个）与 motion 段（8 个码）；
    //  · 枚举小提交：scene3d.checks 的 framing 段（8 个码）与 scene3d.framing.sizes（景别阶梯 9 档）；
    //  · B6：动画词表（enums / ranges / limits / units 新项）、limits["run_node.shotIds"]、./contract 再导出
    //    formatScene3dScene / formatScene3dChecks、CLI 带值旗标 run --shots/--render/--frames/--await/--out-dir
    //    与 snapshot --edges（USAGE_FLAGS_0_17）、hostText.status 的 packageVersion。
    // runNodesFields 起的各项从 0.17.0 起才探；更早的条目按发版规矩不改。
    // 合流（D-87）：0.17.0 = 0.16.1（我们已 tag）∪ 0.16.2（并行发版线已 tag）∪ 列车 2 —— 以合并后的 0.16.2 条目为底
    // （它已带上 0.16.1 的 hostText 等六项，以及站位图 / 镜尾帧 / 文档库 CDN 各项），再叠列车 2；run_node 的字段面是
    // 两边的并集（frame 与 shotIds / allShots / render / sheetFrames）。0.16.1、0.16.2 两条各自对应已 tag 的树，不改。
    // 合流（D-91，B12）：再并进 0.16.3 / 0.16.4（并行线已 tag）—— 底换成 0.16.4 的条目（带上 scene3dActionFields /
    // identity / embedded），scene3dHealthCodes 从「个数」改成与 0.16.3 起同一个探针（整张表）：0.16.4 的 20 个在前、
    // 列车 2 的 4 个（shot_missing_dur / act_conflict / hold_invalid / object_below_ground）在后；字段表在 0.16.3 的
    // 那一份上叠列车 2 的镜头字段（start / via / follow / shake）与 add_act / update_act / remove_act。
    const SCENE3D_OPS_0_17 = [...SCENE3D_OPS, "add_act", "remove_act", "update_act"].sort();
    VERSION_FEATURES["0.17.0"] = {
      ...VERSION_FEATURES["0.16.4"],
      scene3dOps: SCENE3D_OPS_0_17,
      scene3dActionOps: SCENE3D_OPS_0_17,
      scene3dDestructiveOps: ["remove", "remove_shot", "remove_act"],
      scene3dTierDestructiveOps: ["remove", "remove_shot", "remove_act"],
      runNodeFields: [
        "nodeId",
        "approval",
        "clearCandidates",
        "shotId",
        "shotIds",
        "allShots",
        "render",
        "sheetFrames",
        "frame",
      ],
      packageVersion: "0.17.0",
      // B12 复核：身份色多登记没起名字时的缺省名（不算名字、用 id），./contract 多再导出两个按存储的对象复算的函数
      scene3dIdentity: {
        ...VERSION_FEATURES["0.16.4"].scene3dIdentity,
        defaultNames: {
          human: "人物",
          box: "立方体",
          cylinder: "圆柱",
          plane: "平面",
          backdrop: "背景板",
        },
      },
      scene3dObjectIdentityFunctions: "function,function",
      // B9-FX-56：撤销护栏原样写回的节点记一条 update + undo_restored（不再是 delete 再 add）
      changesNotes: [...VERSION_FEATURES["0.16.2"].changesNotes, "undo_restored"],
      runNodesFields: [
        "nodeIds",
        "groupId",
        "concurrency",
        "rerunSucceeded",
        "clearCandidates",
        "approval",
      ],
      scene3dHealthCodes: [
        ...SCENE3D_HEALTH_CODES_0_16_4,
        "shot_missing_dur",
        "act_conflict",
        "hold_invalid",
        "object_below_ground",
        // B14（L2 P1）：身份色撞色
        "identity_color_clash",
      ],
      scene3dActionFields: {
        ...SCENE3D_ACTION_FIELDS_0_16_3,
        // B14（L2 P1）：transform 收 color，撞色提醒的换色动作
        transform: [...SCENE3D_ACTION_FIELDS_0_16_3.transform, "color"],
        add_shot: [...SCENE3D_ACTION_FIELDS_0_16_3.add_shot, ...SCENE3D_SHOT_ANIM_FIELDS_0_17],
        update_shot: [
          ...SCENE3D_ACTION_FIELDS_0_16_3.update_shot,
          ...SCENE3D_SHOT_ANIM_FIELDS_0_17,
        ],
        add_act: SCENE3D_ACT_FIELDS_0_17,
        update_act: SCENE3D_ACT_FIELDS_0_17,
        remove_act: ["id"],
      },
      scene3dMotionCodes: [
        "axis_motion",
        "figure_collision",
        "speed",
        "move_while_posed",
        "prop_unsupported",
        "cut_jump",
        "screen_direction",
        "act_unseen",
      ],
      scene3dFramingCodes: [
        "cam_inside",
        "cam_below_ground",
        "cam_too_close",
        "subject_out",
        "head_out",
        "subject_blocked",
        "foreground_fill",
        "framing_mismatch",
      ],
      scene3dFramingSizes: 9,
      scene3dAnimEnums: {
        gait: ["walk", "run"],
        shake: ["light", "medium", "heavy"],
        hand: ["right", "left"],
        gesture: ["wave", "nod", "shake_head", "bow", "beckon", "point_at"],
        render: ["still", "video", "sheet"],
        sheetFrames: [3, 5, 9],
        actSentinels: ["@keep", "@none", "@drop"],
      },
      scene3dAnimRanges: {
        at: { min: 0, max: 600 },
        start: { min: 0, max: 600 },
        viaT: { exclusiveMin: 0, exclusiveMax: 1 },
      },
      scene3dAnimLimits: { acts: 200, viaPerShot: 8, viaPerAct: 8 },
      scene3dAnimUnits: { time: "s", shotProgress: "unit-interval" },
      runNodeShotIdsLimit: { min: 1, max: 60, itemMaxLength: 128 },
      scene3dFormatters: "function,function,function",
      runSnapshotFlags: USAGE_FLAGS_0_17,
      hostTextStatusHasPackageVersion: true,
    };
    // 0.18.0（站位图 / 预演 / 先修数据再自检，A86 + 补充 + 补充 2、A87、A88；两条开发线 T1–T3 与 T4–T7 合流定稿，守护进程
    // 闭包变了：policy.mjs 的 run_shot_refs 与 apply 审批文案、daemon.mjs 的 packageVersion）：
    //  · T1 俯视全景：契约新块 scene3d.overview（场景正面偏右 30°、俯 45°、整场共用一个机位、各镜起止并集定框、地面网格、
    //    不画标签、产品场景缺省）；页面画法版本 RENDER_REV 5 → 6（之前的站位图 / 静帧 / 镜头卡判过期 —— 页面内部，不进契约）。
    //  · T2 产品场景一镜一段预演：run --render video 不再拒收产品场景、卡名 epXX-PYY-SZZ运镜预演、与两张站位图三联、卡上
    //    previzOf（页面行为与读回字段，契约里没有对应的块，不探）。
    //  · T3 run-shot-refs：新子命令、新线协议方法、字段面、分级、镜头数上限、预算封顶与调用等待、三样的顺序。
    //  · T4 先修数据再自检：契约新块 scene3d.repairs（四个码、三个常量），hostText.apply 多 scene3d[].repairs[] 五条；越轴 /
    //    接缝 < 30° 从 apply 摘要挪到出预演（run --render video、run-shot-refs）回包的 notes[]：hostText.apply 不再要求
    //    scene3d[].checks.axis.message / checks.cuts[].message。动作问题一次报全（error.issues[]）是页面回包，不进契约。
    //  · T5 人改过：契约新块 scene3d.humanEdit（remove / remove_shot 只在打到人改过的对象 / 镜头时要同意）。
    //  · T6 按集身份色：scene3d.identity 多六个键（12 个可念色、道具白 / 浅灰、群演灰），./contract 再导出
    //    allocateEpisodeIdentityColors / checkEpisodeIdentityColors。
    // scene3dEpisodeIdentityFunctions、scene3dHumanEdit、scene3dRepairs、hostTextApplyScene3d 四项从 0.18.0 起才探；
    // 更早的条目按发版规矩不改。
    const STATION_PREVIZ_0_18 = {
      cliSubcommands: [...VERSION_FEATURES["0.17.0"].cliSubcommands, "run-shot-refs"].sort(),
      mainMethods: [...VERSION_FEATURES["0.17.0"].mainMethods, "run_shot_refs"].sort(),
      runShotRefsFields: ["nodeId", "shotIds", "force", "approval"],
      runShotRefsTier: {
        level: "L2",
        method: "run_shot_refs",
        mutation: true,
        mainOnly: true,
        approval: true,
        timeoutTier: "wait",
        billable: false,
      },
      runShotRefsShotIdsLimit: { min: 1, max: 60, itemMaxLength: 128 },
      scene3dShotRefLimits: { shotRefsBudgetMs: 240000, shotRefsCallMs: 255000 },
      scene3dShotRefParts: ["start", "end", "previz"],
      scene3dOverviewKeys: ["bounds", "camera", "grid", "labels", "productDefault"],
    };
    const AUTO_REPAIR_0_18 = {
      scene3dIdentity: {
        ...VERSION_FEATURES["0.17.0"].scene3dIdentity,
        namedColors: [
          "#e85d5d",
          "#4c91ed",
          "#edb443",
          "#36b89a",
          "#a475df",
          "#ef8945",
          "#ef86ba",
          "#43b7cb",
          "#a0623a",
          "#b5d334",
          "#3a7d44",
          "#c3b091",
        ],
        namedLabels: [
          "红色",
          "蓝色",
          "黄色",
          "绿色",
          "紫色",
          "橙色",
          "粉色",
          "青色",
          "棕色",
          "黄绿色",
          "墨绿色",
          "卡其色",
        ],
        propColors: ["#f2f2f2", "#b9bec4"],
        propLabels: ["白色", "浅灰色"],
        extrasColor: "#9097a0",
        extrasLabel: "灰色",
      },
      scene3dEpisodeIdentityFunctions: "function,function",
      scene3dHumanEdit: {
        field: "editedBy",
        value: "human",
        approvalOps: ["remove", "remove_shot"],
      },
      scene3dRepairs: {
        codes: ["grounded", "held_to_hand", "pushed_out", "camera_merged"],
        constants: { PUSH_MAX_M: 0.1, HELD_SNAP_MAX_M: 0.3, SUGGEST_MAX_M: 2 },
      },
      hostTextApplyScene3d: [
        "scene3d[].repairs[].code",
        "scene3d[].repairs[].id",
        "scene3d[].repairs[].field",
        "scene3d[].repairs[].from",
        "scene3d[].repairs[].to",
      ],
    };
    VERSION_FEATURES["0.18.0"] = {
      ...VERSION_FEATURES["0.17.0"],
      ...STATION_PREVIZ_0_18,
      ...AUTO_REPAIR_0_18,
      packageVersion: "0.18.0",
    };
    // 0.18.1（A95 / A96 / A97 修法 ③；守护进程闭包的文件一个没改，它报的 packageVersion 跟着 package.json 变）：
    //  · A95 产品场景的三维卡照常显示、到站位图 / 预演卡画归属虚线、三联摆位把三维卡算进占位：都是页面行为，
    //    scene3d.embedded 的数据（idPattern / idFlags）不变，只改了说明。
    //  · A96 站位图按镜拉近、固定 16:9：scene3d.overview 多 minFigureFraction / figureMarginRatio / aspectRatio / stillSize /
    //    previzSize 五个键（figureMarginRatio：全员完整入画优先于 1/3，调度 2026-10-14 拍板），
    //    camera 的 sharedPerScene 换成 directionPerScene + sharedPerShot，bounds 多 cuts / subjects；整块从 0.18.1 起探
    //    （scene3dOverview —— 只探键名挡不住改值，0.18.0 的四个键之外机位与取景规则都在块里）。画法版本 6 → 7 是页面内部的，不进契约。
    //  · A97 修法 ③ 脚底贴面：scene3d.repairs 多码 figure_grounded、常量 FIGURE_GROUND_MAX_M 0.1。
    // 更早的条目按发版规矩不改。
    VERSION_FEATURES["0.18.1"] = {
      ...VERSION_FEATURES["0.18.0"],
      scene3dOverviewKeys: [
        "aspectRatio",
        "bounds",
        "camera",
        "figureMarginRatio",
        "grid",
        "labels",
        "minFigureFraction",
        "previzSize",
        "productDefault",
        "stillSize",
      ],
      scene3dOverview: {
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
      },
      scene3dRepairs: {
        codes: ["grounded", "figure_grounded", "held_to_hand", "pushed_out", "camera_merged"],
        constants: {
          PUSH_MAX_M: 0.1,
          HELD_SNAP_MAX_M: 0.3,
          SUGGEST_MAX_M: 2,
          FIGURE_GROUND_MAX_M: 0.1,
        },
      },
      packageVersion: "0.18.1",
    };
    // 0.18.2（A102 ④ ⑧ ⑨；守护进程闭包里只有 policy 变了：scene3d_apply 多收 set_figure.offstage 与 add_act /
    // update_act 的 do，0.18.1 的守护进程拒收它们 —— CLI 的旧对端提示认得这两个字段）：
    //  · ④ 穿模原话带深度、坐姿朝向 / 调度帧 / 地板盒子给 fix，read 与 apply 同一份 checks：新块 scene3d.contact（整块探），
    //    自检数据健康码多 sunk_in_floor。
    //  · ⑧ 在场模型：新块 scene3d.presence（整块探），act 保留词多 @enter / @offstage，set_figure 多 offstage、
    //    add_act / update_act 多 do。
    //  · ⑨ 俯视方向三级：scene3d.overview 多 direction / cutaway 两个键（整块探针 scene3dOverview 跟着变）。画法版本
    //    7 → 8 是页面内部的，不进契约。
    // 更早的条目按发版规矩不改；scene3dContact / scene3dPresence 两个探针从这一版起才有。
    const ACT_FIELDS_0_18_2 = [
      "id",
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
    VERSION_FEATURES["0.18.2"] = {
      ...VERSION_FEATURES["0.18.1"],
      scene3dHealthCodes: [...VERSION_FEATURES["0.18.1"].scene3dHealthCodes, "sunk_in_floor"],
      scene3dActionFields: {
        ...VERSION_FEATURES["0.18.1"].scene3dActionFields,
        set_figure: [...VERSION_FEATURES["0.18.1"].scene3dActionFields.set_figure, "offstage"],
        add_act: ACT_FIELDS_0_18_2,
        update_act: ACT_FIELDS_0_18_2,
      },
      scene3dAnimEnums: {
        ...VERSION_FEATURES["0.18.1"].scene3dAnimEnums,
        actSentinels: ["@keep", "@none", "@drop", "@enter", "@offstage"],
      },
      scene3dOverviewKeys: [
        "aspectRatio",
        "bounds",
        "camera",
        "cutaway",
        "direction",
        "figureMarginRatio",
        "grid",
        "labels",
        "minFigureFraction",
        "previzSize",
        "productDefault",
        "stillSize",
      ],
      scene3dOverview: {
        ...VERSION_FEATURES["0.18.1"].scene3dOverview,
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
      scene3dContact: {
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
      scene3dPresence: {
        figureField: "offstage",
        actField: "do",
        enter: "@enter",
        exit: "@offstage",
        enterFields: ["to", "facing"],
        notOnStage: ["render", "contact", "framing", "axis", "cuts", "motion"],
        endFrameExclusive: true,
      },
      packageVersion: "0.18.2",
    };
    VERSION_FEATURES["0.18.3"] = {
      ...VERSION_FEATURES["0.18.2"],
      contractBlocks: [...VERSION_FEATURES["0.18.2"].contractBlocks, "layout"].sort(),
      packageVersion: "0.18.3",
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
          'import * as contractModule from "@scenemint/canvas-cli/contract";',
          "const { CANVAS_CONTRACT, formatTidySummary } = contractModule;",
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
          "const pick = (block, keys) => Object.fromEntries(keys.map((key) => [key, block?.[key] ?? null]));",
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
          `  usageFlags: Object.fromEntries(Object.entries(${JSON.stringify(USAGE_FLAGS_0_16_2)}).map(([command, flags]) => [command, flags.filter((flag) => taught(command, flag))])),`,
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
          // 0.16.2 起才探（三维导演台 S1–S4，scene3d@1）。
          "  scene3dOps: Object.keys(CANVAS_CONTRACT.scene3d?.ops ?? {}).sort(),",
          "  scene3dDestructiveOps: CANVAS_CONTRACT.scene3d?.destructiveOps ?? null,",
          "  scene3dConflict: CANVAS_CONTRACT.bridgeErrors.scene3d_conflict ?? null,",
          "  scene3dTierDestructiveOps: CANVAS_CONTRACT.tiers?.applyCommands?.scene3d_apply?.destructiveOps ?? null,",
          "  runNodeFields: policy.RUN_NODE_FIELDS ?? null,",
          "  scene3dActionOps: policy.SCENE3D_ACTION_FIELDS ? Object.keys(policy.SCENE3D_ACTION_FIELDS).sort() : null,",
          "  scene3dDigest: CANVAS_CONTRACT.scene3d?.digest ?? null,",
          "  scene3dFovRange: CANVAS_CONTRACT.scene3d?.ranges?.fov ?? null,",
          // 0.16.2 起才探（A68：文档库正文改存 CDN 文件）。
          "  documentsGetFields: policy.DOCUMENTS_GET_FIELDS ?? null,",
          "  documentsContentMaxChars: CANVAS_CONTRACT.documents?.contentMaxChars ?? null,",
          "  documentsUploadChapters: CANVAS_CONTRACT.documents?.limits?.uploadChapters ?? null,",
          "  documentsFields: CANVAS_CONTRACT.documents?.fields ?? null,",
          "  documentsErrors: CANVAS_CONTRACT.documents?.errors ?? null,",
          // 0.16.2 起才探（镜尾帧、站位图）。
          "  scene3dStillFrames: policy.SCENE3D_STILL_FRAMES ?? null,",
          "  scene3dFrameEnum: CANVAS_CONTRACT.scene3d?.enums?.frame ?? null,",
          "  runStillsFields: policy.RUN_STILLS_FIELDS ?? null,",
          '  runStillsTier: CANVAS_CONTRACT.tiers?.["run-stills"] ?? null,',
          '  runStillsShotIdsLimit: CANVAS_CONTRACT.limits["run_stills.shotIds"] ?? null,',
          "  scene3dStillLimits: CANVAS_CONTRACT.scene3d?.limits ? { stillsPerRun: CANVAS_CONTRACT.scene3d.limits.stillsPerRun ?? null, stillsBudgetMs: CANVAS_CONTRACT.scene3d.limits.stillsBudgetMs ?? null } : null,",
          "  scene3dStillSkipReasons: CANVAS_CONTRACT.scene3d?.stillSkipReasons ?? null,",
          "  runTier: CANVAS_CONTRACT.tiers?.run ?? null,",
          // 0.16.2 起才探（最终验收补钉）：三维导演台的两条上限。
          '  scene3dApplyActionsLimit: CANVAS_CONTRACT.limits["scene3d_apply.actions"] ?? null,',
          '  runNodeShotIdLimit: CANVAS_CONTRACT.limits["run_node.shotId"] ?? null,',
          // 0.16.1 起才探的六项。
          "  hostTextCommands: CANVAS_CONTRACT.hostText ? Object.keys(CANVAS_CONTRACT.hostText).sort() : null,",
          "  runLocalNodeKinds: CANVAS_CONTRACT.tiers?.run?.localKinds ?? null,",
          '  draftKeysGenHasAudioSpeaker: CANVAS_CONTRACT.draftKeys.gen.includes("audioSpeaker"),',
          "  packageVersion: CANVAS_CONTRACT.packageVersion ?? null,",
          "  cutExemptionLabels: CANVAS_CONTRACT.scene3d?.checks?.cutExemptionLabels ?? null,",
          "  formatScene3dSummary: typeof contractModule.formatScene3dSummary,",
          // 0.16.3 起才探：scene3d_apply 逐 op 的字段（只探 op 集合挡不住加字段）与自检数据健康码。
          "  scene3dActionFields: policy.SCENE3D_ACTION_FIELDS ? Object.fromEntries(Object.entries(policy.SCENE3D_ACTION_FIELDS).map(([op, fields]) => [op, [...fields]])) : null,",
          "  scene3dHealthCodes: CANVAS_CONTRACT.scene3d?.checks?.healthCodes ?? null,",
          // 0.16.4 起才探：身份色（数据与三个再导出的函数）。
          "  scene3dIdentity: CANVAS_CONTRACT.scene3d?.identity ?? null,",
          "  scene3dIdentityFunctions: [contractModule.scene3dIdentityColor, contractModule.scene3dColorLabel, contractModule.allocateIdentityColors].map((fn) => typeof fn).join(),",
          "  scene3dEmbedded: CANVAS_CONTRACT.scene3d?.embedded ?? null,",
          // 0.17.0 起才探（B12 复核）：按存储的对象复算身份色。
          "  scene3dObjectIdentityFunctions: [contractModule.scene3dObjectIdentity, contractModule.scene3dDefaultColor].map((fn) => typeof fn).join(),",
          // 0.17.0 起才探的各项（scene3dHealthCodes 合流后用上面 0.16.3 起的整张表探针，D-91）。
          "  runNodesFields: policy.RUN_NODES_FIELDS ?? null,",
          "  scene3dMotionCodes: CANVAS_CONTRACT.scene3d?.checks?.motionCodes ?? null,",
          "  scene3dFramingCodes: CANVAS_CONTRACT.scene3d?.checks?.framingCodes ?? null,",
          "  scene3dFramingSizes: CANVAS_CONTRACT.scene3d?.framing?.sizes?.length ?? 0,",
          '  scene3dAnimEnums: pick(CANVAS_CONTRACT.scene3d?.enums, ["gait", "shake", "hand", "gesture", "render", "sheetFrames", "actSentinels"]),',
          '  scene3dAnimRanges: pick(CANVAS_CONTRACT.scene3d?.ranges, ["at", "start", "viaT"]),',
          '  scene3dAnimLimits: pick(CANVAS_CONTRACT.scene3d?.limits, ["acts", "viaPerShot", "viaPerAct"]),',
          '  scene3dAnimUnits: pick(CANVAS_CONTRACT.scene3d?.units, ["time", "shotProgress"]),',
          '  runNodeShotIdsLimit: CANVAS_CONTRACT.limits["run_node.shotIds"] ?? null,',
          '  scene3dFormatters: [contractModule.formatScene3dSummary, contractModule.formatScene3dScene, contractModule.formatScene3dChecks].map((fn) => typeof fn).join(","),',
          `  runSnapshotFlags: Object.fromEntries(Object.entries(${JSON.stringify(USAGE_FLAGS_0_17)}).map(([command, flags]) => [command, flags.filter((flag) => taught(command, flag))])),`,
          '  hostTextStatusHasPackageVersion: JSON.stringify(CANVAS_CONTRACT.hostText?.status ?? {}).includes("packageVersion"),',
          // 0.18.0 起才探（站位图 / 预演线 T1–T3）。
          "  runShotRefsFields: policy.RUN_SHOT_REFS_FIELDS ?? null,",
          '  runShotRefsTier: CANVAS_CONTRACT.tiers?.["run-shot-refs"] ?? null,',
          '  runShotRefsShotIdsLimit: CANVAS_CONTRACT.limits["run_shot_refs.shotIds"] ?? null,',
          '  scene3dShotRefLimits: pick(CANVAS_CONTRACT.scene3d?.limits, ["shotRefsBudgetMs", "shotRefsCallMs"]),',
          "  scene3dShotRefParts: CANVAS_CONTRACT.scene3d?.shotRefParts ?? null,",
          "  scene3dOverviewKeys: CANVAS_CONTRACT.scene3d?.overview ? Object.keys(CANVAS_CONTRACT.scene3d.overview).sort() : null,",
          // 0.18.0 起才探（T4–T6：按集分色的两个函数、人改过标记、修数据、apply 回包必须贴出的修数据与越轴 / 接缝路径）。
          '  scene3dEpisodeIdentityFunctions: [contractModule.allocateEpisodeIdentityColors, contractModule.checkEpisodeIdentityColors].map((fn) => typeof fn).join(","),',
          "  scene3dHumanEdit: CANVAS_CONTRACT.scene3d?.humanEdit ?? null,",
          "  scene3dRepairs: CANVAS_CONTRACT.scene3d?.repairs ?? null,",
          '  hostTextApplyScene3d: (CANVAS_CONTRACT.hostText?.apply?.visible ?? []).filter((p) => ["scene3d[].repairs", "scene3d[].checks.axis", "scene3d[].checks.cuts"].some((prefix) => p.startsWith(prefix))),',
          // 0.18.1 起才探（A96：站位图按镜拉近、固定 16:9 —— 整块，键名之外的机位与取景规则也钉住）。
          "  scene3dOverview: CANVAS_CONTRACT.scene3d?.overview ?? null,",
          // 0.18.2 起才探（A102 ④ 穿模原话与改法、⑧ 在场模型 —— 整块）。
          "  scene3dContact: CANVAS_CONTRACT.scene3d?.contact ?? null,",
          "  scene3dPresence: CANVAS_CONTRACT.scene3d?.presence ?? null,",
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
    // 0.17.0 起版本四方对齐（00-contract §3.3）：package.json、cli.mjs 的 VERSION（help.version）、
    // CANVAS_CONTRACT.packageVersion（上面的探针）、装好包里守护进程的 status / connect 回包 packageVersion。
    assert.equal(help.version, pkg.version, "cli.mjs 的 VERSION 与 package.json 不一致");
    assert.equal(
      JSON.parse(probe.stdout).packageVersion,
      pkg.version,
      "CANVAS_CONTRACT.packageVersion 与 package.json 不一致",
    );
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
    assert.equal(
      session.packageVersion,
      pkg.version,
      "connect 回包的 packageVersion 不是装的这一版",
    );
    assert.equal(
      status.packageVersion,
      pkg.version,
      "守护进程 status.packageVersion 不是装的这一版",
    );
    // A-12：`run … --wait <数字>` 是把 --await 写成了 --wait（--wait 是页面不在时排队等的布尔旗标），
    // 在本地拦下并指向 --await，什么都不发。
    const wrongWait = await exec(
      process.execPath,
      [executable, "run", "s3d-1", "--wait", "90", "--approved", "--session", session.sessionId],
      { env, cwd: root },
    ).then(
      () => assert.fail("run --wait 90 应该在本地被拒"),
      (error) => error,
    );
    assert.equal(wrongWait.code, 2);
    const refused = JSON.parse(wrongWait.stdout);
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "invalid_argument");
    assert.match(refused.hint, /--await <秒>/);
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
