import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  activityEventsTable,
  agentsTable,
  db,
  tasksTable,
  workforceInstallationsTable,
  type Agent,
  type Task,
} from "@workspace/db";
import { avatarColorFor } from "../lib/orchestrator/avatar-color";
import {
  assertActiveAgentCapacity,
  assertOutstandingTaskCapacity,
  RuntimeCapacityError,
} from "../lib/orchestrator/runtime-capacity";
import {
  EmergencyStopError,
  lockRuntimeControlState,
} from "../lib/orchestrator/runtime-emergency-stop";
import {
  blueprintSystemPrompt,
  boundedBlueprintPermissions,
  getBlueprintMemberTemplate,
  getWorkforceBlueprint,
  WORKFORCE_BLUEPRINTS,
  type WorkforceBlueprint,
  type WorkforceBlueprintMember,
} from "../lib/workforce-blueprints";

import {
  localizeWorkforceBlueprint,
  workforceActivitySummary,
} from "../lib/workforce-localization";
import {
  WORKSPACE_LOCALES,
  workspaceLanguageContract,
} from "../lib/workspace-locale";

const router: IRouter = Router();

const InstallWorkforceBlueprintBody = z
  .object({
    requestId: z.uuid().optional(),
    locale: z.enum(WORKSPACE_LOCALES).default("tr"),
    blueprintVersion: z.number().int().positive().optional(),
    managerAgentId: z.number().int().positive(),
    outcome: z.string().trim().min(3).max(8_000).optional(),
    autonomyMode: z.enum(["finite", "continuous"]).optional(),
    cadenceSeconds: z.number().int().min(60).max(604_800).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.cadenceSeconds !== undefined &&
      input.autonomyMode !== "continuous"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["cadenceSeconds"],
        message: "cadenceSeconds is only valid for continuous tasks",
      });
    }
    if (
      input.outcome === undefined &&
      (input.autonomyMode !== undefined || input.cadenceSeconds !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Task autonomy settings require an outcome",
      });
    }
  });

class InstallationRequestConflict extends Error {}
class BlueprintVersionChanged extends Error {}
class ManagerNotFound extends Error {}
class ManagerInactive extends Error {}
class ManagerCannotCreateSubAgents extends Error {}

function publicAgent(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    department: agent.department,
    parentAgentId: agent.parentAgentId,
    depth: agent.depth,
    status: agent.status,
    currentTaskId: agent.currentTaskId,
    currentAction: agent.currentAction,
    lastActiveAt: agent.lastActiveAt,
    systemPrompt: agent.systemPrompt,
    isCustomPrompt: agent.isCustomPrompt,
    templateKey: agent.templateKey,
    modelMode: agent.modelMode,
    modelId: agent.modelId,
    avatarColor: agent.avatarColor,
    avatarVersion: agent.avatarVersion,
    permissions: agent.permissions,
    createdByAgentId: agent.createdByAgentId,
    createdByUser: agent.createdByUser,
    isActive: agent.isActive,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function publicTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    brief: task.brief,
    status: task.status,
    priority: task.priority,
    ownerAgentId: task.ownerAgentId,
    assignedByAgentId: task.assignedByAgentId,
    createdByUser: task.createdByUser,
    parentTaskId: task.parentTaskId,
    progressPercent: task.progressPercent,
    tokensUsed: task.tokensUsed,
    estimatedCostUsd: task.estimatedCostUsd,
    resultSummary: task.resultSummary,
    executionModelId: task.executionModelId,
    lastModelId: task.lastModelId,
    lastModelProvider: task.lastModelProvider,
    modelFallbackCount: task.modelFallbackCount,
    autonomyMode: task.autonomyMode,
    cadenceSeconds: task.cadenceSeconds,
    lastHeartbeatAt: task.lastHeartbeatAt,
    recoveryCount: task.recoveryCount,
    cycleCount: task.cycleCount,
    lastCycleCompletedAt: task.lastCycleCompletedAt,
    lastSteppedAt: task.lastSteppedAt,
    stepAttempts: task.stepAttempts,
    consecutiveFailures: task.consecutiveFailures,
    nextAttemptAt: task.nextAttemptAt,
    lastError: task.lastError,
    blockedReason: task.blockedReason,
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

function installOrder(
  blueprint: WorkforceBlueprint,
): WorkforceBlueprintMember[] {
  const pending = new Map(
    blueprint.members.map((member) => [member.key, member]),
  );
  const ordered: WorkforceBlueprintMember[] = [];
  const installed = new Set<string>();

  while (pending.size > 0) {
    const ready = [...pending.values()].filter(
      (member) =>
        member.reportsToKey === null || installed.has(member.reportsToKey),
    );
    if (ready.length === 0) {
      throw new Error(
        `Workforce blueprint ${blueprint.key} has a hierarchy cycle`,
      );
    }
    for (const member of ready) {
      ordered.push(member);
      installed.add(member.key);
      pending.delete(member.key);
    }
  }
  return ordered;
}

router.get("/workforce-blueprints", (req, res): void => {
  const parsed = z
    .object({ locale: z.enum(WORKSPACE_LOCALES).default("tr") })
    .strict()
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Unsupported catalogue locale",
      code: "WORKFORCE_LOCALE_INVALID",
    });
    return;
  }
  res.json(
    WORKFORCE_BLUEPRINTS.map((blueprint) =>
      localizeWorkforceBlueprint(blueprint, parsed.data.locale),
    ),
  );
});

router.post(
  "/workforce-blueprints/:blueprintKey/install",
  async (req, res): Promise<void> => {
    const sourceBlueprint = getWorkforceBlueprint(req.params.blueprintKey);
    if (!sourceBlueprint) {
      res.status(404).json({
        error: "Workforce blueprint not found",
        code: "WORKFORCE_BLUEPRINT_NOT_FOUND",
      });
      return;
    }

    const parsed = InstallWorkforceBlueprintBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.message,
        code: "WORKFORCE_INSTALLATION_INVALID",
      });
      return;
    }

    const input = parsed.data;
    const blueprint = localizeWorkforceBlueprint(sourceBlueprint, input.locale);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          blueprintKey: blueprint.key,
          locale: input.locale,
          blueprintVersion: input.blueprintVersion ?? null,
          managerAgentId: input.managerAgentId,
          outcome: input.outcome ?? null,
          autonomyMode: input.outcome ? (input.autonomyMode ?? "finite") : null,
          cadenceSeconds:
            input.outcome && input.autonomyMode === "continuous"
              ? (input.cadenceSeconds ?? 3600)
              : null,
        }),
      )
      .digest("hex");
    try {
      const installed = await db.transaction(async (tx) => {
        // Keep the shared global lock order: runtime control, then agents/tasks.
        const control = await lockRuntimeControlState(tx);
        if (input.requestId) {
          const [receipt] = await tx
            .select()
            .from(workforceInstallationsTable)
            .where(eq(workforceInstallationsTable.requestId, input.requestId));
          if (receipt) {
            if (receipt.requestHash !== requestHash)
              throw new InstallationRequestConflict();
            return receipt.response;
          }
        }
        // A committed replay is a read, including during emergency stop. A new
        // installation still obeys the control row while its lock is held.
        if (control.emergencyStopEnabled) throw new EmergencyStopError(control);
        if (
          input.blueprintVersion !== undefined &&
          input.blueprintVersion !== blueprint.version
        )
          throw new BlueprintVersionChanged();
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${input.managerAgentId} FOR UPDATE`,
        );
        const [manager] = await tx
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, input.managerAgentId));
        if (!manager) throw new ManagerNotFound();
        if (!manager.isActive) throw new ManagerInactive();
        if (!manager.permissions.canCreateSubAgents) {
          throw new ManagerCannotCreateSubAgents();
        }

        const createdByMemberKey = new Map<string, Agent>();
        for (const member of installOrder(blueprint)) {
          await assertActiveAgentCapacity(tx);
          const reportingManager = member.reportsToKey
            ? createdByMemberKey.get(member.reportsToKey)
            : manager;
          if (!reportingManager) {
            throw new Error(
              `Workforce blueprint ${blueprint.key} manager was not installed`,
            );
          }

          const template = getBlueprintMemberTemplate(member);
          const [created] = await tx
            .insert(agentsTable)
            .values({
              name: member.name,
              role: member.role,
              department: member.department,
              parentAgentId: reportingManager.id,
              depth: reportingManager.depth + 1,
              status: "idle",
              systemPrompt: `${blueprintSystemPrompt(blueprint, member, template, input.locale)}\n\n${workspaceLanguageContract(input.locale)}`,
              isCustomPrompt: true,
              templateKey: template.key,
              isRootCeo: false,
              modelMode: "auto",
              modelId: null,
              avatarColor: avatarColorFor(
                `${blueprint.key}:${member.key}:${reportingManager.id}`,
              ),
              permissions: boundedBlueprintPermissions(
                template.defaultPermissions,
                reportingManager.permissions,
              ),
              createdByAgentId: reportingManager.id,
              createdByUser: true,
              isActive: true,
            })
            .returning();
          createdByMemberKey.set(member.key, created);
        }

        const rootMember = blueprint.members.find(
          (member) => member.reportsToKey === null,
        );
        const rootAgent = rootMember
          ? createdByMemberKey.get(rootMember.key)
          : undefined;
        if (!rootAgent) {
          throw new Error(
            `Workforce blueprint ${blueprint.key} has no root agent`,
          );
        }

        let task = null;
        if (input.outcome !== undefined) {
          await assertOutstandingTaskCapacity(tx);
          [task] = await tx
            .insert(tasksTable)
            .values({
              title: `${blueprint.name}: ${input.outcome}`.slice(0, 240),
              brief: input.outcome,
              status: "pending",
              priority: "normal",
              ownerAgentId: rootAgent.id,
              assignedByAgentId: manager.id,
              createdByUser: true,
              parentTaskId: null,
              progressPercent: 0,
              executionModelId: null,
              autonomyMode: input.autonomyMode ?? "finite",
              cadenceSeconds:
                input.autonomyMode === "continuous"
                  ? (input.cadenceSeconds ?? 3_600)
                  : null,
            })
            .returning();

          await tx.insert(activityEventsTable).values({
            agentId: rootAgent.id,
            taskId: task.id,
            type: "task_created",
            summary: workforceActivitySummary(input.locale, "task_created", {
              team: blueprint.name,
            }),
            detail: {
              blueprintKey: blueprint.key,
              blueprintVersion: blueprint.version,
              installationRequestId: input.requestId ?? null,
              locale: input.locale,
              installedByManagerAgentId: manager.id,
              memberAgentIds: blueprint.members.map(
                (member) => createdByMemberKey.get(member.key)!.id,
              ),
            },
            severity: "info",
          });
        }

        for (const member of blueprint.members) {
          const created = createdByMemberKey.get(member.key)!;
          const reportingManager = member.reportsToKey
            ? createdByMemberKey.get(member.reportsToKey)!
            : manager;
          await tx.insert(activityEventsTable).values({
            agentId: reportingManager.id,
            taskId: task?.id ?? null,
            type: "subagent_created",
            summary: workforceActivitySummary(
              input.locale,
              "subagent_created",
              {
                manager: reportingManager.name,
                member: created.name,
                team: blueprint.name,
              },
            ),
            detail: {
              blueprintKey: blueprint.key,
              blueprintVersion: blueprint.version,
              memberKey: member.key,
              installationRequestId: input.requestId ?? null,
              locale: input.locale,
              reportsToKey: member.reportsToKey,
              newAgentId: created.id,
            },
            severity: "info",
          });
        }

        const result = {
          blueprintKey: blueprint.key,
          version: blueprint.version,
          agents: blueprint.members.map((member) =>
            publicAgent(createdByMemberKey.get(member.key)!),
          ),
          task: task ? publicTask(task) : null,
        };
        if (input.requestId)
          await tx.insert(workforceInstallationsTable).values({
            requestId: input.requestId,
            requestHash,
            blueprintKey: blueprint.key,
            blueprintVersion: blueprint.version,
            response: JSON.parse(JSON.stringify(result)),
          });
        return result;
      });

      res.status(201).json(installed);
    } catch (error) {
      if (error instanceof InstallationRequestConflict) {
        res.status(409).json({
          error: "This request ID belongs to a different installation",
          code: "WORKFORCE_INSTALLATION_REQUEST_CONFLICT",
        });
        return;
      }
      if (error instanceof BlueprintVersionChanged) {
        res.status(409).json({
          error: "The blueprint version changed; review its current version",
          code: "WORKFORCE_BLUEPRINT_VERSION_CHANGED",
        });
        return;
      }
      if (error instanceof ManagerNotFound) {
        res.status(404).json({
          error: "Manager agent not found",
          code: "MANAGER_AGENT_NOT_FOUND",
        });
        return;
      }
      if (error instanceof ManagerInactive) {
        res.status(409).json({
          error: "Manager agent is inactive",
          code: "MANAGER_AGENT_INACTIVE",
        });
        return;
      }
      if (error instanceof ManagerCannotCreateSubAgents) {
        res.status(403).json({
          error: "Manager agent cannot create sub-agents",
          code: "MANAGER_CANNOT_CREATE_SUBAGENTS",
        });
        return;
      }
      if (error instanceof EmergencyStopError) {
        res.status(423).json({
          error: "Emergency stop is active; workforce installation is blocked",
          code: error.code,
          state: {
            emergencyStopEnabled: true,
            reason: error.state.emergencyStopReason,
            version: error.state.version,
          },
        });
        return;
      }
      if (error instanceof RuntimeCapacityError) {
        res.status(429).json({
          error: "Runtime capacity is full",
          code: error.code,
          kind: error.kind,
          limit: error.limit,
        });
        return;
      }
      throw error;
    }
  },
);

export { InstallWorkforceBlueprintBody };
export default router;
