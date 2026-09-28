import { createHash } from "node:crypto";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  buildSyntheticFixtureArguments,
  resolveSyntheticFault,
  type SyntheticFaultPlan,
  type SyntheticFaultSource,
  type SyntheticStepIdentity,
} from "./synthetic-fault-plan";

export const SYNTHETIC_FIXTURE_TOOL_NAME = "synthetic_fixture_write";

export interface SyntheticDelegation {
  agentId: number;
}

export interface SyntheticCompletionOptions {
  runId: string;
  seed: number;
  identity: SyntheticStepIdentity;
  faultPlan: SyntheticFaultPlan;
  faultSource?: SyntheticFaultSource;
  delegations?: ReadonlyArray<SyntheticDelegation>;
}

export function syntheticResponsibilityTitle(
  runId: string,
  agentId: number,
): string {
  return `Endurance ${runId} · ajan ${agentId}`.slice(0, 240);
}

export class SyntheticRateLimitError extends Error {
  readonly status = 429;
  readonly code = "SYNTHETIC_RATE_LIMIT";

  constructor() {
    super("Synthetic provider rate limit");
    this.name = "SyntheticRateLimitError";
  }
}

export class SyntheticCompletionTimeoutError extends Error {
  readonly status = 408;
  readonly code = "LLM_REQUEST_TIMEOUT";

  constructor() {
    super("Synthetic completion timeout");
    this.name = "SyntheticCompletionTimeoutError";
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was aborted", "AbortError");
}

async function waitForSyntheticTimeout(
  delayMs: number,
  signal?: AbortSignal,
): Promise<never> {
  if (signal?.aborted) throw abortError(signal);
  return new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        reject(new SyntheticCompletionTimeoutError());
      },
      Math.max(1, delayMs),
    );
    timer.unref?.();
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function deterministicCompletion(
  options: SyntheticCompletionOptions,
  model: string,
): Awaited<ReturnType<typeof createChatCompletion>> {
  const fixture = buildSyntheticFixtureArguments(options);
  const digest = fixture.operationKey.slice("synthetic:v1:".length);
  const promptTokens = 24 + (Number.parseInt(digest.slice(0, 2), 16) % 17);
  const completionTokens = 12 + (Number.parseInt(digest.slice(2, 4), 16) % 11);
  return {
    provider: "ollama",
    completion: {
      id: `synthetic-completion-${digest.slice(0, 24)}`,
      object: "chat.completion",
      created: 1_700_000_000 + Number.parseInt(digest.slice(4, 10), 16),
      model,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content: `Synthetic work unit ${digest.slice(0, 16)} is ready.`,
            refusal: null,
            tool_calls: [
              {
                id: `synthetic-call-${digest.slice(0, 24)}`,
                type: "function",
                function: {
                  name: SYNTHETIC_FIXTURE_TOOL_NAME,
                  arguments: JSON.stringify(fixture),
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    },
  };
}

function delegatedAgentIds(messages: readonly unknown[]): Set<number> {
  const delegated = new Set<number>();
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const call of toolCalls) {
      if (!call || typeof call !== "object") continue;
      const fn = (call as { function?: unknown }).function;
      if (!fn || typeof fn !== "object") continue;
      const record = fn as { name?: unknown; arguments?: unknown };
      if (
        record.name !== "delegate_task" ||
        typeof record.arguments !== "string"
      ) {
        continue;
      }
      try {
        const args = JSON.parse(record.arguments) as { agentId?: unknown };
        if (Number.isSafeInteger(args.agentId) && Number(args.agentId) > 0) {
          delegated.add(Number(args.agentId));
        }
      } catch {
        // A malformed historic call cannot authorize or suppress delegation.
      }
    }
  }
  return delegated;
}

function delegationCompletion(
  options: SyntheticCompletionOptions,
  model: string,
  messages: readonly unknown[],
): Awaited<ReturnType<typeof createChatCompletion>> | null {
  const alreadyDelegated = delegatedAgentIds(messages);
  const pending = [...(options.delegations ?? [])]
    .filter(
      (delegation) =>
        Number.isSafeInteger(delegation.agentId) &&
        delegation.agentId > 0 &&
        !alreadyDelegated.has(delegation.agentId),
    )
    .sort((left, right) => left.agentId - right.agentId)
    .slice(0, 8);
  if (pending.length === 0) return null;
  const fixture = buildSyntheticFixtureArguments(options);
  const digest = fixture.operationKey.slice("synthetic:v1:".length);
  const promptTokens = 24 + (Number.parseInt(digest.slice(0, 2), 16) % 17);
  const completionTokens = 12 + pending.length * 4;
  return {
    provider: "ollama",
    completion: {
      id: `synthetic-delegation-${digest.slice(0, 24)}-${pending[0]!.agentId}`,
      object: "chat.completion",
      created: 1_700_000_000 + Number.parseInt(digest.slice(4, 10), 16),
      model,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content:
              "Project responsibilities are being assigned deterministically.",
            refusal: null,
            tool_calls: pending.map((delegation) => ({
              id: `synthetic-delegate-${digest.slice(0, 16)}-${delegation.agentId}`,
              type: "function" as const,
              function: {
                name: "delegate_task",
                arguments: JSON.stringify({
                  agentId: delegation.agentId,
                  title: syntheticResponsibilityTitle(
                    options.runId,
                    delegation.agentId,
                  ),
                  brief: `Run ${options.runId} için dakikalık kalıcı sentetik sorumluluğu güvenli biçimde sürdür.`,
                  priority: "normal",
                  autonomyMode: "continuous",
                  cadenceSeconds: 60,
                }),
              },
            })),
          },
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    },
  };
}

function malformedCompletion(
  options: SyntheticCompletionOptions,
  model: string,
): Awaited<ReturnType<typeof createChatCompletion>> {
  const digest = createHash("sha256")
    .update(
      `${options.seed}:${options.identity.taskId}:${options.identity.attemptNumber}:${options.identity.step}`,
      "utf8",
    )
    .digest("hex");
  return {
    provider: "ollama",
    completion: {
      id: `synthetic-malformed-${digest.slice(0, 24)}`,
      object: "chat.completion",
      created: 1_700_000_000 + Number.parseInt(digest.slice(0, 6), 16),
      model,
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    },
  };
}

export function createSyntheticCompletion(
  options: SyntheticCompletionOptions,
): typeof createChatCompletion {
  return async (params) => {
    const fault = options.faultSource
      ? await options.faultSource.resolve(options.identity)
      : resolveSyntheticFault(options.faultPlan, options.identity);
    if (fault.outcome === "timeout") {
      return waitForSyntheticTimeout(fault.delayMs ?? 5_000, params.signal);
    }
    if (fault.outcome === "rate_limit") {
      throw new SyntheticRateLimitError();
    }
    if (fault.outcome === "malformed") {
      return malformedCompletion(options, params.model);
    }
    const delegation = delegationCompletion(
      options,
      params.model,
      params.messages,
    );
    if (delegation) return delegation;
    return deterministicCompletion(options, params.model);
  };
}
