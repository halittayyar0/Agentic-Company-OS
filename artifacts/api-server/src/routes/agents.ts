import { randomBytes } from "node:crypto";
import { Router, type IRouter, type ErrorRequestHandler } from "express";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  agentAvatarsTable,
  agentsTable,
  approvalRequestsTable,
  messagesTable,
  tasksTable,
  defaultAgentPermissions,
} from "@workspace/db";
import {
  ListAgentTemplatesResponse,
  ListAgentTemplatesQueryParams,
  ListAgentsResponse,
  CreateAgentBody,
  CreateAgentResponse,
  GetAgentResponse,
  UpdateAgentAvatarBody,
  UpdateAgentAvatarResponse,
  ResetAgentAvatarResponse,
  UpdateAgentBody,
  UpdateAgentResponse,
  ListAgentMessagesResponse,
  SendAgentMessageBody,
  SendAgentMessageResponse,
} from "@workspace/api-zod";
import {
  getLocalizedAgentTemplate,
  getLocalizedAgentTemplates,
} from "../lib/agent-template-localization";
import { avatarColorFor } from "../lib/orchestrator/avatar-color";
import {
  avatarCacheControl,
  avatarEntityTag,
  validateAvatarDataUrl,
} from "../lib/agent-avatar";
import { isCanonicalRootCeo } from "../lib/orchestrator/agent-authority";
import {
  AgentBusyError,
  ProjectChatUnavailableError,
  runAgentTurn,
} from "../lib/orchestrator/run-agent-turn";
import { EmergencyStopError } from "../lib/orchestrator/runtime-emergency-stop";
import {
  assertActiveAgentCapacity,
  RuntimeCapacityError,
} from "../lib/orchestrator/runtime-capacity";
import {
  parseCursorPage,
  parseOptionalBoolean,
  parseOptionalText,
  parsePositiveInteger,
  setNextCursor,
} from "../lib/http-params";
import { redactApprovalCapabilityScope } from "../lib/orchestrator/approval-capability-redaction";
import { requireHttpRuntimeHandle } from "../lib/http-runtime-context";
import { RuntimeClaimAdmissionError } from "../lib/orchestrator/runtime-instance-registry";

import {
  assertAgentConfig,
  withAgentConfigVersion,
  AgentConfigChanged,
} from "../lib/agent-config-version";

const router: IRouter = Router();
class AgentUpdateConflict extends Error {}
class AgentModelSelectionInvalid extends Error {}
class AgentApprovedActionInFlightConflict extends Error {}
class AgentPermissionUpdateInFlightConflict extends Error {}
class AgentHierarchyUpdateConflict extends Error {}
class AgentParentUnavailable extends Error {}

router.get("/agent-templates", (req, res): void => {
  const parsed = ListAgentTemplatesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = getLocalizedAgentTemplates(parsed.data.locale ?? "tr").map(
    (t) => ({
      key: t.key,
      name: t.name,
      department: t.department,
      defaultRole: t.defaultRole,
      description: t.description,
      defaultSystemPrompt: t.defaultSystemPrompt,
      defaultPermissions: t.defaultPermissions,
    }),
  );
  res.json(ListAgentTemplatesResponse.parse(data));
});

router.get("/agents", async (req, res): Promise<void> => {
  const includeInactive = parseOptionalBoolean(
    req.query.includeInactive,
    "includeInactive",
  );
  const parentAgentId = parsePositiveInteger(
    req.query.parentAgentId,
    "parentAgentId",
    { optional: true },
  );
  const department = parseOptionalText(req.query.department, "department", 120);
  if (!includeInactive.ok) {
    res.status(400).json({ error: includeInactive.error });
    return;
  }
  if (!parentAgentId.ok) {
    res.status(400).json({ error: parentAgentId.error });
    return;
  }
  if (!department.ok) {
    res.status(400).json({ error: department.error });
    return;
  }

  const conditions = [];
  if (!includeInactive.value) conditions.push(eq(agentsTable.isActive, true));
  if (parentAgentId.value !== undefined) {
    conditions.push(eq(agentsTable.parentAgentId, parentAgentId.value));
  }
  if (department.value !== undefined) {
    conditions.push(eq(agentsTable.department, department.value));
  }

  const agents = await db
    .select()
    .from(agentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(agentsTable.depth, agentsTable.id);

  res.json(ListAgentsResponse.parse(agents));
});

router.post("/agents", async (req, res): Promise<void> => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = {
    ...parsed.data,
    name: parsed.data.name.trim(),
    role: parsed.data.role.trim(),
    department: parsed.data.department?.trim(),
    templateKey: parsed.data.templateKey?.trim(),
    modelId: parsed.data.modelId?.trim(),
  };
  if (
    input.name.length === 0 ||
    input.role.length === 0 ||
    input.department === "" ||
    input.templateKey === "" ||
    input.modelId === "" ||
    (input.systemPrompt !== undefined && input.systemPrompt.trim().length === 0)
  ) {
    res.status(400).json({ error: "Text fields cannot be blank." });
    return;
  }

  if (
    input.templateKey === "ceo" ||
    input.permissions?.canUseSudo === true ||
    Object.hasOwn(req.body as object, "isRootCeo")
  ) {
    res.status(403).json({
      error:
        "Root CEO identity and sudo authority are server-managed and cannot be created through the API.",
    });
    return;
  }

  const template = input.templateKey
    ? getLocalizedAgentTemplate(input.templateKey, input.locale ?? "tr")
    : undefined;

  if (input.parentAgentId != null) {
    const [parent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, input.parentAgentId));
    if (!parent) {
      res.status(400).json({ error: "parentAgentId not found" });
      return;
    }
  }

  const systemPrompt = input.systemPrompt ?? template?.defaultSystemPrompt;
  if (!systemPrompt) {
    res.status(400).json({
      error: "systemPrompt is required when no templateKey is provided",
    });
    return;
  }

  let created;
  try {
    [created] = await db.transaction(async (tx) => {
      await assertActiveAgentCapacity(tx);
      let liveParentDepth = -1;
      if (input.parentAgentId != null) {
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${input.parentAgentId} FOR UPDATE`,
        );
        const [liveParent] = await tx
          .select({ depth: agentsTable.depth, isActive: agentsTable.isActive })
          .from(agentsTable)
          .where(eq(agentsTable.id, input.parentAgentId));
        if (!liveParent?.isActive) throw new AgentParentUnavailable();
        liveParentDepth = liveParent.depth;
      }
      return tx
        .insert(agentsTable)
        .values({
          name: input.name,
          role: input.role,
          department: input.department ?? template?.department ?? null,
          parentAgentId: input.parentAgentId ?? null,
          depth: liveParentDepth + 1,
          status: "idle",
          systemPrompt,
          isCustomPrompt:
            input.systemPrompt !== undefined || !input.templateKey,
          templateKey: input.templateKey ?? null,
          isRootCeo: false,
          modelMode: input.modelMode ?? "auto",
          modelId: input.modelId ?? null,
          avatarColor: avatarColorFor(`${input.name}-${Date.now()}`),
          permissions:
            input.permissions ??
            template?.defaultPermissions ??
            defaultAgentPermissions,
          createdByAgentId: null,
          createdByUser: true,
          isActive: true,
        })
        .returning();
    });
  } catch (error) {
    if (error instanceof RuntimeCapacityError) {
      res.status(429).json({
        error: "Aktif ajan kapasitesi dolu.",
        code: error.code,
        kind: error.kind,
        limit: error.limit,
      });
      return;
    }
    if (error instanceof AgentParentUnavailable) {
      res.status(409).json({ error: "parentAgentId not found or inactive" });
      return;
    }
    throw error;
  }

  res.status(201).json(CreateAgentResponse.parse(created));
});

router.get("/agents/:agentId", async (req, res): Promise<void> => {
  const parsedAgentId = parsePositiveInteger(req.params.agentId, "agentId");
  if (!parsedAgentId.ok) {
    res.status(400).json({ error: parsedAgentId.error });
    return;
  }
  const agentId = parsedAgentId.value;
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(GetAgentResponse.parse(withAgentConfigVersion(agent)));
});

router.get("/agents/:agentId/avatar", async (req, res): Promise<void> => {
  const parsedAgentId = parsePositiveInteger(req.params.agentId, "agentId");
  if (!parsedAgentId.ok) {
    res.status(400).json({ error: parsedAgentId.error });
    return;
  }

  const [record] = await db
    .select({
      mimeType: agentAvatarsTable.mimeType,
      imageBase64: agentAvatarsTable.imageBase64,
      avatarVersion: agentsTable.avatarVersion,
    })
    .from(agentAvatarsTable)
    .innerJoin(agentsTable, eq(agentsTable.id, agentAvatarsTable.agentId))
    .where(eq(agentAvatarsTable.agentId, parsedAgentId.value));

  if (!record?.avatarVersion) {
    res.status(404).json({ error: "Custom avatar not found" });
    return;
  }

  const etag = avatarEntityTag(parsedAgentId.value, record.avatarVersion);
  res.setHeader("ETag", etag);
  res.setHeader(
    "Cache-Control",
    avatarCacheControl(req.query.v, record.avatarVersion),
  );
  if (req.header("if-none-match") === etag) {
    res.status(304).end();
    return;
  }

  const image = Buffer.from(record.imageBase64, "base64");
  res.setHeader("Content-Type", record.mimeType);
  res.setHeader("Content-Length", String(image.byteLength));
  res.send(image);
});

router.put("/agents/:agentId/avatar", async (req, res): Promise<void> => {
  const parsedAgentId = parsePositiveInteger(req.params.agentId, "agentId");
  if (!parsedAgentId.ok) {
    res.status(400).json({ error: parsedAgentId.error });
    return;
  }
  const parsed = UpdateAgentAvatarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const avatar = validateAvatarDataUrl(parsed.data.dataUrl);
  if (!avatar.ok) {
    res.status(400).json({ error: avatar.error });
    return;
  }

  const version = randomBytes(12).toString("hex");
  const updated = await db.transaction(async (tx) => {
    const [agent] = await tx
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, parsedAgentId.value))
      .for("update");
    if (!agent) return undefined;
    assertAgentConfig(agent, parsed.data.expectedConfig);

    await tx
      .insert(agentAvatarsTable)
      .values({
        agentId: agent.id,
        mimeType: avatar.mimeType,
        imageBase64: avatar.imageBase64,
      })
      .onConflictDoUpdate({
        target: agentAvatarsTable.agentId,
        set: {
          mimeType: avatar.mimeType,
          imageBase64: avatar.imageBase64,
          updatedAt: new Date(),
        },
      });
    const [saved] = await tx
      .update(agentsTable)
      .set({ avatarVersion: version })
      .where(eq(agentsTable.id, agent.id))
      .returning();
    return saved;
  });

  if (!updated) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(UpdateAgentAvatarResponse.parse(withAgentConfigVersion(updated)));
});

router.delete("/agents/:agentId/avatar", async (req, res): Promise<void> => {
  const parsedAgentId = parsePositiveInteger(req.params.agentId, "agentId");
  if (!parsedAgentId.ok) {
    res.status(400).json({ error: parsedAgentId.error });
    return;
  }

  const expectedConfig = req.query.expectedConfig;
  if (
    expectedConfig !== undefined &&
    (typeof expectedConfig !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedConfig))
  ) {
    res.status(400).json({
      code: "AGENT_INPUT_INVALID",
      error: "Invalid configuration version",
    });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, parsedAgentId.value))
      .for("update");
    if (!current) return undefined;
    assertAgentConfig(current, expectedConfig);
    const [agent] = await tx
      .update(agentsTable)
      .set({ avatarVersion: null })
      .where(eq(agentsTable.id, parsedAgentId.value))
      .returning();
    if (!agent) return undefined;
    await tx
      .delete(agentAvatarsTable)
      .where(eq(agentAvatarsTable.agentId, agent.id));
    return agent;
  });

  if (!updated) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(ResetAgentAvatarResponse.parse(withAgentConfigVersion(updated)));
});

router.patch("/agents/:agentId", async (req, res): Promise<void> => {
  const parsedAgentId = parsePositiveInteger(req.params.agentId, "agentId");
  if (!parsedAgentId.ok) {
    res.status(400).json({ error: parsedAgentId.error });
    return;
  }
  const agentId = parsedAgentId.value;
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { expectedConfig, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0) {
    res.status(400).json({
      code: "AGENT_INPUT_INVALID",
      error: "No editable fields supplied",
    });
    return;
  }
  const update = {
    ...fields,
    name: parsed.data.name?.trim(),
    role: parsed.data.role?.trim(),
    department:
      typeof parsed.data.department === "string"
        ? parsed.data.department.trim()
        : parsed.data.department,
    modelId: parsed.data.modelId?.trim(),
  };
  if (
    update.name === "" ||
    update.role === "" ||
    update.department === "" ||
    update.modelId === "" ||
    (update.systemPrompt !== undefined &&
      update.systemPrompt.trim().length === 0)
  ) {
    res.status(400).json({ error: "Text fields cannot be blank." });
    return;
  }

  if (Object.hasOwn(req.body as object, "isRootCeo")) {
    res.status(403).json({ error: "Root CEO identity is server-managed." });
    return;
  }

  const reparentRequested = Object.hasOwn(req.body as object, "parentAgentId");
  if (reparentRequested && update.isActive === false) {
    res.status(400).json({
      error: "Move and deactivate an agent in separate operations.",
    });
    return;
  }

  let hierarchyDepths: Map<number, number> | null = null;
  if (reparentRequested) {
    const hierarchy = await db
      .select({
        id: agentsTable.id,
        parentAgentId: agentsTable.parentAgentId,
        depth: agentsTable.depth,
        isRootCeo: agentsTable.isRootCeo,
      })
      .from(agentsTable);
    const current = hierarchy.find((item) => item.id === agentId);
    if (!current) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (current.isRootCeo && update.parentAgentId !== null) {
      res
        .status(403)
        .json({ error: "The root CEO cannot report to an agent." });
      return;
    }
    const hierarchyResult = calculateReparentDepths(
      hierarchy,
      agentId,
      update.parentAgentId ?? null,
    );
    if (!hierarchyResult.ok) {
      res.status(400).json({ error: hierarchyResult.error });
      return;
    }
    hierarchyDepths = hierarchyResult.depths;
  }

  if (update.permissions?.canUseSudo === true) {
    const [authority] = await db
      .select({
        id: agentsTable.id,
        depth: agentsTable.depth,
        parentAgentId: agentsTable.parentAgentId,
        templateKey: agentsTable.templateKey,
        isRootCeo: agentsTable.isRootCeo,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    if (!authority || !(await isCanonicalRootCeo(authority))) {
      res.status(403).json({
        error:
          "Sudo permission can only be enabled for the canonical root CEO.",
      });
      return;
    }
  }

  function reviewedUpdate(current: typeof agentsTable.$inferSelect) {
    assertAgentConfig(current, expectedConfig);
    if (
      (update.modelMode ?? current.modelMode) === "manual" &&
      !(update.modelId ?? current.modelId)?.trim()
    ) {
      throw new AgentModelSelectionInvalid();
    }
    return {
      ...update,
      ...(update.modelMode === "auto" ? { modelId: null } : {}),
      ...(update.systemPrompt !== undefined ? { isCustomPrompt: true } : {}),
      ...(update.isActive === true && !current.isActive
        ? { status: "idle", currentTaskId: null, currentAction: null }
        : {}),
    };
  }
  let updated;
  if (update.isActive === false) {
    try {
      updated = await db.transaction(async (tx) => {
        // Canonical mutation lock order: agent -> approvals by id -> tasks by
        // id. Locking the owner first also serializes create/delegate/claim.
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${agentId} FOR UPDATE`,
        );
        const [liveAgent] = await tx
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, agentId));
        if (!liveAgent) throw new AgentUpdateConflict();
        const reviewed = reviewedUpdate(liveAgent);
        const activeTasks = await tx
          .select({ id: tasksTable.id })
          .from(tasksTable)
          .where(
            and(
              eq(tasksTable.ownerAgentId, agentId),
              inArray(tasksTable.status, [
                "pending",
                "planning",
                "in_progress",
                "awaiting_approval",
                "blocked",
              ]),
            ),
          )
          .orderBy(tasksTable.id);
        const taskIds = activeTasks
          .map((task) => task.id)
          .sort((a, b) => a - b);
        if (taskIds.length > 0) {
          const approvalIds = (
            await tx
              .select({ id: approvalRequestsTable.id })
              .from(approvalRequestsTable)
              .where(inArray(approvalRequestsTable.taskId, taskIds))
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
              taskIds.map((id) => sql`${id}`),
              sql`, `,
            )}) ORDER BY ${tasksTable.id} FOR UPDATE`,
          );
          const lockedTasks = await tx
            .select({ leaseOwner: tasksTable.leaseOwner })
            .from(tasksTable)
            .where(inArray(tasksTable.id, taskIds));
          if (
            lockedTasks.some((task) => task.leaseOwner?.startsWith("approval:"))
          ) {
            throw new AgentApprovedActionInFlightConflict();
          }

          const approvalsToReject = await tx
            .select()
            .from(approvalRequestsTable)
            .where(
              and(
                inArray(approvalRequestsTable.taskId, taskIds),
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
                decisionNote: "Agent deactivated by user",
                resolvedAt,
                actionPayload: null,
                scope: redactApprovalCapabilityScope(
                  approval.scope,
                  "AGENT_DEACTIVATED",
                ),
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
        }

        const [deactivated] = await tx
          .update(agentsTable)
          .set({
            ...reviewed,
            isActive: false,
            status: "archived",
            currentTaskId: null,
            currentAction: null,
            runLeaseOwner: null,
            runLeaseExpiresAt: null,
            lastActiveAt: new Date(),
          })
          .where(eq(agentsTable.id, agentId))
          .returning();
        if (!deactivated) throw new AgentUpdateConflict();

        await tx
          .update(tasksTable)
          .set({
            status: "blocked",
            blockedReason: "owner_inactive",
            nextAttemptAt: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError:
              "Gorev sahibi ajan kullanici tarafindan pasiflestirildi.",
          })
          .where(
            and(
              eq(tasksTable.ownerAgentId, agentId),
              inArray(tasksTable.status, [
                "pending",
                "planning",
                "in_progress",
                "awaiting_approval",
                "blocked",
              ]),
            ),
          );
        return deactivated;
      });
    } catch (error) {
      if (error instanceof AgentUpdateConflict) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      if (error instanceof AgentApprovedActionInFlightConflict) {
        res.status(409).json({
          error:
            "An approved action is already executing; wait for its final audit state before deactivating the agent",
          code: "AGENT_ACTION_IN_FLIGHT",
        });
        return;
      }
      throw error;
    }
  } else if (hierarchyDepths) {
    try {
      updated = await db.transaction(async (tx) => {
        if (update.isActive === true)
          await assertActiveAgentCapacity(tx, agentId);
        // Recompute from a serialized workforce snapshot. Reciprocal PATCHes
        // can no longer both validate an obsolete acyclic hierarchy.
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} ORDER BY ${agentsTable.id} FOR UPDATE`,
        );
        const lockedHierarchy = await tx.select().from(agentsTable);
        const current = lockedHierarchy.find((item) => item.id === agentId);
        if (!current) return undefined;
        const reviewed = reviewedUpdate(current);
        if (
          update.permissions !== undefined &&
          current.runLeaseOwner !== null
        ) {
          throw new AgentPermissionUpdateInFlightConflict();
        }
        if (current.isRootCeo && update.parentAgentId !== null) {
          throw new AgentHierarchyUpdateConflict(
            "The root CEO cannot report to an agent.",
          );
        }
        const recalculated = calculateReparentDepths(
          lockedHierarchy,
          agentId,
          update.parentAgentId ?? null,
        );
        if (!recalculated.ok) {
          throw new AgentHierarchyUpdateConflict(recalculated.error);
        }
        const [moved] = await tx
          .update(agentsTable)
          .set({ ...reviewed, depth: recalculated.depths.get(agentId) ?? 0 })
          .where(eq(agentsTable.id, agentId))
          .returning();
        if (!moved) return undefined;
        for (const [descendantId, depth] of recalculated.depths) {
          if (descendantId === agentId) continue;
          await tx
            .update(agentsTable)
            .set({ depth })
            .where(eq(agentsTable.id, descendantId));
        }
        return moved;
      });
    } catch (error) {
      if (error instanceof AgentHierarchyUpdateConflict) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof AgentPermissionUpdateInFlightConflict) {
        res.status(409).json({
          error:
            "Agent permissions cannot change while autonomous work is leased; stop or cancel it and retry",
          code: "AGENT_PERMISSION_IN_FLIGHT",
        });
        return;
      }
      throw error;
    }
  } else if (update.permissions !== undefined) {
    try {
      updated = await db.transaction(async (tx) => {
        if (update.isActive === true)
          await assertActiveAgentCapacity(tx, agentId);
        // A permission snapshot is authority for the full leased turn. Locking
        // the agent serializes revocation with both task and approved-action
        // claims: revoke-first makes the later claim fail, claim-first returns
        // a visible conflict instead of racing an already-starting side effect.
        await tx.execute(
          sql`SELECT id FROM ${agentsTable} WHERE ${agentsTable.id} = ${agentId} FOR UPDATE`,
        );
        const [liveAgent] = await tx
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, agentId));
        if (!liveAgent) return undefined;
        const reviewed = reviewedUpdate(liveAgent);
        if (liveAgent.runLeaseOwner !== null) {
          throw new AgentPermissionUpdateInFlightConflict();
        }
        const [permissionUpdated] = await tx
          .update(agentsTable)
          .set(reviewed)
          .where(eq(agentsTable.id, agentId))
          .returning();
        return permissionUpdated;
      });
    } catch (error) {
      if (error instanceof AgentPermissionUpdateInFlightConflict) {
        res.status(409).json({
          error:
            "Agent permissions cannot change while autonomous work is leased; stop or cancel it and retry",
          code: "AGENT_PERMISSION_IN_FLIGHT",
        });
        return;
      }
      throw error;
    }
  } else {
    updated = await db.transaction(async (tx) => {
      if (update.isActive === true)
        await assertActiveAgentCapacity(tx, agentId);
      const [current] = await tx
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId))
        .for("update");
      if (!current) return undefined;
      const [saved] = await tx
        .update(agentsTable)
        .set(reviewedUpdate(current))
        .where(eq(agentsTable.id, agentId))
        .returning();
      return saved;
    });
  }

  if (!updated) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(UpdateAgentResponse.parse(withAgentConfigVersion(updated)));
});

type HierarchyAgent = {
  id: number;
  parentAgentId: number | null;
  depth: number;
};

export function calculateReparentDepths(
  hierarchy: HierarchyAgent[],
  movedAgentId: number,
  nextParentAgentId: number | null,
): { ok: true; depths: Map<number, number> } | { ok: false; error: string } {
  if (movedAgentId === nextParentAgentId) {
    return { ok: false, error: "An agent cannot report to itself." };
  }
  const byId = new Map(hierarchy.map((item) => [item.id, item]));
  if (nextParentAgentId !== null && !byId.has(nextParentAgentId)) {
    return { ok: false, error: "parentAgentId not found" };
  }

  let cursor = nextParentAgentId;
  const visited = new Set<number>();
  while (cursor !== null) {
    if (cursor === movedAgentId) {
      return {
        ok: false,
        error: "This reporting line would create an organization cycle.",
      };
    }
    if (visited.has(cursor)) {
      return {
        ok: false,
        error: "The existing organization contains a cycle.",
      };
    }
    visited.add(cursor);
    cursor = byId.get(cursor)?.parentAgentId ?? null;
  }

  const children = new Map<number, number[]>();
  for (const item of hierarchy) {
    if (item.parentAgentId === null) continue;
    const list = children.get(item.parentAgentId) ?? [];
    list.push(item.id);
    children.set(item.parentAgentId, list);
  }

  const nextDepth =
    nextParentAgentId === null
      ? 0
      : (byId.get(nextParentAgentId)?.depth ?? 0) + 1;
  const depths = new Map<number, number>([[movedAgentId, nextDepth]]);
  const queue = [movedAgentId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parentDepth = depths.get(parentId)!;
    for (const childId of children.get(parentId) ?? []) {
      depths.set(childId, parentDepth + 1);
      queue.push(childId);
    }
  }
  return { ok: true, depths };
}

router.get("/agents/:agentId/messages", async (req, res): Promise<void> => {
  const parsedAgentId = parsePositiveInteger(req.params.agentId, "agentId");
  const parsedTaskId = parsePositiveInteger(req.query.taskId, "taskId", {
    optional: true,
  });
  const page = parseCursorPage(req.query);
  if (!parsedAgentId.ok) {
    res.status(400).json({ error: parsedAgentId.error });
    return;
  }
  if (!parsedTaskId.ok) {
    res.status(400).json({ error: parsedTaskId.error });
    return;
  }
  if (!page.ok) {
    res.status(400).json({ error: page.error });
    return;
  }
  const agentId = parsedAgentId.value;
  const conditions = [
    eq(messagesTable.agentId, agentId),
    parsedTaskId.value === undefined
      ? isNull(messagesTable.taskId)
      : eq(messagesTable.taskId, parsedTaskId.value),
  ];
  if (page.value.beforeId !== undefined) {
    conditions.push(lt(messagesTable.id, page.value.beforeId));
  }
  const rows = await db
    .select()
    .from(messagesTable)
    .where(and(...conditions))
    .orderBy(desc(messagesTable.id))
    .limit(page.value.limit + 1);
  const hasMore = rows.length > page.value.limit;
  const messages = rows.slice(0, page.value.limit).reverse();
  setNextCursor(res, messages, hasMore);
  res.json(ListAgentMessagesResponse.parse(messages));
});

router.post("/agents/:agentId/messages", async (req, res): Promise<void> => {
  const parsedAgentId = parsePositiveInteger(req.params.agentId, "agentId");
  if (!parsedAgentId.ok) {
    res.status(400).json({ error: parsedAgentId.error });
    return;
  }
  const agentId = parsedAgentId.value;
  const parsed = SendAgentMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (
    parsed.data.content.trim().length === 0 ||
    (parsed.data.modelId !== undefined &&
      parsed.data.modelId.trim().length === 0)
  ) {
    res
      .status(400)
      .json({ error: "Message content and model ID cannot be blank." });
    return;
  }

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));
  if (!agent || !agent.isActive) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const scopedTask =
    parsed.data.taskId === undefined
      ? undefined
      : (
          await db
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.id, parsed.data.taskId))
        )[0];
  if (parsed.data.taskId !== undefined && !scopedTask) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (scopedTask && scopedTask.ownerAgentId !== agent.id) {
    res.status(403).json({
      error: "Task is not owned by the addressed agent",
    });
    return;
  }

  // Runtime model selection: per-message override wins over the agent's
  // saved default for this single turn only.
  const modelOverride = {
    modelMode: parsed.data.modelMode ?? null,
    modelId: parsed.data.modelId?.trim() ?? null,
  };

  try {
    const result = await runAgentTurn(
      agent,
      parsed.data.content,
      modelOverride,
      scopedTask,
      { runtimeHandle: requireHttpRuntimeHandle() },
    );
    res.json(SendAgentMessageResponse.parse(result));
  } catch (error) {
    if (error instanceof EmergencyStopError) {
      res.status(423).json({
        error:
          "Acil durdurma etkin; yeni ajan sohbeti veya arac calismasi baslatilamaz.",
        code: error.code,
        state: {
          emergencyStopEnabled: true,
          reason: error.state.emergencyStopReason,
          version: error.state.version,
        },
      });
      return;
    }
    if (error instanceof ProjectChatUnavailableError) {
      res.status(409).json({ code: error.code, error: error.message });
      return;
    }
    if (error instanceof AgentBusyError) {
      res
        .status(409)
        .json({ error: "Agent is busy; retry after the active run finishes" });
      return;
    }
    if (error instanceof RuntimeCapacityError) {
      res.status(429).json({
        error: "Ajan mesaj gecmisi kapasitesi dolu.",
        code: error.code,
        kind: error.kind,
        limit: error.limit,
      });
      return;
    }
    if (error instanceof RuntimeClaimAdmissionError) {
      res.status(503).json({
        error:
          "Bu API çalışma örneği yeni sohbet işlemi kabul etmiyor; güvenli bir yeniden deneme yapın.",
        code: "runtime_admission_closed",
      });
      return;
    }
    throw error;
  }
});

const agentMutationError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof AgentConfigChanged) {
    res.status(409).json({ code: error.code, error: error.message });
    return;
  }
  if (error instanceof AgentModelSelectionInvalid) {
    res.status(400).json({
      code: "AGENT_MODEL_INVALID",
      error: "Select a model explicitly for manual mode",
    });
    return;
  }
  if (error instanceof RuntimeCapacityError) {
    res
      .status(429)
      .json({ code: error.code, error: "Active agent capacity is full" });
    return;
  }
  next(error);
};
router.use(agentMutationError);

export default router;
