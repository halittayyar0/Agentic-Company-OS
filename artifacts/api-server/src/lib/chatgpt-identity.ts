import { createHash, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_JWKS_URL = `${CHATGPT_ISSUER}/.well-known/jwks.json`;

export interface ValidatedChatGPTIdentity {
  subject: string;
  accountId: string;
  email?: string;
  displayName?: string;
}

export class ChatGPTIdentityUnavailable extends Error {
  constructor() {
    super("chatgpt_identity_unavailable");
    this.name = "ChatGPTIdentityUnavailable";
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
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/** Discovery keys come only from the fixed issuer, never a token's jku/x5u. */
export function createChatGPTIdentityVerifier(
  options: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const request = options.fetch ?? globalThis.fetch;
  const keys = createRemoteJWKSet(new URL(CHATGPT_JWKS_URL), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
    [customFetch]: async (input, init) => {
      try {
        const response = await request(input, {
          ...init,
          redirect: "error",
          credentials: "omit",
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new ChatGPTIdentityUnavailable();
        }
        return response;
      } catch {
        throw new ChatGPTIdentityUnavailable();
      }
    },
  });
  return async function verifyIdentity(
    token: string,
    clientId: string,
    expected: { nonce?: string; subject?: string },
  ): Promise<ValidatedChatGPTIdentity> {
    try {
      if (
        !text(token, 16_384) ||
        !text(clientId) ||
        /\s/u.test(clientId) ||
        clientId === "dynamic_agent_client" ||
        (!expected.nonce && !expected.subject) ||
        (expected.nonce !== undefined && !text(expected.nonce)) ||
        (expected.subject !== undefined && !text(expected.subject))
      )
        throw new Error("identity_input");
      const now = options.now?.() ?? Date.now();
      if (!Number.isSafeInteger(now)) throw new Error("time");
      const { payload } = await jwtVerify(token, keys, {
        issuer: CHATGPT_ISSUER,
        audience: clientId,
        algorithms: ["RS256"],
        requiredClaims: [
          "iss",
          "aud",
          "sub",
          "exp",
          "iat",
          ...(expected.nonce === undefined ? [] : ["nonce"]),
        ],
        currentDate: new Date(now),
        clockTolerance: 30,
      });
      if (
        !text(payload.sub) ||
        !Number.isFinite(payload.exp) ||
        (payload.nbf !== undefined && !Number.isFinite(payload.nbf)) ||
        !Number.isSafeInteger(payload.iat) ||
        payload.iat! > Math.floor(now / 1000) + 30 ||
        (payload.azp !== undefined && payload.azp !== clientId) ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== clientId) ||
        (expected.nonce !== undefined &&
          (!text(payload.nonce) ||
            !equalText(payload.nonce, expected.nonce))) ||
        (expected.subject !== undefined &&
          !equalText(payload.sub, expected.subject))
      )
        throw new Error("identity_claims");
      return {
        subject: payload.sub,
        accountId: createHash("sha256")
          .update(JSON.stringify([CHATGPT_ISSUER, clientId, payload.sub]))
          .digest("hex"),
        ...(text(payload.email) ? { email: payload.email } : {}),
        ...(text(payload.name) ? { displayName: payload.name } : {}),
      };
    } catch (error) {
      if (
        error instanceof ChatGPTIdentityUnavailable ||
        (error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ERR_JWKS_TIMEOUT")
      )
        throw new ChatGPTIdentityUnavailable();
      throw new Error("chatgpt_identity_invalid");
    }
  };
}
