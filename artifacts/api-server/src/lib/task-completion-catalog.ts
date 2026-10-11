import type OpenAI from "openai";
import { parseCompletionRequirements } from "@workspace/db/completion-requirements";

export function eligibleCompletionToolNames(
  tools: readonly OpenAI.Chat.Completions.ChatCompletionTool[],
): string[] {
  const occurrences = new Map<string, number>();
  for (const tool of tools) {
    if (tool.type !== "function") continue;
    const name = tool.function.name;
    try {
      parseCompletionRequirements([{ kind: "tool_succeeded", tool: name }]);
      occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
    } catch {
      // A malformed or non-output definition cannot become an executable
      // completion condition. Do not forward its description or schema.
    }
  }
  return [...occurrences]
    .filter(([, count]) => count === 1)
    .map(([name]) => name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
