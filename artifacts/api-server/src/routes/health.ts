import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkDatabaseReady } from "@workspace/db";
import { runtimeLifecycle } from "../lib/runtime-lifecycle";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  const lifecycle = runtimeLifecycle();
  let timer: NodeJS.Timeout | undefined;
  const database = await Promise.race([
    checkDatabaseReady(),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), 2_000);
      timer.unref();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  const ready = lifecycle.ready && !lifecycle.shuttingDown && database;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks: {
      startup: lifecycle.ready,
      database,
      shuttingDown: lifecycle.shuttingDown,
    },
  });
});

export default router;
