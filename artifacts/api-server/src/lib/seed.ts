import { and, eq, isNull, ne } from "drizzle-orm";
import {
  agentsTable,
  companyChannelMembersTable,
  companyChannelsTable,
  db,
} from "@workspace/db";
import { getLocalizedAgentTemplates } from "./agent-template-localization";
import type { AgentTemplateDefinition } from "./agent-templates";
import type { WorkspaceLocale } from "./workspace-locale";
import { avatarColorFor } from "./orchestrator/avatar-color";
import { logger } from "./logger";

/**
 * Keeps stock prompts current without overwriting user-authored prompts.
 * This makes prompt improvements available to existing installations at the
 * next startup while preserving every agent marked isCustomPrompt=true.
 */
async function syncDefaultTemplatePrompts(
  templates: AgentTemplateDefinition[],
): Promise<number> {
  let updatedCount = 0;

  for (const template of templates) {
    const updated = await db
      .update(agentsTable)
      .set({ systemPrompt: template.defaultSystemPrompt })
      .where(
        and(
          eq(agentsTable.isCustomPrompt, false),
          eq(agentsTable.templateKey, template.key),
          ne(agentsTable.systemPrompt, template.defaultSystemPrompt),
        ),
      )
      .returning({ id: agentsTable.id });
    updatedCount += updated.length;
  }

  return updatedCount;
}

/**
 * JSON permission records created before canUseSudo existed do not receive a
 * PostgreSQL column default retroactively. Add the missing capability once,
 * granting it only to the stock CEO template and preserving every explicit
 * value on subsequent starts.
 */
async function backfillSudoPermissions(): Promise<number> {
  const agents = await db
    .select({
      id: agentsTable.id,
      isRootCeo: agentsTable.isRootCeo,
      permissions: agentsTable.permissions,
    })
    .from(agentsTable);
  let updatedCount = 0;

  for (const agent of agents) {
    if (typeof agent.permissions.canUseSudo === "boolean") continue;
    const updated = await db
      .update(agentsTable)
      .set({
        permissions: {
          ...agent.permissions,
          canUseSudo: agent.isRootCeo,
        },
      })
      .where(eq(agentsTable.id, agent.id))
      .returning({ id: agentsTable.id });
    updatedCount += updated.length;
  }

  return updatedCount;
}

/**
 * Marks at most one pre-existing canonical stock root CEO. The partial unique
 * index enforces singularity, while structural checks remain mandatory at
 * every use. This is only a compatibility path for databases predating the
 * server-managed identity column.
 */
async function ensureCanonicalRootCeo(): Promise<number> {
  const marked = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.isRootCeo, true))
    .orderBy(agentsTable.id)
    .limit(2);
  if (marked.length > 1) {
    logger.error(
      { markedIds: marked.map((agent) => agent.id) },
      "Multiple root CEO markers detected; sudo authority fails closed",
    );
    return 0;
  }
  if (marked.length === 1) return 0;

  const candidates = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.depth, 0),
        isNull(agentsTable.parentAgentId),
        eq(agentsTable.templateKey, "ceo"),
      ),
    )
    .orderBy(agentsTable.id)
    .limit(2);
  if (candidates.length !== 1) {
    if (candidates.length > 1) {
      logger.error(
        { candidateIds: candidates.map((candidate) => candidate.id) },
        "Multiple structural root CEO candidates; sudo authority remains disabled",
      );
    }
    return 0;
  }

  const updated = await db
    .update(agentsTable)
    .set({ isRootCeo: true })
    .where(eq(agentsTable.id, candidates[0].id))
    .returning({ id: agentsTable.id });
  return updated.length;
}

/**
 * Seeds the default org chart (CEO + department directors) the first time
 * the server starts against an empty agents table. Existing stock agents have
 * their prompts synchronized before the idempotent early return.
 */
export async function seedDefaultOrg(
  locale: WorkspaceLocale = "tr",
  options?: { syntheticAgentCount: number },
): Promise<void> {
  const templates = getLocalizedAgentTemplates(locale);
  const availableDirectors = templates.filter(
    (template) => template.key !== "ceo" && template.key !== "specialist",
  );
  // Endurance evidence needs a fixed cohort independent of catalog additions.
  // Only the validated synthetic runtime supplies this option. Ordinary
  // installations keep the complete stock roster and all specialist templates.
  const syntheticCount = options?.syntheticAgentCount;
  if (syntheticCount !== undefined) {
    if (
      !Number.isSafeInteger(syntheticCount) ||
      syntheticCount < 2 ||
      syntheticCount > availableDirectors.length + 1
    ) {
      throw new Error(
        "Synthetic agent count must fit the available stock roster.",
      );
    }
    const existing = await db.select({ id: agentsTable.id }).from(agentsTable);
    if (existing.length !== 0 && existing.length !== syntheticCount) {
      throw new Error(
        "Existing synthetic roster does not match the requested agent count.",
      );
    }
  }
  const rootCeoIdentityCount = await ensureCanonicalRootCeo();
  const backfilledSudoPermissionCount = await backfillSudoPermissions();
  const refreshedPromptCount = await syncDefaultTemplatePrompts(templates);
  const [existingCeo] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.depth, 0));

  if (existingCeo) {
    if (refreshedPromptCount > 0) {
      logger.info(
        {
          refreshedPromptCount,
          backfilledSudoPermissionCount,
          rootCeoIdentityCount,
        },
        "Refreshed stock agent configuration",
      );
    } else if (backfilledSudoPermissionCount > 0 || rootCeoIdentityCount > 0) {
      logger.info(
        { backfilledSudoPermissionCount, rootCeoIdentityCount },
        "Backfilled stock root CEO authority",
      );
    }
    return;
  }

  const ceoTemplate = templates.find((t) => t.key === "ceo");
  if (!ceoTemplate) throw new Error("CEO template missing");

  const [ceo] = await db
    .insert(agentsTable)
    .values({
      name: ceoTemplate.name,
      role: ceoTemplate.defaultRole,
      department: ceoTemplate.department,
      parentAgentId: null,
      depth: 0,
      status: "idle",
      systemPrompt: ceoTemplate.defaultSystemPrompt,
      isCustomPrompt: false,
      templateKey: ceoTemplate.key,
      isRootCeo: true,
      modelMode: "auto",
      modelId: null,
      avatarColor: avatarColorFor(ceoTemplate.key),
      permissions: ceoTemplate.defaultPermissions,
      createdByAgentId: null,
      createdByUser: true,
      isActive: true,
    })
    .returning();

  const directorTemplates =
    syntheticCount === undefined
      ? availableDirectors
      : availableDirectors.slice(0, syntheticCount - 1);

  for (const template of directorTemplates) {
    await db.insert(agentsTable).values({
      name: template.name,
      role: template.defaultRole,
      department: template.department,
      parentAgentId: ceo.id,
      depth: 1,
      status: "idle",
      systemPrompt: template.defaultSystemPrompt,
      isCustomPrompt: false,
      templateKey: template.key,
      modelMode: "auto",
      modelId: null,
      avatarColor: avatarColorFor(template.key),
      permissions: template.defaultPermissions,
      createdByAgentId: ceo.id,
      createdByUser: false,
      isActive: true,
    });
  }

  // A brand-new database applies migrations before the stock organization is
  // seeded, so the migration backfill has no rows to copy. Enroll this initial
  // roster once; later user removals remain durable and are never re-added on
  // restart.
  await db
    .insert(companyChannelsTable)
    .values({ key: "company", name: "Ortak Şirket Chat" })
    .onConflictDoNothing({ target: companyChannelsTable.key });
  const [companyChannel] = await db
    .select({ id: companyChannelsTable.id })
    .from(companyChannelsTable)
    .where(eq(companyChannelsTable.key, "company"));
  const activeAgents = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.isActive, true));
  if (companyChannel && activeAgents.length > 0) {
    await db
      .insert(companyChannelMembersTable)
      .values(
        activeAgents.map((agent) => ({
          channelId: companyChannel.id,
          agentId: agent.id,
        })),
      )
      .onConflictDoNothing();
  }

  logger.info(
    {
      ceoId: ceo.id,
      directorCount: directorTemplates.length,
      refreshedPromptCount,
      backfilledSudoPermissionCount,
      rootCeoIdentityCount,
    },
    "Seeded default org chart",
  );
}
