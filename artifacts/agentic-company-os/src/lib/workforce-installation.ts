import type { WorkforceBlueprintInstallInput } from "@workspace/api-client-react";
import { isLocale } from "./i18n";

export const WORKFORCE_INTENT_KEY = "acos.workforce-intent.v1";
export type WorkforceIntent = {
  blueprintKey: string;
  data: WorkforceBlueprintInstallInput & { requestId: string };
};

/** Session storage preserves a pending request through route changes/reloads, not tab closure. */
export function readWorkforceIntent(): WorkforceIntent | null {
  try {
    const value = sessionStorage.getItem(WORKFORCE_INTENT_KEY);
    if (!value || value.length > 40_000) return null;
    const intent = JSON.parse(value) as WorkforceIntent;
    const data = intent?.data;
    if (
      typeof intent?.blueprintKey !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(intent.blueprintKey) ||
      !data ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        data.requestId,
      ) ||
      !isLocale(data.locale) ||
      !Number.isInteger(data.managerAgentId) ||
      data.managerAgentId < 1 ||
      !Number.isInteger(data.blueprintVersion) ||
      data.blueprintVersion! < 1 ||
      (data.outcome !== undefined &&
        (typeof data.outcome !== "string" ||
          data.outcome.trim().length < 3 ||
          data.outcome.length > 8000)) ||
      (data.autonomyMode !== undefined &&
        !["finite", "continuous"].includes(data.autonomyMode)) ||
      (data.cadenceSeconds !== undefined &&
        (!Number.isInteger(data.cadenceSeconds) ||
          data.cadenceSeconds < 60 ||
          data.cadenceSeconds > 604800))
    )
      return null;
    return intent;
  } catch {
    return null;
  }
}

export function saveWorkforceIntent(intent: WorkforceIntent): boolean {
  try {
    sessionStorage.setItem(WORKFORCE_INTENT_KEY, JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}
export function clearWorkforceIntent(): void {
  try {
    sessionStorage.removeItem(WORKFORCE_INTENT_KEY);
  } catch {
    /* A persisted replay is still safe. */
  }
}

export function workforceRejection(
  error: unknown,
):
  | "stopped"
  | "versionChanged"
  | "managerChanged"
  | "capacity"
  | "rejected"
  | null {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "EMERGENCY_STOP_ACTIVE") return "stopped";
  if (code === "WORKFORCE_BLUEPRINT_VERSION_CHANGED") return "versionChanged";
  if (
    [
      "MANAGER_AGENT_NOT_FOUND",
      "MANAGER_AGENT_INACTIVE",
      "MANAGER_CANNOT_CREATE_SUBAGENTS",
    ].includes(code ?? "")
  )
    return "managerChanged";
  if (code === "RUNTIME_CAPACITY_EXCEEDED") return "capacity";
  if (
    code === "WORKFORCE_BLUEPRINT_NOT_FOUND" ||
    code === "WORKFORCE_INSTALLATION_INVALID"
  )
    return "rejected";
  // Transport/proxy/parse failures cannot prove that the transaction rolled back.
  return null;
}
