import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_TEMPLATES } from "../agent-templates";
import { planCompanyChatRouting } from "./company-chat-routing";

const members = [
  {
    id: 1,
    name: "CEO",
    role: "CEO",
    department: "executive",
    systemPrompt: "",
    isRootCeo: true,
  },
  {
    id: 2,
    name: "İpek",
    role: "İçerik Uzmanı",
    department: "content",
    systemPrompt: "Editoryal içerik",
    isRootCeo: false,
  },
  {
    id: 3,
    name: "Deniz",
    role: "Tasarım Uzmanı",
    department: "design",
    systemPrompt: "Arayüz ve kullanılabilirlik",
    isRootCeo: false,
  },
];

test("noun aliases do not multiply the contribution of one word", () => {
  const roster = [
    {
      ...members[2],
      id: 1,
      role: "Tasarım",
      department: "",
      name: "Ada",
      systemPrompt: "",
    },
    {
      ...members[2],
      id: 2,
      role: "Finans Uzmanı",
      department: "",
      name: "Ece",
      systemPrompt: "",
    },
  ];
  const input = {
    agents: roster,
    mentionedAgentIds: [],
    environment: { COMPANY_CHAT_MAX_RESPONSE_ATTEMPTS: "1" },
  };
  const plain = planCompanyChatRouting({ ...input, content: "Tasarım uzman" });
  const inflected = planCompanyChatRouting({
    ...input,
    content: "Tasarım uzmanı",
  });
  assert.deepEqual(inflected.candidateAgentIds, plain.candidateAgentIds);
  assert.deepEqual(
    inflected.decisions.map((decision) => decision.score),
    plain.decisions.map((decision) => decision.score),
  );
});

test("Turkish case, ASCII keyboards and common noun suffixes reach the same expert", () => {
  for (const content of ["İÇERİK", "icerik", "içeriği", "İçerikleri incele"]) {
    const plan = planCompanyChatRouting({
      content,
      agents: members,
      mentionedAgentIds: [],
    });
    assert.deepEqual(plan.candidateAgentIds, [2], content);
  }
  for (const content of ["TASARIMI", "tasarımı", "tasarim", "tasarımları"]) {
    const plan = planCompanyChatRouting({
      content,
      agents: members,
      mentionedAgentIds: [],
    });
    assert.deepEqual(plan.candidateAgentIds, [3], content);
  }
});

test("explicit routing deduplicates mentions and ignores non-members before budget accounting", () => {
  const plan = planCompanyChatRouting({
    content: "@İpek @İpek @Deniz",
    agents: members,
    mentionedAgentIds: [999, 2, 2, 3],
    environment: { COMPANY_CHAT_MAX_RESPONSE_ATTEMPTS: "2" },
  });
  assert.deepEqual(plan.candidateAgentIds, [2, 3]);
  assert.equal(
    plan.decisions.filter((decision) => decision.shouldAttempt).length,
    2,
  );
});

test("specialist templates have distinct deliverables without new financial or host authority", () => {
  for (const key of [
    "ux_designer",
    "quality_engineer",
    "data_analyst",
    "automation_specialist",
  ]) {
    const template = AGENT_TEMPLATES.find((item) => item.key === key);
    assert.ok(
      template,
      `${key} is available for the roster and template picker`,
    );
    for (const permission of [
      "canUseSudo",
      "canSpend",
      "canDelete",
      "canPublish",
      "canContactExternal",
      "canCreateSubAgents",
    ] as const) {
      assert.equal(
        template.defaultPermissions[permission],
        false,
        `${key}: ${permission}`,
      );
    }
    assert.ok(template.defaultSystemPrompt.includes("Teslim"));
  }
  assert.equal(
    new Set(AGENT_TEMPLATES.map((template) => template.key)).size,
    AGENT_TEMPLATES.length,
  );
});
