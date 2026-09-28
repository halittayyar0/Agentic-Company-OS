import { eq, sql } from "drizzle-orm";
import {
  agentsTable,
  tasksTable,
  projectMembersTable,
  activityEventsTable,
} from "@workspace/db";
import { assertOutstandingTaskCapacity } from "./orchestrator/runtime-capacity";
import {
  lockAndAssertExecutionAllowed,
  type RuntimeTransaction,
} from "./orchestrator/runtime-emergency-stop";
import { assertAgentConfig } from "./agent-config-version";

export class TaskOwnerUnavailable extends Error {}
export class ActiveWorkforceUnavailable extends Error {}
export interface ProjectCreationInput {
  title: string;
  brief: string;
  ownerAgentId?: number;
  priority?: "low" | "normal" | "high" | "urgent";
  autonomyMode?: "finite" | "continuous";
  cadenceSeconds?: number;
  dueAt?: Date | null;
}
/** Caller owns the transaction so a request receipt can commit with the project. */
export async function createProjectWithinTransaction(
  tx: RuntimeTransaction,
  input: ProjectCreationInput,
  expectedConfig?: string,
) {
  // Global lock order starts with the runtime control, then agents.
  await lockAndAssertExecutionAllowed(tx);
  // Serialize the complete workforce snapshot with agent deactivation.
  // Every project membership and its coordinator must describe one
  // database state; locking only a requested legacy owner would permit a
  // concurrently-deactivated teammate to leak into the new roster.
  await tx.execute(
    sql`SELECT id FROM ${agentsTable} ORDER BY ${agentsTable.id} FOR UPDATE`,
  );
  const activeAgents = await tx
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.isActive, true))
    .orderBy(agentsTable.id);
  if (activeAgents.length === 0) throw new ActiveWorkforceUnavailable();

  const requestedOwner =
    input.ownerAgentId === undefined
      ? undefined
      : activeAgents.find((agent) => agent.id === input.ownerAgentId);
  if (input.ownerAgentId !== undefined && !requestedOwner) {
    throw new TaskOwnerUnavailable();
  }
  const owner =
    requestedOwner ??
    activeAgents.find((agent) => agent.isRootCeo) ??
    activeAgents.find(
      (agent) => agent.parentAgentId === null && agent.depth === 0,
    ) ??
    activeAgents[0]!;

  if (expectedConfig !== undefined) assertAgentConfig(owner, expectedConfig);
  await assertOutstandingTaskCapacity(tx);
  const [created] = await tx
    .insert(tasksTable)
    .values({
      title: input.title,
      brief: input.brief,
      status: "pending",
      priority: input.priority ?? "normal",
      ownerAgentId: owner.id,
      assignedByAgentId: owner.parentAgentId,
      createdByUser: true,
      parentTaskId: null,
      progressPercent: 0,
      dueAt: input.dueAt ?? null,
      executionModelId: owner.modelMode === "manual" ? owner.modelId : null,
      autonomyMode: input.autonomyMode ?? "finite",
      cadenceSeconds:
        input.autonomyMode === "continuous"
          ? (input.cadenceSeconds ?? 3_600)
          : null,
    })
    .returning();
  await tx.insert(projectMembersTable).values(
    activeAgents.map((agent) => ({
      taskId: created.id,
      agentId: agent.id,
      memberRole:
        agent.id === owner.id ? ("coordinator" as const) : ("member" as const),
    })),
  );
  await tx.insert(activityEventsTable).values({
    agentId: owner.id,
    taskId: created.id,
    type: "task_created",
    summary: `Kullanıcı yeni bir proje oluşturdu: "${created.title}"`,
    detail: {
      projectMemberCount: activeAgents.length,
      coordinatorAgentId: owner.id,
    },
    severity: "info",
  });
  return created;
}
