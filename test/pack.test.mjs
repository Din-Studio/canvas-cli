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
    // `exports` 里的 "./contract" 子路径必须真的能解析，且拿到的是同一份 19 条命令。
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
      commands: 20,
      draftKinds: 6,
      bridgeErrors: 21,
      cliExitCodes: 24,
    });
    // 导出表面（上面那张表）分不出 0.9.0 和 0.10.0：两版的 `exports` 逐字相同，
    // 新增的全在已有子路径**里面**。而下游按版本号重装时，消失的正是这些
    // ——`health` 不见了、`changes` 不带 epoch 了，且没有任何报错可指。所以功能
    // 面也要钉在版本号上：加一条命令 / 一个字段 / 一个契约块而不动 version，这里红。
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
          'import { CANVAS_CONTRACT, formatTidySummary } from "@scenemint/canvas-cli/contract";',
          'import { HEALTH_FIELDS, enforceRequestPolicy } from "@scenemint/canvas-cli/policy";',
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
