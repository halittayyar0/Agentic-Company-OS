import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, tasksTable, taskBudgetResumeRequestsTable } from "@workspace/db";
import {
  ResumeTaskBudgetBody,
  GetTaskBudgetResumeReceiptParams,
  GetTaskBudgetResumeStatusResponse,
} from "@workspace/api-zod";
import { parsePositiveInteger } from "../lib/http-params";
import {
  budgetResumeRoot,
  parseBudgetResumeReceipt,
  resumeBudgetWithinTransaction,
} from "../lib/resume-task-budget";
import { readWorkspaceLocale } from "../lib/workspace-locale";

const router = Router();
router.get("/tasks/:taskId/budget-resume", async (req, res) => {
  const id = parsePositiveInteger(req.params.taskId, "taskId");
  if (!id.ok) {
    res.status(400).json({ error: id.error });
    return;
  }
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, id.value));
  res.setHeader("Cache-Control", "no-store");
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(
    GetTaskBudgetResumeStatusResponse.parse({
      taskId: id.value,
      rootTaskId: await budgetResumeRoot(id.value),
      budgetPaused:
        task.status === "blocked" && task.blockedReason === "budget",
    }),
  );
});
router.get("/tasks/:taskId/budget-resume/:requestId", async (req, res) => {
  const input = GetTaskBudgetResumeReceiptParams.safeParse(req.params);
  if (!input.success) {
    res.status(400).json({ error: "Invalid receipt identity" });
    return;
  }
  const [receipt] = await db
    .select()
    .from(taskBudgetResumeRequestsTable)
    .where(
      and(
        eq(taskBudgetResumeRequestsTable.requestId, input.data.requestId),
        eq(taskBudgetResumeRequestsTable.taskId, input.data.taskId),
      ),
    );
  res.setHeader("Cache-Control", "no-store");
  if (!receipt) {
    res.status(404).json({ error: "No committed receipt" });
    return;
  }
  const parsed = parseBudgetResumeReceipt(receipt.response);
  if (
    parsed.requestId !== receipt.requestId ||
    parsed.taskId !== receipt.taskId ||
    parsed.rootTaskId !== receipt.rootTaskId
  )
    throw new Error("Invalid budget receipt binding");
  res.json(parsed);
});
router.post("/tasks/:taskId/budget-resume", async (req, res) => {
  const id = parsePositiveInteger(req.params.taskId, "taskId"),
    input = ResumeTaskBudgetBody.strict().safeParse(req.body);
  if (!id.ok || !input.success) {
    res.status(400).json({
      error: "A request identity and exact root task identity are required",
    });
    return;
  }
  const locale = await readWorkspaceLocale();
  const result = await db.transaction((tx) =>
    resumeBudgetWithinTransaction(tx, id.value, input.data, locale),
  );
  res.setHeader("Cache-Control", "no-store");
  if ("conflict" in result) {
    res
      .status(409)
      .json({ error: "Request identity belongs to a different scope" });
    return;
  }
  res.json(result.receipt);
});
export default router;
