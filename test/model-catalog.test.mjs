import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";

test("real CLI models maps account catalog filters and pagination through its own paired daemon", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.cli(["models"])).result.error.code, "not_connected");
  await f.pair();
  const seen = [];
  await f.pump(async (request) => {
    seen.push(request);
    return {
      ok: true,
      models: [{ id: "fixture-model", inputSchema: { required: ["prompt"] } }],
      total: 1,
      nextOffset: null,
    };
  });
  const result = await f.cli([
    "models",
    "Fixture",
    "--model-type",
    "video",
    "--model-id",
    "fixture-model",
    "--limit",
    "2",
    "--offset",
    "3",
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.result.models[0].id, "fixture-model");
  assert.equal(seen[0].method, "model_catalog");
  assert.deepEqual(seen[0].params, {
    query: "Fixture",
    modelType: "video",
    modelId: "fixture-model",
    limit: 2,
    offset: 3,
  });
  const full = await f.cli([
    "models",
    "--json",
    JSON.stringify({ modelType: "image", limit: 1 }),
    "--query",
    "Name",
  ]);
  assert.equal(full.code, 0);
  assert.deepEqual(seen[1].params, { modelType: "image", limit: 1, query: "Name" });
});
