import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";

export const OPERATOR_SESSION_COOKIE = "agentic_os_session";
export const DEFAULT_OPERATOR_AUDIT_ID = "local-operator";

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60_000;

interface SessionPayload {
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface OperatorAuthOptions {
  token: string | null;
  secureCookies: boolean;
  sessionTtlMs?: number;
  now?: () => number;
}

export interface OperatorAuthentication {
  authenticated: boolean;
  sessionExpiresAt: string | null;
}

/**
 * Returns the stable, non-secret identity written to operator audit records.
 * Authentication material is deliberately not accepted here: bearer tokens
 * and session cookies must never become durable actor identifiers.
 */
export function readOperatorAuditId(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.OPERATOR_AUDIT_ID;
  if (configured === undefined || configured === "") {
    return DEFAULT_OPERATOR_AUDIT_ID;
  }
  if (
    configured !== configured.trim() ||
    Buffer.byteLength(configured, "utf8") < 1 ||
    Buffer.byteLength(configured, "utf8") > 256
  ) {
    throw new Error(
      "OPERATOR_AUDIT_ID must contain 1 to 256 UTF-8 bytes and no leading or trailing whitespace.",
    );
  }
  return configured.normalize("NFC");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Compare fixed-length digests so invalid token length does not change timing. */
export function matchesOperatorToken(
  candidate: string,
  expected: string,
): boolean {
  return timingSafeEqual(digest(candidate), digest(expected));
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (!header) return result;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    try {
      result[key] = decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      // Malformed cookies are ignored and therefore fail authentication.
    }
  }
  return result;
}

function signingKey(token: string): Buffer {
  return digest(`agentic-company-os/operator-session/v1:${token}`);
}

function createSession(token: string, ttlMs: number, now: number): string {
  const payload: SessionPayload = {
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: randomBytes(18).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", signingKey(token))
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySession(
  value: string,
  token: string,
  ttlMs: number,
  now: number,
): SessionPayload | null {
  if (value.length > 1024) return null;
  const separator = value.indexOf(".");
  if (separator <= 0 || value.indexOf(".", separator + 1) !== -1) return null;
  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac("sha256", signingKey(token))
    .update(encoded)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    if (
      !Number.isSafeInteger(parsed.issuedAt) ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 16 ||
      (parsed.issuedAt as number) > now + 60_000 ||
      (parsed.expiresAt as number) <= now ||
      (parsed.expiresAt as number) - (parsed.issuedAt as number) !== ttlMs
    ) {
      return null;
    }
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const match = /^Bearer ([^\s,]+)$/.exec(header);
  return match?.[1] ?? null;
}

export function createOperatorAuth(options: OperatorAuthOptions): {
  enabled: boolean;
  router: Router;
  requireAuthentication: RequestHandler;
  authenticate: (req: Request) => OperatorAuthentication;
} {
  const token = options.token;
  const ttlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const now = options.now ?? Date.now;
  const enabled = token !== null;

  const authenticate = (req: Request): OperatorAuthentication => {
    if (!token) return { authenticated: true, sessionExpiresAt: null };
    const bearer = bearerToken(req);
    if (bearer !== null && matchesOperatorToken(bearer, token)) {
      return { authenticated: true, sessionExpiresAt: null };
    }
    const cookie = parseCookies(req.header("cookie"))[OPERATOR_SESSION_COOKIE];
    if (!cookie) return { authenticated: false, sessionExpiresAt: null };
    const session = verifySession(cookie, token, ttlMs, now());
    return session
      ? {
          authenticated: true,
          sessionExpiresAt: new Date(session.expiresAt).toISOString(),
        }
      : { authenticated: false, sessionExpiresAt: null };
  };

  const requireAuthentication: RequestHandler = (req, res, next) => {
    if (req.path === "/healthz" || req.path === "/readyz") {
      next();
      return;
    }
    if (authenticate(req).authenticated) {
      next();
      return;
    }
    res.setHeader("WWW-Authenticate", 'Bearer realm="agentic-company-os"');
    res.status(401).json({ error: "Authentication required" });
  };

  const router = Router();
  router.get("/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled, ...authenticate(req) });
  });
  router.post("/login", (req, res) => {
    const candidate =
      typeof req.body === "object" && req.body !== null
        ? (req.body as { token?: unknown }).token
        : undefined;
    if (
      !token ||
      typeof candidate !== "string" ||
      candidate.length > 4096 ||
      !matchesOperatorToken(candidate, token)
    ) {
      res.status(401).json({ error: "Invalid operator token" });
      return;
    }
    const issuedAt = now();
    const session = createSession(token, ttlMs, issuedAt);
    res.cookie(OPERATOR_SESSION_COOKIE, session, {
      httpOnly: true,
      secure: options.secureCookies,
      sameSite: "strict",
      path: "/",
      maxAge: ttlMs,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      enabled: true,
      authenticated: true,
      sessionExpiresAt: new Date(issuedAt + ttlMs).toISOString(),
    });
  });
  router.delete("/session", (_req, res) => {
    res.clearCookie(OPERATOR_SESSION_COOKIE, {
      httpOnly: true,
      secure: options.secureCookies,
      sameSite: "strict",
      path: "/",
    });
    res.status(204).end();
  });

  return { enabled, router, requireAuthentication, authenticate };
}

export function readOperatorAuthOptions(): OperatorAuthOptions {
  const rawToken = process.env.OPERATOR_AUTH_TOKEN;
  const rawTtl = process.env.OPERATOR_SESSION_TTL_MS;
  const sessionTtlMs =
    rawTtl === undefined || rawTtl === ""
      ? DEFAULT_SESSION_TTL_MS
      : Number(rawTtl);
  if (
    !Number.isSafeInteger(sessionTtlMs) ||
    sessionTtlMs < 5 * 60_000 ||
    sessionTtlMs > 7 * 24 * 60 * 60_000
  ) {
    throw new Error(
      "OPERATOR_SESSION_TTL_MS must be an integer from 300000 to 604800000.",
    );
  }
  if (
    rawToken &&
    (rawToken.length < 32 ||
      rawToken.length > 4096 ||
      rawToken !== rawToken.trim())
  ) {
    throw new Error(
      "OPERATOR_AUTH_TOKEN must contain 32 to 4096 characters and no leading or trailing whitespace.",
    );
  }
  return {
    token: rawToken && rawToken.length > 0 ? rawToken : null,
    secureCookies: process.env.NODE_ENV === "production",
    sessionTtlMs,
  };
}
