import { Router, type IRouter } from "express";
import { parsePositiveInteger } from "../lib/http-params";
import { readWorkspaceLocale } from "../lib/workspace-locale";
import {
  CodexRecoveryInput,
  CodexRecoveryReceipt,
  CodexRecoveryStatus,
} from "../lib/codex-session-recovery-contract";
import {
  CodexRecoveryScopeConflict,
  recoverCodexSession,
  readCodexSessionRecovery,
  readCodexSessionRecoveryReceipt,
} from "../lib/codex-session-recovery";

/** Mounted behind the app's operator authentication and origin/host guard. */
export function createCodexSessionRecoveryRouter(
  dependencies: {
    readStatus?: typeof readCodexSessionRecovery;
    recover?: typeof recoverCodexSession;
    readReceipt?: typeof readCodexSessionRecoveryReceipt;
    readLocale?: typeof readWorkspaceLocale;
  } = {},
): IRouter {
  const router = Router();
  router.get("/tasks/:taskId/coding-session", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = parsePositiveInteger(req.params.taskId, "taskId");
    if (!id.ok) {
      res.status(400).json({ error: "invalid_recovery_task" });
      return;
    }
    try {
      const status = await (
        dependencies.readStatus ?? readCodexSessionRecovery
      )(id.value);
      if (!status) {
        res.status(404).json({ error: "recovery_task_missing" });
        return;
      }
      res.json(CodexRecoveryStatus.parse(status));
    } catch {
      res.status(503).json({ error: "recovery_status_unavailable" });
    }
  });
  router.get(
    "/tasks/:taskId/coding-session/recover/:requestId",
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const id = parsePositiveInteger(req.params.taskId, "taskId"),
        requestId = CodexRecoveryInput.shape.requestId.safeParse(
          req.params.requestId,
        );
      if (!id.ok || !requestId.success) {
        res.status(400).json({ error: "invalid_recovery_identity" });
        return;
      }
      try {
        const receipt = await (
          dependencies.readReceipt ?? readCodexSessionRecoveryReceipt
        )(id.value, requestId.data);
        if (!receipt) {
          res.status(404).json({ error: "recovery_receipt_missing" });
          return;
        }
        res.json(CodexRecoveryReceipt.parse(receipt));
      } catch {
        res.status(503).json({ error: "recovery_receipt_unavailable" });
      }
    },
  );
  router.post("/tasks/:taskId/coding-session/recover", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = parsePositiveInteger(req.params.taskId, "taskId"),
      input = CodexRecoveryInput.safeParse(req.body);
    if (!id.ok || !input.success) {
      res
        .status(400)
        .json({ error: "explicit_recovery_acknowledgement_required" });
      return;
    }
    try {
      const locale = await (dependencies.readLocale ?? readWorkspaceLocale)();
      const receipt = await (dependencies.recover ?? recoverCodexSession)(
        id.value,
        input.data,
        locale,
      );
      res.json(CodexRecoveryReceipt.parse(receipt));
    } catch (error) {
      res.status(error instanceof CodexRecoveryScopeConflict ? 409 : 503).json({
        error:
          error instanceof CodexRecoveryScopeConflict
            ? "recovery_scope_conflict"
            : "recovery_commit_unconfirmed",
      });
    }
  });
  return router;
}
