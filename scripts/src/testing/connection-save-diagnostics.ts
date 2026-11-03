interface ConnectionResponse {
  url: string;
  method: string;
  status: number;
  headers: Record<string, string | undefined>;
  requestId?: number;
}

interface ConnectionRequest {
  id: number | undefined;
  url: string;
  method: string;
}

interface AuthTransportObservation {
  id: number;
  phase: "waiting_headers" | "waiting_body" | "finished" | "failed";
  startedAtMs: number;
  headersAtMs: number | null;
  finishedAtMs: number | null;
  failedAtMs: number | null;
  status: number | null;
  failureKind:
    | "aborted"
    | "timed_out"
    | "connection_closed"
    | "connection_refused"
    | "name_not_resolved"
    | "other"
    | null;
}

function failureKind(
  code: string | undefined,
): AuthTransportObservation["failureKind"] {
  switch (code) {
    case "net::ERR_ABORTED":
      return "aborted";
    case "net::ERR_TIMED_OUT":
      return "timed_out";
    case "net::ERR_CONNECTION_CLOSED":
    case "net::ERR_CONNECTION_RESET":
      return "connection_closed";
    case "net::ERR_CONNECTION_REFUSED":
      return "connection_refused";
    case "net::ERR_NAME_NOT_RESOLVED":
      return "name_not_resolved";
    default:
      return "other";
  }
}

interface ConnectionObservation {
  resource?: "model-catalog" | "auth-status" | "agents" | "tasks";
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
  const authRequests = new Map<number, AuthTransportObservation>();
  let lastAuthRequestId = 0,
    totalAuthRequests = 0,
    ignoredAuthEvents = 0;
  const elapsedMs = () => {
    const value = now() - startedAt;
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  };
  const authRequestId = (request: ConnectionRequest): number | undefined => {
    if (
      request.method !== "GET" ||
      typeof request.id !== "number" ||
      !Number.isSafeInteger(request.id) ||
      request.id <= 0
    )
      return;
    try {
      const url = new URL(request.url);
      if (
        url.origin === expectedOrigin &&
        !url.username &&
        !url.password &&
        url.pathname === "/api/auth/status"
      )
        return request.id;
    } catch {
      /* Invalid observations retain no input values. */
    }
    return undefined;
  };
  const activeAuthRequest = (request: ConnectionRequest) => {
    const id = authRequestId(request);
    if (id === undefined) return;
    const entry = authRequests.get(id);
    if (!entry || entry.phase === "finished" || entry.phase === "failed") {
      ignoredAuthEvents++;
      return;
    }
    return entry;
  };
  return {
    requestStarted(request: ConnectionRequest) {
      const id = authRequestId(request);
      if (id === undefined) return;
      if (id <= lastAuthRequestId) {
        ignoredAuthEvents++;
        return;
      }
      lastAuthRequestId = id;
      totalAuthRequests++;
      authRequests.set(id, {
        id,
        phase: "waiting_headers",
        startedAtMs: elapsedMs(),
        headersAtMs: null,
        finishedAtMs: null,
        failedAtMs: null,
        status: null,
        failureKind: null,
      });
      if (authRequests.size > 16)
        authRequests.delete(authRequests.keys().next().value!);
    },
    requestFinished(request: ConnectionRequest) {
      const entry = activeAuthRequest(request);
      if (!entry) return;
      entry.phase = "finished";
      entry.finishedAtMs = elapsedMs();
    },
    requestFailed(request: ConnectionRequest, code?: string) {
      const entry = activeAuthRequest(request);
      if (!entry) return;
      entry.phase = "failed";
      entry.failedAtMs = elapsedMs();
      entry.failureKind = failureKind(code);
    },
    observe(response: ConnectionResponse) {
      let url: URL;
      try {
        url = new URL(response.url);
      } catch {
        return;
      }
      const catalog =
        url.pathname === "/api/model-catalog" && response.method === "GET";
      const authStatus =
        url.pathname === "/api/auth/status" && response.method === "GET";
      const workspaceResource =
        response.method === "GET"
          ? url.pathname === "/api/agents"
            ? ("agents" as const)
            : url.pathname === "/api/tasks"
              ? ("tasks" as const)
              : undefined
          : undefined;
      const settings =
        url.pathname === "/api/settings/llm" &&
        (response.method === "GET" || response.method === "PUT");
      if (
        url.origin !== expectedOrigin ||
        url.username ||
        url.password ||
        (!catalog && !settings && !authStatus && !workspaceResource) ||
        (response.method !== "GET" && response.method !== "PUT") ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599
      )
        return;
      if (authStatus && response.requestId !== undefined) {
        const entry = activeAuthRequest({
          id: response.requestId,
          url: response.url,
          method: response.method,
        });
        if (entry) {
          if (entry.headersAtMs !== null) ignoredAuthEvents++;
          else {
            entry.headersAtMs = elapsedMs();
            entry.status = response.status;
            entry.phase = "waiting_body";
          }
        }
      }
      const elapsed = now() - startedAt;
      responses.push({
        ...(catalog ? { resource: "model-catalog" as const } : {}),
        ...(authStatus ? { resource: "auth-status" as const } : {}),
        ...(workspaceResource ? { resource: workspaceResource } : {}),
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
        ...(totalAuthRequests
          ? {
              authTransport: {
                totalRequests: totalAuthRequests,
                droppedRequests: totalAuthRequests - authRequests.size,
                ignoredEvents: ignoredAuthEvents,
                requests: [...authRequests.values()].map((entry) => ({
                  ...entry,
                })),
              },
            }
          : {}),
      };
    },
  };
}
