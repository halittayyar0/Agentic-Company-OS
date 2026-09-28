export interface RuntimeProbeOptions {
  baseUrl: string;
  operatorToken: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

export interface RuntimeTopologyProbe {
  ready: boolean;
  apiInstances: number;
  workerInstances: number;
  schedulerWorkers: number;
  healthyWorkerIds: string[];
}

const SAFE_RUNTIME_INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/u;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validatedLoopbackUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username || url.password) {
    throw new TypeError("Runtime probe requires a loopback HTTP URL");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1" &&
    hostname !== "[::1]"
  ) {
    throw new TypeError("Runtime probe requires a loopback host");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function requestJson(
  baseUrl: URL,
  pathname: string,
  options: RuntimeProbeOptions,
): Promise<Record<string, unknown>> {
  if (!options.operatorToken.trim()) {
    throw new TypeError("operatorToken is required");
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.requestTimeoutMs ?? 5_000,
  );
  timer.unref?.();
  try {
    const response = await (options.fetchImpl ?? fetch)(
      new URL(pathname, baseUrl),
      {
        headers: { authorization: `Bearer ${options.operatorToken}` },
        redirect: "error",
        signal: controller.signal,
      },
    );
    const body = asRecord(await response.json(), pathname);
    if (!response.ok) {
      throw new Error(`${pathname} returned HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeRuntimeTopology(
  options: RuntimeProbeOptions,
): Promise<RuntimeTopologyProbe> {
  const baseUrl = validatedLoopbackUrl(options.baseUrl);
  const ready = await requestJson(baseUrl, "/api/readyz", options);
  if (ready.status !== "ready") {
    throw new Error("API readiness did not report ready");
  }
  const response = await requestJson(baseUrl, "/api/ops/instances", options);
  if (!Array.isArray(response.instances)) {
    throw new TypeError("Runtime instance response is missing instances");
  }
  const instances = response.instances.map((item, index) =>
    asRecord(item, `runtime instance ${index}`),
  );
  const healthy = instances.filter((item) => item.effectiveState === "healthy");
  const apiInstances = healthy.filter((item) => item.role === "api").length;
  const workerInstances = healthy.filter(
    (item) => item.role === "worker",
  ).length;
  const schedulerWorkers = healthy.filter(
    (item) => item.role === "worker" && item.schedulerEnabled === true,
  );
  if (apiInstances !== 1) {
    throw new Error(
      `Endurance topology requires one healthy API, found ${apiInstances}`,
    );
  }
  if (workerInstances !== 2 || schedulerWorkers.length !== 2) {
    throw new Error(
      "Endurance topology requires exactly two healthy scheduler workers",
    );
  }
  if (
    instances.some(
      (item) => item.role === "api" && item.schedulerEnabled === true,
    )
  ) {
    throw new Error("API-only runtime must never enable the scheduler");
  }
  const healthyWorkerIds = schedulerWorkers.map((item) => {
    if (
      typeof item.id !== "string" ||
      !SAFE_RUNTIME_INSTANCE_ID.test(item.id)
    ) {
      throw new TypeError(
        "Healthy scheduler worker is missing a safe runtime id",
      );
    }
    return item.id;
  });
  if (new Set(healthyWorkerIds).size !== healthyWorkerIds.length) {
    throw new Error("Healthy scheduler worker runtime ids must be unique");
  }
  healthyWorkerIds.sort();
  return {
    ready: true,
    apiInstances,
    workerInstances,
    schedulerWorkers: schedulerWorkers.length,
    healthyWorkerIds,
  };
}

export async function waitForRuntimeTopology(
  options: RuntimeProbeOptions,
  timing: { timeoutMs: number; intervalMs?: number },
): Promise<RuntimeTopologyProbe> {
  if (!Number.isFinite(timing.timeoutMs) || timing.timeoutMs <= 0) {
    throw new TypeError("topology timeoutMs must be positive");
  }
  const deadline = Date.now() + timing.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await probeRuntimeTopology(options);
    } catch (error) {
      lastError = error;
    }
    await delay(
      Math.min(timing.intervalMs ?? 250, Math.max(1, deadline - Date.now())),
    );
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `Runtime topology did not become ready within ${timing.timeoutMs}ms${detail}`,
  );
}

export async function waitForRuntimeWorkerReplacement(
  options: RuntimeProbeOptions,
  timing: {
    previousWorkerIds: readonly string[];
    timeoutMs: number;
    intervalMs?: number;
  },
): Promise<RuntimeTopologyProbe> {
  if (!Number.isFinite(timing.timeoutMs) || timing.timeoutMs <= 0) {
    throw new TypeError("worker replacement timeoutMs must be positive");
  }
  const previousWorkerIds = new Set(timing.previousWorkerIds);
  if (
    previousWorkerIds.size !== timing.previousWorkerIds.length ||
    [...previousWorkerIds].some((id) => !SAFE_RUNTIME_INSTANCE_ID.test(id))
  ) {
    throw new TypeError(
      "previousWorkerIds must contain unique safe runtime ids",
    );
  }
  const deadline = Date.now() + timing.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const topology = await probeRuntimeTopology(options);
      if (topology.healthyWorkerIds.some((id) => !previousWorkerIds.has(id))) {
        return topology;
      }
      lastError = new Error(
        "Healthy worker topology still contains only pre-restart runtime ids",
      );
    } catch (error) {
      lastError = error;
    }
    await delay(
      Math.min(timing.intervalMs ?? 250, Math.max(1, deadline - Date.now())),
    );
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `Replacement worker did not become healthy within ${timing.timeoutMs}ms${detail}`,
  );
}
