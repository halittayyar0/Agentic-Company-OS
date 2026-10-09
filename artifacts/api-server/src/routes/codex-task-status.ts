import { Router, type IRouter } from "express";
import { readCodexTaskFleetStatus } from "../lib/codex-task-status";

/** Mounted behind operator authentication and the application's origin guard.
 * Reading configuration never starts a probe, native turn or account renewal. */
export function createCodexTaskStatusRouter(
  dependencies: { readStatus?: typeof readCodexTaskFleetStatus } = {},
): IRouter {
  const router = Router();
  router.get("/connections/codex", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await (dependencies.readStatus ?? readCodexTaskFleetStatus)());
    } catch {
      res.status(503).json({ error: "coding_status_unavailable" });
    }
  });
  return router;
}
