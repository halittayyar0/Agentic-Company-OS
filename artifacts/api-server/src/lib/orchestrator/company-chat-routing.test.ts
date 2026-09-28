import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "@workspace/db";
import {
  getCompanyChatRoutingLimits,
  mapWithConcurrency,
  planCompanyChatRouting,
} from "./company-chat-routing";

function agent(
  id: number,
  input: Partial<Agent> & Pick<Agent, "name" | "role">,
): Agent {
  return {
    id,
    name: input.name,
    role: input.role,
    department: input.department ?? null,
    parentAgentId: null,
    depth: 0,
    status: "idle",
    currentTaskId: null,
    currentAction: null,
    lastActiveAt: null,
    runLeaseOwner: null,
    runLeaseExpiresAt: null,
    systemPrompt: input.systemPrompt ?? "",
    isCustomPrompt: false,
    templateKey: null,
    isRootCeo: input.isRootCeo ?? false,
    modelMode: "auto",
    modelId: null,
    avatarColor: "#000000",
    avatarVersion: null,
    permissions: {
      canCreateSubAgents: false,
      canDelegate: false,
      canSpend: false,
      canDelete: false,
      canPublish: false,
      canContactExternal: false,
      canBrowse: false,
      canUseTerminal: false,
      canUseSudo: false,
    },
    createdByAgentId: null,
    createdByUser: true,
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const members = [
  agent(1, { name: "Ada", role: "CEO", isRootCeo: true }),
  agent(2, {
    name: "Mert",
    role: "Pazarlama Direktörü",
    department: "Pazarlama",
    systemPrompt: "Kampanya, marka ve büyüme uzmanı",
  }),
  agent(3, {
    name: "Ece",
    role: "Mühendislik Direktörü",
    department: "Mühendislik",
    systemPrompt: "Yazılım mimarisi ve güvenlik uzmanı",
  }),
];

test("explicit mentions route only to mentioned members", () => {
  const plan = planCompanyChatRouting({
    content: "@Ece güvenlik riskini değerlendirir misin?",
    agents: members,
    mentionedAgentIds: [3],
  });
  assert.equal(plan.mode, "mentions");
  assert.deepEqual(plan.candidateAgentIds, [3]);
  assert.deepEqual(
    plan.decisions.map(({ agentId, shouldAttempt, reason }) => ({
      agentId,
      shouldAttempt,
      reason,
    })),
    [
      { agentId: 1, shouldAttempt: false, reason: "not_mentioned" },
      { agentId: 2, shouldAttempt: false, reason: "not_mentioned" },
      { agentId: 3, shouldAttempt: true, reason: "mentioned" },
    ],
  );
});

test("ambient routing evaluates every member and selects relevant expertise", () => {
  const plan = planCompanyChatRouting({
    content: "Yeni pazarlama kampanyasının marka planını değerlendir.",
    agents: members,
    mentionedAgentIds: [],
  });
  assert.equal(plan.mode, "relevance");
  assert.equal(plan.decisions.length, members.length);
  assert.deepEqual(plan.candidateAgentIds, [2]);
  assert.equal(plan.decisions[0]?.reason, "not_relevant");
  assert.equal(plan.decisions[1]?.reason, "role_match");
  assert.equal(plan.decisions[2]?.reason, "not_relevant");
});

test("a generic question gets one leadership fallback while a statement may stay silent", () => {
  const question = planCompanyChatRouting({
    content: "Bugünkü genel durum nedir?",
    agents: members,
    mentionedAgentIds: [],
  });
  assert.deepEqual(question.candidateAgentIds, [1]);
  assert.equal(question.decisions[0]?.reason, "general_question");

  const statement = planCompanyChatRouting({
    content: "Herkese günaydın.",
    agents: members,
    mentionedAgentIds: [],
  });
  assert.deepEqual(statement.candidateAgentIds, []);
});

test("response attempts are capped by both call count and aggregate token budget", () => {
  const environment = {
    COMPANY_CHAT_MAX_RESPONSE_ATTEMPTS: "20",
    COMPANY_CHAT_RESPONSE_MAX_TOKENS: "500",
    COMPANY_CHAT_RESPONSE_TOKEN_BUDGET: "1200",
    COMPANY_CHAT_RESPONSE_CONCURRENCY: "7",
  } as NodeJS.ProcessEnv;
  assert.deepEqual(getCompanyChatRoutingLimits(environment), {
    maxResponseAttempts: 2,
    concurrency: 2,
    maxTokensPerResponse: 500,
    tokenBudget: 1_200,
  });

  const plan = planCompanyChatRouting({
    content: "Pazarlama kampanya marka planı",
    agents: [
      members[1]!,
      agent(4, { name: "Pelin", role: "Pazarlama Uzmanı" }),
      agent(5, { name: "Can", role: "Marka Uzmanı" }),
    ],
    mentionedAgentIds: [],
    environment,
  });
  assert.equal(plan.candidateAgentIds.length, 2);
  assert.equal(
    plan.decisions.filter((decision) => decision.reason === "budget_guard")
      .length,
    1,
  );

  assert.deepEqual(
    getCompanyChatRoutingLimits({
      COMPANY_CHAT_RESPONSE_MAX_TOKENS: "600",
      COMPANY_CHAT_RESPONSE_TOKEN_BUDGET: "100",
    } as NodeJS.ProcessEnv),
    {
      maxResponseAttempts: 1,
      concurrency: 1,
      maxTokensPerResponse: 100,
      tokenBudget: 100,
    },
  );
});

test("bounded worker pool preserves result order and never exceeds concurrency", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency(
    [0, 1, 2, 3, 4],
    2,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, (4 - value) * 2));
      active -= 1;
      return value * 10;
    },
  );
  assert.equal(peak, 2);
  assert.deepEqual(results, [0, 10, 20, 30, 40]);
});
