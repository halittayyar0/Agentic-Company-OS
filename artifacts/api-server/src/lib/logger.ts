import pino from "pino";
import { redactAuditText } from "./audit-redaction";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Error objects from fetch/OpenAI SDKs may retain request headers, response
 * bodies, or credential-bearing URLs. Persist only a small allowlist of
 * diagnostic fields and never serialize the original object or stack.
 */
export function safeErrorForLog(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return { message: redactAuditText(value, 2_000) };
  }

  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return { message: redactAuditText(String(value), 2_000) };
  }

  const record = value as Record<string, unknown>;
  const read = (key: string): unknown => {
    try {
      return record[key];
    } catch {
      return undefined;
    }
  };
  const rawName = read("name");
  const rawMessage = read("message");
  const rawCode = read("code");
  const rawStatus = read("status") ?? read("statusCode");
  return {
    type:
      typeof rawName === "string"
        ? redactAuditText(rawName, 120)
        : value instanceof Error
          ? value.name
          : "Error",
    message:
      typeof rawMessage === "string"
        ? redactAuditText(rawMessage, 2_000)
        : "An error occurred",
    ...(typeof rawCode === "string" || typeof rawCode === "number"
      ? { code: redactAuditText(String(rawCode), 120) }
      : {}),
    ...(typeof rawStatus === "number" && Number.isFinite(rawStatus)
      ? { status: rawStatus }
      : {}),
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  serializers: {
    error: safeErrorForLog,
    err: safeErrorForLog,
    dbError: safeErrorForLog,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
