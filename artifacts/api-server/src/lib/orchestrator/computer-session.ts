import { randomUUID } from "node:crypto";

export type ComputerSurface = "computer" | "browser" | "terminal" | "files";
export type ComputerStepStatus = "running" | "succeeded" | "failed" | "blocked";
export type ComputerStepPhase = "observe" | "decide" | "act" | "verify";

export interface ComputerStep {
  sessionId: string;
  sequence: number;
  surface: ComputerSurface;
  previousSurface: Exclude<ComputerSurface, "computer"> | null;
  transition: boolean;
  tool: string;
  phase: ComputerStepPhase;
  status: ComputerStepStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  evidence: string | null;
}

export interface ComputerSessionSnapshot {
  sessionId: string;
  activeSurface: Exclude<ComputerSurface, "computer"> | null;
  sequence: number;
  updatedAt: string;
  recentSteps: ComputerStep[];
}

interface MutableComputerSession {
  sessionId: string;
  activeSurface: Exclude<ComputerSurface, "computer"> | null;
  sequence: number;
  updatedAt: string;
  recentSteps: ComputerStep[];
  stepScopes: Map<number, string | null>;
  pendingVerification: {
    scope: string;
    surface: Exclude<ComputerSurface, "computer">;
    sequence: number;
  } | null;
}

const MAX_RECENT_STEPS = 12;
const MAX_TRACKED_AGENTS = 1_000;
const MAX_EVIDENCE_CHARS = 320;
const sessions = new Map<number, MutableComputerSession>();

const OBSERVATION_TOOLS = new Set([
  "computer_observe",
  "browser_snapshot",
  "browser_extract_text",
  "browser_wait",
  "browser_save_screenshot",
  "vm_list_files",
  "vm_read_file",
]);

function inferPhase(
  tool: string,
  session: MutableComputerSession,
  surface: ComputerSurface,
  verificationScope: string | null,
): ComputerStepPhase {
  if (!OBSERVATION_TOOLS.has(tool)) return "act";
  const pending = session.pendingVerification;
  if (
    !pending ||
    !verificationScope ||
    pending.scope !== verificationScope ||
    (surface !== "computer" && pending.surface !== surface)
  ) {
    return "observe";
  }
  session.pendingVerification = null;
  return "verify";
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanEvidence(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, MAX_EVIDENCE_CHARS) : null;
}

function getOrCreateSession(agentId: number): MutableComputerSession {
  let session = sessions.get(agentId);
  if (session) return session;

  if (sessions.size >= MAX_TRACKED_AGENTS) {
    const oldest = [...sessions.entries()].sort((a, b) =>
      a[1].updatedAt.localeCompare(b[1].updatedAt),
    )[0];
    if (oldest) sessions.delete(oldest[0]);
  }

  session = {
    sessionId: `computer:${process.pid}:${randomUUID()}`,
    activeSurface: null,
    sequence: 0,
    updatedAt: nowIso(),
    recentSteps: [],
    stepScopes: new Map(),
    pendingVerification: null,
  };
  sessions.set(agentId, session);
  return session;
}

/**
 * Begins a real computer operation. `computer` is an observation across all
 * surfaces and deliberately does not move the active-surface pointer.
 */
export function beginComputerStep(
  agentId: number,
  surface: ComputerSurface,
  tool: string,
  phaseOverride?: ComputerStepPhase,
  switchSurface = true,
  verificationScope?: string,
): ComputerStep {
  const session = getOrCreateSession(agentId);
  const previousSurface = session.activeSurface;
  const nextSurface =
    !switchSurface || surface === "computer" ? previousSurface : surface;
  const step: ComputerStep = {
    sessionId: session.sessionId,
    sequence: ++session.sequence,
    surface,
    previousSurface,
    transition:
      switchSurface &&
      surface !== "computer" &&
      previousSurface !== null &&
      previousSurface !== surface,
    tool,
    phase:
      phaseOverride ??
      inferPhase(tool, session, surface, verificationScope ?? null),
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    durationMs: null,
    evidence: null,
  };

  if (step.phase === "act") session.pendingVerification = null;
  session.stepScopes.set(step.sequence, verificationScope ?? null);

  session.activeSurface = nextSurface;
  session.updatedAt = step.startedAt;
  session.recentSteps.push(step);
  if (session.recentSteps.length > MAX_RECENT_STEPS) {
    session.recentSteps.splice(
      0,
      session.recentSteps.length - MAX_RECENT_STEPS,
    );
  }
  return { ...step };
}

export function recordComputerDecision(
  agentId: number,
  surface: ComputerSurface,
  selectedTool: string,
): ComputerStep {
  const started = beginComputerStep(
    agentId,
    surface,
    `decide:${selectedTool}`,
    "decide",
    false,
  );
  return finishComputerStep(
    agentId,
    started,
    "succeeded",
    `selectedTool=${selectedTool}`,
  );
}

export function finishComputerStep(
  agentId: number,
  step: ComputerStep,
  status: Exclude<ComputerStepStatus, "running">,
  evidence?: unknown,
): ComputerStep {
  const session = getOrCreateSession(agentId);
  const finishedAt = nowIso();
  const durationMs = Math.max(
    0,
    new Date(finishedAt).getTime() - new Date(step.startedAt).getTime(),
  );
  const finished: ComputerStep = {
    ...step,
    status,
    finishedAt,
    durationMs,
    evidence: cleanEvidence(evidence),
  };
  const verificationScope = session.stepScopes.get(step.sequence) ?? null;
  session.stepScopes.delete(step.sequence);
  if (finished.phase === "act") {
    session.pendingVerification =
      status === "succeeded" &&
      verificationScope &&
      finished.surface !== "computer"
        ? {
            scope: verificationScope,
            surface: finished.surface,
            sequence: finished.sequence,
          }
        : null;
  }
  const index = session.recentSteps.findIndex(
    (candidate) => candidate.sequence === step.sequence,
  );
  if (index >= 0) session.recentSteps[index] = finished;
  else session.recentSteps.push(finished);
  session.updatedAt = finishedAt;
  return { ...finished };
}

export function getComputerSessionSnapshot(
  agentId: number,
): ComputerSessionSnapshot {
  const session = getOrCreateSession(agentId);
  return {
    sessionId: session.sessionId,
    activeSurface: session.activeSurface,
    sequence: session.sequence,
    updatedAt: session.updatedAt,
    recentSteps: session.recentSteps.map((step) => ({ ...step })),
  };
}

export function computerStepDetail(
  step: ComputerStep,
  detail: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sessionId: step.sessionId,
    sequence: step.sequence,
    actor: "agent",
    owner: "agent",
    surface: step.surface,
    previousSurface: step.previousSurface,
    transition: step.transition,
    phase: step.phase,
    lifecyclePhase: step.finishedAt ? "completed" : "running",
    tool: step.tool,
    status: step.status,
    durationMs: step.durationMs,
    ...detail,
  };
}

export function formatComputerStep(
  step: ComputerStep,
  body: string,
  startLabel = "başlangıç",
): string {
  const transition = step.transition
    ? ` | ${step.previousSurface ?? startLabel} → ${step.surface}`
    : "";
  const status =
    step.status === "succeeded"
      ? "OK"
      : step.status === "failed"
        ? "FAILED"
        : step.status === "blocked"
          ? "BLOCKED"
          : "RUNNING";
  return [
    `[COMPUTER STEP #${step.sequence} | ${step.surface.toUpperCase()} | ${status}${transition}]`,
    body,
  ].join("\n");
}

/** Test-only reset; no production caller should erase the live trace. */
export function resetComputerSessionsForTests(): void {
  sessions.clear();
}
