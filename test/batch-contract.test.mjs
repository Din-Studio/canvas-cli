import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.mjs";
import { isMutation, MUTATIONS } from "../src/common.mjs";

const SESSION = "11111111-2222-3333-4444-555555555555";

test("cancel-batch takes --batch BATCH-ID, the form the skill and help both document", () => {
  const parsed = parseArgs(["cancel-batch", "--batch", "b-123", "--session", SESSION]);
  assert.equal(parsed.command, "cancel-batch");
  assert.equal(parsed.options.batch, "b-123");
  // Bare cancel-batch stays the "every batch of this session" form.
  const bare = parseArgs(["cancel-batch", "--session", SESSION]);
  assert.equal(bare.options.batch, undefined);
});

test("run_nodes and cancel_batch are mutations, so a lost reply is unknown_outcome", () => {
  // The daemon takes the serialization slot off this same predicate; a second
  // hand-maintained list in the transport is how they drifted apart, and a batch
  // reported as "not sent" invites the Agent to resubmit 200 paid generations.
  for (const method of ["run_nodes", "cancel_batch", "apply", "run_node", "end_turn"]) {
    assert.equal(MUTATIONS.has(method), true, `${method} must be a mutation`);
    assert.equal(isMutation(method, {}), true, `${method} must classify as a mutation`);
  }
  assert.equal(isMutation("ls", {}), false);
  assert.equal(isMutation("timeline", { op: "list" }), false);
  assert.equal(isMutation("timeline", { op: "set" }), true);
});
