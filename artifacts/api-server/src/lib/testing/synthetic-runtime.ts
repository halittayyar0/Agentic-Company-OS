import { and, eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  projectMembersTable,
  tasksTable,
} from "@workspace/db";
import type { RuntimeOperationsConfig } from "../runtime-operations-config";
import type { SyntheticRuntimeConfiguration } from "../runtime-security";
import { executeTool } from "../orchestrator/execute-tool";
import { stepTask, type StepTaskDependencies } from "../orchestrator/step-task";
import type { ClaimedTask } from "../orchestrator/task-attempt-store";
import {
  createSyntheticCompletion,
  syntheticResponsibilityTitle,
  type SyntheticDelegation,
} from "./synthetic-completion";
import { createFileBackedSyntheticFaultSource } from "./synthetic-fault-plan";
import { createSyntheticToolExecutor } from "./synthetic-tool";

interface SyntheticClaimedTaskLifecycle {
  afterInitialLeaseHeartbeat(): void;
}

function taskIdentity(task: ClaimedTask) {
  return {
    taskId: task.id,
    attemptNumber: Math.max(1, task.stepAttempts),
    step: Math.max(0, task.cycleCount),
  };
}

async function missingProjectResponsibilities(
  task: ClaimedTask,
  synthetic: SyntheticRuntimeConfiguration,
): Promise<SyntheticDelegation[]> {
  if (task.parentTaskId !== null) return [];
  if (task.autonomyMode !== "continuous") {
    throw new Error(
      "Synthetic endurance root project must use continuous autonomy.",
    );
  }
  const members = await db
    .select({
      agentId: projectMembersTable.agentId,
      memberRole: projectMembersTable.memberRole,
      isActive: agentsTable.isActive,
      parentAgentId: agentsTable.parentAgentId,
      permissions: agentsTable.permissions,
    })
    .from(projectMembersTable)
    .innerJoin(agentsTable, eq(agentsTable.id, projectMembersTable.agentId))
    .where(eq(projectMembersTable.taskId, task.id))
    .orderBy(projectMembersTable.agentId);
  if (members.length !== synthetic.expectedAgents) {
    throw new Error(
      `Synthetic endurance expected ${synthetic.expectedAgents} project agents but roster has ${members.length}.`,
    );
  }
  const coordinator = members.find(
    (member) => member.memberRole === "coordinator",
  );
  if (
    coordinator?.agentId !== task.ownerAgentId ||
    !coordinator.isActive ||
    !coordinator.permissions.canDelegate
  ) {
    throw new Error(
      "Synthetic endurance coordinator is inactive, mismatched, or cannot delegate.",
    );
  }
  const targets = members.filter(
    (member) => member.agentId !== task.ownerAgentId,
  );
  if (
    targets.some(
      (member) =>
        !member.isActive || member.parentAgentId !== task.ownerAgentId,
    )
  ) {
    throw new Error(
      "Synthetic endurance members must be active direct reports of the coordinator.",
    );
  }
  const children = await db
    .select({
      ownerAgentId: tasksTable.ownerAgentId,
      title: tasksTable.title,
      status: tasksTable.status,
      autonomyMode: tasksTable.autonomyMode,
    })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.parentTaskId, task.id),
        eq(tasksTable.assignedByAgentId, task.ownerAgentId),
      ),
    );
  const activeOwners = new Set(
    children
      .filter(
        (child) =>
          child.title ===
            syntheticResponsibilityTitle(synthetic.runId, child.ownerAgentId) &&
          child.autonomyMode === "continuous" &&
          !["completed", "failed", "cancelled"].includes(child.status),
      )
      .map((child) => child.ownerAgentId),
  );
  return targets
    .filter((member) => !activeOwners.has(member.agentId))
    .map((member) => ({ agentId: member.agentId }));
}

export function createSyntheticClaimedTaskRunner(input: {
  runtimeOperationsConfig: RuntimeOperationsConfig;
  synthetic: SyntheticRuntimeConfiguration;
}): (
  task: ClaimedTask,
  lifecycle: SyntheticClaimedTaskLifecycle,
) => Promise<void> {
  const faultSource =
    input.synthetic.runDirectory && input.synthetic.controlFile
      ? createFileBackedSyntheticFaultSource({
          runId: input.synthetic.runId,
          seed: input.synthetic.seed,
          runDirectory: input.synthetic.runDirectory,
          controlFile: input.synthetic.controlFile,
          basePlan: input.synthetic.faultPlan,
        })
      : undefined;
  return async (task, lifecycle) => {
    if (
      task.autonomyMode !== "continuous" ||
      !task.cadenceSeconds ||
      task.cadenceSeconds < 60
    ) {
      throw new Error(
        "Synthetic endurance tasks must be continuous with a valid cadence.",
      );
    }
    const identity = taskIdentity(task);
    const delegations = await missingProjectResponsibilities(
      task,
      input.synthetic,
    );
    const shared = {
      runId: input.synthetic.runId,
      seed: input.synthetic.seed,
      identity,
      faultPlan: input.synthetic.faultPlan,
      delegations,
      taskLifecycle: {
        autonomyMode: "continuous" as const,
        cadenceSeconds: task.cadenceSeconds,
        createdAt: task.createdAt,
        cycleCount: task.cycleCount,
      },
      ...(faultSource ? { faultSource } : {}),
    };
    const syntheticToolExecutor = createSyntheticToolExecutor(shared);
    const dependencies: StepTaskDependencies = {
      runtimeOperationsConfig: input.runtimeOperationsConfig,
      createCompletion: createSyntheticCompletion(shared),
      selectModelPlan: () => ({
        primary: {
          modelId: "synthetic/endurance",
          provider: "ollama",
          usedFallback: false,
          source: "automatic",
          tier: "economy",
        },
        routes: [
          {
            modelId: "synthetic/endurance",
            provider: "ollama",
            usedFallback: false,
            source: "automatic",
            tier: "economy",
          },
        ],
        freeOnly: true,
      }),
      runTool: async (context, name, rawArgs) => {
        if (name === "delegate_task") {
          return executeTool(context, name, rawArgs);
        }
        return syntheticToolExecutor(context, name, rawArgs);
      },
      afterInitialLeaseHeartbeat: lifecycle.afterInitialLeaseHeartbeat,
    };
    await stepTask(task, dependencies);
  };
}
