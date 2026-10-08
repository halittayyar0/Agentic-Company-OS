import { configureChatGPTPlan, PlanInferenceError } from "@workspace/ai-server";
import { recordChatGPTPlanQuota } from "./chatgpt-plan-admission";
import type {
  ChatGPTRegistration,
  ChatGPTRegistrationStore,
} from "@workspace/ai-server/chatgpt-plan-types";
import {
  ChatGPTSessionError,
  type createChatGPTSessionManager,
} from "./chatgpt-session";

/** API and workers resolve the same selected, renewable account on every call.
 * A saved OAuth candidate is never silently selected. Account switches during
 * rotation fence the old result rather than using its credentials on a job. */
interface ChatGPTPlanRuntime {
  store(): Promise<ChatGPTRegistrationStore>;
  sessions(): Promise<
    Pick<ReturnType<typeof createChatGPTSessionManager>, "renewRegistration">
  >;
}
export function createChatGPTPlanAccountResolver(
  runtime: ChatGPTPlanRuntime,
  options: { now?: () => number } = {},
) {
  function assertPlanAdmission(account: ChatGPTRegistration) {
    const pause = account.planPause;
    if (
      pause &&
      (pause.retryAt === null || pause.retryAt > (options.now ?? Date.now)())
    )
      throw new PlanInferenceError(
        "quota",
        null,
        pause.code,
        null,
        null,
        null,
        null,
        pause.retryAt,
        false,
      );
  }
  return async (signal?: AbortSignal): Promise<ChatGPTRegistration | null> => {
    try {
      if (signal?.aborted) throw new PlanInferenceError("cancelled");
      const store = await runtime.store();
      const selected = await store.readActiveRegistration();
      if (!selected?.credentials) return null;
      if (
        !selected.credentials.grants.includes("resource.invoke") ||
        !selected.credentials.grants.includes("chatgpt.tokens.use.direct")
      )
        throw new PlanInferenceError("permission");
      assertPlanAdmission(selected);
      await (
        await runtime.sessions()
      ).renewRegistration(selected.id, { signal });
      const current = await store.readActiveRegistration();
      if (signal?.aborted) throw new PlanInferenceError("cancelled");
      if (
        !current?.credentials ||
        current.id !== selected.id ||
        current.accountId !== selected.accountId ||
        current.clientId !== selected.clientId ||
        !current.credentials.grants.includes("resource.invoke") ||
        !current.credentials.grants.includes("chatgpt.tokens.use.direct")
      )
        throw new PlanInferenceError("account_changed");
      assertPlanAdmission(current);
      return current;
    } catch (error) {
      if (error instanceof PlanInferenceError) throw error;
      if (error instanceof ChatGPTSessionError) {
        const kind =
          error.kind === "sign_in_required"
            ? "sign_in_required"
            : error.kind === "registration_changed"
              ? "account_changed"
              : error.kind === "cancelled"
                ? "cancelled"
                : error.kind === "client_configuration"
                  ? "permission"
                  : "temporary";
        throw new PlanInferenceError(
          kind,
          null,
          null,
          null,
          null,
          null,
          null,
          error.retryAt ?? null,
          false,
        );
      }
      throw new PlanInferenceError(signal?.aborted ? "cancelled" : "temporary");
    }
  };
}

/** Shared by API and worker bootstrap; configuration is lazy and performs no
 * consent or inference. Only explicit work uses the selected renewable account. */
export function configureChatGPTPlanRuntime(
  runtime: ChatGPTPlanRuntime,
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    onQuotaPersistenceFailure?: () => void;
  } = {},
) {
  configureChatGPTPlan({
    resolveAccount: createChatGPTPlanAccountResolver(runtime, options),
    fetch: options.fetch,
    now: options.now,
    recordQuotaFailure: async (observed, failure) => {
      try {
        return await recordChatGPTPlanQuota(
          await runtime.store(),
          observed,
          failure,
          options,
        );
      } catch (error) {
        options.onQuotaPersistenceFailure?.();
        throw error;
      }
    },
  });
}
