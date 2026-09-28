import { createMeetingCommandsRouter } from "./project-meeting-commands";
import { createHash, randomUUID } from "node:crypto";
import {
  lockLiveMeetingTurn,
  readMeetingTurnReceipt,
  OPEN_MEETING_STATES,
  type MeetingTurnFence,
} from "../lib/project-meeting-turns";
import { resolveCompanyMeetingLeaseMs } from "../lib/orchestrator/run-company-meeting";
import { Router, type IRouter, type Response } from "express";
import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  agentsTable,
  db,
  projectMeetingActionItemsTable,
  projectMeetingDecisionsTable,
  projectMeetingParticipantsTable,
  projectMeetingsTable,
  projectMeetingTurnRequestsTable,
  projectMeetingTranscriptTable,
  tasksTable,
  type Agent,
  type ProjectMeeting,
  type Task,
} from "@workspace/db";
import {
  parseCursorPage,
  parsePositiveInteger,
  setNextCursor,
} from "../lib/http-params";
import { readIntegerEnvironment } from "../lib/runtime-security";
import {
  runProjectMeetingTurn,
  type ProjectMeetingTurnSkipReason,
} from "../lib/orchestrator/run-project-meeting";
import {
  EmergencyStopError,
  lockRuntimeControlState,
  lockAndAssertExecutionAllowed,
  type RuntimeTransaction,
} from "../lib/orchestrator/runtime-emergency-stop";

export function createProjectMeetingsRouter(): IRouter {
  const router: IRouter = Router();
  router.use(createMeetingCommandsRouter());
  const MAX_RESPONDERS_PER_START = readIntegerEnvironment(
    "PROJECT_MEETING_MAX_RESPONDERS_PER_START",
    8,
    1,
    32,
  );
  const MAX_CONCURRENT_MEETING_STARTS = readIntegerEnvironment(
    "PROJECT_MEETING_MAX_CONCURRENT_STARTS",
    2,
    1,
    16,
  );

  const startMeetingBody = z
    .object({
      requestId: z.string().uuid(),
      prompt: z.string().trim().min(1).max(12_000).optional(),
      participantAgentIds: z.array(z.number().int().positive()).optional(),
      maxTokensPerResponse: z.number().int().min(100).max(600).optional(),
    })
    .strict();
  class MeetingInputError extends Error {}
  class MeetingTurnError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  function parseProjectAndMeetingIds(
    projectIdValue: unknown,
    meetingIdValue?: unknown,
  ):
    | { ok: true; projectId: number; meetingId?: number }
    | { ok: false; error: string } {
    const projectId = parsePositiveInteger(projectIdValue, "projectId");
    if (!projectId.ok) return projectId;
    if (meetingIdValue === undefined) {
      return { ok: true, projectId: projectId.value };
    }
    const meetingId = parsePositiveInteger(meetingIdValue, "meetingId");
    if (!meetingId.ok) return meetingId;
    return {
      ok: true,
      projectId: projectId.value,
      meetingId: meetingId.value,
    };
  }

  function invalidBody(res: Response, error: z.ZodError): void {
    res.status(400).json({ error: error.message });
  }

  async function requireRootProject(
    projectId: number,
    res: Response,
  ): Promise<Task | null> {
    const [project] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, projectId));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return null;
    }
    if (project.parentTaskId !== null) {
      res.status(409).json({
        error: "Meetings can only belong to a root project",
        rootProjectRequired: true,
      });
      return null;
    }
    return project;
  }

  async function scopedMeeting(
    projectId: number,
    meetingId: number,
  ): Promise<ProjectMeeting | undefined> {
    const [meeting] = await db
      .select()
      .from(projectMeetingsTable)
      .where(
        and(
          eq(projectMeetingsTable.id, meetingId),
          eq(projectMeetingsTable.taskId, projectId),
        ),
      );
    return meeting;
  }

  async function meetingParticipantAgents(
    meetingId: number,
    requestedIds?: number[],
    connection: Pick<RuntimeTransaction, "select"> = db,
  ): Promise<Agent[]> {
    if (
      requestedIds !== undefined &&
      new Set(requestedIds).size !== requestedIds.length
    ) {
      throw new MeetingInputError("participantAgentIds must be unique");
    }
    const rows = await connection
      .select({ agent: agentsTable })
      .from(projectMeetingParticipantsTable)
      .innerJoin(
        agentsTable,
        eq(projectMeetingParticipantsTable.agentId, agentsTable.id),
      )
      .where(eq(projectMeetingParticipantsTable.meetingId, meetingId))
      .orderBy(asc(projectMeetingParticipantsTable.addedAt));
    if (requestedIds === undefined) return rows.map((row) => row.agent);
    const byId = new Map(rows.map((row) => [row.agent.id, row.agent]));
    const selected = requestedIds.map((id) => byId.get(id));
    if (selected.some((agent) => agent === undefined)) {
      throw new MeetingInputError(
        "Every participantAgentId must belong to this meeting",
      );
    }
    return selected as Agent[];
  }

  async function meetingDetail(
    meeting: ProjectMeeting,
    connection: Pick<RuntimeTransaction, "select"> = db,
  ) {
    const [participants, transcript, decisions, actionItems] =
      await Promise.all([
        connection
          .select({
            meetingId: projectMeetingParticipantsTable.meetingId,
            agentId: projectMeetingParticipantsTable.agentId,
            addedAt: projectMeetingParticipantsTable.addedAt,
            name: agentsTable.name,
            role: agentsTable.role,
            avatarColor: agentsTable.avatarColor,
            isActive: agentsTable.isActive,
          })
          .from(projectMeetingParticipantsTable)
          .innerJoin(
            agentsTable,
            eq(projectMeetingParticipantsTable.agentId, agentsTable.id),
          )
          .where(eq(projectMeetingParticipantsTable.meetingId, meeting.id))
          .orderBy(asc(projectMeetingParticipantsTable.addedAt)),
        connection
          .select({
            id: projectMeetingTranscriptTable.id,
            meetingId: projectMeetingTranscriptTable.meetingId,
            speakerType: projectMeetingTranscriptTable.speakerType,
            speakerAgentId: projectMeetingTranscriptTable.speakerAgentId,
            content: projectMeetingTranscriptTable.content,
            replyToTranscriptId:
              projectMeetingTranscriptTable.replyToTranscriptId,
            occurredAt: projectMeetingTranscriptTable.occurredAt,
            createdAt: projectMeetingTranscriptTable.createdAt,
            speakerName: agentsTable.name,
            speakerRole: agentsTable.role,
            speakerAvatarColor: agentsTable.avatarColor,
          })
          .from(projectMeetingTranscriptTable)
          .leftJoin(
            agentsTable,
            eq(projectMeetingTranscriptTable.speakerAgentId, agentsTable.id),
          )
          .where(eq(projectMeetingTranscriptTable.meetingId, meeting.id))
          .orderBy(
            asc(projectMeetingTranscriptTable.occurredAt),
            asc(projectMeetingTranscriptTable.id),
          ),
        connection
          .select({
            id: projectMeetingDecisionsTable.id,
            meetingId: projectMeetingDecisionsTable.meetingId,
            content: projectMeetingDecisionsTable.content,
            rationale: projectMeetingDecisionsTable.rationale,
            ownerAgentId: projectMeetingDecisionsTable.ownerAgentId,
            createdAt: projectMeetingDecisionsTable.createdAt,
            ownerName: agentsTable.name,
            ownerRole: agentsTable.role,
          })
          .from(projectMeetingDecisionsTable)
          .leftJoin(
            agentsTable,
            eq(projectMeetingDecisionsTable.ownerAgentId, agentsTable.id),
          )
          .where(eq(projectMeetingDecisionsTable.meetingId, meeting.id))
          .orderBy(
            asc(projectMeetingDecisionsTable.createdAt),
            asc(projectMeetingDecisionsTable.id),
          ),
        connection
          .select({
            id: projectMeetingActionItemsTable.id,
            meetingId: projectMeetingActionItemsTable.meetingId,
            title: projectMeetingActionItemsTable.title,
            details: projectMeetingActionItemsTable.details,
            ownerAgentId: projectMeetingActionItemsTable.ownerAgentId,
            status: projectMeetingActionItemsTable.status,
            dueAt: projectMeetingActionItemsTable.dueAt,
            completedAt: projectMeetingActionItemsTable.completedAt,
            createdAt: projectMeetingActionItemsTable.createdAt,
            updatedAt: projectMeetingActionItemsTable.updatedAt,
            ownerName: agentsTable.name,
            ownerRole: agentsTable.role,
          })
          .from(projectMeetingActionItemsTable)
          .leftJoin(
            agentsTable,
            eq(projectMeetingActionItemsTable.ownerAgentId, agentsTable.id),
          )
          .where(eq(projectMeetingActionItemsTable.meetingId, meeting.id))
          .orderBy(asc(projectMeetingActionItemsTable.id)),
      ]);
    return { meeting, participants, transcript, decisions, actionItems };
  }

  router.get(
    "/projects/:projectId/meetings",
    async (req, res): Promise<void> => {
      const ids = parseProjectAndMeetingIds(req.params.projectId);
      const page = parseCursorPage(req.query);
      if (!ids.ok) {
        res.status(400).json({ error: ids.error });
        return;
      }
      if (!page.ok) {
        res.status(400).json({ error: page.error });
        return;
      }
      if (!(await requireRootProject(ids.projectId, res))) return;

      const conditions = [eq(projectMeetingsTable.taskId, ids.projectId)];
      if (page.value.beforeId !== undefined) {
        conditions.push(lt(projectMeetingsTable.id, page.value.beforeId));
      }
      const rows = await db
        .select()
        .from(projectMeetingsTable)
        .where(and(...conditions))
        .orderBy(desc(projectMeetingsTable.id))
        .limit(page.value.limit + 1);
      const hasMore = rows.length > page.value.limit;
      const meetings = rows.slice(0, page.value.limit);
      const participantCounts = new Map<number, number>();
      if (meetings.length > 0) {
        const counts = await db
          .select({
            meetingId: projectMeetingParticipantsTable.meetingId,
            value: count(),
          })
          .from(projectMeetingParticipantsTable)
          .where(
            inArray(
              projectMeetingParticipantsTable.meetingId,
              meetings.map((meeting) => meeting.id),
            ),
          )
          .groupBy(projectMeetingParticipantsTable.meetingId);
        for (const row of counts)
          participantCounts.set(row.meetingId, row.value);
      }
      setNextCursor(res, meetings, hasMore);
      res.json(
        meetings.map((meeting) => ({
          meeting,
          participantCount: participantCounts.get(meeting.id) ?? 0,
        })),
      );
    },
  );

  router.get(
    "/projects/:projectId/meetings/:meetingId",
    async (req, res): Promise<void> => {
      const ids = parseProjectAndMeetingIds(
        req.params.projectId,
        req.params.meetingId,
      );
      if (!ids.ok) {
        res.status(400).json({ error: ids.error });
        return;
      }
      if (!(await requireRootProject(ids.projectId, res))) return;
      const meeting = await scopedMeeting(ids.projectId, ids.meetingId!);
      if (!meeting) {
        res.status(404).json({ error: "Meeting not found in this project" });
        return;
      }
      res.json(await meetingDetail(meeting));
    },
  );

  router.get(
    "/projects/:projectId/meetings/:meetingId/turn-requests/:requestId",
    async (req, res): Promise<void> => {
      const ids = parseProjectAndMeetingIds(
        req.params.projectId,
        req.params.meetingId,
      );
      const identity = z.string().uuid().safeParse(req.params.requestId);
      if (!ids.ok || !identity.success) {
        res.status(400).json({
          code: "MEETING_REQUEST_INVALID",
          error: "Invalid request identity",
        });
        return;
      }
      const receipt = await readMeetingTurnReceipt(
        ids.projectId,
        ids.meetingId!,
        identity.data,
      );
      if (!receipt) {
        res.status(404).json({
          code: "MEETING_REQUEST_NOT_FOUND",
          error: "Receipt not found",
        });
        return;
      }
      res.json(receipt);
    },
  );

  router.post(
    "/projects/:projectId/meetings/:meetingId/start",
    async (req, res): Promise<void> => {
      const ids = parseProjectAndMeetingIds(
        req.params.projectId,
        req.params.meetingId,
      );
      const parsed = startMeetingBody.safeParse(req.body ?? {});
      if (!ids.ok) {
        res.status(400).json({ error: ids.error });
        return;
      }
      if (!parsed.success) {
        invalidBody(res, parsed.error);
        return;
      }
      const input = parsed.data,
        projectId = ids.projectId,
        meetingId = ids.meetingId!;
      const hash = createHash("sha256")
        .update(
          JSON.stringify([
            "project-meeting-turn-v1",
            projectId,
            meetingId,
            input.prompt ?? null,
            input.participantAgentIds ?? null,
            input.maxTokensPerResponse ?? 600,
          ]),
        )
        .digest("hex");
      const fence: MeetingTurnFence = {
        requestId: input.requestId,
        leaseOwner: randomUUID(),
        projectId,
        meetingId,
      };
      const sendStored = async () => {
        const receipt = await readMeetingTurnReceipt(
          projectId,
          meetingId,
          input.requestId,
        );
        if (!receipt) throw new Error("Accepted meeting receipt is missing");
        if (receipt.state === "complete") {
          res.status(receipt.httpStatus!).json(receipt.response);
          return;
        }
        res.status(receipt.state === "running" ? 202 : 409).json({
          requestId: input.requestId,
          code:
            receipt.state === "running"
              ? "MEETING_REQUEST_RUNNING"
              : "MEETING_REQUEST_UNCONFIRMED",
          error:
            receipt.state === "running"
              ? "The accepted turn is still running"
              : "The accepted turn outcome is unconfirmed; it will not be replayed",
        });
      };
      try {
        // This lock is shared by every API replica. Replays are observed before any
        // root/meeting lookup so deletion cannot make an accepted identity reusable.
        const claim = await db.transaction(async (tx) => {
          const control = await lockRuntimeControlState(tx);
          const [stored] = await tx
            .select()
            .from(projectMeetingTurnRequestsTable)
            .where(
              eq(projectMeetingTurnRequestsTable.requestId, input.requestId),
            );
          if (stored) {
            if (
              stored.projectId !== projectId ||
              stored.meetingId !== meetingId ||
              stored.requestHash !== hash
            )
              throw new MeetingTurnError(
                409,
                "MEETING_REQUEST_CONFLICT",
                "Request identity belongs to different input",
              );
            return null;
          }
          if (control.emergencyStopEnabled)
            throw new EmergencyStopError(control);
          // Retiring an expired reservation never dispatches its model call again.
          await tx
            .update(projectMeetingTurnRequestsTable)
            .set({ state: "unconfirmed", updatedAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(projectMeetingTurnRequestsTable.state, "running"),
                sql`${projectMeetingTurnRequestsTable.leaseExpiresAt} <= clock_timestamp()`,
              ),
            );
          const active = await tx
            .select({ meetingId: projectMeetingTurnRequestsTable.meetingId })
            .from(projectMeetingTurnRequestsTable)
            .where(eq(projectMeetingTurnRequestsTable.state, "running"));
          if (active.some((r) => r.meetingId === meetingId))
            throw new MeetingTurnError(
              409,
              "MEETING_TURN_IN_PROGRESS",
              "A meeting turn is already in progress for this meeting",
            );
          if (active.length >= MAX_CONCURRENT_MEETING_STARTS)
            throw new MeetingTurnError(
              429,
              "PROJECT_MEETING_CONCURRENCY_LIMIT",
              "Concurrent project-meeting execution capacity is full",
            );
          const [project] = await tx
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.id, projectId));
          if (!project)
            throw new MeetingTurnError(
              404,
              "PROJECT_NOT_FOUND",
              "Project not found",
            );
          if (project.parentTaskId !== null)
            throw new MeetingTurnError(
              409,
              "ROOT_PROJECT_REQUIRED",
              "Meetings can only belong to a root project",
            );
          const [meeting] = await tx
            .select()
            .from(projectMeetingsTable)
            .where(
              and(
                eq(projectMeetingsTable.id, meetingId),
                eq(projectMeetingsTable.taskId, projectId),
              ),
            )
            .for("update");
          if (!meeting)
            throw new MeetingTurnError(
              404,
              "MEETING_NOT_FOUND",
              "Meeting not found in this project",
            );
          if (!OPEN_MEETING_STATES.includes(meeting.status))
            throw new MeetingTurnError(
              409,
              "MEETING_CLOSED",
              "A closed meeting cannot be started",
            );
          const participants = await meetingParticipantAgents(
            meetingId,
            input.participantAgentIds,
            tx,
          );
          const leaseMs =
            (MAX_RESPONDERS_PER_START + 1) * resolveCompanyMeetingLeaseMs();
          await tx.insert(projectMeetingTurnRequestsTable).values({
            ...fence,
            requestHash: hash,
            state: "running",
            leaseExpiresAt: sql`clock_timestamp() + (${leaseMs} * interval '1 millisecond')`,
          });
          let currentFounderTranscriptId: number | undefined;
          if (input.prompt) {
            const [entry] = await tx
              .insert(projectMeetingTranscriptTable)
              .values({
                meetingId,
                speakerType: "founder",
                speakerAgentId: null,
                content: input.prompt,
                occurredAt: sql`clock_timestamp()`,
              })
              .returning({ id: projectMeetingTranscriptTable.id });
            currentFounderTranscriptId = entry.id;
          }
          return { project, meeting, participants, currentFounderTranscriptId };
        });
        if (!claim) {
          await sendStored();
          return;
        }
        const { project, meeting, participants, currentFounderTranscriptId } =
          claim;
        const attempted = participants.slice(0, MAX_RESPONDERS_PER_START);
        const skippedParticipants: Array<{
          agentId: number;
          reason: ProjectMeetingTurnSkipReason | "budget_guard";
        }> = participants
          .slice(MAX_RESPONDERS_PER_START)
          .map((agent) => ({ agentId: agent.id, reason: "budget_guard" }));
        const agentTranscriptIds: number[] = [];
        try {
          for (const agent of attempted) {
            if (!agent.isActive) {
              skippedParticipants.push({
                agentId: agent.id,
                reason: "unavailable",
              });
              continue;
            }
            const result = await runProjectMeetingTurn({
              agent,
              project,
              meeting,
              founderContent: input.prompt ?? meeting.agenda ?? meeting.title,
              currentFounderTranscriptId,
              maxTokens: input.maxTokensPerResponse,
              fence,
            });
            if (result.transcript)
              agentTranscriptIds.push(result.transcript.id);
            else
              skippedParticipants.push({
                agentId: agent.id,
                reason: result.skipReason ?? "unavailable",
              });
          }
          await db.transaction(async (tx) => {
            await lockAndAssertExecutionAllowed(tx);
            const live = await lockLiveMeetingTurn(tx, fence);
            if (!live) return;
            const canOpen =
              participants.length === 0 || agentTranscriptIds.length > 0;
            let current = live;
            if (canOpen && live.status !== "in_progress") {
              [current] = await tx
                .update(projectMeetingsTable)
                .set({
                  status: "in_progress",
                  startedAt: live.startedAt ?? sql`clock_timestamp()`,
                  updatedAt: sql`clock_timestamp()`,
                })
                .where(
                  and(
                    eq(projectMeetingsTable.id, meetingId),
                    inArray(projectMeetingsTable.status, OPEN_MEETING_STATES),
                  ),
                )
                .returning();
            }
            const detail = await meetingDetail(current, tx);
            const failed =
              participants.length > 0 && agentTranscriptIds.length === 0;
            const status = failed
              ? skippedParticipants.some(
                  (s) => s.reason === "provider_unavailable",
                )
                ? 503
                : 409
              : 200;
            const body = {
              ...detail,
              requestId: input.requestId,
              execution: {
                requestedParticipantCount: participants.length,
                attemptedParticipantCount: attempted.length,
                maxRespondersPerStart: MAX_RESPONDERS_PER_START,
                maxConcurrentMeetingStarts: MAX_CONCURRENT_MEETING_STARTS,
                maxTokensPerResponse: input.maxTokensPerResponse ?? 600,
              },
              agentTranscriptIds,
              skippedParticipants,
              ...(failed
                ? {
                    error:
                      "No participant response was recorded. Meeting input was preserved.",
                  }
                : {}),
            };
            await tx
              .update(projectMeetingTurnRequestsTable)
              .set({
                state: "complete",
                httpStatus: status,
                response: JSON.parse(JSON.stringify(body)) as Record<
                  string,
                  unknown
                >,
                updatedAt: sql`clock_timestamp()`,
              })
              .where(
                and(
                  eq(
                    projectMeetingTurnRequestsTable.requestId,
                    input.requestId,
                  ),
                  eq(
                    projectMeetingTurnRequestsTable.leaseOwner,
                    fence.leaseOwner,
                  ),
                ),
              );
          });
        } finally {
          // A failed/closed/expired turn remains queryable and cannot be retried as
          // a new execution under the same ID, even after process restart.
          await db.transaction(async (tx) => {
            await lockRuntimeControlState(tx);
            await tx
              .update(projectMeetingTurnRequestsTable)
              .set({ state: "unconfirmed", updatedAt: sql`clock_timestamp()` })
              .where(
                and(
                  eq(
                    projectMeetingTurnRequestsTable.requestId,
                    input.requestId,
                  ),
                  eq(
                    projectMeetingTurnRequestsTable.leaseOwner,
                    fence.leaseOwner,
                  ),
                  eq(projectMeetingTurnRequestsTable.state, "running"),
                ),
              );
          });
        }
        await sendStored();
      } catch (error) {
        if (error instanceof MeetingTurnError) {
          res
            .status(error.status)
            .json({ code: error.code, error: error.message });
          return;
        }
        if (error instanceof MeetingInputError) {
          res.status(400).json({ error: error.message });
          return;
        }
        if (error instanceof EmergencyStopError) {
          res.status(423).json({
            error:
              "Emergency stop is active; any accepted meeting input remains recorded.",
            code: error.code,
            requestId: input.requestId,
          });
          return;
        }
        throw error;
      }
    },
  );

  return router;
}
export default createProjectMeetingsRouter();
