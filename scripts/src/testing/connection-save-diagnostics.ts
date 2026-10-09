interface ConnectionResponse {
  url: string;
  method: string;
  status: number;
  headers: Record<string, string | undefined>;
}

interface ConnectionObservation {
  atMs: number;
  method: "GET" | "PUT";
  status: number;
  limit: number | null;
  remaining: number | null;
  resetSeconds: number | null;
  retryAfterSeconds: number | null;
}

function integer(value: string | undefined): number | null {
  if (!value || !/^(?:0|[1-9][0-9]{0,8})$/u.test(value)) return null;
  return Number(value);
}

// Only the offline smoke uses this collector. Never retain URLs, bodies,
// account identities, authorization headers, cookies or arbitrary error text.
export function createConnectionSaveDiagnostics(
  origin: string,
  now = Date.now,
) {
  const expectedOrigin = new URL(origin).origin;
  const startedAt = now();
  const responses: ConnectionObservation[] = [];
  let totalResponses = 0;
  return {
    observe(response: ConnectionResponse) {
      let url: URL;
      try {
        url = new URL(response.url);
      } catch {
        return;
      }
      if (
        url.origin !== expectedOrigin ||
        url.username ||
        url.password ||
        url.pathname !== "/api/settings/llm" ||
        (response.method !== "GET" && response.method !== "PUT") ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599
      )
        return;
      const elapsed = now() - startedAt;
      responses.push({
        atMs: Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : 0,
        method: response.method,
        status: response.status,
        limit: integer(response.headers["ratelimit-limit"]),
        remaining: integer(response.headers["ratelimit-remaining"]),
        resetSeconds: integer(response.headers["ratelimit-reset"]),
        retryAfterSeconds: integer(response.headers["retry-after"]),
      });
      totalResponses++;
      if (responses.length > 64) responses.shift();
    },
    snapshot() {
      return {
        totalResponses,
        droppedResponses: totalResponses - responses.length,
        responses: responses.map((response) => ({ ...response })),
      };
    },
  };
}
