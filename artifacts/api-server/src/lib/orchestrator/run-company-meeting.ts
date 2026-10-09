import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  createChatCompletion,
  completionTokenControl,
  DEFAULT_MAX_COMPLETION_TOKENS,
  resolveLlmRequestTimeoutMs,
} from "@workspace/ai-server";
import {
  agentsTable,
  companyChannelMembersTable,
  companyMessagesTable,
  db,
  type Agent,
  type CompanyMessage,
} from "@workspace/db";
import { logger } from "../logger";
import { readWorkspaceLocale, type WorkspaceLocale } from "../workspace-locale";
import { assertCompanyMessageCapacity } from "./runtime-capacity";
import {
  assertExecutionAllowed,
  lockAndAssertExecutionAllowed,
} from "./runtime-emergency-stop";
import { selectModel } from "./model-select";
import { buildChatSystemPrompt } from "./system-prompt";
import { runAccountedCompletion } from "./inference-accounting";

const MIN_MEETING_LEASE_MS = 5 * 60_000;
const MEETING_LEASE_BUFFER_MS = 60_000;
const MEETING_MAX_COMPLETION_TOKENS = Math.min(
  DEFAULT_MAX_COMPLETION_TOKENS,
  600,
);
const NO_REPLY_SENTINEL = "[[NO_REPLY]]";

export type CompanyMeetingSkipReason =
  | "busy"
  | "unavailable"
  | "empty_response"
  | "model_error"
  | "not_relevant"
  | "not_mentioned"
  | "budget_guard";

export interface CompanyMeetingTurnResult {
  message: CompanyMessage | null;
  skipReason?: CompanyMeetingSkipReason;
}

export function resolveCompanyMeetingLeaseMs(
  rawTimeout = process.env.LLM_REQUEST_TIMEOUT_MS,
): number {
  return Math.max(
    MIN_MEETING_LEASE_MS,
    resolveLlmRequestTimeoutMs(rawTimeout) + MEETING_LEASE_BUFFER_MS,
  );
}

function meetingPrompt(
  founderContent: string,
  responseMode: "required" | "relevance",
): string {
  const relevanceInstruction =
    responseMode === "relevance"
      ? `Bu mesaj sana doğrudan yöneltilmedi. Rolün, uzmanlığın veya elindeki gerçek kanıtlar konuşmaya yeni ve gerekli bir katkı sağlamıyorsa yalnızca ${NO_REPLY_SENTINEL} yaz. Selamlama, tekrar, onaylama veya başka bir ajanın söylediğini yeniden ifade etme; bunlar katkı sayılmaz.`
      : "Kurucu seni @mention ile doğrudan muhatap seçti. Soruyu kendi yetki ve bilgi sınırların içinde yanıtla.";
  return `Bu, Şirket Odası'ndaki kurucu mesajına verilen sınırlı bir grup sohbeti turudur.

<founder_message>
${founderContent}
</founder_message>

${relevanceInstruction}

Kendi gerçek rolün ve elindeki kanıtlarla tek bir kısa yanıt ver. Senden önce odaya yazan üyelerin gerçek mesajlarını company_channel bağlamından dikkate alabilirsin. Başka bir üye adına konuşma, yapılmamış eylemi yapılmış gibi anlatma, araç veya işlem yürüttüğünü iddia etme. Bu tur yalnızca bir yanıt üretir; başka ajanları otomatik yanıtlamaya çağıran sonsuz bir zincir başlatma.`;
}

export function isCompanyMeetingNoReply(content: string): boolean {
  const normalized = content.trim().toLocaleUpperCase("en-US");
  return normalized === NO_REPLY_SENTINEL || normalized === "NO_REPLY";
}

/**
 * Runs exactly one tool-free model completion for one explicitly selected
 * room member. The caller owns participant count and ordering; this function
 * can never recurse or fan out to another agent.
 */
export async function runCompanyMeetingTurn(params: {
  agent: Agent;
  channelId: number;
  founderMessageId: number;
  founderContent: string;
  responseMode?: "required" | "relevance";
  maxTokens?: number;
  locale?: WorkspaceLocale;
}): Promise<CompanyMeetingTurnResult> {
  const {
    agent,
    channelId,
    founderMessageId,
    founderContent,
    responseMode = "required",
    maxTokens = MEETING_MAX_COMPLETION_TOKENS,
  } = params;
  const locale = params.locale ?? (await readWorkspaceLocale());
  const preparing = {
    tr: "Şirket Odası yanıtını hazırlıyor",
    en: "Preparing a Company Room reply",
    de: "Antwort im Unternehmensraum wird vorbereitet",
    ru: "Подготовка ответа в комнате компании",
    "zh-CN": "正在准备公司聊天室回复",
    "zh-TW": "正在準備公司聊天室回覆",
    ar: "جارٍ إعداد رد في غرفة الشركة",
  }[locale];
  const leaseOwner = `company-meeting:${process.pid}:${randomUUID()}`;
  const now = new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + resolveCompanyMeetingLeaseMs(),
  );

  const claimState = await db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    const [membership] = await tx
      .select({ agentId: companyChannelMembersTable.agentId })
      .from(companyChannelMembersTable)
      .where(
        and(
          eq(companyChannelMembersTable.channelId, channelId),
          eq(companyChannelMembersTable.agentId, agent.id),
        ),
      );
    if (!membership) return "unavailable" as const;
    const [claimed] = await tx
      .update(agentsTable)
      .set({
        status: "working",
        currentTaskId: null,
        currentAction: preparing,
        lastActiveAt: now,
        runLeaseOwner: leaseOwner,
        runLeaseExpiresAt: leaseExpiresAt,
      })
      .where(
        and(
          eq(agentsTable.id, agent.id),
          eq(agentsTable.isActive, true),
          eq(agentsTable.status, "idle"),
          isNull(agentsTable.runLeaseOwner),
        ),
      )
      .returning({ id: agentsTable.id });
    return claimed ? ("claimed" as const) : ("busy" as const);
  });
  if (claimState !== "claimed") {
    return {
      message: null,
      skipReason: claimState === "busy" ? "busy" : "unavailable",
    };
  }

  try {
    await assertExecutionAllowed();
    const systemPrompt = `${await buildChatSystemPrompt(agent, undefined, locale)}

<execution_mode name="bounded_company_room_reply">
- Şirket Odası'nda yalnız kendi adına, tek bir mesajla yanıt ver.
- Bu turda araç yoktur ve hiçbir dış ya da yerel eylem çalıştırılmaz. Öneri ile yapılmış eylemi kesin biçimde ayır.
- Yanıtın yalnızca sunucu kalıcı company_messages kaydını başarıyla oluşturursa kanalda görünür.
</execution_mode>`;
    const selection = selectModel({
      purpose: "chat",
      agentDepth: agent.depth,
      agent: { modelMode: agent.modelMode, modelId: agent.modelId },
    });

    let completion;
    try {
      const result = await runAccountedCompletion(
        {
          provider: selection.provider ?? "unknown",
          modelId: selection.modelId,
          agentId: agent.id,
          taskId: null,
          kind: "chat",
          locale,
          agentLeaseOwner: leaseOwner,
          assertOwnership: assertExecutionAllowed,
        },
        {
          model: selection.modelId,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: meetingPrompt(founderContent, responseMode),
            },
          ],
          ...completionTokenControl(
            selection.modelId,
            Math.max(
              100,
              Math.min(MEETING_MAX_COMPLETION_TOKENS, Math.floor(maxTokens)),
            ),
          ),
        },
      );
      completion = result.completion;
    } catch (error) {
      logger.error(
        { error, agentId: agent.id, founderMessageId },
        "Company Room completion failed",
      );
      return { message: null, skipReason: "model_error" };
    }

    const content = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!content) return { message: null, skipReason: "empty_response" };
    if (responseMode === "relevance" && isCompanyMeetingNoReply(content)) {
      return { message: null, skipReason: "not_relevant" };
    }

    const [message] = await db.transaction(async (tx) => {
      await lockAndAssertExecutionAllowed(tx);
      await assertCompanyMessageCapacity(tx);

      const [membership] = await tx
        .select({ agentId: companyChannelMembersTable.agentId })
        .from(companyChannelMembersTable)
        .where(
          and(
            eq(companyChannelMembersTable.channelId, channelId),
            eq(companyChannelMembersTable.agentId, agent.id),
          ),
        );
      if (!membership) return [];

      const [lease] = await tx
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(
          and(
            eq(agentsTable.id, agent.id),
            eq(agentsTable.isActive, true),
            eq(agentsTable.runLeaseOwner, leaseOwner),
          ),
        );
      if (!lease) return [];

      return tx
        .insert(companyMessagesTable)
        .values({
          channelId,
          senderType: "agent",
          senderAgentId: agent.id,
          content: content.slice(0, 4_000),
          source: "room_reply",
          replyToMessageId: founderMessageId,
          modelId: selection.modelId,
        })
        .returning();
    });

    return message ? { message } : { message: null, skipReason: "unavailable" };
  } finally {
    await db
      .update(agentsTable)
      .set({
        status: "idle",
        currentTaskId: null,
        currentAction: null,
        lastActiveAt: new Date(),
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(agentsTable.id, agent.id),
          eq(agentsTable.runLeaseOwner, leaseOwner),
        ),
      );
  }
}
