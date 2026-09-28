import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  agentsTable,
  tasksTable,
  projectMeetingsTable as meetings,
  projectMeetingParticipantsTable as participants,
  projectMeetingTranscriptTable as transcripts,
  projectMeetingDecisionsTable as decisions,
  projectMeetingActionItemsTable as actions,
  projectMeetingCommandsTable as commands,
  projectMeetingActionStatusValues,
  type MeetingCommandKind,
  type MeetingCommandResult,
} from "@workspace/db";
import {
  lockRuntimeControlState,
  type RuntimeTransaction,
} from "../lib/orchestrator/runtime-emergency-stop";

const id = z.number().int().min(1).max(2147483647);
const pathId = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number)
  .pipe(id);
const requestId = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const timestamp = z.iso
  .datetime({ offset: true })
  .max(64)
  .transform((value) => new Date(value).toISOString())
  .nullable()
  .optional();
const participantIds = z.array(id).default([]);
const decisionFields = {
  content: z.string().trim().min(1).max(12000),
  rationale: z.string().trim().max(12000).nullable().optional(),
  ownerAgentId: id.nullable().optional(),
};
const actionFields = {
  title: z.string().trim().min(1).max(500),
  details: z.string().trim().max(12000).nullable().optional(),
  ownerAgentId: id.nullable().optional(),
  dueAt: timestamp,
};
const hasChange = (body: Record<string, unknown>) =>
  Object.entries(body).some(
    ([key, value]) => key !== "requestId" && value !== undefined,
  );
const schemas = {
  create: z
    .object({
      requestId,
      title: z.string().trim().min(1).max(200),
      agenda: z.string().trim().max(12000).nullable().optional(),
      participantAgentIds: participantIds,
      scheduledFor: timestamp,
    })
    .strict(),
  update: z
    .object({
      requestId,
      title: z.string().trim().min(1).max(200).optional(),
      agenda: z.string().trim().max(12000).nullable().optional(),
      status: z.enum(["draft", "scheduled", "cancelled"]).optional(),
      summary: z.string().trim().max(30000).nullable().optional(),
      participantAgentIds: z.array(id).optional(),
      scheduledFor: timestamp,
    })
    .strict()
    .refine(hasChange, "At least one meeting field is required"),
  transcript: z
    .object({
      requestId,
      speakerType: z.literal("founder").default("founder"),
      content: z.string().trim().min(1).max(12000),
      replyToTranscriptId: id.nullable().optional(),
      occurredAt: timestamp,
    })
    .strict(),
  decision: z.object({ requestId, ...decisionFields }).strict(),
  action: z.object({ requestId, ...actionFields }).strict(),
  "action-update": z
    .object({
      requestId,
      title: actionFields.title.optional(),
      details: actionFields.details,
      ownerAgentId: actionFields.ownerAgentId,
      dueAt: timestamp,
      status: z.enum(projectMeetingActionStatusValues).optional(),
    })
    .strict()
    .refine(hasChange, "At least one action-item field is required"),
  complete: z
    .object({
      requestId,
      summary: z.string().trim().min(1).max(30000),
      decisions: z
        .array(z.object(decisionFields).strict())
        .max(200)
        .default([]),
      actionItems: z
        .array(z.object(actionFields).strict())
        .max(200)
        .default([]),
    })
    .strict(),
};
class CommandFault extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
type CommandInput = {
  [K in MeetingCommandKind]: { kind: K; body: z.infer<(typeof schemas)[K]> };
}[MeetingCommandKind];
type Scope = {
  projectId: number;
  meetingId: number | null;
  actionItemId: number | null;
};
const missing = (message: string): never => {
  throw new CommandFault(404, "MEETING_RECORD_NOT_FOUND", message);
};
const invalid = (message: string): never => {
  throw new CommandFault(400, "MEETING_COMMAND_INVALID", message);
};
const date = (value: string | null | undefined) =>
  value == null ? value : new Date(value);

async function validateParticipants(tx: RuntimeTransaction, ids: number[]) {
  if (new Set(ids).size !== ids.length)
    invalid("participantAgentIds must be unique");
  if (!ids.length) return;
  const rows = await tx
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(inArray(agentsTable.id, ids), eq(agentsTable.isActive, true)));
  if (rows.length !== ids.length)
    invalid("Every participantAgentId must identify an active agent");
}
async function validateOwner(
  tx: RuntimeTransaction,
  meetingId: number,
  ownerId: number | null | undefined,
) {
  if (ownerId == null) return;
  const [row] = await tx
    .select({ id: participants.agentId })
    .from(participants)
    .where(
      and(
        eq(participants.meetingId, meetingId),
        eq(participants.agentId, ownerId),
      ),
    );
  if (!row) invalid("The selected agent must be a participant in this meeting");
}
async function replaceParticipants(
  tx: RuntimeTransaction,
  meetingId: number,
  ids: number[],
) {
  await tx.delete(participants).where(eq(participants.meetingId, meetingId));
  if (ids.length)
    await tx
      .insert(participants)
      .values(ids.map((agentId) => ({ meetingId, agentId })));
}
async function mutate(
  tx: RuntimeTransaction,
  scope: Scope,
  command: CommandInput,
): Promise<{ meetingId: number; entityId: number }> {
  const [project] = await tx
    .select({ parentTaskId: tasksTable.parentTaskId })
    .from(tasksTable)
    .where(eq(tasksTable.id, scope.projectId));
  if (!project) missing("Project not found");
  if (project.parentTaskId !== null)
    throw new CommandFault(
      409,
      "ROOT_PROJECT_REQUIRED",
      "Meetings can only belong to a root project",
    );
  if (command.kind === "create") {
    const body = command.body;
    await validateParticipants(tx, body.participantAgentIds);
    const [meeting] = await tx
      .insert(meetings)
      .values({
        taskId: scope.projectId,
        title: body.title,
        agenda: body.agenda || null,
        scheduledFor: date(body.scheduledFor) ?? null,
        status: body.scheduledFor ? "scheduled" : "draft",
      })
      .returning({ id: meetings.id });
    await replaceParticipants(tx, meeting.id, body.participantAgentIds);
    return { meetingId: meeting.id, entityId: meeting.id };
  }
  const meetingId = scope.meetingId!;
  const [meeting] = await tx
    .select()
    .from(meetings)
    .where(
      and(eq(meetings.id, meetingId), eq(meetings.taskId, scope.projectId)),
    )
    .for("update");
  if (!meeting) missing("Meeting not found in this project");
  switch (command.kind) {
    case "update": {
      const body = command.body;
      if (
        body.status &&
        !(
          {
            draft: ["draft", "scheduled", "cancelled"],
            scheduled: ["draft", "scheduled", "cancelled"],
            in_progress: ["cancelled"],
            completed: [],
            cancelled: ["cancelled"],
          } as Record<string, string[]>
        )[meeting.status]?.includes(body.status)
      )
        throw new CommandFault(
          409,
          "MEETING_STATE_CHANGED",
          `Meeting status cannot transition from ${meeting.status} to ${body.status}`,
        );
      if (body.participantAgentIds !== undefined)
        await validateParticipants(tx, body.participantAgentIds);
      const updates: Partial<typeof meetings.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.agenda !== undefined) updates.agenda = body.agenda || null;
      if (body.summary !== undefined) updates.summary = body.summary || null;
      if (body.scheduledFor !== undefined)
        updates.scheduledFor = date(body.scheduledFor);
      if (body.status !== undefined) {
        updates.status = body.status;
        if (body.status === "cancelled" && meeting.startedAt)
          updates.endedAt = new Date();
      }
      await tx.update(meetings).set(updates).where(eq(meetings.id, meetingId));
      if (body.participantAgentIds !== undefined)
        await replaceParticipants(tx, meetingId, body.participantAgentIds);
      return { meetingId, entityId: meetingId };
    }
    case "transcript": {
      const body = command.body;
      if (body.replyToTranscriptId != null) {
        const [reply] = await tx
          .select({ id: transcripts.id })
          .from(transcripts)
          .where(
            and(
              eq(transcripts.id, body.replyToTranscriptId),
              eq(transcripts.meetingId, meetingId),
            ),
          );
        if (!reply) invalid("replyToTranscriptId must belong to this meeting");
      }
      const [row] = await tx
        .insert(transcripts)
        .values({
          meetingId,
          speakerType: "founder",
          speakerAgentId: null,
          content: body.content,
          replyToTranscriptId: body.replyToTranscriptId ?? null,
          occurredAt: date(body.occurredAt) ?? undefined,
        })
        .returning({ id: transcripts.id });
      return { meetingId, entityId: row.id };
    }
    case "decision": {
      const body = command.body;
      await validateOwner(tx, meetingId, body.ownerAgentId);
      const [row] = await tx
        .insert(decisions)
        .values({
          meetingId,
          content: body.content,
          rationale: body.rationale || null,
          ownerAgentId: body.ownerAgentId ?? null,
        })
        .returning({ id: decisions.id });
      return { meetingId, entityId: row.id };
    }
    case "action": {
      const body = command.body;
      await validateOwner(tx, meetingId, body.ownerAgentId);
      const [row] = await tx
        .insert(actions)
        .values({
          meetingId,
          title: body.title,
          details: body.details || null,
          ownerAgentId: body.ownerAgentId ?? null,
          dueAt: date(body.dueAt) ?? null,
          status: "open",
          completedAt: null,
        })
        .returning({ id: actions.id });
      return { meetingId, entityId: row.id };
    }
    case "action-update": {
      const body = command.body,
        actionItemId = scope.actionItemId!;
      const [existing] = await tx
        .select({ id: actions.id })
        .from(actions)
        .where(
          and(eq(actions.id, actionItemId), eq(actions.meetingId, meetingId)),
        )
        .for("update");
      if (!existing) missing("Action item not found in this meeting");
      await validateOwner(tx, meetingId, body.ownerAgentId);
      const updates: Partial<typeof actions.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.details !== undefined) updates.details = body.details || null;
      if (body.ownerAgentId !== undefined)
        updates.ownerAgentId = body.ownerAgentId;
      if (body.dueAt !== undefined) updates.dueAt = date(body.dueAt);
      if (body.status !== undefined) {
        updates.status = body.status;
        updates.completedAt = body.status === "done" ? new Date() : null;
      }
      await tx.update(actions).set(updates).where(eq(actions.id, actionItemId));
      return { meetingId, entityId: actionItemId };
    }
    case "complete": {
      const body = command.body;
      if (meeting.status !== "in_progress")
        throw new CommandFault(
          409,
          "MEETING_STATE_CHANGED",
          "Only an in-progress meeting can be completed",
        );
      for (const owner of new Set(
        [...body.decisions, ...body.actionItems].map(
          (item) => item.ownerAgentId,
        ),
      ))
        await validateOwner(tx, meetingId, owner);
      const now = new Date();
      await tx
        .update(meetings)
        .set({
          status: "completed",
          summary: body.summary,
          startedAt: meeting.startedAt ?? now,
          endedAt: now,
          updatedAt: now,
        })
        .where(eq(meetings.id, meetingId));
      if (body.decisions.length)
        await tx.insert(decisions).values(
          body.decisions.map((item) => ({
            meetingId,
            content: item.content,
            rationale: item.rationale || null,
            ownerAgentId: item.ownerAgentId ?? null,
          })),
        );
      if (body.actionItems.length)
        await tx.insert(actions).values(
          body.actionItems.map((item) => ({
            meetingId,
            title: item.title,
            details: item.details || null,
            ownerAgentId: item.ownerAgentId ?? null,
            dueAt: date(item.dueAt) ?? null,
            status: "open",
            completedAt: null,
          })),
        );
      return { meetingId, entityId: meetingId };
    }
  }
}

/** All domain writes and compact outcomes commit together; no remote effects. */
async function execute(scope: Scope, command: CommandInput) {
  const { requestId, ...input } = command.body;
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ version: 1, ...scope, kind: command.kind, input }))
    .digest("hex");
  return db.transaction(async (tx) => {
    // Same lock order as model turns: runtime controls, receipt, meeting, records.
    await lockRuntimeControlState(tx);
    const [previous] = await tx
      .select()
      .from(commands)
      .where(eq(commands.requestId, requestId))
      .for("update");
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new CommandFault(
          409,
          "MEETING_COMMAND_CONFLICT",
          "This request identity belongs to different input",
        );
      return { status: previous.httpStatus, body: previous.response };
    }
    let body: MeetingCommandResult, status: number;
    try {
      // A business rejection after a partial write must also roll back that write.
      const result = await tx.transaction((inner) =>
        mutate(inner, scope, command),
      );
      body = {
        requestId,
        projectId: scope.projectId,
        kind: command.kind,
        ...result,
        ok: true,
      };
      status = ["create", "transcript", "decision", "action"].includes(
        command.kind,
      )
        ? 201
        : 200;
    } catch (error) {
      if (!(error instanceof CommandFault)) throw error;
      status = error.status;
      body = {
        requestId,
        projectId: scope.projectId,
        meetingId: scope.meetingId,
        kind: command.kind,
        entityId: null,
        ok: false,
        code: error.code,
        error: error.message,
      };
    }
    await tx.insert(commands).values({
      requestId,
      projectId: scope.projectId,
      meetingId: body.meetingId,
      kind: command.kind,
      requestHash,
      httpStatus: status,
      response: body,
    });
    return { status, body };
  });
}

export function createMeetingCommandsRouter(): IRouter {
  const router = Router();
  router.get(
    "/projects/:projectId/meeting-commands/:requestId",
    async (req, res) => {
      const project = pathId.safeParse(req.params.projectId),
        key = requestId.safeParse(req.params.requestId);
      if (!project.success || !key.success) {
        res.status(400).json({ error: "Invalid command receipt identity" });
        return;
      }
      const [row] = await db
        .select()
        .from(commands)
        .where(
          and(
            eq(commands.requestId, key.data),
            eq(commands.projectId, project.data),
          ),
        );
      if (!row) {
        res.status(404).json({ error: "Meeting command receipt not found" });
        return;
      }
      res.json({
        requestId: row.requestId,
        projectId: row.projectId,
        meetingId: row.meetingId,
        kind: row.kind,
        httpStatus: row.httpStatus,
        response: row.response,
        createdAt: row.createdAt,
      });
    },
  );
  const base = "/projects/:projectId/meetings";
  const routes: ["post" | "patch", string, MeetingCommandKind][] = [
    ["post", base, "create"],
    ["patch", base + "/:meetingId", "update"],
    ["post", base + "/:meetingId/transcript", "transcript"],
    ["post", base + "/:meetingId/decisions", "decision"],
    ["post", base + "/:meetingId/action-items", "action"],
    ["patch", base + "/:meetingId/action-items/:actionItemId", "action-update"],
    ["post", base + "/:meetingId/complete", "complete"],
  ];
  for (const [method, path, kind] of routes)
    router[method](path, async (req, res) => {
      const project = pathId.safeParse(req.params.projectId);
      const meeting =
        req.params.meetingId === undefined
          ? null
          : pathId.safeParse(req.params.meetingId);
      const action =
        req.params.actionItemId === undefined
          ? null
          : pathId.safeParse(req.params.actionItemId);
      const parsed = schemas[kind].safeParse(req.body);
      if (
        !project.success ||
        (meeting && !meeting.success) ||
        (action && !action.success) ||
        !parsed.success
      ) {
        res.status(400).json({
          error: "Invalid meeting command input",
          code: "MEETING_COMMAND_INVALID",
        });
        return;
      }
      try {
        const result = await execute(
          {
            projectId: project.data,
            meetingId: meeting?.data ?? null,
            actionItemId: action?.data ?? null,
          },
          { kind, body: parsed.data } as CommandInput,
        );
        res.status(result.status).json(result.body);
      } catch (error) {
        if (error instanceof CommandFault) {
          res
            .status(error.status)
            .json({ error: error.message, code: error.code });
          return;
        }
        throw error;
      }
    });
  return router;
}
