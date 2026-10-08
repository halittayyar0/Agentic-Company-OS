export type TokenUsageCoverage =
  "no_usage" | "complete" | "partial" | "unknown";

/** Legacy rows (null provenance) and explicitly unreported calls both leave
 * token totals as lower bounds. A genuinely reported zero remains measured. */
export function tokenUsageEvidence(
  events: number | string | undefined,
  reported: number | string | undefined,
  hasUnreceiptedTokens = false,
) {
  const count = Number(events ?? 0),
    known = Number(reported ?? 0);
  if (
    !Number.isSafeInteger(count) ||
    !Number.isSafeInteger(known) ||
    count < 0 ||
    known < 0 ||
    known > count
  )
    throw new Error("Invalid token usage evidence");
  const tokenUsageCoverage: TokenUsageCoverage =
    count === 0 && !hasUnreceiptedTokens
      ? "no_usage"
      : known === 0
        ? "unknown"
        : known === count && !hasUnreceiptedTokens
          ? "complete"
          : "partial";
  return {
    tokenReportedEvents: known,
    tokenUnreportedEvents: count - known,
    tokenUsageCoverage,
  };
}
