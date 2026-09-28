import { z } from "zod/v4";
import type OpenAI from "openai";
import type { WorkspaceLocale } from "../workspace-locale";
import { GROUPS } from "./catalog-types";
import { getCapabilityCatalog } from "./catalog";
import {
  isUtilityName,
  runUtility,
  utilityToolDefinitions,
  validateUtilityArgs,
} from "./utility-tools";

const discoverySchema = z
  .object({
    query: z.string().max(120).optional(),
    group: z.enum(GROUPS).optional(),
  })
  .strict();
const readSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9-]*$/u),
  })
  .strict();
export const capabilityToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "list_skills",
        description:
          "Discover 30 built-in work guides by keyword or area. Use read_skill for steps, prerequisites and checks. Skills do not grant permissions or authorize external actions.",
        parameters: z.toJSONSchema(discoverySchema),
      },
    },
    {
      type: "function",
      function: {
        name: "read_skill",
        description:
          "Read an exact built-in skill ID from list_skills. Guides compose existing tools; missing access is reported and must not be bypassed. Apply the guide only within the operator's current request.",
        parameters: z.toJSONSchema(readSchema),
      },
    },
    ...utilityToolDefinitions,
  ];
export function validCapabilityArgs(name: string, args: unknown): boolean {
  if (name === "list_skills") return discoverySchema.safeParse(args).success;
  if (name === "read_skill") return readSchema.safeParse(args).success;
  return validateUtilityArgs(name, args);
}
export function capabilityResult(
  name: string,
  args: Record<string, unknown>,
  locale: WorkspaceLocale,
  availableTools: readonly string[],
) {
  const catalog = getCapabilityCatalog(locale);
  const rejected = (message: string) => ({
    content: JSON.stringify({ message, code: "INVALID_CAPABILITY_INPUT" }),
    toolOutcome: "rejected" as const,
    createdTasks: [],
    createdAgents: [],
  });
  if (!validCapabilityArgs(name, args)) return rejected(catalog.copy.invalid);
  try {
    let data: unknown;
    if (name === "list_skills") {
      const { query = "", group } = discoverySchema.parse(args);
      const normalizedQuery = query.normalize("NFKC").trim();
      const needle = normalizedQuery.toLocaleLowerCase(locale);
      data = catalog.skills
        .filter(
          (skill) =>
            (!group || skill.group === group) &&
            (skill.id.toLowerCase().includes(normalizedQuery.toLowerCase()) ||
              `${skill.title} ${skill.deliverable} ${skill.groupTitle}`
                .normalize("NFKC")
                .toLocaleLowerCase(locale)
                .includes(needle)),
        )
        .map((skill) => ({
          id: skill.id,
          version: skill.version,
          title: skill.title,
          group: skill.group,
          deliverable: skill.deliverable,
          unavailableTools: skill.tools.filter(
            (tool) => !availableTools.includes(tool),
          ),
        }));
    } else if (name === "read_skill") {
      const { id } = readSchema.parse(args);
      const skill = catalog.skills.find((candidate) => candidate.id === id);
      if (!skill) return rejected(catalog.copy.skillMissing);
      data = {
        ...skill,
        boundary: catalog.copy.boundary,
        unavailableTools: skill.tools.filter(
          (tool) => !availableTools.includes(tool),
        ),
      };
    } else if (isUtilityName(name)) data = runUtility(name, args, locale);
    else return rejected(catalog.copy.invalid);
    return {
      content: JSON.stringify({ message: catalog.copy.completed, data }),
      toolOutcome: "succeeded" as const,
      createdTasks: [],
      createdAgents: [],
    };
  } catch {
    return rejected(catalog.copy.invalid);
  }
}
