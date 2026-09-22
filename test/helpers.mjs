import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const bin = path.join(packageRoot, "bin", "scenemint-canvas.mjs");
export function cli(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI test timed out"));
    }, 20000);
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        resolve({ code, result: JSON.parse(stdout), stdout, stderr });
      } catch {
        reject(new Error(`CLI did not return JSON: ${stderr || stdout}`));
      }
    });
    child.stdin.end(input);
  });
}
export function request(endpoint, route, { headers = {}, body, method, signal } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, endpoint);
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: {
          ...(encoded
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(encoded) }
            : {}),
          ...headers,
        },
        signal,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            result: text ? JSON.parse(text) : null,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(encoded);
  });
}
export async function fixture(t, { timeout = 8000, lease = 30000, resume } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scenemint-cli-test-"));
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "userdata");
  await fs.mkdir(workspace);
  const env = {
    ...process.env,
    SCENEMINT_CANVAS_HOME: home,
    NODE_ENV: "test",
    SCENEMINT_CANVAS_TEST_TIMEOUT_MS: String(timeout),
    SCENEMINT_CANVAS_TEST_LEASE_MS: String(lease),
    ...(resume ? { SCENEMINT_CANVAS_TEST_RESUME_MS: String(resume) } : {}),
  };
  const opened = await cli(
    [
      "connect",
      "--origin",
      "https://canvas.example.test",
      "--name",
      "Research collaborator",
      "--workspace",
      workspace,
    ],
    env,
  );
  if (opened.code !== 0) throw new Error(`connect failed: ${opened.stdout}`);
  const info = opened.result;
  const recordPath = path.join(home, "sessions", `${info.sessionId}.json`);
  const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
  let paired;
  const controllers = new Set();
  const browserHeaders = () => ({
    Origin: info.origin,
    ...(paired ? { Authorization: `Bearer ${paired.browserToken}` } : {}),
  });
  const f = {
    root,
    workspace,
    home,
    env,
    info,
    record,
    recordPath,
    cli: (args, input) => cli([...args, "--session", info.sessionId], env, input),
    raw: (route, args) => request(info.endpoint, route, args),
    rpc: (body) =>
      request(info.endpoint, "/v1/call", {
        headers: { Authorization: `Bearer ${record.cliToken}` },
        body,
      }),
    async pair() {
      const reply = await request(info.endpoint, "/v1/pair", {
        headers: browserHeaders(),
        body: {
          protocolVersion: 2,
          code: info.pairCode,
          canvasId: "canvas-a",
          projectId: "project-a",
        },
      });
      if (reply.status !== 200) throw new Error(`pair failed: ${JSON.stringify(reply.result)}`);
      paired = reply.result;
      return paired;
    },
    /** Resume as the replacement page; rotates the browser credential used by browser()/pump(). */
    async resume() {
      const reply = await request(info.endpoint, "/v1/resume", {
        headers: browserHeaders(),
        body: { protocolVersion: 2, canvasId: "canvas-a", projectId: "project-a" },
      });
      if (reply.status === 200) paired = reply.result;
      return reply;
    },
    browser: (route, body = {}, extra = {}) =>
      request(info.endpoint, route, { headers: browserHeaders(), body, ...extra }),
    async pump(handler) {
      const controller = new AbortController();
      controllers.add(controller);
      const done = (async () => {
        while (!controller.signal.aborted) {
          const next = await f.browser("/v1/next", {}, { signal: controller.signal });
          if (next.status !== 200) break;
          if (next.result.idle) continue;
          const result = await handler(next.result);
          await f.browser(
            "/v1/reply",
            { requestId: next.result.requestId, result },
            { signal: controller.signal },
          );
        }
      })().catch((error) => {
        if (!controller.signal.aborted) throw error;
      });
      return {
        stop: async () => {
          controller.abort();
          await done;
        },
        done,
      };
    },
  };
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    await request(info.endpoint, "/v1/stop", {
      headers: { Authorization: `Bearer ${record.cliToken}` },
      body: {},
    }).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  return f;
}
