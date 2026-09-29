import { z } from "zod/v4";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  capabilityInstallationsTable,
  capabilityPreferencesTable,
  activityEventsTable,
  runtimeControlsTable,
} from "@workspace/db";
import { extensionId, validateExtensionPackage } from "./extension-manifest";
import { isPackTool, runPackTool } from "./pack-tools";
import { isUtilityName, runUtility } from "./utility-tools";
import type { WorkspaceLocale } from "../workspace-locale";
import type { BuiltinSkill } from "./catalog-types";
import { packSchemas } from "./pack-tools";
import { utilityToolDefinitions } from "./utility-tools";
export const PACK_IDS = [
  "data",
  "documents",
  "web",
  "code",
  "planning",
] as const;
const packSchema = z
  .object({
    enabledPacks: z
      .array(z.enum(PACK_IDS))
      .max(5)
      .refine((values) => new Set(values).size === values.length),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
const saveSchema = z
  .object({
    manifest: z.unknown(),
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export class CapabilityConflict extends Error {
  constructor() {
    super("CAPABILITY_REVISION_CONFLICT");
  }
}
export async function listExtensions() {
  const rows = await db
    .select()
    .from(capabilityInstallationsTable)
    .orderBy(capabilityInstallationsTable.id);
  return rows.map((row) => ({
    ...row,
    manifest: validateExtensionPackage(row.manifest),
  }));
}
export async function discoverExtensions(offset = 0) {
  const rows = await listExtensions();
  const items = rows.slice(offset, offset + 3).map((row) => {
    const manifest = row.manifest;
    let parameters: unknown;
    if (manifest.kind === "tool") {
      const builtin = utilityToolDefinitions.find(
        (tool) =>
          tool.type === "function" && tool.function.name === manifest.tool,
      );
      parameters = isPackTool(manifest.tool)
        ? z.toJSONSchema(packSchemas[manifest.tool])
        : builtin?.type === "function"
          ? builtin.function.parameters
          : undefined;
    }
    return {
      revision: row.revision,
      enabled: row.enabled,
      ...manifest,
      ...(parameters ? { parameters } : {}),
      ...(manifest.kind === "program"
        ? {
            invocation: {
              tool: "vm_run_command",
              commandTemplate: `extension ${row.id}@${row.revision} {"input":"replace with the documented JSON object"}`,
              permission: "terminal",
              approval:
                "Exact one-use approval; full-access policy can authorize eligible queued actions.",
            },
          }
        : {}),
    };
  });
  return {
    items,
    nextOffset:
      offset + items.length < rows.length ? offset + items.length : null,
  };
}
export async function personalSkillGuides(
  locale: WorkspaceLocale = "en",
): Promise<BuiltinSkill[]> {
  return (await listExtensions()).flatMap((row) =>
    row.enabled && row.manifest.kind === "skill"
      ? [
          {
            id: row.id,
            version: row.revision,
            group: "operations" as const,
            groupTitle: {
              tr: "Kişisel",
              en: "Personal",
              de: "Persönlich",
              ru: "Личные",
              "zh-CN": "个人",
              "zh-TW": "個人",
              ar: "شخصية",
            }[locale],
            title: row.manifest.title,
            deliverable: row.manifest.description,
            inputs: [],
            steps: [row.manifest.instructions],
            checks: [],
            tools: [],
            permissions: [],
          },
        ]
      : [],
  );
}
export async function saveExtension(input: unknown) {
  const body = saveSchema.parse(input),
    manifest = validateExtensionPackage(body.manifest);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${runtimeControlsTable} WHERE id = 1 FOR UPDATE`,
    );
    const [existing] = await tx
      .select()
      .from(capabilityInstallationsTable)
      .where(eq(capabilityInstallationsTable.id, manifest.id));
    if ((existing?.revision ?? 0) !== body.expectedRevision)
      throw new CapabilityConflict();
    if (
      !existing &&
      (
        await tx
          .select({ id: capabilityInstallationsTable.id })
          .from(capabilityInstallationsTable)
          .limit(100)
      ).length >= 100
    )
      throw new Error("EXTENSION_CAPACITY_REACHED");
    const [saved] = existing
      ? await tx
          .update(capabilityInstallationsTable)
          .set({
            manifest,
            enabled: body.enabled,
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(capabilityInstallationsTable.id, manifest.id))
          .returning()
      : await tx
          .insert(capabilityInstallationsTable)
          .values({ id: manifest.id, manifest, enabled: body.enabled })
          .returning();
    await tx.insert(activityEventsTable).values({
      type: "operations_changed",
      summary: "Operator saved a personal capability",
      severity: "info",
      detail: {
        kind: "capability_saved",
        id: saved.id,
        revision: saved.revision,
        enabled: saved.enabled,
      },
    });
    return { ...saved, manifest };
  });
}
export async function exportExtension(id: string) {
  extensionId.parse(id);
  const [row] = await db
    .select()
    .from(capabilityInstallationsTable)
    .where(eq(capabilityInstallationsTable.id, id));
  if (!row) throw new Error("EXTENSION_MISSING");
  return validateExtensionPackage(row.manifest);
}
export async function readCapabilityPacks() {
  const [row] = await db
    .select()
    .from(capabilityPreferencesTable)
    .where(eq(capabilityPreferencesTable.id, 1));
  if (!row) throw new Error("CAPABILITY_SETTINGS_MISSING");
  return row;
}
export async function setCapabilityPacks(input: unknown) {
  const body = packSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${runtimeControlsTable} WHERE id = 1 FOR UPDATE`,
    );
    const [saved] = await tx
      .update(capabilityPreferencesTable)
      .set({
        enabledPacks: body.enabledPacks,
        revision: sql`${capabilityPreferencesTable.revision}+1`,
      })
      .where(
        and(
          eq(capabilityPreferencesTable.id, 1),
          eq(capabilityPreferencesTable.revision, body.expectedRevision),
        ),
      )
      .returning();
    if (!saved) throw new CapabilityConflict();
    await tx.insert(activityEventsTable).values({
      type: "operations_changed",
      summary: "Operator changed enabled tool packs",
      severity: "info",
      detail: {
        kind: "capability_packs_changed",
        enabledPacks: saved.enabledPacks,
        revision: saved.revision,
      },
    });
    return saved;
  });
}
export function toolPack(name: string): (typeof PACK_IDS)[number] | null {
  if (
    name.startsWith("csv_") ||
    name.startsWith("json_") ||
    ["compare_lists", "convert_units"].includes(name)
  )
    return "data";
  if (name === "date_interval") return "planning";
  if (
    [
      "render_report",
      "fill_template",
      "markdown_outline",
      "markdown_table",
      "text_find",
      "text_replace",
    ].includes(name)
  )
    return "documents";
  if (name === "compare_page_text") return "web";
  return null;
}
export async function assertPackEnabled(name: string) {
  const pack = toolPack(name);
  if (pack && !(await readCapabilityPacks()).enabledPacks.includes(pack))
    throw new Error("CAPABILITY_PACK_DISABLED");
}
export async function executeInstalledTool(
  id: string,
  args: Record<string, unknown>,
  locale: WorkspaceLocale,
) {
  extensionId.parse(id);
  const [row] = await db
    .select()
    .from(capabilityInstallationsTable)
    .where(eq(capabilityInstallationsTable.id, id));
  if (!row?.enabled) throw new Error("EXTENSION_DISABLED");
  const manifest = validateExtensionPackage(row.manifest);
  if (manifest.kind !== "tool") throw new Error("EXTENSION_NOT_EXECUTABLE");
  if (JSON.stringify(args).length > 48000)
    throw new Error("EXTENSION_INPUT_TOO_LARGE");
  for (const [key, value] of Object.entries(manifest.defaults))
    if (
      Object.hasOwn(args, key) &&
      JSON.stringify(args[key]) !== JSON.stringify(value)
    )
      throw new Error("EXTENSION_FIXED_ARGUMENT");
  const merged = { ...args, ...manifest.defaults };
  await assertPackEnabled(manifest.tool);
  if (isPackTool(manifest.tool)) return runPackTool(manifest.tool, merged);
  if (isUtilityName(manifest.tool))
    return runUtility(manifest.tool, merged, locale) as Record<string, unknown>;
  throw new Error("EXTENSION_TOOL_UNAVAILABLE");
}
