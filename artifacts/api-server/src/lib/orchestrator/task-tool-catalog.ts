import type OpenAI from "openai";

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;
const CORE = new Set([
  "calculate",
  "complete_task",
  "request_user_input",
  "update_task_progress",
  "list_skills",
  "read_skill",
  "request_approval",
]);
const loader: Tool = {
  type: "function",
  function: {
    name: "load_tools",
    description:
      "Load up to eight tools from the available tool index for subsequent calls. This does not execute them or change permissions.",
    parameters: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 8,
        },
      },
      required: ["names"],
      additionalProperties: false,
    },
  },
};

export function createTaskToolCatalog(authorized: Tool[]) {
  const byName = new Map(authorized.map((tool) => [tool.function.name, tool]));
  const core = authorized.filter((tool) => CORE.has(tool.function.name));
  let selected: Tool[] = [];
  return {
    get tools(): Tool[] {
      return [...core, ...selected, loader];
    },
    index:
      "Additional authorized tools (call load_tools with names before use):\n" +
      authorized
        .filter((tool) => !CORE.has(tool.function.name))
        .map(
          (tool) =>
            `${tool.function.name}: ${(tool.function.description ?? "").replace(/\s+/g, " ").slice(0, 100)}`,
        )
        .join("\n"),
    load(raw: string): string {
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        throw new Error("Expected a JSON object with names.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Expected an object.");
      const names = (input as { names?: unknown }).names;
      if (
        !Array.isArray(names) ||
        names.length < 1 ||
        names.length > 8 ||
        names.some((name) => typeof name !== "string" || !byName.has(name)) ||
        Object.keys(input).some((key) => key !== "names")
      )
        throw new Error("Choose 1–8 names from the authorized tool index.");
      selected = [...new Set(names as string[])]
        .filter((name) => !CORE.has(name))
        .map((name) => byName.get(name)!);
      return `Tools available on the next call: ${[...core, ...selected].map((tool) => tool.function.name).join(", ")}. Previous optional tools are replaced; load them again if needed.`;
    },
  };
}
