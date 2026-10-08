import type { ChatGPTRegistration } from "./chatgpt-plan-types";
import type { ModelCatalogEntry } from "./model-router";
import type {
  UnifiedChatCompletionParams,
  UnifiedCompletion,
} from "./openrouter";
import {
  completeChatGPTPlanResponse,
  chatGPTPlanRequestId,
  listChatGPTPlanModels,
  PlanInferenceError,
} from "./chatgpt-plan-responses";

interface Configuration {
  /** Backend-owned authority, including renewal. No browser tokens or API keys. */
  resolveAccount(signal?: AbortSignal): Promise<ChatGPTRegistration | null>;
  /** Persist a real quota failure in the shared backend authority. False fences
   * a stale attempt after an explicit retry or sign-out. Never accepts tokens
   * from the browser and never repeats inference. */
  recordQuotaFailure?(
    account: ChatGPTRegistration,
    failure: PlanInferenceError,
  ): Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => number;
}
export interface ChatGPTPlanCatalogSnapshot {
  available: boolean;
  models: ModelCatalogEntry[];
  fetchedAt: number | null;
  errorKind: PlanInferenceError["kind"] | null;
  paused: {
    kind: PlanInferenceError["kind"];
    code: string | null;
    retryAt: number | null;
  } | null;
}
const CATALOG_TTL_MS = 5 * 60_000;
const CATALOG_RETRY_MS = 15_000;
function key(account: ChatGPTRegistration | null): string | null {
  return account?.credentials
    ? `${account.id}:${account.accountId}:${account.clientId}:${account.planAdmissionVersion ?? 0}`
    : null;
}
function canUsePlan(account: ChatGPTRegistration | null, now: number): boolean {
  return (
    !!account?.credentials &&
    account.credentials.expiresAt > now &&
    account.credentials.grants.includes("resource.invoke") &&
    account.credentials.grants.includes("chatgpt.tokens.use.direct")
  );
}
function createProvider(configuration: Configuration) {
  const now = configuration.now ?? Date.now;
  let generation = 0,
    lookupSequence = 0;
  let selectedKey: string | null = null,
    available = false,
    fetchedAt: number | null = null,
    lastAttemptAt = 0;
  let models: ModelCatalogEntry[] = [],
    errorKind: PlanInferenceError["kind"] | null = null;
  let pause: PlanInferenceError | null = null;
  let discovery: { generation: number; promise: Promise<void> } | null = null;
  let invalidated = false;

  function adopt(account: ChatGPTRegistration | null) {
    const nextKey = key(account),
      nextAvailable = canUsePlan(account, now());
    if (nextKey !== selectedKey || nextAvailable !== available) {
      selectedKey = nextKey;
      available = nextAvailable;
      generation++;
      models = [];
      fetchedAt = null;
      lastAttemptAt = 0;
      errorKind = null;
      pause = null;
      discovery = null;
    }
  }
  async function resolve(
    signal?: AbortSignal,
  ): Promise<ChatGPTRegistration | null> {
    if (invalidated) throw new PlanInferenceError("account_changed");
    const controller = new AbortController(),
      bounded = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;
    const timer = setTimeout(() => controller.abort(), 10_000);
    let remove = () => {};
    const abort = new Promise<never>((_resolve, reject) => {
      const stop = () =>
        reject(
          new PlanInferenceError(signal?.aborted ? "cancelled" : "timeout"),
        );
      if (bounded.aborted) stop();
      else {
        bounded.addEventListener("abort", stop, { once: true });
        remove = () => bounded.removeEventListener("abort", stop);
      }
    });
    try {
      if (bounded.aborted) return await abort;
      const account = await Promise.race([
        configuration.resolveAccount(bounded),
        abort,
      ]);
      if (invalidated) throw new PlanInferenceError("account_changed");
      return account;
    } catch (error) {
      if (error instanceof PlanInferenceError) throw error;
      throw new PlanInferenceError("temporary");
    } finally {
      clearTimeout(timer);
      remove();
    }
  }
  async function discover(
    account: ChatGPTRegistration,
    force = false,
    signal?: AbortSignal,
  ) {
    adopt(account);
    if (!available) throw new PlanInferenceError("permission");
    if (!force && fetchedAt !== null && now() - fetchedAt < CATALOG_TTL_MS)
      return;
    if (discovery?.generation === generation) return discovery.promise;
    if (
      !force &&
      lastAttemptAt > 0 &&
      now() - lastAttemptAt < CATALOG_RETRY_MS &&
      errorKind
    )
      throw new PlanInferenceError(errorKind);
    const capturedGeneration = generation;
    lastAttemptAt = now();
    const promise = (async () => {
      try {
        const choices = await listChatGPTPlanModels(account, {
          ...configuration,
          signal,
        });
        if (invalidated || capturedGeneration !== generation) return;
        // Preserve account-specific server order; no guessed prices or tiers.
        models = choices.map((choice) => ({
          ...choice,
          tier: "standard",
          supportsTools: true,
          description:
            "Uses the selected ChatGPT account and its granted plan permission.",
        }));
        fetchedAt = now();
        errorKind = null;
      } catch (error) {
        if (invalidated || capturedGeneration !== generation) return;
        const failure =
          error instanceof PlanInferenceError
            ? error
            : new PlanInferenceError("temporary");
        models = [];
        fetchedAt = null;
        errorKind = failure.kind;
        throw failure;
      } finally {
        if (discovery?.generation === capturedGeneration) discovery = null;
      }
    })();
    discovery = { generation: capturedGeneration, promise };
    return promise;
  }
  return {
    invalidate() {
      invalidated = true;
      generation++;
      models = [];
      pause = null;
    },
    retry() {
      pause = null;
      fetchedAt = null;
      lastAttemptAt = 0;
      errorKind = null;
    },
    snapshot(): ChatGPTPlanCatalogSnapshot {
      return {
        available,
        models: models.map((model) => ({ ...model })),
        fetchedAt,
        errorKind,
        paused: pause
          ? { kind: pause.kind, code: pause.code, retryAt: pause.retryAt }
          : null,
      };
    },
    async refresh(force = false): Promise<void> {
      const sequence = ++lookupSequence;
      try {
        const account = await resolve();
        if (sequence !== lookupSequence || invalidated) return;
        adopt(account);
        if (!account || !available) return;
        await discover(account, force);
      } catch (error) {
        if (sequence !== lookupSequence || invalidated) return;
        models = [];
        fetchedAt = null;
        available = false;
        errorKind =
          error instanceof PlanInferenceError ? error.kind : "temporary";
      }
    },
    async complete(
      params: UnifiedChatCompletionParams,
      timeoutMs: number,
    ): Promise<UnifiedCompletion> {
      const account = await resolve(params.signal);
      adopt(account);
      if (!account?.credentials)
        throw new PlanInferenceError("sign_in_required");
      if (!available) throw new PlanInferenceError("permission");
      const capturedKey = key(account),
        capturedGeneration = generation;
      if (pause) {
        if (pause.retryAt !== null && now() >= pause.retryAt) pause = null;
        else
          throw new PlanInferenceError(
            pause.kind,
            null,
            pause.code,
            pause.status,
            pause.requestId,
            pause.bodyShape,
            pause.param,
            pause.retryAt,
            false,
          );
      }
      await discover(account, false, params.signal);
      if (!models.some((model) => model.id === params.model))
        throw new PlanInferenceError("unsupported");
      const current = await resolve(params.signal);
      if (
        invalidated ||
        key(current) !== capturedKey ||
        generation !== capturedGeneration ||
        !canUsePlan(current, now())
      )
        throw new PlanInferenceError("account_changed");
      let completion: UnifiedCompletion | undefined;
      try {
        completion = await completeChatGPTPlanResponse(params, current!, {
          ...configuration,
          timeoutMs,
        });
        const after = await resolve(params.signal);
        if (key(after) !== capturedKey || !canUsePlan(after, now())) {
          adopt(after);
          throw new PlanInferenceError(
            "account_changed",
            completion.usage ?? null,
          );
        }
        return completion;
      } catch (error) {
        let failure =
          error instanceof PlanInferenceError
            ? error
            : new PlanInferenceError("temporary");
        if (completion)
          failure = new PlanInferenceError(
            failure.kind,
            failure.usage ?? completion.usage ?? null,
            failure.code,
            failure.status,
            failure.requestId ?? chatGPTPlanRequestId(completion),
            failure.bodyShape,
            failure.param,
            failure.retryAt,
            true,
          );
        // Unknown quota reset stays unknown. Only explicit retry, a different
        // account or an actual Retry-After permits another plan inference.
        let sharedPause = true;
        if (
          failure.kind === "quota" &&
          failure.requestStarted &&
          configuration.recordQuotaFailure
        ) {
          try {
            sharedPause = await configuration.recordQuotaFailure(
              account,
              failure,
            );
          } catch {
            // Keep the original actual/unknown usage and local admission pause.
            // The backend callback owns a safe storage diagnostic. Do not turn
            // a storage error into an inference retry or a fabricated receipt.
          }
        }
        if (
          failure.kind === "quota" &&
          sharedPause &&
          selectedKey === capturedKey &&
          generation === capturedGeneration
        )
          pause = new PlanInferenceError(
            failure.kind,
            null,
            failure.code,
            failure.status,
            failure.requestId,
            failure.bodyShape,
            failure.param,
            failure.retryAt,
          );
        throw failure;
      }
    },
  };
}
let provider: ReturnType<typeof createProvider> | null = null;
export function configureChatGPTPlan(
  configuration: Configuration | null,
): void {
  provider?.invalidate();
  provider = configuration ? createProvider(configuration) : null;
}
export function getChatGPTPlanCatalogSnapshot(): ChatGPTPlanCatalogSnapshot {
  return (
    provider?.snapshot() ?? {
      available: false,
      models: [],
      fetchedAt: null,
      errorKind: null,
      paused: null,
    }
  );
}
export function isChatGPTPlanConfigured(): boolean {
  return getChatGPTPlanCatalogSnapshot().available;
}
export async function refreshChatGPTPlanCatalog(force = false): Promise<void> {
  await provider?.refresh(force);
}
export function retryChatGPTPlanConnection(): void {
  provider?.retry();
}
export async function createChatGPTPlanCompletion(
  params: UnifiedChatCompletionParams,
  timeoutMs: number,
): Promise<UnifiedCompletion> {
  if (!provider) throw new PlanInferenceError("sign_in_required");
  return provider.complete(params, timeoutMs);
}
