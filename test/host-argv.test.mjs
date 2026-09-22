import test from "node:test";
import assert from "node:assert/strict";
import { HostArgvError, extractPayload, injectSession } from "../src/host-argv.mjs";

/**
 * 宿主把 argv 透传给 CLI 之前只做两件事：注入会话、看一眼载荷。这两件事出错的代价都是
 * 「Agent 借用别的任务的会话」或「闸门没看到真正要写的东西」，所以这里把每条进入路径钉死。
 */

const SESSION = "11111111-2222-4333-8444-555555555555";
const withCode = (code) => (error) => error instanceof HostArgvError && error.code === code;

test("injectSession 追加 --session 且不改原数组", () => {
  const argv = ["apply", "--json", "{}"];
  const out = injectSession(argv, SESSION);
  assert.deepEqual(out, ["apply", "--json", "{}", "--session", SESSION]);
  assert.deepEqual(argv, ["apply", "--json", "{}"]);
  assert.notEqual(out, argv);
});

test("injectSession 拒绝 argv 里任何位置的 --session", () => {
  for (const argv of [
    ["status", "--session", "x"],
    ["--session", "x", "status"],
    ["status", "--session=xyz"],
    ["read", "--", "--session", "x"],
    ["read", "--", "--session=x"],
    ["--session=" + SESSION],
  ])
    assert.throws(
      () => injectSession(argv, SESSION),
      withCode("SESSION_NOT_ALLOWED"),
      argv.join(" "),
    );
});

test("injectSession 只拦 --session 本身，不误伤形似的值", () => {
  assert.doesNotThrow(() => injectSession(["grep", "--session-like"], SESSION));
  assert.doesNotThrow(() => injectSession(["grep", "session"], SESSION));
});

test("injectSession 拒绝空 sessionId 与非字符串数组 argv", () => {
  for (const bad of ["", "   ", undefined, null, 42])
    assert.throws(() => injectSession(["status"], bad), withCode("SESSION_NOT_ALLOWED"));
  for (const bad of ["status", null, ["status", 1], [{}], undefined])
    assert.throws(() => injectSession(bad, SESSION), withCode("INVALID_ARGV"));
});

const files = {
  "cmds.json": JSON.stringify({ commands: [{ type: "delete_node", nodeId: "n1" }] }),
  "prompt.md": "基于参考图 @{白妍·基准} 生成",
  "-": JSON.stringify({ commands: [{ type: "add_node", kind: "text" }], label: "stdin" }),
};
const calls = [];
const readFile = (p) => {
  calls.push(p);
  if (!(p in files)) throw new Error(`no fixture ${p}`);
  return files[p];
};

test("extractPayload：--json OBJECT", async () => {
  const out = await extractPayload(
    ["apply", "--json", '{"commands":[{"type":"move_node","nodeId":"a","x":1,"y":2}]}'],
    { readFile },
  );
  assert.equal(out.shape, "json");
  assert.equal(out.command, "apply");
  assert.deepEqual(out.commands, [{ type: "move_node", nodeId: "a", x: 1, y: 2 }]);
  // 非 apply 的 --json 也要能看：run-batch 的审批清单就在这里。
  const batch = await extractPayload(
    [
      "run-batch",
      "--group",
      "g",
      "--approved",
      "--json",
      '{"approval":{"userApprovedNodeIds":["a"]}}',
    ],
    { readFile },
  );
  assert.equal(batch.shape, "json");
  assert.equal(batch.commands, null);
  assert.deepEqual(batch.params.approval.userApprovedNodeIds, ["a"]);
});

test("extractPayload：--file FILE 与 --file=FILE 都交给 readFile", async () => {
  calls.length = 0;
  const out = await extractPayload(["apply", "--file", "cmds.json"], { readFile });
  assert.equal(out.shape, "file");
  assert.equal(out.path, "cmds.json");
  assert.deepEqual(out.commands, [{ type: "delete_node", nodeId: "n1" }]);
  const eq = await extractPayload(["apply", "--file=cmds.json"], { readFile });
  assert.equal(eq.shape, "file");
  assert.deepEqual(calls, ["cmds.json", "cmds.json"]);
});

test("extractPayload：--file - 是 stdin，必须以 '-' 调 readFile", async () => {
  calls.length = 0;
  const out = await extractPayload(["apply", "--file", "-"], { readFile });
  assert.equal(out.shape, "stdin");
  assert.equal(out.path, undefined);
  assert.deepEqual(out.commands, [{ type: "add_node", kind: "text" }]);
  assert.deepEqual(calls, ["-"]);
  // readFile 可以是异步的
  const async = await extractPayload(["apply", "--file=-"], {
    readFile: async (p) => files[p],
  });
  assert.equal(async.shape, "stdin");
});

test("extractPayload：--node --field --text-file --expect-sha 整段文本写入", async () => {
  const out = await extractPayload(
    [
      "apply",
      "--node",
      "n9",
      "--field",
      "prompt",
      "--text-file",
      "prompt.md",
      "--expect-sha",
      "abc",
    ],
    { readFile },
  );
  assert.equal(out.shape, "text-file");
  assert.deepEqual(out.fields, {
    nodeId: "n9",
    field: "prompt",
    text: files["prompt.md"],
    expectSha: "abc",
    path: "prompt.md",
  });
  // commands 与 cli.mjs 合成的 update_node 逐字一致
  assert.deepEqual(out.commands, [
    {
      type: "update_node",
      nodeId: "n9",
      draft: { prompt: files["prompt.md"] },
      expect: { promptSha: "abc" },
    },
  ]);
  // 节点 id 可以是位置参数；field 默认 prompt；title 走顶层 title 字段
  const positional = await extractPayload(
    ["apply", "n9", "--text-file", "prompt.md", "--expect-sha", "abc"],
    { readFile },
  );
  assert.equal(positional.fields.nodeId, "n9");
  assert.equal(positional.fields.field, "prompt");
  const title = await extractPayload(
    ["apply", "--node", "n9", "--field", "title", "--text-file", "prompt.md", "--expect-sha", "t1"],
    { readFile },
  );
  assert.deepEqual(title.commands[0], {
    type: "update_node",
    nodeId: "n9",
    title: files["prompt.md"],
    expect: { titleSha: "t1" },
  });
});

test("extractPayload：text-file 缺 --expect-sha / 非法 field 与 CLI 同样拒绝", async () => {
  await assert.rejects(
    extractPayload(["apply", "--node", "n9", "--text-file", "prompt.md"], { readFile }),
    withCode("INVALID_PAYLOAD"),
  );
  await assert.rejects(
    extractPayload(
      [
        "apply",
        "--node",
        "n9",
        "--field",
        "params",
        "--text-file",
        "prompt.md",
        "--expect-sha",
        "x",
      ],
      { readFile },
    ),
    withCode("INVALID_PAYLOAD"),
  );
});

test("extractPayload：--node --tags a,b 合成 update_node {draft:{assetTags}}", async () => {
  const out = await extractPayload(["apply", "--node", "n9", "--tags", "人物设定, 终稿,,"], {
    readFile,
  });
  assert.deepEqual(out, {
    shape: "tags",
    command: "apply",
    fields: { nodeId: "n9", tags: ["人物设定", "终稿"] },
    commands: [{ type: "update_node", nodeId: "n9", draft: { assetTags: ["人物设定", "终稿"] } }],
  });
  // 位置参数给节点 id；`--tags ""` 是清空
  const clear = await extractPayload(["apply", "g1", "--tags", ""], { readFile });
  assert.deepEqual(clear.fields, { nodeId: "g1", tags: [] });
  assert.deepEqual(clear.commands[0].draft, { assetTags: [] });
  await assert.rejects(
    extractPayload(["apply", "--tags", "a"], { readFile }),
    withCode("INVALID_PAYLOAD"),
  );
  // 与其它三种载荷互斥，照 CLI 一样拒绝
  await Promise.all(
    [
      ["apply", "--node", "n", "--tags", "a", "--json", "{}"],
      ["apply", "--node", "n", "--tags", "a", "--file", "cmds.json"],
      ["apply", "--node", "n", "--tags", "a", "--text-file", "prompt.md", "--expect-sha", "s"],
    ].map((argv) =>
      assert.rejects(
        extractPayload(argv, { readFile }),
        withCode("INVALID_PAYLOAD"),
        argv.join(" "),
      ),
    ),
  );
});

test("extractPayload：ls/grep 的 --tag 过滤不是载荷（shape none），可重复", async () => {
  const out = await extractPayload(["ls", "/", "--tag", "人物设定", "--tag", "终稿", "--long"], {
    readFile,
  });
  assert.equal(out.shape, "none");
  const g = await extractPayload(["grep", "终稿", "--fields", "tags", "--tag=ep01"], { readFile });
  assert.equal(g.shape, "none");
});

test("extractPayload：tidy 由 flag 合成 apply 命令", async () => {
  const out = await extractPayload(["tidy", "--nodes", "a,b"], { readFile });
  assert.deepEqual(out, {
    shape: "tidy",
    command: "tidy",
    commands: [{ type: "tidy", nodeIds: ["a", "b"] }],
  });
  await assert.rejects(extractPayload(["tidy"], { readFile }), withCode("INVALID_ARGV"));
});

test("extractPayload：没有载荷的命令是 shape none", async () => {
  const cases = [
    ["status"],
    ["read", "n1"],
    ["ls", "--long"],
    ["run", "n1", "--approved"],
    // 0.8.1 tasks：只读查询，--node / --status 可重复，都不是载荷。
    [
      "tasks",
      "--node",
      "a",
      "--node",
      "b",
      "--status",
      "failed",
      "--submitter",
      "me",
      "--scope",
      "all",
    ],
  ];
  const outs = await Promise.all(cases.map((argv) => extractPayload(argv, { readFile })));
  outs.forEach((out, i) => {
    assert.equal(out.shape, "none", cases[i].join(" "));
    assert.equal(out.command, cases[i][0]);
  });
});

test("extractPayload：两种载荷同时出现没有优先级，照 CLI 一样拒绝", async () => {
  // cli.mjs paramsFrom：--json 与 --file 同给 → invalid_argument "Use either --json or --file"；
  // apply 块：--text-file 与二者同给 → invalid_argument。宿主镜像这条规则而不是挑一个用。
  const combined = [
    ["apply", "--json", "{}", "--file", "cmds.json"],
    ["apply", "--json", "{}", "--node", "n", "--text-file", "prompt.md", "--expect-sha", "s"],
    [
      "apply",
      "--file",
      "cmds.json",
      "--node",
      "n",
      "--text-file",
      "prompt.md",
      "--expect-sha",
      "s",
    ],
    ["apply", "--file", "-", "--json", "{}"],
  ].map((argv) =>
    assert.rejects(extractPayload(argv, { readFile }), withCode("INVALID_PAYLOAD"), argv.join(" ")),
  );
  await Promise.all(combined);
});

test("extractPayload：坏 JSON、非对象、禁用键都是 INVALID_PAYLOAD", async () => {
  await Promise.all(
    ["{", "[1]", '"s"', '{"__proto__":{}}'].map((bad) =>
      assert.rejects(
        extractPayload(["apply", "--json", bad], { readFile }),
        withCode("INVALID_PAYLOAD"),
        bad,
      ),
    ),
  );
  await assert.rejects(
    extractPayload(["apply", "--file", "cmds.json"], { readFile: () => "not json" }),
    withCode("INVALID_PAYLOAD"),
  );
});

test("extractPayload：CLI 不接受的 flag 组合、未知命令、坏 argv 是 INVALID_ARGV", async () => {
  // download 在 paramsFrom 之前就返回，根本不读 --json；宿主不能把它当载荷放行。
  await assert.rejects(
    extractPayload(["download", "n1", "--json", "{}"], { readFile }),
    withCode("INVALID_ARGV"),
  );
  await assert.rejects(
    extractPayload(["nope", "--json", "{}"], { readFile }),
    withCode("INVALID_ARGV"),
  );
  await assert.rejects(
    extractPayload(["apply", "--bogus"], { readFile }),
    withCode("INVALID_ARGV"),
  );
  await assert.rejects(extractPayload("apply --json {}", { readFile }), withCode("INVALID_ARGV"));
  await assert.rejects(extractPayload(["apply"], {}), withCode("INVALID_ARGV"));
});

test("extractPayload：-- 之后的 token 是位置参数，不会被当成载荷 flag", async () => {
  const out = await extractPayload(["read", "--", "--json", "{}"], { readFile });
  assert.equal(out.shape, "none");
});
