import { Router, type IRouter } from "express";
import {
  createProjectWithinTransaction,
  TaskOwnerUnavailable,
  ActiveWorkforceUnavailable,
} from "../lib/create-project";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notLike,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  agentsTable,
  approvalRequestsTable,
  projectMembersTable,
  tasksTable,
  activityEventsTable,
  taskStatusValues,
} from "@workspace/db";
import {
  ListTasksResponse,
  CreateTaskBody,
  CreateTaskResponse,
  GetTaskResponse,
  ListProjectMembersResponse,
  ListSubtasksResponse,
  ListTaskActivityResponse,
  CancelTaskResponse,
  UpdateTaskAutonomyBody,
  UpdateTaskAutonomyResponse,
} from "@workspace/api-zod";
import { RuntimeCapacityError } from "../lib/orchestrator/runtime-capacity";
import {
  parseCursorPage,
  parseOptionalBoolean,
  parseOptionalEnum,
  parsePositiveInteger,
  setNextCursor,
} from "../lib/http-params";
import { redactAuditText } from "../lib/audit-redaction";
import { lockAndAssertExecutionAllowed } from "../lib/orchestrator/runtime-emergency-stop";
import { redactApprovalCapabilityScope } from "../lib/orchestrator/approval-capability-redaction";

import taskAnswersRouter from "./task-answers";

const router: IRouter = Router();
router.use(taskAnswersRouter);
class TaskCancellationConflict extends Error {}
class ApprovedActionInFlightConflict extends Error {}

router.get("/tasks", async (req, res): Promise<void> => {
  const ownerAgentId = parsePositiveInteger(
    req.query.ownerAgentId,
    "ownerAgentId",
    { optional: true },
  );
  const status = parseOptionalEnum(
    req.query.status,
    "status",
    taskStatusValues,
  );
  const rootOnly = parseOptionalBoolean(req.query.rootOnly, "rootOnly");
  const page = parseCursorPage(req.query);
  if (!ownerAgentId.ok) {
    res.status(400).json({ error: ownerAgentId.error });
    return;
  }
  if (!status.ok) {
    res.status(400).json({ error: status.error });
    return;
  }
  if (!rootOnly.ok) {
    res.status(400).json({ error: rootOnly.error });
    return;
  }
  if (!page.ok) {
    res.status(400).json({ error: page.error });
    return;
  }

  const conditions = [];
  if (ownerAgentId.value !== undefined) {
    conditions.push(eq(tasksTable.ownerAgentId, ownerAgentId.value));
  }
  if (status.value !== undefined) {
    conditions.push(eq(tasksTable.status, status.value));
  }
  if (rootOnly.value) {
    conditions.push(isNull(tasksTable.parentTaskId));
  }
  if (page.value.beforeId !== undefined) {
    conditions.push(lt(tasksTable.id, page.value.beforeId));
  }

  const rows = await db
    .select()
    .from(tasksTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tasksTable.id))
    .limit(page.value.limit + 1);

  const hasMore = rows.length > page.value.limit;
  const tasks = rows.slice(0, page.value.limit);
  setNextCursor(res, tasks, hasMore);
  res.json(ListTasksResponse.parse(tasks));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = {
    ...parsed.data,
    title: parsed.data.title.trim(),
  };
  if (input.title.length === 0 || input.brief.trim().length === 0) {
    res.status(400).json({ error: "Task title and brief cannot be blank." });
    return;
  }
  if (input.brief.length > 8_000) {
    res
      .status(400)
      .json({ error: "Task brief cannot exceed 8000 characters." });
    return;
  }
  if (input.autonomyMode !== "continuous" && input.cadenceSeconds) {
    res.status(400).json({
      error: "cadenceSeconds is only valid for continuous tasks",
    });
    return;
  }

  let task;
  try {
    task = await db.transaction((tx) =>
      createProjectWithinTransaction(tx, input),
    );
  } catch (error) {
    if (error instanceof TaskOwnerUnavailable) {
      res.status(400).json({ error: "ownerAgentId not found or inactive" });
      return;
    }
    if (error instanceof ActiveWorkforceUnavailable) {
      res.status(409).json({ error: "No active agents are available" });
      return;
    }
    if (error instanceof RuntimeCapacityError) {
      res.status(429).json({
        error: "Bekleyen proje kapasitesi dolu.",
        code: error.code,
        kind: error.kind,
        limit: error.limit,
      });
      return;
    }
    throw error;
  }

  res.status(201).json(CreateTaskResponse.parse(task));
});

router.get("/tasks/:taskId", async (req, res): Promise<void> => {
  const parsedTaskId = parsePositiveInteger(req.params.taskId, "taskId");
  if (!parsedTaskId.ok) {
    res.status(400).json({ error: parsedTaskId.error });
    return;
  }
  const taskId = parsedTaskId.value;
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(GetTaskResponse.parse(task));
});

router.get("/tasks/:taskId/members", async (req, res): Promise<void> => {
  const parsedTaskId = parsePositiveInteger(req.params.taskId, "taskId");
  if (!parsedTaskId.ok) {
    res.status(400).json({ error: parsedTaskId.error });
    return;
  }

  const taskId = parsedTaskId.value;
  const [project] = await db
    .select({ id: tasksTable.id, parentTaskId: tasksTable.parentTaskId })
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.parentTaskId !== null) {
    res.status(409).json({
      error: "Members can only be listed for a root project",
      rootProjectRequired: true,
    });
    return;
  }

  const members = await db
    .select({
      taskId: projectMembersTable.taskId,
      agentId: projectMembersTable.agentId,
      membershipRole: projectMembersTable.memberRole,
      addedAt: projectMembersTable.joinedAt,
      agent: agentsTable,
    })
    .from(projectMembersTable)
    .innerJoin(agentsTable, eq(agentsTable.id, projectMembersTable.agentId))
    .where(eq(projectMembersTable.taskId, taskId))
    .orderBy(
      sql`CASE WHEN ${projectMembersTable.memberRole} = 'coordinator' THEN 0 ELSE 1 END`,
      projectMembersTable.agentId,
    );

  res.json(ListProjectMembersResponse.parse(members));
});

router.get("/tasks/:taskId/subtasks", async (req, res): Promise<void> => {
  const parsedTaskId = parsePositiveInteger(req.params.taskId, "taskId");
  const page = parseCursorPage(req.query);
  if (!parsedTaskId.ok) {
    res.status(400).json({ error: parsedTaskId.error });
    return;
  }
  if (!page.ok) {
    res.status(400).json({ error: page.error });
    return;
  }
  const conditions = [eq(tasksTable.parentTaskId, parsedTaskId.value)];
  if (page.value.beforeId !== undefined) {
    conditions.push(lt(tasksTable.id, page.value.beforeId));
  }
  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(desc(tasksTable.id))
    .limit(page.value.limit + 1);
  const hasMore = rows.length > page.value.limit;
  const subtasks = rows.slice(0, page.value.limit).reverse();
  setNextCursor(res, subtasks, hasMore);
  res.json(ListSubtasksResponse.parse(subtasks));
});

router.get("/tasks/:taskId/activity", async (req, res): Promise<void> => {
  const parsedTaskId = parsePositiveInteger(req.params.taskId, "taskId");
  const page = parseCursorPage(req.query);
  if (!parsedTaskId.ok) {
    res.status(400).json({ error: parsedTaskId.error });
    return;
  }
  if (!page.ok) {
    res.status(400).json({ error: page.error });
    return;
  }
  const conditions = [eq(activityEventsTable.taskId, parsedTaskId.value)];
  if (page.value.beforeId !== undefined) {
    conditions.push(lt(activityEventsTable.id, page.value.beforeId));
  }
  const rows = await db
    .select()
    .from(activityEventsTable)
    .where(and(...conditions))
    .orderBy(desc(activityEventsTable.id))
    .limit(page.value.limit + 1);
  const hasMore = rows.length > page.value.limit;
  const events = rows.slice(0, page.value.limit).reverse();
  setNextCursor(res, events, hasMore);
  res.json(ListTaskActivityResponse.parse(events));
});

router.post("/tasks/:taskId/cancel", async (req, res): Promise<void> => {
  const parsedTaskId = parsePositiveInteger(req.params.taskId, "taskId");
  if (!parsedTaskId.ok) {
    res.status(400).json({ error: parsedTaskId.error });
    return;
  }
  const taskId = parsedTaskId.value;
  const [existing] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId));
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const cancellableStatuses = [
    "pending",
    "planning",
    "in_progress",
    "awaiting_approval",
    "blocked",
  ];
  if (!cancellableStatuses.includes(existing.status)) {
    res.status(409).json({ error: `Task is already ${existing.status}` });
    return;
  }

  let task = existing;
  try {
    task = await db.transaction(async (tx) => {
      // All task creation/delegation paths lock an agent before inserting a
      // task. Locking the small, bounded workforce first therefore freezes
      // the delegation graph while the full descendant set is computed. The
      // remaining canonical order is approvals by id, then tasks by id.
      await tx.execute(
        sql`SELECT id FROM ${agentsTable} ORDER BY ${agentsTable.id} FOR UPDATE`,
      );
      const allTasks = await tx.select().from(tasksTable);
      const descendants = new Set<number>([taskId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of allTasks) {
          if (
            candidate.parentTaskId !== null &&
            descendants.has(candidate.parentTaskId) &&
            !descendants.has(candidate.id)
          ) {
            descendants.add(candidate.id);
            changed = true;
          }
        }
      }
      const liveRoot = allTasks.find((candidate) => candidate.id === taskId);
      if (!liveRoot || !cancellableStatuses.includes(liveRoot.status)) {
        throw new TaskCancellationConflict();
      }
      const affected = allTasks
        .filter(
          (candidate) =>
            descendants.has(candidate.id) &&
            cancellableStatuses.includes(candidate.status),
        )
        .sort((left, right) => left.id - right.id);
      const affectedTaskIds = affected.map((candidate) => candidate.id);
      const approvalIds =
        affectedTaskIds.length === 0
          ? []
          : (
              await tx
                .select({ id: approvalRequestsTable.id })
                .from(approvalRequestsTable)
                .where(inArray(approvalRequestsTable.taskId, affectedTaskIds))
                .orderBy(approvalRequestsTable.id)
            ).map((approval) => approval.id);
      if (approvalIds.length > 0) {
        await tx.execute(
          sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.id} IN (${sql.join(
            approvalIds.map((id) => sql`${id}`),
            sql`, `,
          )}) ORDER BY ${approvalRequestsTable.id} FOR UPDATE`,
        );
      }
      await tx.execute(
        sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} IN (${sql.join(
          affectedTaskIds.map((id) => sql`${id}`),
          sql`, `,
        )}) ORDER BY ${tasksTable.id} FOR UPDATE`,
      );
      const lockedTasks = await tx
        .select()
        .from(tasksTable)
        .where(inArray(tasksTable.id, affectedTaskIds));
      if (
        lockedTasks.some((candidate) =>
          candidate.leaseOwner?.startsWith("approval:"),
        )
      ) {
        throw new ApprovedActionInFlightConflict();
      }
      const lockedRoot = lockedTasks.find(
        (candidate) => candidate.id === taskId,
      );
      if (!lockedRoot || !cancellableStatuses.includes(lockedRoot.status)) {
        throw new TaskCancellationConflict();
      }

      const cancelledTasks = await tx
        .update(tasksTable)
        .set({
          status: "cancelled",
          blockedReason: null,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: "Kullanıcı tarafından iptal edildi.",
        })
        .where(
          and(
            inArray(tasksTable.id, affectedTaskIds),
            inArray(tasksTable.status, cancellableStatuses),
            or(
              isNull(tasksTable.leaseOwner),
              notLike(tasksTable.leaseOwner, "approval:%"),
            ),
          ),
        )
        .returning();
      if (cancelledTasks.length !== affectedTaskIds.length) {
        throw new TaskCancellationConflict();
      }
      const cancelled = cancelledTasks.find(
        (candidate) => candidate.id === taskId,
      );
      if (!cancelled) throw new TaskCancellationConflict();

      const approvalsToReject = await tx
        .select()
        .from(approvalRequestsTable)
        .where(
          and(
            inArray(approvalRequestsTable.taskId, affectedTaskIds),
            or(
              eq(approvalRequestsTable.status, "pending"),
              and(
                eq(approvalRequestsTable.status, "approved"),
                isNull(approvalRequestsTable.consumedAt),
                isNotNull(approvalRequestsTable.actionPayload),
              ),
            ),
          ),
        );
      const resolvedAt = new Date();
      for (const approval of approvalsToReject) {
        await tx
          .update(approvalRequestsTable)
          .set({
            status: "rejected",
            decisionNote: "Task cancelled by user",
            resolvedAt,
            actionPayload: null,
            scope: redactApprovalCapabilityScope(approval.scope, "CANCELLED"),
          })
          .where(
            and(
              eq(approvalRequestsTable.id, approval.id),
              or(
                eq(approvalRequestsTable.status, "pending"),
                and(
                  eq(approvalRequestsTable.status, "approved"),
                  isNull(approvalRequestsTable.consumedAt),
                  isNotNull(approvalRequestsTable.actionPayload),
                ),
              ),
            ),
          );
      }

      await tx
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
            inArray(agentsTable.id, [
              ...new Set(cancelledTasks.map((item) => item.ownerAgentId)),
            ]),
            inArray(agentsTable.currentTaskId, affectedTaskIds),
          ),
        );

      await tx.insert(activityEventsTable).values(
        cancelledTasks.map((item) => ({
          agentId: item.ownerAgentId,
          taskId: item.id,
          type: "task_status_changed" as const,
          summary:
            item.id === taskId
              ? `Kullanıcı ${lockedRoot.parentTaskId === null ? "projeyi" : "çalışmayı"} ve etkin alt çalışmalarını iptal etti; yürütme kilitleri geri alındı.`
              : `Üst ${lockedRoot.parentTaskId === null ? "proje" : "çalışma"} #${taskId} iptal edildiği için bu alt çalışma atomik olarak iptal edildi.`,
          detail: {
            cancellationRootTaskId: taskId,
            cascaded: item.id !== taskId,
          },
          severity: "warning" as const,
        })),
      );
      return cancelled;
    });
  } catch (error) {
    if (error instanceof ApprovedActionInFlightConflict) {
      res.status(409).json({
        error:
          "An approved action is already executing; wait for its final audit state before cancelling",
      });
      return;
    }
    if (error instanceof TaskCancellationConflict) {
      res.status(409).json({ error: "Task changed concurrently" });
      return;
    }
    throw error;
  }

  res.json(CancelTaskResponse.parse(task));
});

router.put("/tasks/:taskId/autonomy", async (req, res): Promise<void> => {
  const parsedTaskId = parsePositiveInteger(req.params.taskId, "taskId");
  if (!parsedTaskId.ok) {
    res.status(400).json({ error: parsedTaskId.error });
    return;
  }
  const parsed = UpdateTaskAutonomyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.autonomyMode !== "continuous" && parsed.data.cadenceSeconds) {
    res.status(400).json({
      error: "cadenceSeconds is only valid for continuous tasks",
    });
    return;
  }

  const taskId = parsedTaskId.value;
  const continuous = parsed.data.autonomyMode === "continuous";
  const now = new Date();
  const [identity] = await db
    .select({ ownerAgentId: tasksTable.ownerAgentId })
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId));
  if (!identity) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    // Canonical mutation lock order: agent -> approvals -> task.
    await tx.execute(
      sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${identity.ownerAgentId} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${approvalRequestsTable} WHERE ${approvalRequestsTable.taskId} = ${taskId} ORDER BY ${approvalRequestsTable.id} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM ${tasksTable} WHERE ${tasksTable.id} = ${taskId} FOR UPDATE`,
    );
    const [existing] = await tx
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId));
    if (!existing) return { kind: "not_found" as const };
    if (["cancelled", "failed"].includes(existing.status)) {
      return { kind: "terminal" as const, status: existing.status };
    }
    if (existing.leaseOwner) return { kind: "conflict" as const };

    const [owner] = await tx
      .select({
        isActive: agentsTable.isActive,
        modelMode: agentsTable.modelMode,
        modelId: agentsTable.modelId,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, existing.ownerAgentId));
    if (!owner?.isActive) return { kind: "inactive_owner" as const };

    const [task] = await tx
      .update(tasksTable)
      .set({
        autonomyMode: parsed.data.autonomyMode,
        cadenceSeconds: continuous
          ? (parsed.data.cadenceSeconds ??
            (existing.autonomyMode === "continuous"
              ? existing.cadenceSeconds
              : null) ??
            3_600)
          : null,
        // Converting an existing job to a persistent responsibility is the
        // last safe point to snapshot a manual, user-owned model selection.
        // Automatic jobs remain unpinned and follow the runtime router.
        executionModelId:
          continuous &&
          !existing.executionModelId &&
          owner?.modelMode === "manual"
            ? owner.modelId
            : existing.executionModelId,
        ...(continuous && existing.status === "completed"
          ? {
              status: "in_progress",
              progressPercent: 0,
              completedAt: null,
              nextAttemptAt: now,
              lastError: null,
              blockedReason: null,
            }
          : {}),
      })
      .where(
        and(
          eq(tasksTable.id, taskId),
          inArray(tasksTable.status, [
            "pending",
            "planning",
            "in_progress",
            "awaiting_approval",
            "blocked",
            "completed",
          ]),
          isNull(tasksTable.leaseOwner),
        ),
      )
      .returning();
    if (!task) return { kind: "conflict" as const };

    await tx.insert(activityEventsTable).values({
      agentId: task.ownerAgentId,
      taskId: task.id,
      type: "task_status_changed",
      summary: continuous
        ? `${task.parentTaskId === null ? "Proje" : "Çalışma"} sürekli sorumluluğa dönüştürüldü; döngü aralığı ${task.cadenceSeconds} saniye.`
        : `${task.parentTaskId === null ? "Proje" : "Çalışma"} tek seferlik teslim moduna alındı.`,
      detail: {
        autonomyMode: task.autonomyMode,
        cadenceSeconds: task.cadenceSeconds,
        executionModelId: task.executionModelId,
        reopened: continuous && existing.status === "completed",
      },
      severity: "info",
    });
    return { kind: "updated" as const, task };
  });
  if (outcome.kind === "not_found") {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (outcome.kind === "terminal") {
    res.status(409).json({
      error: `Task is ${outcome.status}; create a new responsibility instead`,
    });
    return;
  }
  if (outcome.kind === "inactive_owner") {
    res.status(409).json({ error: "Task owner is inactive" });
    return;
  }
  if (outcome.kind === "conflict") {
    res.status(409).json({ error: "Task changed concurrently" });
    return;
  }

  res.json(UpdateTaskAutonomyResponse.parse(outcome.task));
});

export default router;
