import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase } from "@workspace/db";
import {
  completionProposalDigest,
  completionProposalContextHash,
  completionProposalMatchesContext,
  readCompletionProposal,
} from "./task-result-review-proposal";

test.after(() => closeDatabase());
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const task = {
  id: 1,
  ownerAgentId: 2,
  title: "Read notes",
  brief: "Read and report only.",
  cycleCount: 0,
  createdAt: new Date("2026-10-23T00:00:00.000Z"),
  lastCycleCompletedAt: null,
  autonomyMode: "finite",
  cadenceSeconds: null,
  executionModelId: "ollama:owned:latest",
  completionRequirements: [
    { kind: "tool_succeeded" as const, tool: "vm_read_file" },
  ],
  resultFormat: { kind: "table" as const, columns: ["Owner", "Due"] },
};
const agent = { id: 2, configVersion: hash("owner-config-1") };
function fixture() {
  const summary = "| Owner | Due |\n| --- | --- |\n| Mira | 2026-10-26 |";
  return {
    schemaVersion: 1,
    taskId: 1,
    ownerAgentId: 2,
    ownerConfigVersion: agent.configVersion,
    cycleNumber: 0,
    cycleStartedAt: task.createdAt.toISOString(),
    originAttemptId: randomUUID(),
    judgeReviewId: 3,
    judgeReasonCode: "missing_required_action",
    contextHash: completionProposalContextHash(task, agent),
    resultSummary: summary,
    resultSummaryHash: hash(summary),
    sourceReceipts: [
      {
        receiptId: "owned-receipt",
        argumentHash: hash("path"),
        fileSha256: hash("notes"),
        byteCount: 21,
      },
    ],
  };
}

test("a strict proposal preserves exact output, bounded metadata and deterministic digest", () => {
  const raw = fixture();
  const proposal = readCompletionProposal(raw);
  assert.ok(proposal);
  assert.equal(proposal.resultSummary, raw.resultSummary);
  assert.equal(
    completionProposalDigest(proposal),
    completionProposalDigest(structuredClone(proposal)),
  );
  assert.equal(completionProposalMatchesContext(proposal, task, agent), true);
  assert.ok(!Object.hasOwn(proposal.sourceReceipts[0]!, "content"));
  for (const control of ["\u0007", "\u000b", "\u001b", "\u007f"]) {
    const resultSummary = "Proposed" + control + "output";
    assert.equal(
      readCompletionProposal({
        ...raw,
        resultSummary,
        resultSummaryHash: hash(resultSummary),
      }),
      null,
    );
  }
});

for (const [name, patch] of [
  ["unknown version", { schemaVersion: 2 }],
  ["wrong summary hash", { resultSummaryHash: "0".repeat(64) }],
  ["success reason", { judgeReasonCode: "scope_satisfied" }],
  ["quoted reasoning", { reasoning: "SOURCE-SECRET" }],
  ["raw source", { sourceContent: "SOURCE-SECRET" }],
  ["empty summary", { resultSummary: "", resultSummaryHash: hash("") }],
  [
    "NUL summary",
    { resultSummary: "bad\0text", resultSummaryHash: hash("bad\0text") },
  ],
  [
    "lone surrogate",
    { resultSummary: "bad\ud800", resultSummaryHash: hash("bad\ud800") },
  ],
  [
    "large summary",
    {
      resultSummary: "x".repeat(65537),
      resultSummaryHash: hash("x".repeat(65537)),
    },
  ],
  ["fractional cycle", { cycleNumber: 0.5 }],
  ["invalid attempt", { originAttemptId: "model-claimed" }],
  ["noncanonical date", { cycleStartedAt: "2026-10-23T00:00:00Z" }],
] as const) {
  test(`proposal refuses ${name}`, () =>
    assert.equal(readCompletionProposal({ ...fixture(), ...patch }), null));
}

test("proposal refuses duplicate, extra, forged and excessive receipt fields", () => {
  const raw = fixture();
  for (const sourceReceipts of [
    [],
    [raw.sourceReceipts[0], raw.sourceReceipts[0]],
    [{ ...raw.sourceReceipts[0], content: "SOURCE-SECRET" }],
    [{ ...raw.sourceReceipts[0], byteCount: 4097 }],
    [{ ...raw.sourceReceipts[0], receiptId: " padded " }],
    Array.from({ length: 5 }, (_, index) => ({
      ...raw.sourceReceipts[0],
      receiptId: `receipt-${index}`,
    })),
  ])
    assert.equal(readCompletionProposal({ ...raw, sourceReceipts }), null);
});

for (const [name, patch] of [
  ["brief", { brief: "Send a message instead." }],
  ["owner", { ownerAgentId: 4 }],
  ["cycle", { cycleCount: 1 }],
  [
    "cycle start",
    { lastCycleCompletedAt: new Date("2026-10-24T00:00:00.000Z") },
  ],
  [
    "format",
    {
      resultFormat: {
        kind: "table" as const,
        columns: ["Due", "Owner"] as string[],
      },
    },
  ],
  [
    "required operations",
    { completionRequirements: [] as typeof task.completionRequirements },
  ],
  ["autonomy", { autonomyMode: "continuous", cadenceSeconds: 60 }],
  ["model", { executionModelId: "ollama:another:latest" }],
] as const) {
  test(`a changed ${name} invalidates the reviewed context`, () => {
    assert.equal(
      completionProposalMatchesContext(
        readCompletionProposal(fixture())!,
        { ...task, ...patch },
        agent,
      ),
      false,
    );
  });
}

test("owner configuration changes invalidate previously reviewed permissions/model context", () => {
  const proposal = readCompletionProposal(fixture())!;
  assert.equal(
    completionProposalMatchesContext(proposal, task, {
      ...agent,
      configVersion: hash("owner-config-2"),
    }),
    false,
  );
});

test("changing exact proposed output changes the mandatory reviewed digest", () => {
  const original = readCompletionProposal(fixture())!;
  const changed = {
    ...original,
    resultSummary: original.resultSummary.replace("Mira", "Deniz"),
  };
  changed.resultSummaryHash = hash(changed.resultSummary);
  assert.notEqual(
    completionProposalDigest(original),
    completionProposalDigest(readCompletionProposal(changed)!),
  );
});
