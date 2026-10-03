import { setTimeout as delay } from "node:timers/promises";
import type {
  ChatGPTRegistration,
  ChatGPTRegistrationStore,
} from "@workspace/ai-server/chatgpt-plan-types";
import {
  CHATGPT_ISSUER,
  createChatGPTIdentityVerifier,
} from "./chatgpt-identity";
import {
  CHATGPT_RESOURCE,
  ChatGPTAuthorizationError,
  parseChatGPTTokenCredentials,
  readChatGPTOAuthBody,
  requestChatGPTToken,
} from "./chatgpt-sign-in";

export type ChatGPTSessionFailureKind =
  | "temporary"
  | "sign_in_required"
  | "refresh_unconfirmed"
  | "refresh_deferred"
  | "registration_changed"
  | "cancelled"
  | "client_configuration";
export class ChatGPTSessionError extends Error {
  constructor(
    readonly kind: ChatGPTSessionFailureKind,
    readonly retryAt?: number,
  ) {
    super(`chatgpt_session_${kind}`);
    this.name = "ChatGPTSessionError";
  }
}

/** Every installed process joins the same durable registration authority. */
export function createChatGPTSessionManager(options: {
  store: ChatGPTRegistrationStore;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const store = options.store,
    request = options.fetch ?? globalThis.fetch,
    now = options.now ?? Date.now;
  const verifyIdentity = createChatGPTIdentityVerifier({ fetch: request, now });

  async function revocationEndpoint(signal?: AbortSignal): Promise<string> {
    const response = await request(
      `${CHATGPT_ISSUER}/.well-known/openid-configuration`,
      {
        headers: { Accept: "application/json" },
        redirect: "error",
        credentials: "omit",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ChatGPTSessionError("temporary");
    }
    const metadata = await readChatGPTOAuthBody(response);
    if (
      metadata.issuer !== CHATGPT_ISSUER ||
      typeof metadata.revocation_endpoint !== "string" ||
      metadata.revocation_endpoint.length > 2048
    )
      throw new ChatGPTSessionError("temporary");
    const endpoint = new URL(metadata.revocation_endpoint);
    if (
      endpoint.origin !== CHATGPT_ISSUER ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new ChatGPTSessionError("temporary");
    return endpoint.toString();
  }

  async function revoke(
    endpoint: string,
    registration: ChatGPTRegistration,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: registration.credentials!.refreshToken!,
        token_type_hint: "refresh_token",
        client_id: registration.clientId,
      }),
      redirect: "error",
      credentials: "omit",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return false;
    }
    if (!response.body) return true;
    const reader = response.body.getReader();
    try {
      const first = await reader.read();
      return first.done === true;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  return {
    async renewRegistration(
      id: string,
      input: {
        force?: boolean;
        expectedRevision?: number;
        signal?: AbortSignal;
      } = {},
    ): Promise<ChatGPTRegistration> {
      input.signal?.throwIfAborted();
      const observed = await store.readRegistration(id);
      if (!observed?.credentials)
        throw new ChatGPTSessionError("sign_in_required");
      const outcome = await store.withRegistrationRefreshLock<
        ChatGPTRegistration | ChatGPTSessionError
      >(
        id,
        async (locked) => {
          const current = await locked.readRegistration(id);
          if (!current?.credentials)
            throw new ChatGPTSessionError("sign_in_required");
          if (
            input.expectedRevision !== undefined &&
            current.revision !== input.expectedRevision
          )
            throw new ChatGPTSessionError("registration_changed");
          const credentials = current.credentials;
          if (
            credentials.expiresAt > now() + 60_000 &&
            (!input.force || current.revision !== observed.revision)
          )
            return current;
          if (
            credentials.earliestRefreshAt !== undefined &&
            now() < credentials.earliestRefreshAt
          ) {
            if (credentials.expiresAt > now()) return current;
            throw new ChatGPTSessionError(
              "refresh_deferred",
              credentials.earliestRefreshAt,
            );
          }
          if (!credentials.refreshToken)
            throw new ChatGPTSessionError("sign_in_required");
          let value: Record<string, unknown> | undefined;
          for (let attempt = 0; attempt < 2; attempt++) {
            input.signal?.throwIfAborted();
            try {
              value = await requestChatGPTToken(
                new URLSearchParams({
                  grant_type: "refresh_token",
                  client_id: current.clientId,
                  refresh_token: credentials.refreshToken,
                  resource: CHATGPT_RESOURCE,
                }),
                request,
                input.signal,
              );
              break;
            } catch (error) {
              if (input.signal?.aborted)
                throw new ChatGPTSessionError("cancelled");
              if (
                error instanceof ChatGPTAuthorizationError &&
                error.kind === "invalid_grant"
              ) {
                await locked.replaceRegistration(current.revision, {
                  ...current,
                  credentials: null,
                });
                // Return through the transaction so confirmed invalid credentials stay cleared.
                // Throwing here would roll back the removal in the PostgreSQL authority.
                return new ChatGPTSessionError("sign_in_required");
              }
              if (
                error instanceof ChatGPTAuthorizationError &&
                error.kind === "temporary"
              ) {
                if (attempt === 0) {
                  await delay(250, undefined, { signal: input.signal });
                  continue;
                }
                throw new ChatGPTSessionError("temporary");
              }
              if (
                error instanceof ChatGPTAuthorizationError &&
                error.kind === "invalid_client"
              )
                throw new ChatGPTSessionError("client_configuration");
              throw new ChatGPTSessionError("refresh_unconfirmed");
            }
          }
          if (!value) throw new ChatGPTSessionError("temporary");
          let replacementCredentials;
          try {
            replacementCredentials = parseChatGPTTokenCredentials(value, now());
            if (!replacementCredentials.refreshToken)
              throw new Error("replacement_refresh_missing");
            const identity = await verifyIdentity(
              replacementCredentials.idToken,
              current.clientId,
              { subject: current.subject },
            );
            if (identity.accountId !== current.accountId)
              throw new Error("identity_changed");
          } catch {
            throw new ChatGPTSessionError("refresh_unconfirmed");
          }
          input.signal?.throwIfAborted();
          return locked.replaceRegistration(current.revision, {
            ...current,
            credentials: replacementCredentials,
          });
        },
        input.signal,
      );
      if (outcome instanceof ChatGPTSessionError) throw outcome;
      return outcome;
    },

    async signOut(
      id: string,
      signal?: AbortSignal,
    ): Promise<{ localSignedOut: true; revocationConfirmed: boolean | null }> {
      return store.withRegistrationRefreshLock(id, async (locked) => {
        const registration = await locked.readRegistration(id);
        if (!registration) throw new ChatGPTSessionError("sign_in_required");
        let confirmed: boolean | null = null;
        if (registration.credentials?.refreshToken) {
          confirmed = false;
          try {
            const endpoint = await revocationEndpoint(signal);
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                confirmed = await revoke(endpoint, registration, signal);
              } catch {
                confirmed = false;
              }
              if (confirmed || signal?.aborted) break;
              if (attempt === 0) await delay(250, undefined, { signal });
            }
          } catch {
            confirmed = false;
          }
        }
        if (registration.credentials)
          await locked.replaceRegistration(registration.revision, {
            ...registration,
            credentials: null,
          });
        return { localSignedOut: true, revocationConfirmed: confirmed };
      });
    },
  };
}
