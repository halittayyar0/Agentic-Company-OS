import { Router, type IRouter } from "express";
import { count, eq, gte, sql, sum } from "drizzle-orm";
import {
  db,
  agentsTable,
  tasksTable,
  approvalRequestsTable,
  effectiveUsageEventsView as usageEventsTable,
} from "@workspace/db";
import { GetOrgSummaryResponse } from "@workspace/api-zod";
import { tokenUsageEvidence } from "../lib/usage-coverage";

const router: IRouter = Router();

router.get("/org/summary", async (_req, res): Promise<void> => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // Keep this hot dashboard route constant-memory. Counting full row sets in
  // Node made every five-second refresh grow linearly with task and usage
  // history, and transferred sensitive text the response never needed.
  const [[agentStats], [taskStats], [approvalStats], [usageStats]] =
    await Promise.all([
      db
        .select({
          total: count(),
          working: sql<number>`count(*) filter (where ${agentsTable.status} = 'working')`,
        })
        .from(agentsTable)
        .where(eq(agentsTable.isActive, true)),
      db
        .select({
          inProgress: sql<number>`count(*) filter (where ${tasksTable.status} in ('pending', 'planning', 'in_progress'))`,
          awaitingApproval: sql<number>`count(*) filter (where ${tasksTable.status} = 'awaiting_approval')`,
          completedToday: sql<number>`count(*) filter (where ${tasksTable.status} = 'completed' and ${tasksTable.completedAt} >= ${startOfToday})`,
        })
        .from(tasksTable),
      db
        .select({ total: count() })
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.status, "pending")),
      db
        .select({
          events: count(),
          tokens: sum(usageEventsTable.totalTokens),
          reportedCost: sum(usageEventsTable.reportedCostUsd),
          costReportedEvents: count(usageEventsTable.reportedCostUsd),
          tokenReportedEvents: sql<number>`count(*) filter (where ${usageEventsTable.usageReported} is true)`,
        })
        .from(usageEventsTable)
        .where(gte(usageEventsTable.createdAt, startOfToday)),
    ]);

  const tokensUsedToday = Number(usageStats?.tokens ?? 0);
  const reportedCostTodayUsd = Number(usageStats?.reportedCost ?? 0);
  const tokenEvidence = tokenUsageEvidence(
    usageStats?.events,
    usageStats?.tokenReportedEvents,
  );

  const summary = {
    totalAgents: Number(agentStats?.total ?? 0),
    activeAgents: Number(agentStats?.total ?? 0),
    workingAgents: Number(agentStats?.working ?? 0),
    tasksInProgress: Number(taskStats?.inProgress ?? 0),
    tasksAwaitingApproval: Number(taskStats?.awaitingApproval ?? 0),
    tasksCompletedToday: Number(taskStats?.completedToday ?? 0),
    pendingApprovals: Number(approvalStats?.total ?? 0),
    tokensUsedToday,
    estimatedCostTodayUsd: Number(reportedCostTodayUsd.toFixed(6)),
    usageEventsToday: Number(usageStats?.events ?? 0),
    costReportedEventsToday: Number(usageStats?.costReportedEvents ?? 0),
    tokenReportedEventsToday: tokenEvidence.tokenReportedEvents,
    tokenUnreportedEventsToday: tokenEvidence.tokenUnreportedEvents,
    tokenUsageCoverageToday: tokenEvidence.tokenUsageCoverage,
  };

  res.json(GetOrgSummaryResponse.parse(summary));
});

export default router;
