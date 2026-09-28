import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { createOperatorAuth, readOperatorAuditId } from "../lib/operator-auth";
import {
  claimOperationInvocation,
  markOperationRunning,
  markOperationUnknown,
  reserveOperation,
} from "../lib/orchestrator/operation-receipts";
import {
  createOperationsRouter,
  type OperationsRouterDependencies,
} from "./operations";

const TOKEN = "route-test-operator-token-that-is-at-least-32-characters";

interface HttpResponse {
  status: number;
  body: string;
}

function request(
  port: number,
  input: {
    path: string;
    body?: unknown;
    authenticated?: boolean;
    headers?: Record<string, string>;
  },
): Promise<HttpResponse> {
  const body =
    input.body === undefined ? undefined : JSON.stringify(input.body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: input.path,
        method: "POST",
        headers: {
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body).toString(),
              }),
          ...(input.authenticated === false
            ? {}
            : { Authorization: `Bearer ${TOKEN}` }),
          ...input.headers,
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: responseBody }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function listen(
  reconcile?: OperationsRouterDependencies["reconcile"],
  operatorAuditId = "ops-route-test",
) {
  const auth = createOperatorAuth({ token: TOKEN, secureCookies: false });
  const app = express();
  app.use(express.json());
  app.use("/api", auth.requireAuthentication);
  app.use(
    "/api",
    createOperationsRouter({
      environment: { OPERATOR_AUDIT_ID: operatorAuditId },
      ...(reconcile ? { reconcile } : {}),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}

async function createReceiptFixture(makeUnknown: boolean) {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const leaseOwner = `reconcile-task-${suffix}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Reconcile owner ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 90_000),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Reconcile task ${suffix}`,
      brief: "Exercise the authenticated reconciliation API.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 90_000),
      stepAttempts: 1,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const runtimeId = `reconcile-runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "operations-route-test",
    processId: 2101,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeId,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const reservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId,
    toolName: "vm_run_command",
    args: { targetHash: `route-${suffix}` },
    physical: {
      attemptId,
      workerInstanceId: runtimeId,
      modelToolCallId: `route-call-${suffix}`,
      callSlot: "provider:0:tool:0",
    },
    taskId: task.id,
    agentId: agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: `route-effect-${suffix}`,
    now,
  });

  if (!makeUnknown) return reservation.receipt;

  const invocationLeaseOwner = `route-invocation-${suffix}`;
  const claim = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "task_step",
    attemptId,
    workerInstanceId: runtimeId,
    modelToolCallId: `route-call-${suffix}`,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    taskLeaseOwner: leaseOwner,
    agentLeaseOwner: leaseOwner,
    now,
  });
  assert.ok(claim.invocation);
  await markOperationRunning({
    receiptId: reservation.receipt.id,
    invocationId: claim.invocation.id,
    leaseOwner: invocationLeaseOwner,
    now: new Date(now.getTime() + 1_000),
  });
  return markOperationUnknown({
    receiptId: reservation.receipt.id,
    invocationId: claim.invocation.id,
    leaseOwner: invocationLeaseOwner,
    failureKind: "route_test_unknown",
    sanitizedError: "Effect completion could not be observed.",
    now: new Date(now.getTime() + 2_000),
  });
}

test("reconciliation route is authenticated and rejects malformed authority or audit input", async (t) => {
  let calls = 0;
  const { server, port } = await listen(async () => {
    calls += 1;
    throw new Error("validation must stop before reconciliation");
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const path = `/api/ops/receipts/${randomUUID()}/reconcile`;

  const denied = await request(port, {
    path,
    authenticated: false,
    body: { decision: "confirmed_applied", note: "Verified externally." },
  });
  assert.equal(denied.status, 401);

  for (const body of [
    { decision: "maybe", note: "Verified externally." },
    { decision: "confirmed_applied" },
    { decision: "confirmed_applied", note: "   " },
    { decision: "confirmed_applied", note: "x".repeat(2_001) },
    { decision: "confirmed_applied", note: "ğ".repeat(1_001) },
    {
      decision: "confirmed_applied",
      note: "Verified externally.",
      actorId: "request-controlled-actor",
    },
  ]) {
    const invalid = await request(port, { path, body });
    assert.equal(invalid.status, 400);
  }
  const overlongId = await request(port, {
    path: `/api/ops/receipts/${"r".repeat(257)}/reconcile`,
    body: { decision: "confirmed_applied", note: "Verified externally." },
  });
  assert.equal(overlongId.status, 400);
  assert.equal(calls, 0);
});

test("reconciliation persists only the configured stable actor and is immutable/idempotent", async (t) => {
  const actorId = readOperatorAuditId({ OPERATOR_AUDIT_ID: "ops-primary" });
  const receipt = await createReceiptFixture(true);
  const { server, port } = await listen(undefined, actorId);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const path = `/api/ops/receipts/${receipt.id}/reconcile`;

  const first = await request(port, {
    path,
    headers: { "X-Operator-Audit-Id": "forged-request-actor" },
    body: {
      decision: "confirmed_applied",
      note: "  Verified in the authoritative external system.  ",
    },
  });
  assert.equal(first.status, 200, first.body);
  const firstBody = JSON.parse(first.body) as Record<string, unknown>;
  assert.equal(firstBody.actorId, actorId);
  assert.equal(
    firstBody.note,
    "Verified in the authoritative external system.",
  );
  assert.equal(firstBody.decision, "confirmed_applied");

  const repeated = await request(port, {
    path,
    body: {
      decision: "confirmed_applied",
      note: "A later duplicate must not replace the first audit note.",
    },
  });
  assert.equal(repeated.status, 200, repeated.body);
  const repeatedBody = JSON.parse(repeated.body) as Record<string, unknown>;
  assert.equal(repeatedBody.reconciledAt, firstBody.reconciledAt);
  assert.equal(repeatedBody.note, firstBody.note);
  assert.equal(repeatedBody.actorId, actorId);

  const opposite = await request(port, {
    path,
    body: {
      decision: "confirmed_not_applied",
      note: "Conflicting observation.",
    },
  });
  assert.equal(opposite.status, 409);

  const [persisted] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, receipt.id));
  assert.equal(persisted.reconciliationActorId, actorId);
  assert.equal(persisted.reconciliationDecision, "confirmed_applied");
  assert.equal(persisted.reconciliationNote, firstBody.note);

  const racedReceipt = await createReceiptFixture(true);
  const racedPath = `/api/ops/receipts/${racedReceipt.id}/reconcile`;
  const raced = await Promise.all([
    request(port, {
      path: racedPath,
      body: {
        decision: "confirmed_applied",
        note: "The effect was observed.",
      },
    }),
    request(port, {
      path: racedPath,
      body: {
        decision: "confirmed_not_applied",
        note: "The effect was not observed.",
      },
    }),
  ]);
  assert.deepEqual(
    raced
      .map((response) => response.status)
      .sort((left, right) => left - right),
    [200, 409],
  );
  const [racedPersisted] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, racedReceipt.id));
  assert.ok(
    racedPersisted.reconciliationDecision === "confirmed_applied" ||
      racedPersisted.reconciliationDecision === "confirmed_not_applied",
  );
  assert.equal(racedPersisted.reconciliationActorId, actorId);
});

test("missing receipts return 404 and non-unknown receipts return 409", async (t) => {
  const nonUnknown = await createReceiptFixture(false);
  const { server, port } = await listen();
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const body = {
    decision: "confirmed_not_applied",
    note: "Checked the authoritative external system.",
  };

  const missing = await request(port, {
    path: `/api/ops/receipts/${randomUUID()}/reconcile`,
    body,
  });
  assert.equal(missing.status, 404, missing.body);

  const wrongState = await request(port, {
    path: `/api/ops/receipts/${nonUnknown.id}/reconcile`,
    body,
  });
  assert.equal(wrongState.status, 409, wrongState.body);
});
