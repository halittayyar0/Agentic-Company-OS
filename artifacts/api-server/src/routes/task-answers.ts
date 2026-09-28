import { createHash } from "node:crypto";
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  tasksTable,
  agentsTable,
  approvalRequestsTable,
  activityEventsTable,
  taskAnswerRequestsTable,
} from "@workspace/db";
import {
  ResumeTaskBody,
  ResumeTaskResponse,
  GetTaskQuestionResponse,
  GetTaskAnswerReceiptParams,
} from "@workspace/api-zod";
import { parsePositiveInteger } from "../lib/http-params";
import { redactAuditText } from "../lib/audit-redaction";
import { lockRuntimeControlState } from "../lib/orchestrator/runtime-emergency-stop";

const router = Router();
type Receipt = ReturnType<typeof ResumeTaskResponse.parse>;

router.get("/tasks/:taskId/question", async (req, res) => {
  const id = parsePositiveInteger(req.params.taskId, "taskId");
  if (!id.ok) {
    res.status(400).json({ error: id.error });
    return;
  }
  // One statement gives a coherent read. This is a snapshot, not a mutation permit.
  const [row] = await db
    .select({ task: tasksTable, active: agentsTable.isActive })
    .from(tasksTable)
    .leftJoin(agentsTable, eq(agentsTable.id, tasksTable.ownerAgentId))
    .where(eq(tasksTable.id, id.value));
  if (!row) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const t = row.task;
  res.setHeader("Cache-Control", "no-store");
  res.json(
    GetTaskQuestionResponse.parse({
      taskId: t.id,
      questionId: t.userInputQuestionId,
      question: t.userInputQuestion,
      ownerAgentId: t.userInputOwnerAgentId,
      answerable: Boolean(
        t.status === "blocked" &&
        t.blockedReason === "user_input" &&
        !t.leaseOwner &&
        row.active &&
        t.userInputQuestionId &&
        t.userInputQuestion?.trim() &&
        t.userInputOwnerAgentId === t.ownerAgentId,
      ),
    }),
  );
});

router.get("/tasks/:taskId/resume/:requestId", async (req, res) => {
  const params = GetTaskAnswerReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid receipt identity" });
    return;
  }
  const [receipt] = await db
    .select()
    .from(taskAnswerRequestsTable)
    .where(
      and(
        eq(taskAnswerRequestsTable.requestId, params.data.requestId),
        eq(taskAnswerRequestsTable.taskId, params.data.taskId),
      ),
    );
  res.setHeader("Cache-Control", "no-store");
  if (!receipt) {
    res.status(404).json({ error: "No committed receipt" });
    return;
  }
  res.json(ResumeTaskResponse.parse(receipt.response));
});

router.post("/tasks/:taskId/resume", async (req, res) => {
  const id = parsePositiveInteger(req.params.taskId, "taskId");
  const parsed = ResumeTaskBody.safeParse(req.body);
  if (!id.ok || !parsed.success || !parsed.data.answer.trim()) {
    res.status(400).json({
      error:
        "A request identity, exact question identity and nonblank answer (maximum 1200 characters) are required",
    });
    return;
  }
  const taskId = id.value;
  const input = parsed.data;
  const answer = input.answer.trim();
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify(["task-answer-v1", taskId, input.questionId, answer]),
    )
    .digest("hex");
  const result = await db.transaction(async (tx) => {
    // Same global admission row as scheduler/stop. Serializes request reservation
    // across replicas, then canonical agent -> approvals -> task lock order.
    const control = await lockRuntimeControlState(tx);
    const [prior] = await tx
      .select()
      .from(taskAnswerRequestsTable)
      .where(eq(taskAnswerRequestsTable.requestId, input.requestId));
    if (prior) {
      return prior.requestHash === requestHash && prior.taskId === taskId
        ? { receipt: ResumeTaskResponse.parse(prior.response) }
        : { conflict: true as const };
    }
    const finish = async (reason: Receipt["reason"]) => {
      const receipt: Receipt = {
        requestId: input.requestId,
        taskId,
        questionId: input.questionId,
        outcome: reason ? "rejected" : "accepted",
        reason,
        recordedAt: new Date(),
      };
      await tx.insert(taskAnswerRequestsTable).values({
        requestId: input.requestId,
        taskId,
        questionId: input.questionId,
        requestHash,
        response: JSON.parse(JSON.stringify(receipt)),
      });
      return { receipt };
    };
    if (control.emergencyStopEnabled) return finish("emergency_stop");
    const [identity] = await tx
      .select({ owner: tasksTable.ownerAgentId })
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId));
    if (!identity) return finish("task_changed");
    await tx.execute(
      sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${identity.owner} FOR UPDATE`,
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
    if (
      !existing ||
      existing.ownerAgentId !== identity.owner ||
      existing.status !== "blocked" ||
      existing.blockedReason !== "user_input" ||
      existing.leaseOwner
    )
      return finish("task_changed");
    if (
      existing.userInputQuestionId !== input.questionId ||
      !existing.userInputQuestion?.trim() ||
      existing.userInputOwnerAgentId !== existing.ownerAgentId
    )
      return finish("question_changed");
    const [owner] = await tx
      .select({ active: agentsTable.isActive })
      .from(agentsTable)
      .where(eq(agentsTable.id, identity.owner));
    if (!owner?.active) return finish("owner_inactive");
    const [resumed] = await tx
      .update(tasksTable)
      .set({
        status: "in_progress",
        nextAttemptAt: new Date(),
        lastError: null,
        blockedReason: null,
        consecutiveFailures: 0,
        userInputQuestionId: null,
        userInputQuestion: null,
        userInputOwnerAgentId: null,
      })
      .where(
        and(
          eq(tasksTable.id, taskId),
          eq(tasksTable.ownerAgentId, identity.owner),
          eq(tasksTable.userInputQuestionId, input.questionId),
          eq(tasksTable.status, "blocked"),
          eq(tasksTable.blockedReason, "user_input"),
          isNull(tasksTable.leaseOwner),
        ),
      )
      .returning();
    if (!resumed) return finish("task_changed");
    const safeAnswer = redactAuditText(answer, 1_200);
    await tx.insert(activityEventsTable).values({
      agentId: resumed.ownerAgentId,
      taskId,
      type: "task_status_changed",
      summary: `User answer recorded: ${safeAnswer}`,
      detail: {
        runtimeEvent: "task_resumed_with_user_input",
        questionId: input.questionId,
        requestId: input.requestId,
        question: existing.userInputQuestion,
        answer: safeAnswer,
      },
      severity: "info",
    });
    return finish(null);
  });
  if ("conflict" in result) {
    res
      .status(409)
      .json({ error: "Request identity belongs to different content" });
    return;
  }
  res.json(result.receipt);
});

export default router;
