import assert from "node:assert/strict";
// This worker is exclusively an owned disposable database test actor.
assert.equal(process.env.POSTGRES_RACE_TEST_DISPOSABLE, "1");
const target = new URL(process.env.DATABASE_URL!);
assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
assert.ok(
  ["agentic_inference_test", "agentic_os_ci"].includes(
    target.pathname.slice(1),
  ),
);
const id = process.argv[2];
assert.match(id, /^[a-f0-9-]{36}$/i);
const { dbReady, closeDatabase } = await import("@workspace/db");
const { reconcileInferenceResponseEvidence } =
  await import("../inference-usage-correction");
try {
  await dbReady;
  const result = await reconcileInferenceResponseEvidence(id);
  console.log(JSON.stringify({ result, attemptId: id }));
} finally {
  await closeDatabase();
}
