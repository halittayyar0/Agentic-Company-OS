import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { closeDatabase } from "@workspace/db";
import { canonicalArgumentHash } from "./operation-receipts";
import {
  LocalSourceReview,
  prepareLocalFileObservation,
  privateSourceXml,
} from "./local-source-review";

test.after(() => closeDatabase());

const args = { path: "notes.txt" };
const file = (
  content = "Mira: review accessibility on 2026-10-26.\n決定は未定。",
) => ({
  path: "notes.txt",
  content,
  sizeBytes: Buffer.byteLength(content, "utf8"),
  version: createHash("sha256").update(content, "utf8").digest("hex"),
  truncated: false,
  editable: true,
});
const scope = {
  taskId: 1,
  agentId: 2,
  originAttemptId: "attempt-a",
  logicalExecutionId: "logical-a",
};
const receipt = () => ({
  ...scope,
  id: "receipt-a",
  toolName: "vm_read_file",
  executionKind: "task_step" as const,
  sideEffectClass: "read_only" as const,
  state: "succeeded" as const,
  reconciliationDecision: null,
  argumentHash: canonicalArgumentHash(args),
  finishedAt: new Date(),
});
const model = "ollama:owned:latest";
function fixture() {
  let current = true;
  let prepared = 0;
  const review = new LocalSourceReview(scope, {
    prepareAuthority: async () => {
      prepared++;
      return {
        origin: "http://127.0.0.1:11434",
        generation: 1,
        boundary: "local",
      };
    },
    assertAuthority: () => {
      if (!current) throw new Error("Owned authority changed");
    },
  });
  return {
    review,
    change: () => {
      current = false;
    },
    prepared: () => prepared,
  };
}

test("a complete UTF-8 observation preserves original bytes and requested/resolved paths", () => {
  const observed = prepareLocalFileObservation({ path: "./notes.txt" }, file());
  assert.ok(observed);
  assert.equal(observed.requestedPath, "./notes.txt");
  assert.equal(observed.resolvedPath, "notes.txt");
  assert.equal(observed.content, file().content);
  assert.equal(observed.sha256, file().version);
});

for (const [name, mutate] of [
  [
    "truncated",
    (value: ReturnType<typeof file>) => ({ ...value, truncated: true }),
  ],
  [
    "noneditable",
    (value: ReturnType<typeof file>) => ({ ...value, editable: false }),
  ],
  [
    "wrong hash",
    (value: ReturnType<typeof file>) => ({ ...value, version: "0".repeat(64) }),
  ],
  [
    "wrong byte count",
    (value: ReturnType<typeof file>) => ({
      ...value,
      sizeBytes: value.content.length,
    }),
  ],
  ["NUL", () => file("secret\0tail")],
  ["invalid UTF-16", () => file("\ud800")],
  ["oversized multibyte", () => file("界".repeat(1366))],
] as const) {
  test(`private source review omits ${name} reads`, () => {
    assert.equal(prepareLocalFileObservation(args, mutate(file())), null);
  });
}

test("only a committed matching receipt admits the staged original observation", async () => {
  const { review } = fixture();
  await review.stageRead("slot-a", model, args, file());
  assert.equal(review.forJudge(model), undefined);
  review.confirmRead("slot-a", receipt());
  const sources = review.forJudge(model);
  assert.ok(sources);
  assert.equal(sources.documents.length, 1);
  assert.equal(sources.documents[0]!.receiptId, "receipt-a");
  assert.equal(sources.documents[0]!.content, file().content);
  assert.equal(sources.scope, "current_task_step_reads");
});

for (const [name, patch] of [
  ["failed", { state: "failed" }],
  ["reconciled", { reconciliationDecision: "confirmed_applied" }],
  ["foreign task", { taskId: 3 }],
  ["foreign agent", { agentId: 3 }],
  ["foreign attempt", { originAttemptId: "attempt-b" }],
  ["foreign logical execution", { logicalExecutionId: "logical-b" }],
  [
    "different arguments",
    { argumentHash: canonicalArgumentHash({ path: "other.txt" }) },
  ],
  ["different tool", { toolName: "vm_run_command" }],
  ["uncommitted", { finishedAt: null }],
  ["chat", { executionKind: "chat_turn" }],
] as const) {
  test(`private source review refuses a ${name} receipt`, async () => {
    const { review } = fixture();
    await review.stageRead("slot-a", model, args, file());
    review.confirmRead("slot-a", { ...receipt(), ...patch });
    assert.equal(review.forJudge(model), undefined);
  });
}

test("cloud routes and later different models cannot receive private observations", async () => {
  const { review, prepared } = fixture();
  await review.stageRead("cloud", "openai:gpt-5.6-luna", args, file());
  assert.equal(prepared(), 0);
  await review.stageRead("slot-a", model, args, file());
  review.confirmRead("slot-a", receipt());
  assert.equal(review.forJudge("ollama:another:latest"), undefined);
  const sources = review.forJudge(model)!;
  assert.throws(() =>
    sources.assertCurrent({ provider: "openrouter", modelId: model }),
  );
  assert.throws(() =>
    sources.assertCurrent({
      provider: "ollama",
      modelId: "ollama:another:latest",
    }),
  );
  sources.assertCurrent({ provider: "ollama", modelId: model });
});

test("an endpoint/configuration change invalidates even an already prepared private review", async () => {
  const { review, change } = fixture();
  await review.stageRead("slot-a", model, args, file());
  review.confirmRead("slot-a", receipt());
  const sources = review.forJudge(model)!;
  change();
  assert.throws(() =>
    sources.assertCurrent({ provider: "ollama", modelId: model }),
  );
  assert.equal(review.forJudge(model), undefined);
});

test("only four small observations fit, and a new step has no retained source", async () => {
  const { review } = fixture();
  for (let index = 0; index < 5; index++) {
    await review.stageRead(`slot-${index}`, model, args, file(`Note ${index}`));
    review.confirmRead(`slot-${index}`, {
      ...receipt(),
      id: `receipt-${index}`,
    });
  }
  const sources = review.forJudge(model)!;
  assert.equal(sources.documents.length, 4);
  assert.equal(sources.omittedReads, 1);
  assert.ok(
    Buffer.byteLength(JSON.stringify(sources.documents), "utf8") <= 16384,
  );
  assert.equal(fixture().review.forJudge(model), undefined);
});

test("the serialized bound accounts for escaping, not just raw source bytes", async () => {
  const { review } = fixture();
  for (let index = 0; index < 4; index++) {
    await review.stageRead(
      `slot-${index}`,
      model,
      args,
      file("\\".repeat(4096)),
    );
    review.confirmRead(`slot-${index}`, {
      ...receipt(),
      id: `receipt-${index}`,
    });
  }
  const sources = review.forJudge(model)!;
  assert.ok(sources.documents.length < 4);
  assert.ok(sources.omittedReads > 0);
  assert.ok(
    Buffer.byteLength(JSON.stringify(sources.documents), "utf8") <= 16384,
  );
});

test("the prompt bound includes XML escaping and the source envelope", async () => {
  const { review } = fixture();
  for (let index = 0; index < 4; index++) {
    await review.stageRead(
      `slot-${index}`,
      model,
      args,
      file("&".repeat(3000)),
    );
    review.confirmRead(`slot-${index}`, {
      ...receipt(),
      id: `receipt-${index}`,
    });
  }
  const sources = review.forJudge(model)!;
  assert.equal(sources.documents.length, 1);
  assert.equal(sources.omittedReads, 3);
  assert.ok(
    Buffer.byteLength(
      privateSourceXml({
        scope: sources.scope,
        documents: sources.documents,
        omittedReads: sources.omittedReads,
      }),
      "utf8",
    ) <= 16384,
  );
});
