import {
  customFetch,
  type ChatGPTAccount,
  type ChatGPTConnection,
  type ChatGPTSignInStart,
  type ChatGPTSignInStatus,
  type BeginChatGPTSignInBody,
} from "@workspace/api-client-react";
import { revision } from "./connection-api";
const root = "/api/connections/chatgpt";
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
    value,
  );
const bounded = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 512;
export function validAccount(value: unknown): value is ChatGPTAccount {
  if (!value || typeof value !== "object") return false;
  const a = value as ChatGPTAccount;
  return (
    uuid(a.id) &&
    bounded(a.accountId) &&
    revision(a.revision) &&
    a.revision > 0 &&
    typeof a.signedIn === "boolean" &&
    typeof a.canUsePlan === "boolean" &&
    (a.expiresAt === null ||
      (Number.isSafeInteger(a.expiresAt) && a.expiresAt > 0)) &&
    (a.email === undefined || bounded(a.email)) &&
    (a.displayName === undefined || bounded(a.displayName))
  );
}
const options = (method: string, body?: unknown) => ({
  method,
  cache: "no-store" as const,
  signal: AbortSignal.timeout(30_000),
  ...(body === undefined
    ? {}
    : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
});
export async function readChatGPTConnection(signal?: AbortSignal) {
  const result = await customFetch<ChatGPTConnection>(root, {
    ...options("GET"),
    ...(signal
      ? { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) }
      : {}),
  });
  if (
    !result ||
    !Array.isArray(result.registrations) ||
    result.registrations.length > 64 ||
    !result.registrations.every(validAccount) ||
    new Set(result.registrations.map((a) => a.id)).size !==
      result.registrations.length ||
    (result.activeRegistrationId !== null &&
      !result.registrations.some((a) => a.id === result.activeRegistrationId))
  )
    throw new Error("Account state unavailable");
  return result;
}
export async function beginChatGPTConnection(body: BeginChatGPTSignInBody) {
  const result = await customFetch<ChatGPTSignInStart>(
    `${root}/sign-in`,
    options("POST", body),
  );
  if (
    !result ||
    !uuid(result.attemptId) ||
    !Number.isSafeInteger(result.expiresAt) ||
    result.expiresAt <= Date.now() ||
    result.expiresAt > Date.now() + 11 * 60_000 ||
    typeof result.authorizeUrl !== "string" ||
    result.authorizeUrl.length > 32768
  )
    throw new Error("Unconfirmed sign-in");
  const url = new URL(result.authorizeUrl);
  if (
    url.origin !== "https://auth.openai.com" ||
    url.pathname !== "/api/accounts/authorize" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Unconfirmed sign-in");
  return result;
}
export async function readChatGPTAttempt(id: string, signal?: AbortSignal) {
  const result = await customFetch<ChatGPTSignInStatus>(
    `${root}/sign-in/${encodeURIComponent(id)}`,
    {
      ...options("GET"),
      ...(signal
        ? { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) }
        : {}),
    },
  );
  const states = [
    "pending",
    "exchanging",
    "review",
    "confirming",
    "connected",
    "denied",
    "cancelled",
    "expired",
    "failed",
  ];
  if (
    !result ||
    result.attemptId !== id ||
    !states.includes(result.state) ||
    !Number.isSafeInteger(result.expiresAt) ||
    (result.state === "review" &&
      (!revision(result.expectedRevision) ||
        !validAccount(result.proposedAccount)))
  )
    throw new Error("Sign-in state unavailable");
  return result;
}
export const cancelChatGPTAttempt = (id: string) =>
  customFetch<void>(
    `${root}/sign-in/${encodeURIComponent(id)}`,
    options("DELETE"),
  );
export async function confirmChatGPTAttempt(
  id: string,
  expectedRevision: number,
  proposed: ChatGPTAccount,
) {
  const result = await customFetch<ChatGPTAccount>(
    `${root}/sign-in/${encodeURIComponent(id)}/confirm`,
    options("POST", { expectedRevision }),
  );
  if (
    !validAccount(result) ||
    result.id !== proposed.id ||
    result.accountId !== proposed.accountId ||
    result.revision !== expectedRevision + 1 ||
    !result.signedIn
  )
    throw new Error("Unconfirmed account save");
  return result;
}
export async function selectChatGPTConnection(account: ChatGPTAccount) {
  const result = await customFetch<ChatGPTAccount>(
    `${root}/accounts/${encodeURIComponent(account.id)}/select`,
    options("POST", { expectedRevision: account.revision }),
  );
  if (
    !validAccount(result) ||
    result.id !== account.id ||
    result.revision !== account.revision ||
    !result.signedIn
  )
    throw new Error("Unconfirmed account selection");
  return result;
}
