import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger, safeErrorForLog } from "./lib/logger";
import {
  createOperatorAuth,
  readOperatorAuthOptions,
} from "./lib/operator-auth";
import { createRateLimiter } from "./lib/rate-limit";
import { readIntegerEnvironment } from "./lib/runtime-security";
import { configureStaticUi } from "./lib/static-ui";
import internalRuntimeControlRouter from "./routes/internal-runtime-control";

const app: Express = express();

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader(
    "Content-Security-Policy",
    _req.path === "/api" || _req.path.startsWith("/api/")
      ? "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
      : "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'",
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
      err(error) {
        return safeErrorForLog(error);
      },
    },
  }),
);
const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const normalizeHostname = (value: string): string | null => {
  try {
    const withScheme = value.includes("://") ? value : `http://${value}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const configuredOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin)),
);
const localDevelopmentOrigins = new Set(
  process.env.NODE_ENV === "production"
    ? []
    : ["http://127.0.0.1:5173", "http://localhost:5173"],
);
const trustedHostnames = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  ...(process.env.TRUSTED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .map(normalizeHostname)
    .filter((host): host is string => Boolean(host)),
]);

function isAllowedOrigin(req: Request, rawOrigin: string): boolean {
  try {
    const parsed = new URL(rawOrigin);
    const requestHost = req.header("host")?.toLowerCase();
    const sameOrigin = requestHost
      ? parsed.host.toLowerCase() === requestHost
      : false;
    return (
      sameOrigin ||
      configuredOrigins.has(parsed.origin) ||
      localDevelopmentOrigins.has(parsed.origin)
    );
  } catch {
    return false;
  }
}

// Reject DNS-rebinding hosts and cross-site state changes before a route can
// mutate data. CORS response headers alone do not stop a browser from sending
// a simple form POST, so this is an explicit server-side boundary.
app.use((req, res, next) => {
  const requestHostname = normalizeHostname(req.header("host") ?? "");
  if (!requestHostname || !trustedHostnames.has(requestHostname)) {
    res.status(421).json({ error: "Untrusted Host header" });
    return;
  }

  const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const origin = req.header("origin");
  if (
    mutation &&
    (req.header("sec-fetch-site") === "cross-site" ||
      (origin !== undefined && !isAllowedOrigin(req, origin)))
  ) {
    res.status(403).json({ error: "Cross-site state change blocked" });
    return;
  }
  next();
});

app.use(
  cors((req: Request, callback) => {
    const origin = req.header("origin");
    if (!origin) {
      callback(null, { origin: false });
      return;
    }

    const allowed = isAllowedOrigin(req, origin);
    callback(null, {
      origin: allowed ? origin : false,
      credentials: allowed,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: [
        "X-Next-Before-Id",
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
        "Retry-After",
      ],
      maxAge: 600,
    });
  }),
);

const apiRateLimiter = createRateLimiter({
  namespace: "api",
  max: readIntegerEnvironment("API_RATE_LIMIT_MAX", 300, 10, 100_000),
  windowMs: readIntegerEnvironment(
    "API_RATE_LIMIT_WINDOW_MS",
    60_000,
    1_000,
    60 * 60_000,
  ),
});
const authRateLimiter = createRateLimiter({
  namespace: "operator-login",
  max: readIntegerEnvironment("AUTH_RATE_LIMIT_MAX", 10, 1, 1_000),
  windowMs: readIntegerEnvironment(
    "AUTH_RATE_LIMIT_WINDOW_MS",
    15 * 60_000,
    10_000,
    24 * 60 * 60_000,
  ),
});
const operatorAuth = createOperatorAuth(readOperatorAuthOptions());

app.use("/api", (req, res, next) => {
  if (
    req.path === "/healthz" ||
    req.path === "/readyz" ||
    req.path.startsWith("/internal/runtime-control/")
  ) {
    next();
    return;
  }
  apiRateLimiter(req, res, next);
});
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  "/api/internal/runtime-control",
  express.json({ limit: "8mb" }),
  internalRuntimeControlRouter,
);
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth/login", authRateLimiter);
app.use("/api/auth", operatorAuth.router);

app.use((req, res, next) => {
  const match = req.path.match(/^\/api\/(?:agents|tasks|approvals)\/([^/]+)/);
  if (match && (!/^\d+$/.test(match[1]) || Number(match[1]) <= 0)) {
    res.status(400).json({ error: "Resource id must be a positive integer" });
    return;
  }
  next();
});

app.use("/api", operatorAuth.requireAuthentication, router);

configureStaticUi(app);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const genericErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  logger.error(
    {
      error: error instanceof Error ? error.message : "Unknown request error",
      method: req.method,
      path: req.path,
    },
    "Unhandled API request error",
  );
  if (res.headersSent) {
    next(error);
    return;
  }
  const bodyErrorType =
    error && typeof error === "object" && "type" in error
      ? String((error as { type?: unknown }).type)
      : "";
  if (bodyErrorType === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON request body" });
    return;
  }
  if (bodyErrorType === "entity.too.large") {
    res.status(413).json({ error: "Request body exceeds the 1 MiB limit" });
    return;
  }
  if (
    bodyErrorType === "encoding.unsupported" ||
    bodyErrorType === "charset.unsupported"
  ) {
    res.status(415).json({ error: "Unsupported request body encoding" });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
};
app.use(genericErrorHandler);

export default app;
