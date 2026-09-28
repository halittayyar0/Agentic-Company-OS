import { createOperatorMutationRouter } from "./operator-mutations";
import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import {
  GetVmStatusResponse,
  ListVmFilesResponse,
  ReadVmFileResponse,
  WriteVmFileBody,
  WriteVmFileResponse,
  DeleteVmFileResponse,
  DeleteVmFileBody,
  PreviewVmDeletionBody,
  PreviewVmDeletionResponse,
  GetModelCatalogResponse,
  GetBrowserViewResponse,
  GetBrowserControlResponse,
} from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { activityEventsTable, agentsTable, db } from "@workspace/db";
import { refreshModelCatalog } from "@workspace/ai-server";
import { describeAvailableModels } from "../lib/orchestrator/model-select";
import { logger } from "../lib/logger";
import {
  VmError,
  VmFileEditError,
  VmFileMissingError,
  VmDeleteReviewError,
  previewDeletion,
  deleteEntry,
  ensureSandbox,
  listDirectory,
  readTextFile,
  writeTextFile,
  getVmStatus,
} from "../lib/vm/sandbox";
import {
  captureView,
  getBrowserControlState,
  BrowserActionOutcomeUnknownError,
} from "../lib/vm/browser";
import {
  assertExecutionAllowed,
  EmergencyStopError,
} from "../lib/orchestrator/runtime-emergency-stop";
import { LocalEmergencyStopError } from "../lib/orchestrator/local-emergency-epoch";
import { redactAuditText } from "../lib/audit-redaction";
import {
  dispatchBrowserRuntimeCommand,
  noBrowserSessionResponse,
  RuntimeControlUnavailableError,
} from "../lib/runtime-control-api";

const router: IRouter = Router();
const operatorActivitySessionId = `operator:${process.pid}:${randomUUID()}`;
const operatorActivitySequences = new Map<number, number>();
const splitApiRole = process.env.RUNTIME_ROLE === "api";

const emptyBrowserControl = {
  owner: "agent" as const,
  leaseId: null,
  leaseExpiresAt: null,
  agentActionInFlight: false,
};

function emptyBrowserView(note = "Oturum yok - once kontrolu devral.") {
  return {
    available: false,
    pngBase64: null,
    url: null,
    title: null,
    visible: false,
    control: emptyBrowserControl,
    width: 1280,
    height: 800,
    note,
  };
}

function respondRuntimeControlError(res: Response, error: unknown): boolean {
  if (error instanceof BrowserActionOutcomeUnknownError) {
    res.status(503).json({
      code: "BROWSER_RUNTIME_OUTCOME_UNKNOWN",
      error:
        "The browser action was sent, but its outcome is unknown. Do not replay it automatically.",
    });
    return true;
  }
  if (
    error instanceof EmergencyStopError ||
    error instanceof LocalEmergencyStopError
  ) {
    res.status(423).json({
      code: "EMERGENCY_STOP_ACTIVE",
      error: "Browser changes are unavailable while emergency stop is active.",
    });
    return true;
  }
  if (!(error instanceof RuntimeControlUnavailableError)) return false;
  res.status(error.status).json({ code: error.code, error: error.message });
  return true;
}

export interface OperatorActivityHandle {
  id: number | null;
  agentId: number;
  sequence: number;
  surface: "browser" | "terminal" | "files";
  tool: string;
  startedAt: number;
  detail: Record<string, unknown>;
}

function operatorActivityType(
  surface: OperatorActivityHandle["surface"],
): "vm_command" | "vm_file" | "note" {
  return surface === "terminal"
    ? "vm_command"
    : surface === "files"
      ? "vm_file"
      : "note";
}

async function beginOperatorActivity(
  agentId: number,
  surface: OperatorActivityHandle["surface"],
  tool: string,
  detail: Record<string, unknown> = {},
): Promise<OperatorActivityHandle> {
  const sequence = (operatorActivitySequences.get(agentId) ?? 0) + 1;
  operatorActivitySequences.set(agentId, sequence);
  const handle: OperatorActivityHandle = {
    id: null,
    agentId,
    sequence,
    surface,
    tool,
    startedAt: Date.now(),
    detail,
  };
  try {
    const [event] = await db
      .insert(activityEventsTable)
      .values({
        agentId,
        taskId: null,
        type: operatorActivityType(surface),
        summary: `Operator bilgisayar adımına başladı: ${tool.replaceAll("_", " ")}.`,
        detail: {
          ...detail,
          sessionId: `${operatorActivitySessionId}:${agentId}`,
          sequence,
          actor: "operator",
          owner: "operator",
          surface,
          phase: "act",
          lifecyclePhase: "running",
          tool,
          status: "running",
          durationMs: null,
        },
        severity: "info",
      })
      .returning({ id: activityEventsTable.id });
    handle.id = event?.id ?? null;
  } catch (error) {
    logger.error(
      { error, agentId, tool },
      "operator activity start persistence failed",
    );
  }
  return handle;
}

async function finishOperatorActivity(
  handle: OperatorActivityHandle,
  summary: string,
  status: "succeeded" | "failed" | "blocked" | "unknown",
  detail: Record<string, unknown> = {},
  severity: "info" | "warning" | "critical" = "info",
): Promise<void> {
  const values = {
    agentId: handle.agentId,
    taskId: null,
    type: operatorActivityType(handle.surface),
    summary,
    detail: {
      sessionId: `${operatorActivitySessionId}:${handle.agentId}`,
      sequence: handle.sequence,
      actor: "operator",
      owner: "operator",
      surface: handle.surface,
      phase: "act",
      lifecyclePhase: "completed",
      tool: handle.tool,
      status,
      durationMs: Date.now() - handle.startedAt,
      ...handle.detail,
      ...detail,
    },
    severity,
  };
  try {
    if (handle.id !== null) {
      const updated = await db
        .update(activityEventsTable)
        .set(values)
        .where(eq(activityEventsTable.id, handle.id))
        .returning({ id: activityEventsTable.id });
      if (updated.length > 0) return;
    }
    await db.insert(activityEventsTable).values(values);
  } catch (error) {
    logger.error(
      { error, agentId: handle.agentId, tool: handle.tool },
      "operator activity completion persistence failed",
    );
  }
}

router.use(
  createOperatorMutationRouter({
    begin: beginOperatorActivity,
    finish: finishOperatorActivity,
  }),
);

router.param("agentId", async (req, res, next, rawAgentId): Promise<void> => {
  const agentId = Number(rawAgentId);
  if (!Number.isSafeInteger(agentId) || agentId <= 0 || agentId > 2147483647) {
    res.status(400).json({ error: "Resource id must be a positive integer" });
    return;
  }

  try {
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1);
    if (!agent) {
      res.status(404).json({ error: "Ajan bulunamadi." });
      return;
    }
    next();
  } catch (error) {
    logger.error({ error, agentId }, "agent capability lookup failed");
    res.status(500).json({ error: "Ajan yetkileri dogrulanamadi." });
  }
});

router.get("/model-catalog", async (_req, res): Promise<void> => {
  await refreshModelCatalog();
  res.json(GetModelCatalogResponse.parse(describeAvailableModels()));
});

router.get("/agents/:agentId/vm/status", (req, res): void => {
  const agentId = Number(req.params.agentId);
  getVmStatus(agentId)
    .then((summary) => res.json(GetVmStatusResponse.parse(summary)))
    .catch(() => res.status(500).json({ error: "VM durumu okunamadi." }));
});

router.post(
  "/agents/:agentId/vm/files-list",
  async (req, res): Promise<void> => {
    const agentId = Number(req.params.agentId);
    await ensureSandbox(agentId);
    const relPath = typeof req.body?.path === "string" ? req.body.path : "";
    try {
      const listing = await listDirectory(agentId, relPath);
      res.json(ListVmFilesResponse.parse(listing));
    } catch (error) {
      if (error instanceof VmError) {
        res.status(400).json({ error: error.message });
        return;
      }
      logger.error({ error, agentId }, "VM directory listing failed");
      res.status(500).json({ error: "Dizin listelenemedi." });
    }
  },
);

router.post(
  "/agents/:agentId/vm/file-read",
  async (req, res): Promise<void> => {
    const agentId = Number(req.params.agentId);
    const relPath = typeof req.body?.path === "string" ? req.body.path : "";
    try {
      const file = await readTextFile(agentId, relPath);
      res.json(ReadVmFileResponse.parse(file));
    } catch (error) {
      if (error instanceof VmFileMissingError) {
        res.status(404).json({ code: error.code, error: error.message });
        return;
      }
      if (error instanceof VmError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res
        .status(500)
        .json({ error: "Dosya okunurken beklenmeyen bir hata olustu." });
    }
  },
);

router.put(
  "/agents/:agentId/vm/file-write",
  async (req, res): Promise<void> => {
    const agentId = Number(req.params.agentId);
    const parsed = WriteVmFileBody.strict().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "VM_FILE_INVALID_INPUT",
        error: "A reviewed file version or missing-only creation is required.",
      });
      return;
    }
    const activity = await beginOperatorActivity(
      agentId,
      "files",
      "vm_write_file",
      { path: redactAuditText(parsed.data.path, 1_000) },
    );
    try {
      const result = await writeTextFile(
        agentId,
        parsed.data.path,
        parsed.data.content,
        undefined,
        assertExecutionAllowed,
        { expectedVersion: parsed.data.expectedVersion },
      );
      await finishOperatorActivity(
        activity,
        "Operator ajan çalışma alanına dosya yazdı.",
        "succeeded",
        { path: result.path, sizeBytes: result.sizeBytes },
      );
      res.json(WriteVmFileResponse.parse(result));
    } catch (error) {
      await finishOperatorActivity(
        activity,
        "Operator çalışma alanına dosya yazamadı.",
        "failed",
        {
          error: redactAuditText(
            error instanceof Error ? error.message : "unknown",
            300,
          ),
        },
        "warning",
      );
      if (error instanceof VmFileEditError) {
        res
          .status(error.code === "VM_FILE_CHANGED" ? 409 : 422)
          .json({ code: error.code, error: error.message });
        return;
      }
      if (
        error instanceof EmergencyStopError ||
        error instanceof LocalEmergencyStopError
      ) {
        res.status(403).json({
          code: "EMERGENCY_STOP_ACTIVE",
          error: "File changes are paused.",
        });
        return;
      }
      if (error instanceof VmError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Dosya yazilamadi." });
    }
  },
);

function respondDeleteReviewError(res: Response, error: unknown): boolean {
  if (!(error instanceof VmDeleteReviewError)) return false;
  res
    .status(
      error.code === "VM_DELETE_CHANGED"
        ? 409
        : error.code === "VM_DELETE_MISSING"
          ? 404
          : 422,
    )
    .json({ code: error.code, error: error.message });
  return true;
}

router.post(
  "/agents/:agentId/vm/file-delete-preview",
  async (req, res): Promise<void> => {
    const parsed = PreviewVmDeletionBody.strict().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "VM_DELETE_INVALID_INPUT",
        error: "A relative target path is required.",
      });
      return;
    }
    try {
      res.json(
        PreviewVmDeletionResponse.parse(
          await previewDeletion(Number(req.params.agentId), parsed.data.path),
        ),
      );
    } catch (error) {
      if (respondDeleteReviewError(res, error)) return;
      res.status(error instanceof VmError ? 400 : 500).json({
        code: "VM_DELETE_NOT_REVIEWABLE",
        error: "The deletion scope could not be inspected.",
      });
    }
  },
);

router.delete(
  "/agents/:agentId/vm/file-delete",
  async (req, res): Promise<void> => {
    const agentId = Number(req.params.agentId);
    const parsed = DeleteVmFileBody.strict().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "VM_DELETE_INVALID_INPUT",
        error: "An exact reviewed deletion version is required.",
      });
      return;
    }
    const relPath = parsed.data.path;
    const activity = await beginOperatorActivity(
      agentId,
      "files",
      "vm_delete_file",
      { path: redactAuditText(relPath, 1_000) },
    );
    try {
      const result = await deleteEntry(
        agentId,
        relPath,
        undefined,
        assertExecutionAllowed,
        { expectedVersion: parsed.data.expectedVersion },
      );
      await finishOperatorActivity(
        activity,
        "Operator ajan çalışma alanından bir öğe sildi.",
        "succeeded",
        { path: result.path },
        "warning",
      );
      res.json(DeleteVmFileResponse.parse(result));
    } catch (error) {
      await finishOperatorActivity(
        activity,
        "Operator silme isteğinin tamamlandığı doğrulanamadı.",
        "failed",
        {
          error: redactAuditText(
            error instanceof Error ? error.message : "unknown",
            300,
          ),
        },
        "warning",
      );
      if (respondDeleteReviewError(res, error)) return;
      if (
        error instanceof EmergencyStopError ||
        error instanceof LocalEmergencyStopError
      ) {
        res.status(403).json({
          code: "EMERGENCY_STOP_ACTIVE",
          error: "File changes are paused.",
        });
        return;
      }
      if (error instanceof VmError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Silme islemi basarisiz." });
    }
  },
);

// --- operator browser control ---------------------------------------------

router.get(
  "/agents/:agentId/browser/control",
  async (req, res): Promise<void> => {
    const agentId = Number(req.params.agentId);
    try {
      const state =
        splitApiRole && (await noBrowserSessionResponse(agentId))
          ? emptyBrowserControl
          : splitApiRole
            ? await dispatchBrowserRuntimeCommand({
                kind: "browser_control_state",
                agentId,
              })
            : await getBrowserControlState(agentId);
      res.json(GetBrowserControlResponse.parse(state));
    } catch (error) {
      if (!respondRuntimeControlError(res, error)) throw error;
    }
  },
);

router.get("/agents/:agentId/browser/view", async (req, res): Promise<void> => {
  const agentId = Number(req.params.agentId);
  try {
    const view =
      splitApiRole && (await noBrowserSessionResponse(agentId))
        ? emptyBrowserView()
        : splitApiRole
          ? await dispatchBrowserRuntimeCommand({
              kind: "browser_view",
              agentId,
            })
          : await captureView(agentId);
    res.json(GetBrowserViewResponse.parse(view));
  } catch (error) {
    if (respondRuntimeControlError(res, error)) return;
    const safeError = redactAuditText(
      error instanceof Error ? error.message : "browser view failed",
      200,
    );
    logger.error({ error: safeError, agentId }, "browser view failed");
    res.status(503).json({
      code: "BROWSER_VIEW_UNAVAILABLE",
      error: "The browser view could not be read.",
    });
  }
});

export default router;
