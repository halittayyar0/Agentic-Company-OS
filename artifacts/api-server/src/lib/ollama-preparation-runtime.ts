import { randomUUID } from "node:crypto";
import { refreshModelCatalog } from "@workspace/ai-server";
import { requireHttpRuntimeHandle } from "./http-runtime-context";
import type { RuntimeInstanceHandle } from "./orchestrator/runtime-instance-registry";
import { readProviderRuntimeConfigSnapshot } from "./provider-runtime-config";
import { createOllamaPreparationStore } from "./ollama-preparation-store";
import { createOllamaPreparationTransport } from "./ollama-preparation-transport";
import {
  createOllamaModelPreparation,
  OllamaPreparationServiceError,
  type OllamaModelPreparation,
} from "./ollama-model-preparation";

let active: {
  handle: RuntimeInstanceHandle;
  service: OllamaModelPreparation;
} | null = null;

export async function initializeOllamaPreparationRuntime(
  handle: RuntimeInstanceHandle,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  if (requireHttpRuntimeHandle() !== handle || active !== null)
    throw new OllamaPreparationServiceError("SERVICE_UNAVAILABLE");
  const store = createOllamaPreparationStore({
    runtimeId: handle.id,
    epoch: randomUUID(),
  });
  await store.reconcile();
  active = {
    handle,
    service: createOllamaModelPreparation({
      store,
      environment,
      readState: () => readProviderRuntimeConfigSnapshot(environment),
      transport: createOllamaPreparationTransport(),
      refreshCatalog: refreshModelCatalog,
    }),
  };
}

export function requireOllamaPreparationRuntime(): OllamaModelPreparation {
  if (!active || requireHttpRuntimeHandle() !== active.handle)
    throw new OllamaPreparationServiceError("SERVICE_UNAVAILABLE");
  return active.service;
}

export async function closeOllamaPreparationRuntime(
  handle: RuntimeInstanceHandle,
): Promise<void> {
  if (active?.handle !== handle) return;
  const current = active;
  await current.service.close();
  if (active === current) active = null;
}
