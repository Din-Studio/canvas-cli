import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "../src/client.mjs";
import { readSession } from "../src/session.mjs";
import { request } from "./helpers.mjs";

async function daemon(t, attest) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scenemint-cli-attest-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  process.env.SCENEMINT_CANVAS_HOME = path.join(root, "home");
  process.env.NODE_ENV = "test";
  const info = await connect({
    origin: "https://canvas.example.test",
    name: "attested",
    workspace,
    attest,
  });
  const session = await readSession(info.sessionId);
  t.after(async () => {
    await request(info.endpoint, "/v1/stop", {
      headers: { Authorization: `Bearer ${session.cliToken}` },
      body: {},
    }).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  return { info, session };
}
const pair = (info, code) =>
  request(info.endpoint, "/v1/pair", {
    headers: { Origin: "https://canvas.example.test" },
    body: { protocolVersion: 2, code, canvasId: "canvas-a", projectId: "project-a" },
  });

test("host attestation is bound to the session id and handed to the page at pair and resume, never to the CLI", async (t) => {
  let seen;
  const { info, session } = await daemon(t, async (sessionId) => {
    seen = sessionId;
    return `hat1.${Buffer.from(sessionId).toString("base64url")}.sig`;
  });
  assert.equal(seen, info.sessionId);
  const status = await request(info.endpoint, "/v1/status", {
    headers: { Authorization: `Bearer ${session.cliToken}` },
    method: "GET",
  });
  assert.equal(status.result.hostAttested, true);
  assert.equal(status.result.hostAttestation, undefined);
  const paired = await pair(info, info.pairCode);
  assert.equal(paired.status, 200);
  assert.equal(
    paired.result.hostAttestation,
    `hat1.${Buffer.from(info.sessionId).toString("base64url")}.sig`,
  );
  const resumed = await request(info.endpoint, "/v1/resume", {
    headers: {
      Origin: "https://canvas.example.test",
      Authorization: `Bearer ${paired.result.browserToken}`,
    },
    body: { protocolVersion: 2, canvasId: "canvas-a", projectId: "project-a" },
  });
  assert.equal(resumed.result.hostAttestation, paired.result.hostAttestation);
});

test("a failing or absent attest callback still connects, without an attestation", async (t) => {
  const { info, session } = await daemon(t, async () => {
    throw new Error("host offline");
  });
  const status = await request(info.endpoint, "/v1/status", {
    headers: { Authorization: `Bearer ${session.cliToken}` },
    method: "GET",
  });
  assert.equal(status.result.hostAttested, false);
  const paired = await pair(info, info.pairCode);
  assert.equal(paired.status, 200);
  assert.equal(paired.result.hostAttestation, undefined);
});

test("an attestation with whitespace or over 4 KiB is refused at connect", async (t) => {
  const { info } = await daemon(t, async () => "bad token");
  assert.equal((await pair(info, info.pairCode)).result.hostAttestation, undefined);
  const { info: big } = await daemon(t, async () => "x".repeat(5000));
  assert.equal((await pair(big, big.pairCode)).result.hostAttestation, undefined);
});
