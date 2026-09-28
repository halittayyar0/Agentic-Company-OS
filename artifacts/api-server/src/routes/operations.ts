import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { logger, safeErrorForLog } from "../lib/logger";
import { readOperatorAuditId } from "../lib/operator-auth";
import {
  getOperationsOverview,
  getProjectOperations,
  getProjectOperationReceipt,
  listRuntimeInstances,
  OperationsProjectNotFoundError,
  OperationsRootRequiredError,
  OperationsReceiptNotFoundError,
} from "../lib/operations/operations-read-model";
import {
  formatOperationsSseFrame,
  OperationsStreamConnectionLimiter,
  operationsStreamHub,
  parseOperationsCursor,
  type OperationsStreamHub,
} from "../lib/operations/operations-stream";
import {
  OperationInvocationStateError,
  OperationReceiptIntegrityError,
  OperationReconciliationConflictError,
  reconcileOperation,
} from "../lib/orchestrator/operation-receipts";
import { readIntegerEnvironment } from "../lib/runtime-security";

const boundedUtf8String = (label: string, maxBytes: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(maxBytes, `${label} is too long.`)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= maxBytes,
      `${label} must not exceed ${maxBytes} UTF-8 bytes.`,
    );

const ReconcileOperationParams = z.object({
  receiptId: boundedUtf8String("Receipt ID", 256),
});

const ReconcileOperationBody = z
  .object({
    decision: z.enum(["confirmed_applied", "confirmed_not_applied"]),
    note: boundedUtf8String("Audit note", 2_000),
  })
  .strict();

const WindowQuery = z
  .object({
    windowHours: z.coerce.number().int().min(1).max(168).optional(),
  })
  .strict();

const RuntimeInstancesQuery = z
  .object({
    windowHours: z.coerce.number().int().min(1).max(168).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

const ProjectOperationsParams = z.object({
  taskId: z.coerce.number().int().positive(),
});

const ProjectReceiptParams = z.object({
  taskId: z.coerce.number().int().positive().max(2147483647),
  receiptId: boundedUtf8String("Receipt ID", 256),
});

const OperationsStreamQuery = z
  .object({
    windowHours: z.coerce.number().int().min(1).max(168).optional(),
    taskId: z.coerce.number().int().positive().optional(),
    cursor: z.string().optional(),
  })
  .strict();

type ReconcileOperation = typeof reconcileOperation;
type GetOperationsOverview = typeof getOperationsOverview;
type GetProjectOperations = typeof getProjectOperations;
type ListRuntimeInstances = typeof listRuntimeInstances;

export interface OperationsRouterDependencies {
  environment?: NodeJS.ProcessEnv;
  getOverview?: GetOperationsOverview;
  getProject?: GetProjectOperations;
  getReceipt?: typeof getProjectOperationReceipt;
  listInstances?: ListRuntimeInstances;
  reconcile?: ReconcileOperation;
  streamHub?: Pick<OperationsStreamHub, "subscribe">;
  streamLimiter?: OperationsStreamConnectionLimiter;
}

async function writeStreamFrame(
  response: Response,
  frame: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  if (response.destroyed || response.writableEnded) return false;
  if (response.write(frame)) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response.off("drain", onDrain);
      response.off("close", onClose);
      response.off("error", onClose);
      resolve(result);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("error", onClose);
  });
}

function isMissingReceipt(error: unknown): boolean {
  return (
    error instanceof OperationInvocationStateError &&
    error.message === "Operation receipt is missing."
  );
}

export function createOperationsRouter(
  dependencies: OperationsRouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const actorId = readOperatorAuditId(dependencies.environment);
  const getOverview = dependencies.getOverview ?? getOperationsOverview;
  const getProject = dependencies.getProject ?? getProjectOperations;
  const getReceipt = dependencies.getReceipt ?? getProjectOperationReceipt;
  const listInstances = dependencies.listInstances ?? listRuntimeInstances;
  const reconcile = dependencies.reconcile ?? reconcileOperation;
  const streamHub = dependencies.streamHub ?? operationsStreamHub;
  const environment = dependencies.environment ?? process.env;
  const streamLimiter =
    dependencies.streamLimiter ??
    new OperationsStreamConnectionLimiter(
      readIntegerEnvironment("OPS_SSE_MAX_CLIENTS", 100, 1, 1_000, environment),
    );
  const streamHeartbeatMs = readIntegerEnvironment(
    "OPERATIONS_STREAM_HEARTBEAT_MS",
    10_000,
    1_000,
    60_000,
    environment,
  );
  const streamMaximumDurationMs = readIntegerEnvironment(
    "OPERATIONS_STREAM_MAX_DURATION_MS",
    55 * 60_000,
    5_000,
    24 * 60 * 60_000,
    environment,
  );

  router.get("/ops/overview", async (req, res): Promise<void> => {
    const query = WindowQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid operations window" });
      return;
    }
    res.json(await getOverview(query.data));
  });

  router.get("/ops/instances", async (req, res): Promise<void> => {
    const query = RuntimeInstancesQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid runtime instance query" });
      return;
    }
    res.json(await listInstances(query.data));
  });

  router.get("/ops/stream", async (req, res): Promise<void> => {
    const query = OperationsStreamQuery.safeParse(req.query);
    let requestedCursor: string;
    try {
      if (!query.success) throw new TypeError("Invalid stream query");
      requestedCursor = parseOperationsCursor(
        req.header("last-event-id") ?? query.data.cursor,
      );
    } catch {
      res.status(400).json({ error: "Invalid operations stream query" });
      return;
    }
    const releaseConnection = streamLimiter.tryAcquire();
    if (!releaseConnection) {
      res.setHeader("Retry-After", "3");
      res.status(503).json({ error: "Operations stream capacity reached" });
      return;
    }

    const loadSnapshot = () =>
      query.data.taskId === undefined
        ? getOverview({ windowHours: query.data.windowHours })
        : getProject({
            rootTaskId: query.data.taskId,
            windowHours: query.data.windowHours,
          });

    let snapshot: Awaited<ReturnType<typeof loadSnapshot>>;
    try {
      snapshot = await loadSnapshot();
    } catch (error) {
      releaseConnection();
      if (error instanceof OperationsProjectNotFoundError) {
        res.status(404).json({ error: "Project task not found" });
        return;
      }
      if (error instanceof OperationsRootRequiredError) {
        res.status(409).json({ error: "Operations requires a root project" });
        return;
      }
      throw error;
    }
    const snapshotCursor = parseOperationsCursor(snapshot.cursor);
    if (BigInt(requestedCursor) > BigInt(snapshotCursor)) {
      releaseConnection();
      res.status(409).json({
        error: "Operations stream cursor is ahead of the durable snapshot",
        cursor: snapshotCursor,
      });
      return;
    }

    let closed = false;
    let unsubscribe: () => void = () => {};
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let maximumDurationTimer: NodeJS.Timeout | null = null;
    let latestRuntimeState = snapshot.runtime.state;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (maximumDurationTimer) clearTimeout(maximumDurationTimer);
      releaseConnection();
    };
    const endStream = () => {
      cleanup();
      if (!res.writableEnded && !res.destroyed) res.end();
    };
    res.once("close", cleanup);
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const initialWritten = await writeStreamFrame(
      res,
      formatOperationsSseFrame({
        event: "snapshot",
        id: snapshot.cursor,
        data: { snapshot },
      }),
    );
    if (!initialWritten || closed) {
      endStream();
      return;
    }

    let refreshPending = false;
    let refreshRunning = false;
    const refresh = async () => {
      if (closed || refreshRunning) return;
      refreshRunning = true;
      try {
        while (refreshPending && !closed) {
          refreshPending = false;
          const nextSnapshot = await loadSnapshot();
          latestRuntimeState = nextSnapshot.runtime.state;
          if (
            !(await writeStreamFrame(
              res,
              formatOperationsSseFrame({
                event: "operations_changed",
                id: nextSnapshot.cursor,
                data: { snapshot: nextSnapshot },
              }),
            ))
          ) {
            endStream();
          }
        }
      } catch (error) {
        logger.warn(
          { error: safeErrorForLog(error) },
          "Operations stream snapshot refresh failed",
        );
        endStream();
      } finally {
        refreshRunning = false;
        if (refreshPending && !closed) void refresh();
      }
    };
    unsubscribe = streamHub.subscribe(snapshot.cursor, () => {
      refreshPending = true;
      void refresh();
    });

    heartbeatTimer = setInterval(() => {
      void writeStreamFrame(
        res,
        formatOperationsSseFrame({
          event: "heartbeat",
          data: {
            generatedAt: new Date().toISOString(),
            runtimeState: latestRuntimeState,
          },
        }),
      ).then((written) => {
        if (!written) endStream();
      });
    }, streamHeartbeatMs);
    heartbeatTimer.unref?.();
    maximumDurationTimer = setTimeout(endStream, streamMaximumDurationMs);
    maximumDurationTimer.unref?.();
  });

  router.get("/tasks/:taskId/operations", async (req, res): Promise<void> => {
    const params = ProjectOperationsParams.safeParse(req.params);
    const query = WindowQuery.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Invalid project operations query" });
      return;
    }
    try {
      res.json(
        await getProject({
          rootTaskId: params.data.taskId,
          ...query.data,
        }),
      );
    } catch (error) {
      if (error instanceof OperationsProjectNotFoundError) {
        res.status(404).json({ error: "Project task not found" });
        return;
      }
      if (error instanceof OperationsRootRequiredError) {
        res.status(409).json({ error: "Operations requires a root project" });
        return;
      }
      throw error;
    }
  });

  router.get(
    "/tasks/:taskId/operations/receipts/:receiptId",
    async (req, res): Promise<void> => {
      res.setHeader("Cache-Control", "no-store");
      const params = ProjectReceiptParams.safeParse(req.params);
      if (
        !params.success ||
        !z.object({}).strict().safeParse(req.query).success
      ) {
        res.status(400).json({ error: "Invalid project receipt query" });
        return;
      }
      try {
        res.json(
          await getReceipt({
            rootTaskId: params.data.taskId,
            receiptId: params.data.receiptId,
          }),
        );
      } catch (error) {
        if (
          error instanceof OperationsProjectNotFoundError ||
          error instanceof OperationsReceiptNotFoundError
        ) {
          res
            .status(404)
            .json({ error: "Project operation receipt not found" });
          return;
        }
        if (error instanceof OperationsRootRequiredError) {
          res.status(409).json({ error: "Operations requires a root project" });
          return;
        }
        throw error;
      }
    },
  );

  router.post(
    "/ops/receipts/:receiptId/reconcile",
    async (req, res): Promise<void> => {
      const params = ReconcileOperationParams.safeParse(req.params);
      const body = ReconcileOperationBody.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({ error: "Invalid reconciliation request" });
        return;
      }

      try {
        const receipt = await reconcile({
          receiptId: params.data.receiptId,
          decision: body.data.decision,
          note: body.data.note,
          actorId,
        });
        if (
          receipt.reconciliationDecision === null ||
          receipt.reconciliationNote === null ||
          receipt.reconciliationActorId === null ||
          receipt.reconciledAt === null
        ) {
          throw new OperationReceiptIntegrityError(
            "Reconciliation completed without immutable audit evidence.",
          );
        }
        res.json({
          receiptId: receipt.id,
          state: receipt.state,
          decision: receipt.reconciliationDecision,
          note: receipt.reconciliationNote,
          actorId: receipt.reconciliationActorId,
          reconciledAt: receipt.reconciledAt.toISOString(),
        });
      } catch (error) {
        if (isMissingReceipt(error)) {
          res.status(404).json({ error: "Operation receipt not found" });
          return;
        }
        if (
          error instanceof OperationReconciliationConflictError ||
          error instanceof OperationReceiptIntegrityError ||
          error instanceof OperationInvocationStateError
        ) {
          res.status(409).json({ error: "Operation cannot be reconciled" });
          return;
        }
        if (error instanceof TypeError) {
          res.status(400).json({ error: "Invalid reconciliation request" });
          return;
        }
        throw error;
      }
    },
  );

  return router;
}

export default createOperationsRouter();
