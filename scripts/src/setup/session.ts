import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  planInstallation,
  type InstallationPlan,
  type InstallationStep,
} from "./plan";
import { detectInstallCapabilities } from "./preflight";
import { renderSetupPage } from "./page";

export interface InstallationCredentials {
  databaseUrl?: string;
  providerKey?: string;
  ollamaUrl?: string;
}
export interface SetupProgress {
  phase: "idle" | "planned" | "installing" | "complete" | "failed";
  step: InstallationStep | null;
  completedSteps: InstallationStep[];
  error: string | null;
  url: string | null;
  phoneUrl?: string;
  connectionAvailable?: boolean;
}
export type InstallationExecutor = (
  plan: InstallationPlan,
  credentials: InstallationCredentials,
  progress: (step: InstallationStep, completed: boolean) => void,
) => Promise<{ url: string; operatorToken?: string; phoneUrl?: string }>;

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"] !== "application/json")
    throw new RequestFailure(415, "json_required");
  if (request.headers["content-encoding"])
    throw new RequestFailure(415, "encoding_unsupported");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 16384) throw new RequestFailure(413, "request_too_large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestFailure(400, "invalid_json");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestFailure(400, "invalid_request");
  return value as Record<string, unknown>;
}

function credentialsFrom(value: unknown): InstallationCredentials {
  const entry = record(value);
  const allowed = new Set(["databaseUrl", "providerKey", "ollamaUrl"]);
  const result: InstallationCredentials = {};
  for (const [key, val] of Object.entries(entry)) {
    if (
      !allowed.has(key) ||
      typeof val !== "string" ||
      val.length > 4096 ||
      /[\r\n\0]/u.test(val)
    )
      throw new RequestFailure(400, "invalid_credentials");
    result[key as keyof InstallationCredentials] = val;
  }
  return result;
}

export async function createSetupSession(options: {
  capabilities?: typeof detectInstallCapabilities;
  execute: InstallationExecutor;
  renderPage?: (nonce: string) => string;
  now?: () => number;
  lifetimeMs?: number;
}) {
  const token = randomBytes(32).toString("base64url");
  const expectedToken = Buffer.from(`Bearer ${token}`);
  const now = options.now ?? Date.now;
  const lifetime = options.lifetimeMs ?? 60 * 60_000;
  if (
    !Number.isSafeInteger(lifetime) ||
    lifetime < 1000 ||
    lifetime > 4 * 60 * 60_000
  )
    throw new TypeError("Invalid setup lifetime");
  const expiresAt = now() + lifetime;
  const detect = options.capabilities ?? detectInstallCapabilities;
  const state: SetupProgress = {
    phase: "idle",
    step: null,
    completedSteps: [],
    error: null,
    url: null,
  };
  let plan: InstallationPlan | null = null;
  let execution: Promise<void> | null = null;
  let connectionToken: string | null = null;
  let origin = "";

  function json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(body));
  }
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    const nonce = randomBytes(24).toString("base64url");
    response.setHeader(
      "content-security-policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
    );
    const handle = async () => {
      if (request.headers.host !== new URL(origin).host)
        throw new RequestFailure(403, "host_rejected");
      const path = request.url;
      if (request.method === "GET" && path === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end((options.renderPage ?? renderSetupPage)(nonce));
        return;
      }
      const suppliedToken = Buffer.from(request.headers.authorization ?? "");
      if (
        now() >= expiresAt ||
        suppliedToken.length !== expectedToken.length ||
        !timingSafeEqual(suppliedToken, expectedToken)
      )
        throw new RequestFailure(401, "session_required");
      const suppliedOrigin = request.headers.origin;
      if (
        (suppliedOrigin !== undefined && suppliedOrigin !== origin) ||
        (request.headers["sec-fetch-site"] &&
          request.headers["sec-fetch-site"] !== "same-origin") ||
        (request.method === "POST" && suppliedOrigin !== origin)
      )
        throw new RequestFailure(403, "origin_rejected");
      if (request.method === "GET" && path === "/api/state") {
        json(response, 200, state);
        return;
      }
      if (request.method === "GET" && path === "/api/capabilities") {
        json(response, 200, await detect());
        return;
      }
      if (request.method === "POST" && path === "/api/connection") {
        const body = record(await readJson(request));
        if (Object.keys(body).length)
          throw new RequestFailure(400, "invalid_request");
        if (state.phase !== "complete" || !connectionToken)
          throw new RequestFailure(409, "connection_unavailable");
        const key = connectionToken;
        connectionToken = null;
        state.connectionAvailable = false;
        json(response, 200, { operatorToken: key });
        return;
      }
      if (request.method === "POST" && path === "/api/plan") {
        if (execution)
          throw new RequestFailure(409, "installation_already_started");
        const input = await readJson(request);
        // The capability probe is asynchronous. Recheck admission after it so a
        // concurrent install request cannot replace the reviewed plan.
        const capabilities = await detect();
        if (execution)
          throw new RequestFailure(409, "installation_already_started");
        try {
          plan = planInstallation(input, capabilities);
        } catch {
          throw new RequestFailure(400, "invalid_plan_or_prerequisites");
        }
        state.phase = "planned";
        json(response, 200, plan);
        return;
      }
      if (request.method === "POST" && path === "/api/install") {
        const body = record(await readJson(request));
        if (
          Object.keys(body).some(
            (key) => key !== "planId" && key !== "credentials",
          )
        )
          throw new RequestFailure(400, "invalid_request");
        if (!plan || body.planId !== plan.id)
          throw new RequestFailure(409, "plan_changed");
        if (state.phase === "installing") {
          json(response, 202, state);
          return;
        }
        if (execution)
          throw new RequestFailure(409, "installation_already_started");
        const credentials = credentialsFrom(body.credentials);
        state.phase = "installing";
        const reviewedPlan = plan;
        execution = Promise.resolve()
          .then(() =>
            options.execute(reviewedPlan, credentials, (step, completed) => {
              if (!reviewedPlan.steps.includes(step))
                throw Error("Invalid installation step");
              state.step = step;
              if (completed && !state.completedSteps.includes(step))
                state.completedSteps.push(step);
            }),
          )
          .then((result) => {
            state.url = result.url;
            state.phoneUrl = result.phoneUrl;
            connectionToken = result.operatorToken ?? null;
            state.connectionAvailable = Boolean(connectionToken);
            state.phase = "complete";
          })
          .catch(() => {
            state.error = "installation_failed";
            state.phase = "failed";
          })
          .finally(() => {
            delete credentials.databaseUrl;
            delete credentials.providerKey;
            delete credentials.ollamaUrl;
          });
        json(response, 202, state);
        return;
      }
      throw new RequestFailure(404, "not_found");
    };
    void handle().catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      json(response, error instanceof RequestFailure ? error.status : 500, {
        error: error instanceof RequestFailure ? error.code : "setup_failed",
      });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Setup listener unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    token,
    url: `${origin}/#${token}`,
    settled: () => execution ?? Promise.resolve(),
    close: async () => {
      await execution;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
