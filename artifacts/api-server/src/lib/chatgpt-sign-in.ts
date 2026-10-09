import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import type {
  ChatGPTRegistrationCredentials,
  ChatGPTRegistrationInput,
  ChatGPTRegistrationPublicStatus,
  ChatGPTRegistrationStore,
} from "@workspace/ai-server/chatgpt-plan-types";
import { ChatGPTRegistrationConflict } from "./chatgpt-registration-store";
import {
  CHATGPT_ISSUER,
  ChatGPTIdentityUnavailable,
  createChatGPTIdentityVerifier,
} from "./chatgpt-identity";

export const CHATGPT_AUTHORIZE_URL = `${CHATGPT_ISSUER}/api/accounts/authorize`;
export const CHATGPT_TOKEN_URL = `${CHATGPT_ISSUER}/api/accounts/oauth/token`;
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";
const ATTEMPT_LIFETIME_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

type FailureKind =
  | "temporary"
  | "client_missing"
  | "client_mismatch"
  | "identity_invalid"
  | "token_invalid"
  | "invalid_grant"
  | "invalid_client"
  | "authorization_failed";
export class ChatGPTAuthorizationError extends Error {
  constructor(readonly kind: FailureKind) {
    super(`chatgpt_authorization_${kind}`);
    this.name = "ChatGPTAuthorizationError";
  }
}

function text(value: unknown, maximum = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\r\n\0]/u.test(value)
  );
}
function equalText(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

export async function readChatGPTOAuthBody(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    if (!response.body) throw new Error("body");
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65_536) throw new Error("body");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("body");
    return value as Record<string, unknown>;
  } catch {
    throw new ChatGPTAuthorizationError("token_invalid");
  }
}

/** Canonical milliseconds; unknown timing formats never silently disable the floor. */
function refreshInstant(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  let milliseconds: number;
  if (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(
      value,
    )
  )
    milliseconds = Date.parse(value);
  else if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1_000_000_000
  )
    milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  else throw new ChatGPTAuthorizationError("token_invalid");
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds <= 0 ||
    !Number.isFinite(new Date(milliseconds).getTime())
  )
    throw new ChatGPTAuthorizationError("token_invalid");
  return milliseconds;
}

export function parseChatGPTTokenCredentials(
  value: Record<string, unknown>,
  now: number,
): ChatGPTRegistrationCredentials {
  if (
    !text(value.access_token, 16_384) ||
    !text(value.id_token, 16_384) ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer" ||
    typeof value.expires_in !== "number" ||
    !Number.isSafeInteger(value.expires_in) ||
    value.expires_in <= 0 ||
    !Number.isSafeInteger(now + value.expires_in * 1000) ||
    !text(value.scope, 4096) ||
    (value.refresh_token !== undefined && !text(value.refresh_token, 16_384))
  )
    throw new ChatGPTAuthorizationError("token_invalid");
  const grants = value.scope.split(/\s+/u).filter(Boolean);
  if (
    grants.length > 64 ||
    new Set(grants).size !== grants.length ||
    grants.some((grant) => grant.length > 256)
  )
    throw new ChatGPTAuthorizationError("token_invalid");
  if (grants.includes("offline_access") && !text(value.refresh_token, 16_384))
    throw new ChatGPTAuthorizationError("token_invalid");
  const earliestRefreshAt = refreshInstant(value.earliest_refresh_at);
  return {
    accessToken: value.access_token,
    idToken: value.id_token,
    ...(value.refresh_token === undefined
      ? {}
      : { refreshToken: value.refresh_token as string }),
    grants,
    expiresAt: now + value.expires_in * 1000,
    ...(earliestRefreshAt === undefined ? {} : { earliestRefreshAt }),
  };
}

export async function requestChatGPTToken(
  form: URLSearchParams,
  request: typeof fetch,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await request(CHATGPT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
      redirect: "error",
      credentials: "omit",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ChatGPTAuthorizationError("temporary");
  }
  if (response.status >= 500 || response.status === 429) {
    await response.body?.cancel();
    throw new ChatGPTAuthorizationError("temporary");
  }
  const value = await readChatGPTOAuthBody(response);
  if (response.status !== 200) {
    const code =
      typeof value.error === "string"
        ? value.error
        : value.error &&
            typeof value.error === "object" &&
            !Array.isArray(value.error)
          ? (value.error as Record<string, unknown>).code
          : undefined;
    const unusable =
      typeof code === "string" &&
      [
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
      ].includes(code);
    throw new ChatGPTAuthorizationError(
      unusable
        ? "invalid_grant"
        : code === "invalid_client"
          ? "invalid_client"
          : "authorization_failed",
    );
  }
  return value;
}

export interface ChatGPTSignInStatus {
  attemptId: string;
  state:
    | "pending"
    | "exchanging"
    | "review"
    | "confirming"
    | "connected"
    | "denied"
    | "cancelled"
    | "expired"
    | "failed";
  expiresAt: number;
  failureKind?: FailureKind;
  expectedRevision?: number;
  proposedAccount?: ChatGPTRegistrationPublicStatus;
}
interface Attempt {
  id: string;
  state: ChatGPTSignInStatus["state"];
  expiresAt: number;
  nonce: string;
  stateToken: string;
  verifier: string;
  callback: string;
  hostId: string;
  clientId?: string;
  registrationId?: string;
  subject?: string;
  expectedRevision: number;
  requestPlanPermission: boolean;
  candidate?: ChatGPTRegistrationInput;
  failureKind?: FailureKind;
  server: Server;
  abort: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  confirmation?: Promise<ChatGPTRegistrationPublicStatus>;
}

export function createChatGPTSignInController(options: {
  store: ChatGPTRegistrationStore;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const store = options.store,
    request = options.fetch ?? globalThis.fetch,
    now = options.now ?? Date.now;
  const verifyIdentity = createChatGPTIdentityVerifier({ fetch: request, now });
  const attempts = new Map<string, Attempt>();
  let closed = false;

  function getAttempt(id: string): Attempt {
    const attempt = attempts.get(id);
    if (!attempt) throw new Error("chatgpt_sign_in_attempt_missing");
    return attempt;
  }
  function stopListener(attempt: Attempt): Promise<void> {
    if (attempt.state !== "review" && attempt.state !== "confirming")
      clearTimeout(attempt.timer);
    attempt.abort.abort();
    return new Promise((resolve) => {
      attempt.server.close(() => resolve());
      attempt.server.closeAllConnections();
    });
  }
  function clearCandidate(attempt: Attempt) {
    attempt.candidate = undefined;
    attempt.verifier = "";
    attempt.nonce = "";
  }
  function restoreReviewAfterFailure(attempt: Attempt) {
    if (attempt.state === "confirming") attempt.state = "review";
  }
  async function expire(attempt: Attempt) {
    if (
      ["pending", "exchanging", "review"].includes(attempt.state) &&
      now() >= attempt.expiresAt
    ) {
      attempt.state = "expired";
      clearCandidate(attempt);
      await stopListener(attempt);
    }
  }
  function reply(response: ServerResponse, status: number, message: string) {
    response.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(message);
  }
  function status(attempt: Attempt): ChatGPTSignInStatus {
    const candidate = attempt.candidate,
      credentials = candidate?.credentials;
    return {
      attemptId: attempt.id,
      state: attempt.state,
      expiresAt: attempt.expiresAt,
      ...(attempt.failureKind ? { failureKind: attempt.failureKind } : {}),
      ...(candidate
        ? {
            expectedRevision: attempt.expectedRevision,
            proposedAccount: {
              id: candidate.id,
              accountId: candidate.accountId,
              ...(candidate.email ? { email: candidate.email } : {}),
              ...(candidate.displayName
                ? { displayName: candidate.displayName }
                : {}),
              revision: attempt.expectedRevision,
              signedIn: true,
              canUsePlan:
                !!credentials?.grants.includes("resource.invoke") &&
                credentials.grants.includes("chatgpt.tokens.use.direct"),
              expiresAt: credentials?.expiresAt ?? null,
            },
          }
        : {}),
    };
  }

  async function callback(
    attempt: Attempt,
    url: URL,
    response: ServerResponse,
  ) {
    await expire(attempt);
    if (attempt.state !== "pending") {
      reply(
        response,
        409,
        "This sign-in attempt is no longer waiting for a callback.",
      );
      return;
    }
    const stateToken = url.searchParams.get("state");
    if (!stateToken || !equalText(stateToken, attempt.stateToken)) {
      reply(response, 400, "Invalid sign-in state.");
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      attempt.state = error === "access_denied" ? "denied" : "failed";
      attempt.failureKind =
        error === "access_denied" ? undefined : "authorization_failed";
      clearCandidate(attempt);
      reply(
        response,
        error === "access_denied" ? 200 : 400,
        "Sign-in was not completed. Return to Agentic Company OS.",
      );
      await stopListener(attempt);
      return;
    }
    const issued = url.searchParams.get("client_id");
    if (
      issued !== null &&
      (!text(issued) ||
        /\s/u.test(issued) ||
        issued === "dynamic_agent_client" ||
        (attempt.clientId && issued !== attempt.clientId))
    ) {
      attempt.state = "failed";
      attempt.failureKind = "client_mismatch";
      clearCandidate(attempt);
      reply(response, 400, "The sign-in client did not match this attempt.");
      await stopListener(attempt);
      return;
    }
    if (issued) attempt.clientId = issued;
    if (!attempt.clientId) {
      attempt.state = "failed";
      attempt.failureKind = "client_missing";
      clearCandidate(attempt);
      reply(response, 400, "Registration did not return an issued client.");
      await stopListener(attempt);
      return;
    }
    const code = url.searchParams.get("code");
    if (!text(code, 4096)) {
      reply(response, 400, "A sign-in code is required.");
      return;
    }
    attempt.state = "exchanging";
    try {
      const value = await requestChatGPTToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: attempt.clientId,
          code,
          code_verifier: attempt.verifier,
          redirect_uri: attempt.callback,
          resource: CHATGPT_RESOURCE,
        }),
        request,
        attempt.abort.signal,
      );
      const credentials = parseChatGPTTokenCredentials(value, now());
      const identity = await verifyIdentity(
        credentials.idToken,
        attempt.clientId,
        {
          nonce: attempt.nonce,
          ...(attempt.subject ? { subject: attempt.subject } : {}),
        },
      );
      if (attempt.state !== "exchanging" || now() >= attempt.expiresAt) {
        await expire(attempt);
        return;
      }
      attempt.candidate = {
        id: attempt.registrationId ?? randomUUID(),
        hostId: attempt.hostId,
        clientId: attempt.clientId,
        accountId: identity.accountId,
        subject: identity.subject,
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        credentials,
      };
      attempt.state = "review";
      attempt.verifier = "";
      attempt.nonce = "";
      reply(
        response,
        200,
        "Identity verified. Return to Agentic Company OS to review and select this account.",
      );
    } catch (error) {
      if (attempt.state !== "exchanging") return;
      attempt.state = "failed";
      attempt.failureKind =
        error instanceof ChatGPTAuthorizationError
          ? error.kind
          : error instanceof ChatGPTIdentityUnavailable
            ? "temporary"
            : "identity_invalid";
      clearCandidate(attempt);
      reply(
        response,
        attempt.failureKind === "temporary" ? 503 : 400,
        "Sign-in could not be completed. Your previous account remains selected.",
      );
    } finally {
      await stopListener(attempt);
    }
  }

  return {
    async beginSignIn(
      input: {
        registrationId?: string;
        retryAttemptId?: string;
        requestPlanPermission?: boolean;
      } = {},
    ): Promise<{ attemptId: string; authorizeUrl: string; expiresAt: number }> {
      if (closed) throw new Error("chatgpt_sign_in_closed");
      for (const [id, attempt] of attempts)
        if (now() >= attempt.expiresAt + ATTEMPT_LIFETIME_MS) {
          await stopListener(attempt);
          clearCandidate(attempt);
          attempts.delete(id);
        }
      if (attempts.size >= 32) throw new Error("chatgpt_sign_in_attempt_limit");
      if (
        (input.registrationId && input.retryAttemptId) ||
        (input.requestPlanPermission &&
          !input.registrationId &&
          !input.retryAttemptId)
      )
        throw new Error("chatgpt_sign_in_input_invalid");
      const previous = input.retryAttemptId
        ? getAttempt(input.retryAttemptId)
        : undefined;
      if (
        previous &&
        (previous.state !== "failed" ||
          !previous.clientId ||
          now() >= previous.expiresAt)
      )
        throw new Error("chatgpt_sign_in_retry_unavailable");
      const registrationId = input.registrationId ?? previous?.registrationId;
      const saved = registrationId
        ? await store.readRegistration(registrationId)
        : null;
      if (registrationId && !saved)
        throw new Error("chatgpt_registration_missing");
      const hostId = await store.getHostId(),
        clientId = saved?.clientId ?? previous?.clientId;
      const id = randomUUID(),
        stateToken = randomBytes(32).toString("base64url"),
        nonce = randomBytes(32).toString("base64url"),
        verifier = randomBytes(48).toString("base64url");
      let attempt: Attempt;
      const server = createServer(
        { maxHeaderSize: 8192, headersTimeout: 5_000, requestTimeout: 20_000 },
        (incoming, response) => {
          if (
            !attempt ||
            incoming.method !== "GET" ||
            !incoming.url ||
            incoming.url.length > 8192 ||
            incoming.headers.host !== new URL(attempt.callback).host
          ) {
            reply(response, 400, "Invalid callback request.");
            return;
          }
          const url = new URL(incoming.url, attempt.callback);
          if (
            url.origin !== new URL(attempt.callback).origin ||
            url.pathname !== "/auth/callback"
          ) {
            reply(response, 404, "Callback not found.");
            return;
          }
          for (const key of url.searchParams.keys())
            if (url.searchParams.getAll(key).length !== 1) {
              reply(response, 400, "Duplicate callback parameter.");
              return;
            }
          void callback(attempt, url, response).catch(() => {
            if (!response.writableEnded && !response.destroyed)
              reply(response, 400, "Sign-in was not completed.");
          });
        },
      );
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        throw new Error("chatgpt_callback_listener_failed");
      }
      const callbackUrl = `http://127.0.0.1:${address.port}/auth/callback`,
        expiresAt = now() + ATTEMPT_LIFETIME_MS;
      attempt = {
        id,
        state: "pending",
        expiresAt,
        nonce,
        stateToken,
        verifier,
        callback: callbackUrl,
        hostId,
        clientId,
        registrationId,
        subject: saved?.subject,
        expectedRevision: saved?.revision ?? 0,
        requestPlanPermission:
          input.requestPlanPermission ??
          previous?.requestPlanPermission ??
          false,
        server,
        abort: new AbortController(),
      };
      attempt.timer = setTimeout(() => {
        void expire(attempt);
      }, ATTEMPT_LIFETIME_MS);
      attempt.timer.unref();
      attempts.set(id, attempt);
      const url = new URL(CHATGPT_AUTHORIZE_URL);
      const parameters = {
        client_id: clientId ?? "dynamic_agent_client",
        ext_agent_host_id: hostId,
        response_type: "code",
        redirect_uri: callbackUrl,
        scope: SCOPES,
        resource: CHATGPT_RESOURCE,
        state: stateToken,
        nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      };
      for (const [key, value] of Object.entries(parameters))
        url.searchParams.set(key, value);
      if (!clientId)
        url.searchParams.set("agent_name_hint", "Agentic Company OS");
      if (saved?.credentials?.idToken)
        url.searchParams.set("id_token_hint", saved.credentials.idToken);
      if (saved?.email) url.searchParams.set("login_hint", saved.email);
      if (attempt.requestPlanPermission)
        url.searchParams.set("prompt", "consent");
      return { attemptId: id, authorizeUrl: url.toString(), expiresAt };
    },
    async readSignInStatus(id: string): Promise<ChatGPTSignInStatus> {
      const attempt = getAttempt(id);
      await expire(attempt);
      return status(attempt);
    },
    async cancelSignIn(id: string): Promise<void> {
      const attempt = getAttempt(id);
      if (attempt.state === "confirming")
        throw new Error("chatgpt_sign_in_confirmation_in_progress");
      if (["pending", "exchanging", "review"].includes(attempt.state)) {
        attempt.state = "cancelled";
        clearCandidate(attempt);
        await stopListener(attempt);
      }
    },
    async confirmAccount(
      id: string,
      expectedRevision: number,
    ): Promise<ChatGPTRegistrationPublicStatus> {
      const attempt = getAttempt(id);
      await expire(attempt);
      if (attempt.state !== "review" || !attempt.candidate)
        throw new Error("chatgpt_sign_in_review_required");
      if (attempt.confirmation)
        throw new Error("chatgpt_sign_in_confirmation_in_progress");
      if (expectedRevision !== attempt.expectedRevision)
        throw new ChatGPTRegistrationConflict();
      const candidate = attempt.candidate;
      const confirmation = store.withRegistrationRefreshLock(
        candidate.id,
        async (locked) => {
          if (attempt.state !== "review" || now() >= attempt.expiresAt)
            throw new Error("chatgpt_sign_in_review_required");
          attempt.state = "confirming";
          const registration = await locked.replaceRegistration(
            expectedRevision,
            candidate,
          );
          await locked.activateRegistration(
            registration.id,
            registration.revision,
          );
          return (await locked.readPublicStatus(registration.id))!;
        },
      );
      attempt.confirmation = confirmation;
      try {
        const result = await confirmation;
        attempt.state = "connected";
        clearCandidate(attempt);
        clearTimeout(attempt.timer);
        return result;
      } catch (error) {
        restoreReviewAfterFailure(attempt);
        throw error;
      } finally {
        attempt.confirmation = undefined;
      }
    },
    async close(): Promise<void> {
      closed = true;
      await Promise.all(
        [...attempts.values()].map(async (attempt) => {
          if (["pending", "exchanging", "review"].includes(attempt.state))
            attempt.state = "cancelled";
          await attempt.confirmation?.catch(() => undefined);
          clearCandidate(attempt);
          await stopListener(attempt);
        }),
      );
      attempts.clear();
    },
  };
}
