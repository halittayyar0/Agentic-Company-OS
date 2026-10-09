import { randomUUID } from "node:crypto";
import { PlanInferenceError } from "@workspace/ai-server";
import type {
  ChatGPTRegistration,
  ChatGPTRegistrationStore,
} from "@workspace/ai-server/chatgpt-plan-types";
import { ChatGPTRegistrationConflict } from "./chatgpt-registration-store";

/** Shared encrypted authority for a quota observed by a real inference attempt.
 * Token rotation may advance credential revision while that attempt is running;
 * only an explicit retry advances admission generation and fences old failures. */
export async function recordChatGPTPlanQuota(
  store: ChatGPTRegistrationStore,
  observed: ChatGPTRegistration,
  failure: PlanInferenceError,
  options: { now?: () => number } = {},
): Promise<boolean> {
  if (failure.kind !== "quota" || !failure.requestStarted) return false;
  return store.withRegistrationRefreshLock(observed.id, async (locked) => {
    const current = await locked.readRegistration(observed.id);
    if (
      !current?.credentials ||
      current.accountId !== observed.accountId ||
      current.clientId !== observed.clientId ||
      current.subject !== observed.subject ||
      (current.planAdmissionVersion ?? 0) !==
        (observed.planAdmissionVersion ?? 0)
    )
      return false;
    const now = (options.now ?? Date.now)();
    if (
      current.planPause &&
      (current.planPause.retryAt === null || current.planPause.retryAt > now)
    )
      return true;
    const code =
      failure.code === "subscription_sharing_usage_limit_exceeded" ||
      failure.code === "rate_limit_exceeded"
        ? failure.code
        : null;
    await locked.replaceRegistration(current.revision, {
      ...current,
      planPause: {
        id: randomUUID(),
        code,
        pausedAt: now,
        retryAt: failure.retryAt,
      },
    });
    return true;
  });
}

/** User-visible, revision-bound retry. It clears admission only; it does not
 * start a job, refresh a token, repeat consent or change the billing provider. */
export async function retryChatGPTPlanQuota(
  store: ChatGPTRegistrationStore,
  registrationId: string,
  expectedRevision: number,
  pauseId: string,
) {
  return store.withRegistrationRefreshLock(registrationId, async (locked) => {
    const current = await locked.readRegistration(registrationId);
    if (!current) throw new Error("chatgpt_registration_missing");
    if (
      current.revision !== expectedRevision ||
      !current.planPause ||
      current.planPause.id !== pauseId
    )
      throw new ChatGPTRegistrationConflict();
    if (!current.credentials)
      throw new Error("chatgpt_registration_not_signed_in");
    if (
      !current.credentials.grants.includes("resource.invoke") ||
      !current.credentials.grants.includes("chatgpt.tokens.use.direct")
    )
      throw new PlanInferenceError("permission");
    const version = current.planAdmissionVersion ?? 0;
    if (version >= Number.MAX_SAFE_INTEGER)
      throw new Error("chatgpt_registration_admission_conflict");
    await locked.replaceRegistration(current.revision, {
      ...current,
      planAdmissionVersion: version + 1,
      planPause: null,
    });
    return (await locked.readPublicStatus(registrationId))!;
  });
}
