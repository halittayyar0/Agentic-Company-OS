import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

test("scoped receipt GET validates identity and maps missing or non-root scope without reconciliation", async (t) => {
  const { createOperationsRouter } = await import("./operations");
  const model = await import("../lib/operations/operations-read-model");
  const { closeDatabase } = await import("@workspace/db");
  t.after(() => closeDatabase());
  const calls: unknown[] = [];
  const app = express();
  app.use(
    "/api",
    createOperationsRouter({
      getReceipt: async (input) => {
        calls.push(input);
        if (input.rootTaskId === 404)
          throw new model.OperationsProjectNotFoundError();
        if (input.rootTaskId === 409)
          throw new model.OperationsRootRequiredError();
        if (input.receiptId === "missing")
          throw new model.OperationsReceiptNotFoundError();
        return {
          projectId: input.rootTaskId,
          receipt: { id: input.receiptId },
          audit: null,
        } as never;
      },
      reconcile: async () => {
        throw new Error("GET must not reconcile");
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const get = (path: string) =>
    fetch(`http://127.0.0.1:${address.port}/api${path}`);
  const response = await get("/tasks/12/operations/receipts/receipt-1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(await response.json(), {
    projectId: 12,
    receipt: { id: "receipt-1" },
    audit: null,
  });
  assert.deepEqual(calls, [{ rootTaskId: 12, receiptId: "receipt-1" }]);
  for (const path of [
    "/tasks/0/operations/receipts/r",
    "/tasks/2147483648/operations/receipts/r",
    "/tasks/12/operations/receipts/%20",
    "/tasks/12/operations/receipts/r?windowHours=1",
    `/tasks/12/operations/receipts/${"界".repeat(86)}`,
  ]) {
    assert.equal((await get(path)).status, 400, path);
  }
  assert.equal(calls.length, 1);
  assert.equal((await get("/tasks/404/operations/receipts/r")).status, 404);
  assert.equal((await get("/tasks/409/operations/receipts/r")).status, 409);
  assert.equal(
    (await get("/tasks/12/operations/receipts/missing")).status,
    404,
  );
});
