import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { oldPeerHint, prefabCandidates, resendCommand } from "../src/cli.mjs";
import { SCENE3D } from "../src/contract.mjs";
import { injectSession } from "../src/host-argv.mjs";
import { COMMAND_FIELDS } from "../src/policy.mjs";
import { fixture, packageRoot } from "./helpers.mjs";

/**
 * B11-F2 step 2（B9-FX-22 / 24 / 25 / 26 / 29 / 49 / 50）：失败回包里「下一步怎么办」要能直接读出来——
 * 路径、合法清单、真实可执行的 argv、刷新修不好时的退路——不靠 Agent 猜 message。
 */

const scene3d = (actions) => ({
  type: "scene3d_apply",
  nodeId: "desk",
  baseDigest: "new",
  actions,
});

test("FX-22：旧对端提示每一档都带「刷新修不好 = 站点还是旧线」的退路，0.17.0 写法给 0.16.x 能用的替代", () => {
  // 守护进程已是 0.17.0：仍先点刷新，但刷新过一次仍拒收就别再刷新（站点是 0.16.x，含测试线 0.16.4）。
  const page = oldPeerHint("allShots", "0.17.0");
  assert.match(page, /拒收的是还没刷新的画布页面：请用户刷新画布标签页后重试；/);
  assert.match(page, /刷新过一次仍是这句拒收.*0\.16\.x（含测试线 0\.16\.4）.*不要再让用户刷新/);
  assert.match(page, /逐镜用 run <nodeId> --shot <shotId>/);
  assert.doesNotMatch(page, /disconnect/);
  // 0.16.2 那一档的旧站点是 0.16.1。
  assert.match(oldPeerHint("frame", "0.17.0", "0.16.2"), /还是 0\.16\.1.*去掉 --frame/);
  assert.match(oldPeerHint("ifVersion", null, "0.16.2"), /`disconnect`.*去掉 --if-version/);
  assert.match(oldPeerHint("run-stills", undefined, "0.16.2"), /逐镜用 run <nodeId> --shot/);
  // 没有专门替代的 0.17.0 字段（调度 / 运镜）：去掉它。
  assert.match(oldPeerHint("via", "0.17.0"), /不支持 via，去掉它/);
  // 提示里不出现大写占位（00-contract §2.3 的同一口径）。
  for (const key of ["allShots", "render", "sheetFrames", "run-stills"])
    assert.doesNotMatch(oldPeerHint(key, "0.17.0"), /\bNODE\b|SHOT-ID/);
});

test("FX-22：0.16.2 站点（policy 原话）拒收 run --shots all：hint 带站点退路", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const pump = await f.pump(() => ({
    ok: false,
    error: { code: "invalid_request", message: "Unexpected run_node field: allShots" },
  }));
  t.after(() => pump.stop());
  const run = await f.cli(["run", "desk", "--shots", "all", "--approved"]);
  assert.equal(run.result.error.path, "run_node.allShots");
  assert.match(run.result.hint, /0\.16\.x（含测试线 0\.16\.4）.*逐镜用 run <nodeId> --shot/);
});

test("B12：早于 0.16.3 的对端拒收座面 / 前倾 / 持物 / 起止状态 / 子镜头：旧对端提示（先刷新、再重连、再去掉它们），不说「X 不收；X 收：… X …」", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const cases = [
    ["set_figure", "seat", { op: "set_figure", id: "f1", seat: "chair" }],
    ["set_figure", "lean", { op: "set_figure", id: "f1", lean: 10 }],
    ["set_figure", "heldR", { op: "set_figure", id: "f1", heldR: "cup" }],
    ["add_shot", "cuts", { op: "add_shot", id: "s9", cam: "c1", look: "f1", cuts: [] }],
    ["update_shot", "states", { op: "update_shot", id: "s1", states: [] }],
  ];
  let refused = "";
  const pump = await f.pump(() => ({
    ok: false,
    error: { code: "invalid_request", message: refused },
  }));
  t.after(() => pump.stop());
  for (const [op, key, action] of cases) {
    refused = `Unexpected scene3d ${op} field: ${key}`;
    // oxlint-disable-next-line eslint/no-await-in-loop -- 同一个页面桩，逐条换拒收原话
    const r = await f.cli(["apply", "--json", JSON.stringify({ commands: [scene3d([action])] })]);
    assert.equal(r.result.error.path, `commands[0].actions[0].${key}`);
    const hint = r.result.hint;
    assert.match(hint, /0\.16\.3 起才有的写法/, hint);
    // 报 0.17.0 的守护进程也可能是合流前的那一版：不断言「拒收的是页面」，两条出路按先后都给
    assert.doesNotMatch(hint, /拒收的是还没刷新的画布页面/, hint);
    assert.match(hint, /刷新画布标签页后重试；仍报错则 `disconnect` 后重新 `connect`/, hint);
    assert.match(
      hint,
      /站点部署的还是 0\.16\.1 \/ 0\.16\.2.*去掉 seat \/ lean \/ heldL \/ heldR \/ states \/ cuts 再发/,
      hint,
    );
    assert.doesNotMatch(hint, new RegExp(`${op} 不收`), hint);
  }
});

test("FX-25：connect 带 sourceHandle → path + 收哪些字段 + 为什么；同一条里不收的一次列全；未知 type 指到第几条", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const seen = [];
  const pump = await f.pump((req) => {
    seen.push(req.method);
    return { ok: true };
  });
  t.after(() => pump.stop());
  const connect = await f.cli([
    "apply",
    "--json",
    JSON.stringify({
      commands: [
        { type: "move_node", nodeId: "a", position: { x: 0, y: 0 } },
        {
          type: "connect",
          source: "s3v-x",
          sourceHandle: "output",
          target: "gen-v1",
          targetHandle: "reference",
        },
      ],
    }),
  ]);
  assert.equal(connect.code, 1);
  assert.equal(connect.result.error.message, "Unexpected connect field: sourceHandle");
  assert.equal(connect.result.error.path, "commands[1].sourceHandle");
  assert.match(connect.result.hint, /connect 不收 sourceHandle，输出口由源节点决定/);
  assert.match(connect.result.hint, new RegExp(`connect 收：${COMMAND_FIELDS.connect.join(" ")}$`));
  const two = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [{ type: "add_node", kind: "gen", label: "x", size: 3 }] }),
  ]);
  assert.equal(two.result.error.path, "commands[0].label");
  assert.match(two.result.hint, /^add_node 不收 label size；add_node 收：id kind position/);
  const unknown = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [{ type: "delete_node", nodeId: "a" }, { type: "teleport" }] }),
  ]);
  assert.equal(unknown.result.error.path, "commands[1].type");
  assert.match(unknown.result.hint, /不认识命令 type "teleport".*合法 type：add_node update_node/);
  assert.deepEqual(seen, [], "本地预检拒收的不该送到页面");
});

test("FX-50：三维动作里不收的字段一次列全，并列出这个 op 收哪些", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const r = await f.cli([
    "apply",
    "--json",
    JSON.stringify({
      commands: [scene3d([{ op: "add_shot", look: "boss", fov: 30, radius: 3, height: 1 }])],
    }),
  ]);
  assert.equal(r.result.error.path, "commands[0].actions[0].radius");
  assert.match(r.result.hint, /^scene3d_apply 的 add_shot 不收 radius height；add_shot 收：id /);
});

test("0.18.0 T4：一批里几条动作都有不收的字段 / 不认识的 op——hint 一次点名全部，不只第一处", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const r = await f.cli([
    "apply",
    "--json",
    JSON.stringify({
      commands: [
        scene3d([
          { op: "add_shot", look: "boss", fov: 30, radius: 3 },
          { op: "remove", id: "a" },
          { op: "transform", id: "a", colour: "#ffffff", size: 2 },
          { op: "zoom", id: "a" },
        ]),
      ],
    }),
  ]);
  assert.equal(r.result.error.path, "commands[0].actions[0].radius");
  assert.match(r.result.hint, /^scene3d_apply 的 add_shot 不收 radius；add_shot 收：id /);
  assert.match(r.result.hint, /同一批另有 2 处/);
  assert.match(r.result.hint, /commands\[0\]\.actions\[2\] 的 transform 不收 colour size/);
  assert.match(r.result.hint, /commands\[0\]\.actions\[3\] 的 op "zoom" 不认识/);
});

test("FX-49：prefab 查不到——省略 kind 被拒时 hint 列最接近的词与全表在哪；照画成功时接一条 notes", async (t) => {
  assert.deepEqual(prefabCandidates("table_lamp").slice(0, 2), ["table", "lamp"]);
  assert.match(prefabCandidates("bookcase")[0], /^bookshelf（= shelf）$/);
  const f = await fixture(t);
  await f.pair();
  // 页面 reducer 的原话（actions.ts）；守护进程放行（prefab 是开放字符串）。
  const pump = await f.pump((req) =>
    req.params.commands[0].actions[0].kind === undefined
      ? {
          ok: false,
          error: {
            code: "invalid_request",
            message:
              'kind 省略时要能推出来：给词表内的 prefab（含别名），或 role:"figure"（推为 human）',
            path: "commands[0].actions[0].kind",
          },
        }
      : { ok: true, notes: ["页面自己的 note"], scene3d: [] },
  );
  t.after(() => pump.stop());
  const cup = { op: "add_object", id: "cup", role: "prop", prefab: "cup" };
  const refused = await f.cli(["apply", "--json", JSON.stringify({ commands: [scene3d([cup])] })]);
  assert.equal(refused.result.error.path, "commands[0].actions[0].kind");
  assert.match(
    refused.result.hint,
    /prefab "cup" 不在词表里，推不出 kind：换成最接近的 (?:[^/，]+ \/ ){4}[^/，]+，/,
  );
  assert.match(refused.result.hint, /显式写 kind（box \/ cylinder \/ plane \/ backdrop）/);
  assert.match(refused.result.hint, /24 个 prefab \+ 16 个别名/);
  const drawn = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [scene3d([{ ...cup, kind: "cylinder" }])] }),
  ]);
  assert.equal(drawn.result.ok, true);
  assert.equal(drawn.result.notes[0], "页面自己的 note");
  assert.match(
    drawn.result.notes[1],
    /^prefab "cup" 不在词表里（按 kind 画、提醒 unknown_prefab），最接近的：/,
  );
  // 词表内（含别名）的不加话。
  const known = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [scene3d([{ ...cup, prefab: "bar", kind: "box" }])] }),
  ]);
  assert.deepEqual(known.result.notes, ["页面自己的 note"]);
});

test("FX-26：--file 找不到 / 越出 workspace → error.path 是解析后的绝对路径、error.workspace 是会话根、hint 说怎么改", async (t) => {
  const f = await fixture(t);
  const missing = await f.cli(["apply", "--file", "edits/missing.json"]);
  assert.equal(missing.code, 2);
  assert.equal(missing.result.error.code, "file_not_found");
  assert.equal(missing.result.error.workspace, f.record.workspace);
  assert.equal(missing.result.error.path, path.join(f.record.workspace, "edits", "missing.json"));
  assert.match(missing.result.hint, /没有这个文件：.*missing\.json。路径按会话 workspace（/);
  assert.match(missing.result.hint, /--json/);
  const outside = await f.cli(["apply", "--file", "/tmp/x.json"]);
  assert.equal(outside.code, 2);
  assert.equal(outside.result.error.code, "workspace_boundary");
  assert.equal(outside.result.error.path, "/tmp/x.json");
  assert.equal(outside.result.error.workspace, f.record.workspace);
  assert.match(outside.result.hint, /只能用会话 workspace（.*）里的文件，\/tmp\/x\.json 不在里面/);
  const climb = await f.cli(["apply", "--file", "../x.json"]);
  assert.equal(climb.result.error.code, "workspace_boundary");
  assert.equal(climb.result.error.path, path.join(path.dirname(f.record.workspace), "x.json"));
  // 文件在、内容对：照常走（不受影响）。
  await mkdir(path.join(f.workspace, "edits"), { recursive: true });
  await writeFile(path.join(f.workspace, "edits", "ok.json"), "{}");
  const bad = await f.cli(["apply", "--file", "edits/ok.json"]);
  assert.notEqual(bad.result.error?.code, "file_not_found");
});

test("FX-29：collab_offline 的 next[0].command 换成这次真正的 argv（去掉 --session 与 --request-id）", async (t) => {
  assert.equal(
    resendCommand([
      "apply",
      "--json",
      `{"a":"it's"}`,
      "--session",
      "s",
      "--request-id=x",
      "--turn",
      "t 1",
    ]),
    `apply --json '{"a":"it'\\''s"}' --turn 't 1'`,
  );
  const f = await fixture(t);
  await f.pair();
  const pump = await f.pump(() => ({
    ok: false,
    error: {
      code: "collab_offline",
      message: "画布和协同服务断开了：这次什么都没写。等 5 s 原样重发",
      retryable: true,
      persisted: false,
      next: [{ command: "<刚才那条命令>", description: "等 5 s 原样重发刚才那条命令" }],
    },
  }));
  t.after(() => pump.stop());
  const batch = JSON.stringify({ commands: [{ type: "delete_node", nodeId: "n" }] });
  const plain = await f.cli(["apply", "--json", batch]);
  assert.equal(plain.result.error.next[0].command, `apply --json '${batch}'`);
  assert.equal(plain.result.error.next[0].description, "等 5 s 原样重发刚才那条命令");
  const withId = await f.cli([
    "apply",
    "--json",
    batch,
    "--request-id",
    "6f1f9c1e-8a52-4d5c-9b1e-2b8f1c4e7a10",
  ]);
  assert.equal(withId.result.error.next[0].command, `apply --json '${batch}'`);
  assert.match(withId.result.error.next[0].description, /已去掉 --request-id/);
  const run = await f.cli(["run", "desk", "--shot", "shot-1", "--approved"]);
  assert.equal(run.result.error.next[0].command, "run desk --shot shot-1 --approved");
});

test("FX-24 / B11-F2-4：页面不在时 status 与 page_away 的「关掉了 → 重新配对」一支查得到、不让写命令跑两次", async (t) => {
  const f = await fixture(t, { timeout: 8000, lease: 120 });
  await f.pair();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const status = await f.cli(["status"]);
  assert.equal(status.result.pageAway, true);
  assert.match(status.result.hint, /^页面不在：请用户回到原来的画布标签页。/);
  const read = await f.cli(["ls", "/"]);
  assert.equal(read.result.error.code, "page_away");
  assert.match(read.result.hint, /回到画布标签页.*后重发。只有用户说标签页已经关掉/);
  const queued = await f.cli([
    "apply",
    "--json",
    JSON.stringify({ commands: [{ type: "delete_node", nodeId: "n" }] }),
    "--wait-ms",
    "200",
  ]);
  assert.equal(queued.result.error.queued, true);
  assert.match(queued.result.hint, /用同一个 --request-id 取结果.*只有用户说标签页已经关掉/);
  for (const hint of [status.result.hint, read.result.hint, queued.result.hint]) {
    // 条件是 Agent 查得到的（用户说关过 / 过了 resumeExpiresAt），pageAway:true 本身不算（丢弃、刷新的标签页会续上）。
    assert.match(
      hint,
      /只有用户说标签页已经关掉（或在新标签页里重开了画布），或过了 resumeExpiresAt/,
    );
    assert.match(hint, /光是 reconnecting、pageAway:true 不算关掉/);
    assert.doesNotMatch(hint, /status 仍是 reconnecting、pageAway:true）：/);
    // 重新配对：宿主里发的那一步是 `connect`（宿主注入会话、自己探活）；宿主拒收的 argv 一条都不给成那一步。
    const steps = [...hint.matchAll(/你发 `([^`]+)`/g)].map((m) => m[1].split(" "));
    assert.deepEqual(steps, [["connect"]], hint);
    for (const argv of steps) assert.doesNotThrow(() => injectSession(argv, f.info.sessionId));
    assert.match(hint, /argv 里不写 --session/);
    assert.doesNotMatch(hint, /不要发不带 --session 的 connect/);
    // 直接跑 CLI 的写法点名本会话：connect --session 停掉旧会话、丢掉排队的命令（60 s 内回 reused:true，见下）。
    assert.ok(
      hint.includes(`没有宿主、直接跑 CLI 时写成 \`connect --session ${f.info.sessionId}\``),
      hint,
    );
    // reused:true 不等于没关（关标签后守护进程最多约 105 s 才认）：用户确认关了就过一分钟再发同一条，直到 reused:false。
    assert.doesNotMatch(hint, /没关，等它回来/);
    assert.match(
      hint,
      /用户确认关了就过一分钟再发同一条 connect，直到回 reused:false 带新的 connectionCode/,
    );
    // 写命令不再一律「原样再发」：先看生效没有，只有三维出片可以原样重发。
    assert.doesNotMatch(hint, /在新会话里把同一条命令原样再发/);
    assert.match(hint, /写命令先 ls \/ read 看生效没有/);
  }
});

test("B11-F2-3：collab_offline 的重发 argv 永远是一行——排好版的 --json 压成一行，压不成就留页面那句", async (t) => {
  const pretty = JSON.stringify({ commands: [{ type: "delete_node", nodeId: "n" }] }, null, 2);
  assert.match(pretty, /\n/);
  const compact = JSON.stringify(JSON.parse(pretty));
  assert.equal(resendCommand(["apply", "--json", pretty]), `apply --json '${compact}'`);
  assert.equal(resendCommand(["apply", `--json=${pretty}`]), `apply '--json=${compact}'`);
  // 本来就是一行的 --json 一个字不动（不重排数字写法）。
  assert.equal(resendCommand(["apply", "--json", '{"n": 1.0}']), `apply --json '{"n": 1.0}'`);
  // 不是 JSON、又带换行的词：做不成单行。
  assert.equal(resendCommand(["run", "desk", "--turn", "a\nb"]), null);
  assert.equal(resendCommand(["apply", "--json", "{\n broken"]), null);
  const f = await fixture(t);
  await f.pair();
  const placeholder = { command: "<刚才那条命令>", description: "等 5 s 原样重发刚才那条命令" };
  const pump = await f.pump(() => ({
    ok: false,
    error: {
      code: "collab_offline",
      message: "画布和协同服务断开了：这次什么都没写。等 5 s 原样重发",
      retryable: true,
      persisted: false,
      next: [placeholder],
    },
  }));
  t.after(() => pump.stop());
  const viaPretty = await f.cli(["apply", "--json", pretty]);
  assert.equal(viaPretty.result.error.next[0].command, `apply --json '${compact}'`);
  assert.doesNotMatch(viaPretty.result.error.next[0].command, /[\r\n]/);
  const multiLineTurn = await f.cli(["apply", "--json", compact, "--turn", "a\nb"]);
  assert.deepEqual(multiLineTurn.result.error.next[0], placeholder);
});

test("B11-F2-5：workspace 路径的 hint 按参数措辞——输出路径不叫你挪文件，没有 --file 的命令不提 --json", async (t) => {
  const f = await fixture(t);
  const upload = await f.cli(["upload", "missing.png"]);
  assert.equal(upload.result.error.code, "file_not_found");
  assert.match(upload.result.hint, /^没有这个文件：.*missing\.png。路径按会话 workspace（/);
  assert.doesNotMatch(upload.result.hint, /--file|--json/);
  const out = await f.cli(["download", "n1", "--out", "../x.png"]);
  assert.equal(out.result.error.code, "workspace_boundary");
  assert.match(
    out.result.hint,
    /^输出路径只能写进会话 workspace（.*），.*x\.png 不行：写它里面的相对路径/,
  );
  assert.doesNotMatch(out.result.hint, /把文件放进|--json/);
  const doc = await f.cli([
    "docs",
    "create",
    "--type",
    "outline",
    "--title",
    "a",
    "--file",
    "nope.md",
  ]);
  assert.equal(doc.result.error.code, "file_not_found");
  assert.doesNotMatch(doc.result.hint, /--json|edit\.json/);
  // apply --file 那一句照旧（FX-26）。
  const apply = await f.cli(["apply", "--file", "edits/missing.json"]);
  assert.match(apply.result.hint, /（例如 --file edit\.json）；JSON 参数也可以直接 --json 给$/);
});

test("B11-F2：版本不明那一档的旧对端提示按先后走——站点退路的条件是刷新、重连都做过之后，不与「重连」抢同一个条件", () => {
  for (const since of ["0.17.0", "0.16.2"]) {
    const hint = oldPeerHint("allShots", undefined, since);
    assert.doesNotMatch(hint, /刷新过一次仍是这句拒收/, hint);
    assert.match(
      hint,
      /`disconnect` 后重新 `connect`.*；刷新过、也 disconnect \/ 重新 connect 过之后仍是这句拒收/,
    );
    assert.ok(hint.indexOf("disconnect") < hint.indexOf("逐镜用"), hint);
    const daemon = oldPeerHint("allShots", null, since);
    assert.match(daemon, /重新 connect、再刷新过一次之后仍是这句拒收/);
  }
  assert.match(oldPeerHint("allShots", "0.17.0"), /刷新画布标签页后重试；刷新过一次仍是这句拒收/);
});

test("FX-48：三维 run 送到页面却没拿到答复 → render_interrupted（可重试、next 是这次的 argv、带『始终保持活跃』）；裸 run 照旧 unknown_outcome", async (t) => {
  const f = await fixture(t, { timeout: 300, lease: 30000 });
  await f.pair();
  const scene3dRun = f.cli([
    "run",
    "desk",
    "--shots",
    "all",
    "--render",
    "video",
    "--approved",
    "--request-id",
    "6f1f9c1e-8a52-4d5c-9b1e-2b8f1c4e7a11",
  ]);
  // 页面取走了请求（delivered），然后再也不答：守护进程到点回 unknown_outcome
  assert.equal((await f.browser("/v1/next")).result.method, "run_node");
  const interrupted = await scene3dRun;
  assert.equal(interrupted.result.error.code, "render_interrupted", interrupted.stdout);
  assert.equal(interrupted.result.error.retryable, true);
  assert.equal(interrupted.result.error.outcome, "unknown");
  assert.equal(
    interrupted.result.error.next[0].command,
    "run desk --shots all --render video --approved",
  );
  assert.match(interrupted.result.error.next[0].description, /已去掉 --request-id/);
  assert.equal(interrupted.result.error.next[1].command, "read desk/renders");
  assert.match(interrupted.result.hint, /始终保持活跃/);
  // argv 里没有 --request-id：不说去掉了它（B11-int 复核）
  const plainRun = f.cli([
    "run",
    "desk",
    "--json",
    '{"shotIds":["shot-2"],"frame":"end"}',
    "--approved",
  ]);
  assert.equal((await f.browser("/v1/next")).result.method, "run_node");
  const plain = (await plainRun).result.error;
  assert.equal(plain.code, "render_interrupted");
  assert.equal(
    plain.next[0].command,
    `run desk --json '{"shotIds":["shot-2"],"frame":"end"}' --approved`,
  );
  assert.doesNotMatch(plain.next[0].description, /request-id/);
  assert.doesNotMatch(JSON.stringify(interrupted.result), /重复扣费|Do not repeat/);
  assert.notEqual(interrupted.code, 4, "不再是「结果未知、绝不重发」的退出码");

  const bare = f.cli(["run", "gen-1", "--approved"]);
  assert.equal((await f.browser("/v1/next")).result.method, "run_node");
  const unknown = await bare;
  assert.equal(unknown.result.error.code, "unknown_outcome");
  assert.equal(unknown.code, 4);
});

test("FX-49：commands.md 的 scene3d_apply 段列出契约里全部 prefab 与别名（一行一组），与契约同步", () => {
  const md = readFileSync(
    path.join(packageRoot, "skills", "scenemint-canvas", "references", "commands.md"),
    "utf8",
  );
  const prefabs = /^- \*\*Prefabs\*\* \(24[^\n]*$/m.exec(md)?.[0] ?? "";
  const aliases = /^- \*\*Aliases\*\* \(16[^\n]*$/m.exec(md)?.[0] ?? "";
  assert.equal(SCENE3D.enums.prefab.length, 24);
  assert.equal(Object.keys(SCENE3D.enums.aliases).length, 16);
  for (const name of SCENE3D.enums.prefab) assert.ok(prefabs.includes(`\`${name}\``), name);
  for (const [alias, to] of Object.entries(SCENE3D.enums.aliases))
    assert.ok(aliases.includes(`\`${alias}\`→\`${to}\``), alias);
});

test("B11-int 复核：SKILL.md 与 commands.md 的「关掉了 → 重新配对」一支——reused:true 不等于没关，用户确认关了就过一分钟再发", () => {
  const skills = path.join(packageRoot, "skills", "scenemint-canvas");
  for (const file of ["SKILL.md", path.join("references", "commands.md")]) {
    const md = readFileSync(path.join(skills, file), "utf8");
    assert.doesNotMatch(md, /没关[，、]\s*等它回来/, file);
    assert.match(
      md,
      /用户确认关了就过一分钟再发同一条 `connect`，直到回 `reused:false` 带新的连接码（connectionCode）/,
      file,
    );
  }
});

test("B14 P5：--json 后面给了 workspace 里的文件路径 → error.path 是 --json，next 是同一路径的 apply --file；不是文件只回 path", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.workspace, "edits"), { recursive: true });
  await writeFile(path.join(f.workspace, "edits", "batch.json"), '{"commands":[]}');
  const wrong = await f.cli(["apply", "--json", "edits/batch.json"]);
  assert.equal(wrong.result.error.code, "invalid_json");
  assert.equal(wrong.result.error.path, "--json");
  assert.deepEqual(
    wrong.result.error.next.map((step) => step.command),
    ["apply --file edits/batch.json"],
  );
  assert.match(wrong.result.error.message, /edits\/batch\.json is a file in the workspace/);
  // 复核：next 是这次的 argv、只把 --json <path> 换成 --file <path>——节点 id、子命令、--approved / --label 都留着
  for (const [argv, expected] of [
    [
      ["apply", "--json", "edits/batch.json", "--approved", "--label", "接线"],
      "apply --file edits/batch.json --approved --label '接线'",
    ],
    [
      ["run-tool", "n1", "--json", "edits/batch.json", "--approved"],
      "run-tool n1 --file edits/batch.json --approved",
    ],
    [["timeline", "add", "--json=edits/batch.json"], "timeline add --file edits/batch.json"],
  ]) {
    const r = await f.cli(argv);
    assert.equal(r.result.error.path, "--json", argv.join(" "));
    assert.deepEqual(
      r.result.error.next.map((step) => step.command),
      [expected],
    );
  }
  // 坏 JSON、或不是 workspace 里的文件：只回 path（不编一条用不了的 --file），message 带 JSON 解析报的原因
  for (const text of ["{oops", '{"commands":[', "edits/missing.json"]) {
    const bad = await f.cli(["apply", "--json", text]);
    assert.equal(bad.result.error.code, "invalid_json", text);
    assert.equal(bad.result.error.path, "--json", text);
    assert.equal(bad.result.error.next, undefined, text);
    assert.match(bad.result.error.message, /^--json expects inline JSON text: \S/, text);
    assert.notEqual(bad.result.error.message, "--json expects inline JSON text", text);
  }
});
