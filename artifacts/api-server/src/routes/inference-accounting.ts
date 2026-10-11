import { Router, type IRouter } from "express";
import { parsePositiveInteger } from "../lib/http-params";
import { readInferenceAccountingStatus } from "../lib/inference-accounting-status";
import { GetInferenceAccountingStatusResponse } from "@workspace/api-zod";
import { z } from "zod/v4";
import {
  AccountingRecoveryConflict,
  reconcileScopedInferenceEvidence,
} from "../lib/inference-accounting-recovery";

/** The app mounts this behind operator authentication and host/origin guards. */
export function createInferenceAccountingRouter(
  dependencies: { readStatus?: typeof readInferenceAccountingStatus } = {},
): IRouter {
  const router = Router();
  router.post(
    "/inference-accounting/:attemptId/reconcile",
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const scopeType = req.query.scopeType,
        id = parsePositiveInteger(req.query.scopeId, "scopeId"),
        attempt = z.uuid().safeParse(req.params.attemptId),
        body = z
          .object({ acknowledge: z.literal(true) })
          .strict()
          .safeParse(req.body);
      if (
        (scopeType !== "task" && scopeType !== "agent") ||
        !id.ok ||
        id.value > 2147483647 ||
        !attempt.success ||
        !body.success
      ) {
        res.status(400).json({ error: "invalid_accounting_recovery" });
        return;
      }
      try {
        res.json(
          await reconcileScopedInferenceEvidence(
            scopeType,
            id.value,
            attempt.data,
          ),
        );
      } catch (error) {
        res
          .status(error instanceof AccountingRecoveryConflict ? 409 : 503)
          .json({ error: "accounting_recovery_unavailable" });
      }
    },
  );
  router.get("/inference-accounting", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const scopeType = req.query.scopeType,
      id = parsePositiveInteger(req.query.scopeId, "scopeId");
    if (
      (scopeType !== "task" && scopeType !== "agent") ||
      !id.ok ||
      !Number.isSafeInteger(id.value) ||
      id.value > 2147483647
    ) {
      res.status(400).json({ error: "invalid_accounting_scope" });
      return;
    }
    try {
      const status = await (
        dependencies.readStatus ?? readInferenceAccountingStatus
      )(scopeType, id.value);
      if (!status) {
        res.status(404).json({ error: "accounting_scope_missing" });
        return;
      }
      res.json(GetInferenceAccountingStatusResponse.strict().parse(status));
    } catch {
      res.status(503).json({ error: "accounting_status_unavailable" });
    }
  });
  return router;
}
