import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, count, desc, eq, lt } from "drizzle-orm";
import {
  agentsTable,
  companyChannelMembersTable,
  companyChannelsTable,
  companyMessagesTable,
  companyMessageRequestsTable,
  db,
  type Agent,
  type CompanyMessage,
} from "@workspace/db";
import {
  AddCompanyChannelMemberBody,
  AddCompanyChannelMemberResponse,
  GetCompanyChannelResponse,
  ListCompanyChannelMembersResponse,
  ListCompanyMessagesResponse,
  SendCompanyMessageBody,
  SendCompanyMessageResponse,
} from "@workspace/api-zod";
import {
  parseCursorPage,
  parsePositiveInteger,
  setNextCursor,
} from "../lib/http-params";
import { createRateLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { readWorkspaceLocale } from "../lib/workspace-locale";
import {
  assertCompanyMessageCapacity,
  RuntimeCapacityError,
} from "../lib/orchestrator/runtime-capacity";
import {
  EmergencyStopError,
  lockRuntimeControlState,
} from "../lib/orchestrator/runtime-emergency-stop";
import {
  mapWithConcurrency,
  planCompanyChatRouting,
} from "../lib/orchestrator/company-chat-routing";
import {
  runCompanyMeetingTurn,
  type CompanyMeetingSkipReason,
} from "../lib/orchestrator/run-company-meeting";

export function createCompanyChatRouter(
  dependencies: { runTurn?: typeof runCompanyMeetingTurn } = {},
): IRouter {
  const router: IRouter = Router();
  class SendConflict extends Error {}
  const companyMessageLimiter = createRateLimiter({
    namespace: "company-chat-message",
    max: 12,
    windowMs: 60_000,
  });
  const companyMembershipLimiter = createRateLimiter({
    namespace: "company-chat-membership",
    max: 60,
    windowMs: 60_000,
  });

  type CompanyMessageView = {
    id: number;
    channelId: number;
    senderType: string;
    senderAgentId: number | null;
    senderName: string | null;
    senderRole: string | null;
    senderAvatarColor: string | null;
    content: string;
    source: string;
    taskId: number | null;
    replyToMessageId: number | null;
    modelId: string | null;
    createdAt: Date;
  };

  type CompanyChannelMemberView = {
    channelId: number;
    agentId: number;
    name: string;
    role: string;
    department: string | null;
    status: string;
    avatarColor: string;
    isActive: boolean;
    joinedAt: Date;
  };

  async function canonicalChannel() {
    await db
      .insert(companyChannelsTable)
      .values({ key: "company", name: "Ortak Şirket Chat" })
      .onConflictDoNothing({ target: companyChannelsTable.key });
    const [channel] = await db
      .select()
      .from(companyChannelsTable)
      .where(eq(companyChannelsTable.key, "company"));
    if (!channel) throw new Error("Canonical company channel is unavailable");
    return channel;
  }

  function messageView(
    message: CompanyMessage,
    agent?: Pick<Agent, "name" | "role" | "avatarColor"> | null,
  ): CompanyMessageView {
    return {
      ...message,
      senderName: agent?.name ?? null,
      senderRole: agent?.role ?? null,
      senderAvatarColor: agent?.avatarColor ?? null,
    };
  }

  async function listMemberViews(
    channelId: number,
  ): Promise<CompanyChannelMemberView[]> {
    return db
      .select({
        channelId: companyChannelMembersTable.channelId,
        agentId: companyChannelMembersTable.agentId,
        name: agentsTable.name,
        role: agentsTable.role,
        department: agentsTable.department,
        status: agentsTable.status,
        avatarColor: agentsTable.avatarColor,
        isActive: agentsTable.isActive,
        joinedAt: companyChannelMembersTable.joinedAt,
      })
      .from(companyChannelMembersTable)
      .innerJoin(
        agentsTable,
        eq(companyChannelMembersTable.agentId, agentsTable.id),
      )
      .where(eq(companyChannelMembersTable.channelId, channelId))
      .orderBy(companyChannelMembersTable.joinedAt, agentsTable.id);
  }

  async function listActiveMemberAgents(channelId: number): Promise<Agent[]> {
    const rows = await db
      .select({ agent: agentsTable })
      .from(companyChannelMembersTable)
      .innerJoin(
        agentsTable,
        and(
          eq(companyChannelMembersTable.agentId, agentsTable.id),
          eq(agentsTable.isActive, true),
        ),
      )
      .where(eq(companyChannelMembersTable.channelId, channelId))
      .orderBy(companyChannelMembersTable.joinedAt, agentsTable.id);
    return rows.map((row) => row.agent);
  }

  function sameIds(left: number[], right: number[]): boolean {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }

  function textualMentionIds(content: string, agents: Agent[]): number[] {
    return agents
      .filter((agent) => {
        const escapedName = agent.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        return new RegExp(
          `(^|[\\s([{])@${escapedName}(?=$|[\\s,.:;!?\\])}])`,
          "iu",
        ).test(content);
      })
      .map((agent) => agent.id);
  }

  router.get("/company-chat", async (_req, res): Promise<void> => {
    const channel = await canonicalChannel();
    const [active] = await db
      .select({ value: count() })
      .from(companyChannelMembersTable)
      .innerJoin(
        agentsTable,
        and(
          eq(companyChannelMembersTable.agentId, agentsTable.id),
          eq(agentsTable.isActive, true),
        ),
      )
      .where(eq(companyChannelMembersTable.channelId, channel.id));
    res.json(
      GetCompanyChannelResponse.parse({
        ...channel,
        activeAgentCount: active?.value ?? 0,
      }),
    );
  });

  router.get("/company-chat/members", async (_req, res): Promise<void> => {
    const channel = await canonicalChannel();
    res.json(
      ListCompanyChannelMembersResponse.parse(
        await listMemberViews(channel.id),
      ),
    );
  });

  router.post(
    "/company-chat/members",
    companyMembershipLimiter,
    async (req, res): Promise<void> => {
      const parsed = AddCompanyChannelMemberBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.message,
          code: "COMPANY_REQUEST_INVALID",
        });
        return;
      }
      const channel = await canonicalChannel();
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, parsed.data.agentId));
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      if (!agent.isActive) {
        res
          .status(409)
          .json({ error: "Only active agents can join the company room." });
        return;
      }

      const inserted = await db
        .insert(companyChannelMembersTable)
        .values({ channelId: channel.id, agentId: agent.id })
        .onConflictDoNothing({
          target: [
            companyChannelMembersTable.channelId,
            companyChannelMembersTable.agentId,
          ],
        })
        .returning({ joinedAt: companyChannelMembersTable.joinedAt });
      const [membership] = await db
        .select({ joinedAt: companyChannelMembersTable.joinedAt })
        .from(companyChannelMembersTable)
        .where(
          and(
            eq(companyChannelMembersTable.channelId, channel.id),
            eq(companyChannelMembersTable.agentId, agent.id),
          ),
        );
      if (!membership) {
        throw new Error("Company room membership was not persisted");
      }

      res.status(inserted.length > 0 ? 201 : 200).json(
        AddCompanyChannelMemberResponse.parse({
          channelId: channel.id,
          agentId: agent.id,
          name: agent.name,
          role: agent.role,
          department: agent.department,
          status: agent.status,
          avatarColor: agent.avatarColor,
          isActive: agent.isActive,
          joinedAt: membership.joinedAt,
        }),
      );
    },
  );

  router.delete(
    "/company-chat/members/:agentId",
    companyMembershipLimiter,
    async (req, res): Promise<void> => {
      const parsedAgentId = parsePositiveInteger(req.params.agentId, "agentId");
      if (!parsedAgentId.ok) {
        res.status(400).json({ error: parsedAgentId.error });
        return;
      }
      const channel = await canonicalChannel();
      await db
        .delete(companyChannelMembersTable)
        .where(
          and(
            eq(companyChannelMembersTable.channelId, channel.id),
            eq(companyChannelMembersTable.agentId, parsedAgentId.value),
          ),
        );
      res.status(204).end();
    },
  );

  router.get("/company-chat/messages", async (req, res): Promise<void> => {
    const page = parseCursorPage(req.query);
    if (!page.ok) {
      res.status(400).json({ error: page.error });
      return;
    }
    const channel = await canonicalChannel();
    const conditions = [eq(companyMessagesTable.channelId, channel.id)];
    if (page.value.beforeId !== undefined) {
      conditions.push(lt(companyMessagesTable.id, page.value.beforeId));
    }

    const rows = await db
      .select({
        id: companyMessagesTable.id,
        channelId: companyMessagesTable.channelId,
        senderType: companyMessagesTable.senderType,
        senderAgentId: companyMessagesTable.senderAgentId,
        senderName: agentsTable.name,
        senderRole: agentsTable.role,
        senderAvatarColor: agentsTable.avatarColor,
        content: companyMessagesTable.content,
        source: companyMessagesTable.source,
        taskId: companyMessagesTable.taskId,
        replyToMessageId: companyMessagesTable.replyToMessageId,
        modelId: companyMessagesTable.modelId,
        createdAt: companyMessagesTable.createdAt,
      })
      .from(companyMessagesTable)
      .leftJoin(
        agentsTable,
        eq(companyMessagesTable.senderAgentId, agentsTable.id),
      )
      .where(and(...conditions))
      .orderBy(desc(companyMessagesTable.id))
      .limit(page.value.limit + 1);
    const hasMore = rows.length > page.value.limit;
    const messages = rows.slice(0, page.value.limit).reverse();
    setNextCursor(res, messages, hasMore);
    res.json(ListCompanyMessagesResponse.parse(messages));
  });

  router.post(
    "/company-chat/messages",
    companyMessageLimiter,
    async (req, res): Promise<void> => {
      const parsed = SendCompanyMessageBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.message,
          code: "COMPANY_REQUEST_INVALID",
        });
        return;
      }
      const content = parsed.data.content.trim();
      if (!content) {
        res.status(400).json({
          error: "Message content cannot be blank.",
          code: "COMPANY_REQUEST_INVALID",
        });
        return;
      }

      const mentionedIds = parsed.data.mentionedAgentIds;
      const legacyParticipantIds = parsed.data.participantAgentIds;
      if (
        mentionedIds !== undefined &&
        legacyParticipantIds !== undefined &&
        !sameIds(mentionedIds, legacyParticipantIds)
      ) {
        res.status(400).json({
          error:
            "mentionedAgentIds and participantAgentIds must match when both are supplied.",
          code: "COMPANY_REQUEST_INVALID",
        });
        return;
      }
      const requestedMentionIds = mentionedIds ?? legacyParticipantIds ?? [];
      if (new Set(requestedMentionIds).size !== requestedMentionIds.length) {
        res.status(400).json({
          error: "Mentioned agent ids must be unique.",
          code: "COMPANY_REQUEST_INVALID",
        });
        return;
      }

      const requestId = parsed.data.requestId;
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            content,
            mentionedAgentIds: requestedMentionIds,
            locale: parsed.data.locale ?? null,
          }),
        )
        .digest("hex");
      if (requestId) {
        const [stored] = await db
          .select()
          .from(companyMessageRequestsTable)
          .where(eq(companyMessageRequestsTable.requestId, requestId));
        if (stored) {
          if (stored.requestHash !== requestHash) {
            res.status(409).json({
              error: "This send identity belongs to a different message.",
              code: "COMPANY_REQUEST_CONFLICT",
            });
            return;
          }
          res.status(200).json(
            SendCompanyMessageResponse.parse({
              ...stored.response,
              replayed: true,
            }),
          );
          return;
        }
      }
      const locale = parsed.data.locale ?? (await readWorkspaceLocale());
      const channel = await canonicalChannel();
      const activeMembers = await listActiveMemberAgents(channel.id);
      const activeMemberIds = new Set(activeMembers.map((agent) => agent.id));
      if (requestedMentionIds.some((id) => !activeMemberIds.has(id))) {
        res.status(400).json({
          error:
            "Every mentioned participant must be an active company-room member.",
          code: "COMPANY_MEMBER_CHANGED",
        });
        return;
      }
      const resolvedMentionIds =
        requestedMentionIds.length > 0
          ? requestedMentionIds
          : textualMentionIds(content, activeMembers);
      const plan = planCompanyChatRouting({
        content,
        agents: activeMembers,
        mentionedAgentIds: resolvedMentionIds,
      });
      const agentsById = new Map(
        activeMembers.map((agent) => [agent.id, agent]),
      );
      const candidateAgents = plan.candidateAgentIds.map((id) =>
        agentsById.get(id)!,
      );

      const routing = {
        mode: plan.mode,
        mentionedAgentIds: resolvedMentionIds,
        evaluatedMemberCount: plan.decisions.length,
        attemptedAgentCount: candidateAgents.length,
        responseCount: 0,
        maxResponseAttempts: plan.maxResponseAttempts,
        concurrency: plan.concurrency,
        maxTokensPerResponse: plan.maxTokensPerResponse,
        tokenBudget: plan.tokenBudget,
        decisions: plan.decisions,
      };
      let founderMessage: CompanyMessage;
      try {
        const accepted = await db.transaction(async (tx) => {
          const control = await lockRuntimeControlState(tx);
          if (requestId) {
            const [stored] = await tx
              .select()
              .from(companyMessageRequestsTable)
              .where(eq(companyMessageRequestsTable.requestId, requestId));
            if (stored) {
              if (stored.requestHash !== requestHash) throw new SendConflict();
              return { receipt: stored.response };
            }
          }
          if (control.emergencyStopEnabled)
            throw new EmergencyStopError(control);
          await assertCompanyMessageCapacity(tx);
          const [persistedMessage] = await tx
            .insert(companyMessagesTable)
            .values({
              channelId: channel.id,
              senderType: "founder",
              senderAgentId: null,
              content,
              source: "operator",
            })
            .returning();
          if (requestId)
            await tx.insert(companyMessageRequestsTable).values({
              requestId,
              requestHash,
              response: SendCompanyMessageResponse.parse({
                founderMessage: messageView(persistedMessage),
                agentMessages: [],
                skippedParticipants: [],
                routing: { ...routing, attemptedAgentCount: 0 },
                deliveryState: "unconfirmed",
                replayed: false,
              }),
            });
          return { founderMessage: persistedMessage };
        });
        if (accepted.receipt) {
          res.status(200).json(
            SendCompanyMessageResponse.parse({
              ...accepted.receipt,
              replayed: true,
            }),
          );
          return;
        }
        founderMessage = accepted.founderMessage!;
      } catch (error) {
        if (error instanceof SendConflict) {
          res.status(409).json({
            error: "This send identity belongs to a different message.",
            code: "COMPANY_REQUEST_CONFLICT",
          });
          return;
        }
        if (error instanceof EmergencyStopError) {
          res.status(423).json({
            error:
              "Acil durdurma etkin; yeni ortak kanal mesajı veya oda turu başlatılamaz.",
            code: error.code,
          });
          return;
        }
        if (error instanceof RuntimeCapacityError) {
          res.status(409).json({
            error: "Company message capacity is full.",
            code: error.code,
            limit: error.limit,
          });
          return;
        }
        throw error;
      }

      let emergencyStopped = false;
      const turnResults = await mapWithConcurrency(
        candidateAgents,
        plan.concurrency,
        async (agent) => {
          if (emergencyStopped) {
            return {
              agent,
              message: null,
              skipReason: "unavailable" as CompanyMeetingSkipReason,
            };
          }
          try {
            const result = await (
              dependencies.runTurn ?? runCompanyMeetingTurn
            )({
              agent,
              channelId: channel.id,
              founderMessageId: founderMessage.id,
              founderContent: content,
              locale,
              responseMode: plan.mode === "mentions" ? "required" : "relevance",
              maxTokens: plan.maxTokensPerResponse,
            });
            return { agent, ...result };
          } catch (error) {
            logger.warn(
              { error, agentId: agent.id, founderMessageId: founderMessage.id },
              "Company room participant was skipped",
            );
            if (error instanceof EmergencyStopError) emergencyStopped = true;
            return {
              agent,
              message: null,
              skipReason: "unavailable" as CompanyMeetingSkipReason,
            };
          }
        },
      );

      const agentMessages: CompanyMessageView[] = [];
      const skippedParticipants: Array<{
        agentId: number;
        reason: CompanyMeetingSkipReason;
      }> = plan.decisions
        .filter((decision) => decision.reason === "budget_guard")
        .map((decision) => ({
          agentId: decision.agentId,
          reason: "budget_guard" as const,
        }));
      for (const result of turnResults) {
        if (result.message) {
          agentMessages.push(messageView(result.message, result.agent));
        } else {
          skippedParticipants.push({
            agentId: result.agent.id,
            reason: result.skipReason ?? "unavailable",
          });
        }
      }

      const response = SendCompanyMessageResponse.parse({
        deliveryState: "complete",
        replayed: false,
        founderMessage: messageView(founderMessage),
        agentMessages,
        skippedParticipants,
        routing: { ...routing, responseCount: agentMessages.length },
      });
      if (requestId)
        await db
          .update(companyMessageRequestsTable)
          .set({ response })
          .where(
            and(
              eq(companyMessageRequestsTable.requestId, requestId),
              eq(companyMessageRequestsTable.requestHash, requestHash),
            ),
          );
      res.status(201).json(response);
    },
  );

  return router;
}
export default createCompanyChatRouter();
