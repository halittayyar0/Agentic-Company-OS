import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  closeDatabase,
  db,
  dbReady,
  usageEventsTable,
} from "@workspace/db";
import { configureOllama, refreshOllamaCatalog } from "@workspace/ai-server";
import { ownedOllamaPeer } from "../../../../../lib/ai-server/src/testing/ollama-boundary-peer";
import { runJudge } from "./judge";

test.after(() => closeDatabase());

const expectedLocalReviewFormat = {
  type: "json_schema",
  json_schema: {
    name: "agentic_completion_review",
    strict: true,
    schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["pass", "warn", "block"] },
        reasoning: { type: "string" },
      },
      required: ["verdict", "reasoning"],
      additionalProperties: false,
    },
  },
};

async function fixture(
  t: test.TestContext,
  answer: unknown,
  finishReason = "stop",
  thinking = true,
) {
  await dbReady;
  const peer = await ownedOllamaPeer({
    show: { capabilities: thinking ? ["tools", "thinking"] : ["tools"] },
    complete: (body, response) =>
      response.end(
        JSON.stringify({
          id: "owned-judge-reply",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(answer) },
              finish_reason: finishReason,
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      ),
  });
  t.after(async () => {
    configureOllama({ baseUrl: null });
    await peer.close();
  });
  configureOllama({ baseUrl: peer.origin });
  await refreshOllamaCatalog(true);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Owned review integrity",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  return { peer, agent: agent! };
}

for (const purpose of ["completion", "approval"] as const) {
  test(`${purpose} truncated review cannot certify even a valid PASS object`, async (t) => {
    const { peer, agent } = await fixture(
      t,
      {
        verdict: "pass",
        reasoning: "All requirements are satisfied.",
      },
      "length",
    );
    const review = await runJudge({
      agent,
      taskId: null,
      purpose,
      locale: "en",
      originalBrief: "Owned fixture",
      actionSummary: "Owned fixture",
    });
    assert.equal(review.unavailable, true);
    assert.equal(review.verdict, purpose === "completion" ? "block" : "warn");
    assert.equal(
      peer.completions().length,
      1,
      "no repeated request or paid fallback",
    );
    const receipts = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]!.usageReported, true);
    assert.equal(receipts[0]!.totalTokens, 2);
  });

  test(`${purpose} local thinking review explicitly disables hidden reasoning on the actual request`, async (t) => {
    const { peer, agent } = await fixture(t, {
      verdict: "warn",
      reasoning: "An advisory issue remains.",
    });
    const review = await runJudge({
      agent,
      taskId: null,
      purpose,
      locale: "en",
      originalBrief: "Owned fixture",
      actionSummary: "Owned fixture",
    });
    assert.equal(review.verdict, "warn");
    assert.equal(peer.completions().length, 1);
    assert.equal(peer.completions()[0]!.body.reasoning_effort, "none");
    assert.equal(peer.completions()[0]!.body.temperature, 0);
    assert.equal(
      peer.completions()[0]!.body.max_tokens,
      4096,
      "existing review ceiling stays unchanged",
    );
    assert.deepEqual(
      peer.completions()[0]!.body.response_format,
      expectedLocalReviewFormat,
    );
  });

  for (const [name, answer] of [
    ["missing", { verdict: "pass" }],
    ["blank", { verdict: "warn", reasoning: " \n\t " }],
    ["non-string", { verdict: "block", reasoning: 391 }],
  ] as const) {
    test(`${purpose} review with ${name} reasoning is unavailable and keeps reported usage`, async (t) => {
      const { peer, agent } = await fixture(t, answer);
      const review = await runJudge({
        agent,
        taskId: null,
        purpose,
        locale: "en",
        originalBrief: "Owned fixture",
        actionSummary: "Owned fixture",
      });
      assert.equal(review.unavailable, true);
      assert.equal(review.verdict, purpose === "completion" ? "block" : "warn");
      assert.equal(
        peer.completions().length,
        1,
        "no repeated request or paid fallback",
      );
      const receipts = await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id));
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0]!.kind, "judge");
      assert.equal(receipts[0]!.usageReported, true);
      assert.equal(receipts[0]!.totalTokens, 2);
    });
  }

  test(`${purpose} valid advisory review preserves the actual reason and stays available`, async (t) => {
    const { peer, agent } = await fixture(
      t,
      {
        verdict: "warn",
        reasoning: "  An advisory issue remains.  ",
      },
      "stop",
      false,
    );
    const review = await runJudge({
      agent,
      taskId: null,
      purpose,
      locale: "en",
      originalBrief: "Owned fixture",
      actionSummary: "Owned fixture",
    });
    assert.equal(review.verdict, "warn");
    assert.notEqual(review.unavailable, true);
    assert.equal(review.reasoning.trim(), "An advisory issue remains.");
    assert.equal(peer.completions().length, 1);
    const body = peer.completions()[0]!.body;
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, expectedLocalReviewFormat);
  });
}
