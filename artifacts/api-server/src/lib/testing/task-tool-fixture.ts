import { randomUUID } from "node:crypto";
import type { createChatCompletion } from "@workspace/ai-server";

/** Controlled provider preparation, not inference or a permission shortcut.
 * The real outer step consumes this loader response, accounts its reported
 * usage and supplies schemas in its next request before the scenario runs.
 * Exclusive/chat envelopes have no loader and retain their original behavior.
 */
export async function loadFixtureTaskTools(
  params: Parameters<typeof createChatCompletion>[0],
  names: readonly string[],
): Promise<Awaited<ReturnType<typeof createChatCompletion>> | null> {
  const offered = new Set(params.tools?.map((tool) => tool.function.name));
  if (!offered.has("load_tools")) return null;
  const missing = names.filter((name) => !offered.has(name));
  if (missing.length === 0) return null;
  await params.beforeRequest?.();
  return {
    provider: "replit",
    completion: {
      id: randomUUID(),
      object: "chat.completion",
      created: 1,
      model: params.model,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: {
                  name: "load_tools",
                  arguments: JSON.stringify({ names }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  };
}
