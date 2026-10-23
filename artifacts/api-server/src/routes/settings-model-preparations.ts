import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import {
  PreparationStartBody,
  OllamaPreparationServiceError,
  type OllamaModelPreparation,
} from "../lib/ollama-model-preparation";
import { OllamaPreparationConflict } from "../lib/ollama-preparation-store";
import { requireOllamaPreparationRuntime } from "../lib/ollama-preparation-runtime";
import { createRateLimiter } from "../lib/rate-limit";

const RequestId = z.string().uuid();
const ROOT = "/settings/ollama/preparations";

export function createSettingsModelPreparationsRouter(
  service: () => OllamaModelPreparation = requireOllamaPreparationRuntime,
): IRouter {
  const router = Router();
  router.use(ROOT, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  function errorResponse(error: unknown, res: Response): void {
    if (error instanceof OllamaPreparationConflict) {
      res.status(409).json({ code: error.code });
      return;
    }
    if (error instanceof OllamaPreparationServiceError) {
      res
        .status(error.code === "INVALID_REQUEST" ? 400 : 503)
        .json({ code: error.code });
      return;
    }
    // Upstream/configuration/database details never enter the operator response.
    res.status(503).json({ code: "SERVICE_UNAVAILABLE" });
  }
  router.get(ROOT, async (_req, res) => {
    try {
      res.json(await service().snapshot());
    } catch (error) {
      errorResponse(error, res);
    }
  });
  router.post(
    ROOT,
    createRateLimiter({
      namespace: "model-preparation-start",
      max: 6,
      windowMs: 60_000,
    }),
    async (req, res) => {
      const parsed = PreparationStartBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "INVALID_REQUEST" });
        return;
      }
      try {
        res.status(202).json(await service().start(parsed.data));
      } catch (error) {
        errorResponse(error, res);
      }
    },
  );
  router.get(`${ROOT}/:requestId`, async (req, res) => {
    const id = RequestId.safeParse(req.params.requestId);
    if (!id.success) {
      res.status(400).json({ code: "INVALID_REQUEST" });
      return;
    }
    try {
      const found = await service().snapshot(id.data);
      if (!found) {
        res.status(404).json({ code: "PREPARATION_NOT_FOUND" });
        return;
      }
      res.json(found);
    } catch (error) {
      errorResponse(error, res);
    }
  });
  router.post(`${ROOT}/:requestId/stop`, async (req, res) => {
    const id = RequestId.safeParse(req.params.requestId);
    if (
      !id.success ||
      (req.body !== undefined &&
        (req.body === null ||
          Array.isArray(req.body) ||
          typeof req.body !== "object" ||
          Object.keys(req.body).length > 0))
    ) {
      res.status(400).json({ code: "INVALID_REQUEST" });
      return;
    }
    try {
      const found = await service().stop(id.data);
      if (!found) {
        res.status(404).json({ code: "PREPARATION_NOT_FOUND" });
        return;
      }
      res.json(found);
    } catch (error) {
      errorResponse(error, res);
    }
  });
  return router;
}
