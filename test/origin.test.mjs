import test from "node:test";
import assert from "node:assert/strict";
import { CliError, validateOrigin } from "../src/common.mjs";

test("validateOrigin allows exact local HTTP origins, including reserved .localhost names", () => {
  for (const origin of [
    "http://localhost:17001",
    "http://127.0.0.1:17001",
    "http://[::1]:17001",
    "http://gap-e2e.localhost:17001",
    "http://nested.gap-e2e.localhost:17001",
    "https://canvas.example.test",
  ]) {
    assert.equal(validateOrigin(origin), origin);
  }
});

test("validateOrigin rejects lookalikes, credentials, and non-origin URLs", () => {
  for (const origin of [
    "http://localhost.example:17001",
    "http://evil-localhost:17001",
    "http://gap-e2e.localhost.example:17001",
    "http://user@gap-e2e.localhost:17001",
    "http://gap-e2e.localhost:17001/path",
    "http://example.test:17001",
  ]) {
    assert.throws(() => validateOrigin(origin), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "invalid_origin");
      return true;
    });
  }
});
