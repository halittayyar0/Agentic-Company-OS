import assert from "node:assert/strict";
const integer = (headers: Headers, name: string) => {
  const raw = headers.get(name);
  assert.ok(
    raw && /^(?:0|[1-9][0-9]{0,3})$/u.test(raw),
    "native_read_window_header_required",
  );
  return Number(raw);
};
// Offline native acceptance shares the actual application's per-IP read window.
// Wait before a new rendered journey, keeping its assertions and deadlines intact.
// This helper never alters the limiter or repeats a mutation.
export async function waitForNativeReadWindow(headers: Headers) {
  const limit = integer(headers, "RateLimit-Limit");
  const remaining = integer(headers, "RateLimit-Remaining");
  const resetSeconds = integer(headers, "RateLimit-Reset");
  assert.equal(limit, 300, "native_read_window_limit_changed");
  assert.ok(remaining <= limit, "native_read_window_remaining_invalid");
  assert.ok(
    resetSeconds > 0 && resetSeconds <= 60,
    "native_read_window_reset_invalid",
  );
  const waitedMilliseconds = remaining < 250 ? (resetSeconds + 1) * 1000 : 0;
  if (waitedMilliseconds) {
    console.log(
      "Awaiting the production read window before native UI acceptance",
    );
    await new Promise<void>((resolve) =>
      setTimeout(resolve, waitedMilliseconds),
    );
  }
  return { limit, remaining, resetSeconds, waitedMilliseconds };
}
