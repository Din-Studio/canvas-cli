import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "../src/cli.mjs";
import { packageRoot } from "./helpers.mjs";

/**
 * 「新 flag 不许布尔」闸（0.17.0，R08-P7；G3 `anim/probe/G3/flags-probe.mjs` 晋升）。
 *
 * 两个宿主（灵影 pi `canvas-cli-tool.ts` 的 BOOLEAN_FLAGS、s2v `.pi/lib/canvas-cli.mjs` 的
 * CLI_BOOLEAN_FLAGS）各手抄了一份 CLI 的布尔 flag 表，用它在 argv 里找命令名与节点 id（审批闸、会话注入、
 * 墙钟档位都靠它）。表外的 flag 它们一律当带值处理：CLI 新加一个布尔 flag、写在节点 id 前面
 * （`run --video s3d-p02`），宿主就把节点 id 当成 flag 的值吃掉，两边读到的不是同一条命令。所以 CLI 的布尔表
 * 冻结在两宿主那一份（G3 探针实测三份逐字相同，19 个），新 flag 只能带值。
 * 唯一的例外是并行发版线 0.16.2 已经发出去的 `run-stills --force`（D-87 合流）：s2v v3.34.0 的 CLI_BOOLEAN_FLAGS
 * 已把它抄在 `all` 之后（20 个）；灵影换装 0.17.0 时它的 BOOLEAN_FLAGS 要跟着补上 `force`。
 */
const HOST_BOOLEAN_FLAGS = [
  "all",
  "force",
  "fit-frames",
  "fit",
  "absorb-strays",
  "rerun-succeeded",
  "fresh",
  "approved",
  "overwrite",
  "long",
  "fixed",
  "ignore-case",
  "files-only",
  "has-output",
  "probe",
  "wait",
  "dry-run",
  "folders",
  "help",
  "version",
];

const cliSrc = readFileSync(path.join(packageRoot, "src", "cli.mjs"), "utf8");
const setLiteral = (name) => {
  const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(cliSrc);
  assert.ok(m, `cli.mjs 的 ${name} 形状变了`);
  return [...m[1].matchAll(/"([a-z-]+)"/g)].map((hit) => hit[1]);
};

/** 宿主视角（与两宿主同法）：表内是布尔，`count` 按命令与下一个 token 判，其余一律吃掉下一个 token。 */
function hostView(argv) {
  let command;
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const key = arg.slice(2, eq === -1 ? undefined : eq);
      const takes =
        key !== "count"
          ? !HOST_BOOLEAN_FLAGS.includes(key)
          : command === "frames" ||
            (command === undefined && /^\d+(\.\d+)?$/.test(argv[i + 1] ?? ""));
      if (eq === -1 && takes) i++;
      continue;
    }
    if (command === undefined) command = arg;
    else positionals.push(arg);
  }
  return { command, positionals };
}

test("CLI 的布尔 flag 表就是两宿主手抄的那一份（新 flag 一律带值）", () => {
  assert.deepEqual(setLiteral("BOOLEANS"), HOST_BOOLEAN_FLAGS);
  // FLAGS 里除了这 20 个（和按命令判的 count）都带值：parseArgs 把下一个 token 当值，而不是当节点 id。
  for (const key of setLiteral("FLAGS")) {
    if (HOST_BOOLEAN_FLAGS.includes(key) || key === "count") continue;
    const parsed = parseArgs(["run", `--${key}`, "VALUE", "node-1"]);
    // 可重复的（--tag）聚成数组，同样是带值。
    assert.deepEqual([parsed.options[key]].flat(), ["VALUE"], `--${key} 没有按带值解析`);
    assert.deepEqual(parsed.positionals, ["node-1"], `--${key}`);
  }
});

test("0.17.0 的 run / snapshot 新 flag：写在节点 id 前、后、命令名前，宿主与 CLI 读出同一条命令", () => {
  const shapes = [
    ["run", "--shots", "all", "s3d-p02", "--render", "video", "--approved"],
    ["run", "--render", "sheet", "s3d-p02", "--frames", "5", "--approved"],
    ["run", "--await", "90", "s3d-p02", "--shots", "a,b", "--render", "video", "--approved"],
    ["run", "s3d-p02", "--out-dir", "预演", "--await", "180", "--approved"],
    ["--shots", "all", "run", "s3d-p02", "--approved"],
    ["snapshot", "--edges", "touching", "--json", "{}"],
    ["--edges", "none", "snapshot"],
  ];
  for (const argv of shapes) {
    const cli = parseArgs(argv);
    assert.deepEqual(
      hostView(argv),
      { command: cli.command, positionals: cli.positionals },
      JSON.stringify(argv),
    );
  }
  // 反例（G3 探针里 R03a / R07 的写法）：要是把 --video 做成布尔，CLI 认得出节点 id，宿主却把它吃掉了。
  const argv = ["run", "--video", "s3d-p02", "--approved"];
  assert.deepEqual(hostView(argv), { command: "run", positionals: [] });
});
