import test from "node:test";
import assert from "node:assert/strict";
import { createConnectionCode, parseConnectionCode } from "../src/connection-code.mjs";
const token = "a".repeat(43);
test("one invitation carries only a loopback port and a one-use secret", () => {
  const code = createConnectionCode("http://127.0.0.1:23456", token);
  assert.deepEqual(parseConnectionCode(code), { endpoint: "http://127.0.0.1:23456", code: token });
  assert.deepEqual(
    parseConnectionCode(" ```text\n" + code.slice(0, 20) + "\n" + code.slice(20) + "\n``` "),
    parseConnectionCode(code),
  );
});
test("refuses malformed invitations and non-loopback targets before any request", () => {
  for (const value of [
    "",
    "SM2.23456." + token,
    "SM1.65536." + token,
    "SM1.80." + token,
    "SM1.0." + token,
    "SM1.023." + token,
    "SM1.23456.short",
    "http://evil.test/" + token,
    "SM1：23456：" + token,
    "x".repeat(513),
  ]) {
    assert.throws(() => parseConnectionCode(value));
  }
  assert.throws(() => createConnectionCode("http://evil.test:23456", token));
});

test("an invitation is rejected by the live daemon after its ten-minute lifetime", async (t) => {
  const { startDaemon } = await import("../src/daemon.mjs");
  const { request } = await import("./helpers.mjs");
  const { promises: fs } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const root = await fs.mkdtemp(join(tmpdir(), "scenemint-expired-code-"));
  const previous = process.env.SCENEMINT_CANVAS_HOME;
  process.env.SCENEMINT_CANVAS_HOME = root;
  let daemon;
  t.after(async () => {
    t.mock.restoreAll();
    await daemon?.shutdown();
    if (previous === undefined) delete process.env.SCENEMINT_CANVAS_HOME;
    else process.env.SCENEMINT_CANVAS_HOME = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  daemon = await startDaemon({
    sessionId: randomUUID(),
    cliToken: token,
    origin: "https://canvas.example.test",
    name: "Expiry test",
    workspace: root,
  });
  const invitation = parseConnectionCode(daemon.publicInfo.connectionCode);
  t.mock.method(Date, "now", () => Date.parse(daemon.publicInfo.pairExpiresAt) + 1);
  const result = await request(invitation.endpoint, "/v1/pair", {
    headers: { Origin: "https://canvas.example.test" },
    body: {
      protocolVersion: 2,
      code: invitation.code,
      canvasId: "canvas-a",
      projectId: "project-a",
    },
  });
  assert.equal(result.status, 401);
  assert.equal(result.result.error.code, "invalid_pair_code");
});
