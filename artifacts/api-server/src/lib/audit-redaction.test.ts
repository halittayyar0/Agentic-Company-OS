import assert from "node:assert/strict";
import test from "node:test";
import { auditCommandName, redactAuditText } from "./audit-redaction";

test("audit redaction removes command assignments, credentials, and URL secrets", () => {
  assert.equal(
    auditCommandName("API_KEY=super-secret curl example.com"),
    "curl",
  );
  assert.equal(
    auditCommandName("$env:API_KEY=super-secret Invoke-WebRequest example.com"),
    "Invoke-WebRequest",
  );
  assert.equal(
    auditCommandName('API_KEY="secret with spaces" node task.mjs'),
    "node",
  );
  assert.equal(
    auditCommandName('API_KEY="unterminated secret node task.mjs'),
    "command",
  );

  const redacted = redactAuditText(
    "request https://example.com/callback?token=secret#private Authorization=Bearer abcdefgh",
  );
  assert.equal(
    redacted,
    "request https://example.com/callback?[REDACTED] Authorization=[REDACTED]",
  );
  assert.doesNotMatch(redacted, /token=secret|#private|Bearer|abcdefgh/);
});

test("source-preserving redaction retains layout while still removing credentials and hidden controls", () => {
  const source =
    "  原文 {name} $&\n\tAuthorization: Bearer abcdefgh\r\nhttps://example.com/path?token=secret#private\n  ";
  const redacted = redactAuditText(source, 1_000, true);
  assert.equal(
    redacted,
    "  原文 {name} $&\n\tAuthorization=[REDACTED]\r\nhttps://example.com/path?[REDACTED]\n  ",
  );
  assert.doesNotMatch(redacted, /abcdefgh|token=secret|#private/);
  assert.equal(
    redactAuditText("visible\u0000\u202Eend", 1_000, true),
    "visible  end",
  );
  assert.equal(redactAuditText(source, 6, true), "  原文 {");
});
