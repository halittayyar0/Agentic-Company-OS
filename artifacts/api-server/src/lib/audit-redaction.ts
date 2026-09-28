const SECRET_NAME =
  /(?:token|secret|pass(?:word|wd)?|api[_-]?key|private[_-]?key|authorization|cookie|credential|database[_-]?url)/i;

/**
 * Redacts compact operational text before it reaches an activity row, API
 * error note, or structured log. It deliberately removes URL query/fragment
 * data because browser errors often echo the complete requested URL.
 */
export function redactAuditText(
  value: string,
  maxChars = 1_000,
  preserveWhitespace = false,
): string {
  let redacted = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (!secret || secret.length < 4 || !SECRET_NAME.test(key)) continue;
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  redacted = redacted
    .replace(
      /\b(Authorization)\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|AUTHORIZATION|COOKIE|CREDENTIAL|DATABASE_URL)[A-Z0-9_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b(?:sk|pk|ghp|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi,
      "[REDACTED]",
    )
    .replace(/:\/\/[^\s/@:]+:[^\s/@]+@/g, "://[REDACTED]@")
    .replace(/https?:\/\/[^\s<>"']+/gi, redactUrlToken);
  if (preserveWhitespace) {
    // Source notes retain layout; other controls still cannot spoof audit UI.
    redacted = redacted.replace(/[\p{Cc}\p{Cf}]/gu, (character) =>
      /[\r\n\t]/u.test(character) ? character : " ",
    );
  } else {
    redacted = redacted
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return redacted.slice(0, maxChars);
}

export function auditCommandName(command: string): string {
  let remainder = command.trim();
  const assignment =
    /^(?:\$env:)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"']+)\s*/i;
  while (remainder) {
    const match = remainder.match(assignment);
    if (!match) break;
    remainder = remainder.slice(match[0].length).trimStart();
  }
  if (/^(?:\$env:)?[A-Za-z_][A-Za-z0-9_]*\s*=/i.test(remainder)) {
    return "command";
  }
  const executable = remainder.split(/\s+/, 1)[0] ?? "command";
  return redactAuditText(executable, 80) || "command";
}

function redactUrlToken(raw: string): string {
  const trailing = raw.match(/[),.;!?]+$/)?.[0] ?? "";
  const candidate = trailing ? raw.slice(0, -trailing.length) : raw;
  try {
    const parsed = new URL(candidate);
    const hasPrivateSuffix = Boolean(parsed.search || parsed.hash);
    return `${parsed.origin}${parsed.pathname}${hasPrivateSuffix ? "?[REDACTED]" : ""}${trailing}`;
  } catch {
    return "[REDACTED_URL]";
  }
}
