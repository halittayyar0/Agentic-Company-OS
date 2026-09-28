import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.RUNTIME_CONTROL_KEY = "operator-worker-test-key-32-characters";
process.env.AGENT_BROWSER_HEADLESS = "true";
process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  operatorRequestsTable,
  runtimeControlsTable,
} = await import("@workspace/db");
const { reserveOperatorRequest, completeOperatorRequest, failOperatorRequest } =
  await import("./operator-requests");
const { encryptRuntimeEnvelope, decryptRuntimeEnvelope } =
  await import("./runtime-control-crypto");
const { startRuntimeControlWorker } = await import("./runtime-control-worker");
const browser = await import("./vm/browser");
import type {
  RuntimeControlAck,
  RuntimeControlDelivery,
  RuntimeBrowserCommand,
} from "./runtime-control-protocol";

test(
  "worker rejects expired, missing and stopped operator authority at the browser effect boundary",
  { timeout: 60000 },
  async (t) => {
    await dbReady;
    const [agent] = await db
      .insert(agentsTable)
      .values({ name: "Worker boundary", role: "Test", systemPrompt: "Test" })
      .returning();
    const queue: RuntimeControlDelivery[] = [];
    const waiting = new Map<string, (ack: RuntimeControlAck) => void>();
    let visits = 0;
    const server = createServer((req, res) => {
      if (req.url === "/page") {
        visits++;
        res.setHeader("content-type", "text/html");
        res.end("<!doctype html><title>Worker fixture</title>");
        return;
      }
      if (req.url === "/api/internal/runtime-control/poll") {
        req.resume();
        setTimeout(() => {
          const delivery = queue.shift();
          if (!delivery) {
            res.writeHead(204);
            res.end();
          } else {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(delivery));
          }
        }, 20);
        return;
      }
      if (req.url === "/api/internal/runtime-control/ack") {
        let body = "";
        req.on("data", (part) => (body += part));
        req.on("end", () => {
          const ack = JSON.parse(body) as RuntimeControlAck;
          waiting.get(ack.id)?.(ack);
          waiting.delete(ack.id);
          res.end("{}");
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const secret = process.env.RUNTIME_CONTROL_KEY!;
    const worker = startRuntimeControlWorker(
      { id: randomUUID(), startedAt: new Date() },
      {
        ...process.env,
        RUNTIME_CONTROL_API_URL: `${origin}/api/internal/runtime-control`,
      },
    );
    t.after(async () => {
      await worker.stop();
      await browser.closeAllSessions();
      const { closeBrowserEgressProxy } =
        await import("./vm/browser-egress-proxy");
      await closeBrowserEgressProxy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDatabase();
    });
    function deliver(
      command: RuntimeBrowserCommand,
    ): Promise<RuntimeControlAck> {
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("worker acknowledgement timed out")),
          15000,
        );
        waiting.set(id, (ack) => {
          clearTimeout(timer);
          resolve(ack);
        });
        queue.push({ id, envelope: encryptRuntimeEnvelope(command, secret) });
      });
    }
    async function reserve(
      kind: "browser_take_over" | "browser_navigate" | "browser_release",
      input: unknown = {},
    ) {
      const claim = await reserveOperatorRequest({
        requestId: randomUUID(),
        agentId: agent.id,
        kind,
        input,
      });
      assert.equal(claim.admitted, true);
      if (!claim.admitted) throw Error("missing owner");
      return claim.owner;
    }
    const expired = await reserve("browser_take_over");
    await db
      .update(operatorRequestsTable)
      .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(operatorRequestsTable.requestId, expired.requestId));
    const rejected = await deliver({
      kind: "browser_take_over",
      agentId: agent.id,
      expectedSession: null,
      operatorOwner: expired,
    });
    assert.equal(
      rejected.ok,
      false,
      "a worker must reject an owner that expired in transit",
    );
    assert.equal(
      await browser.getExistingBrowserSessionIdentity(agent.id),
      null,
    );
    assert.equal(
      (
        await deliver({
          kind: "browser_take_over",
          agentId: agent.id,
          expectedSession: null,
        })
      ).ok,
      false,
      "old payloads must fail closed",
    );
    const live = await reserve("browser_take_over");
    const accepted = await deliver({
      kind: "browser_take_over",
      agentId: agent.id,
      expectedSession: null,
      operatorOwner: live,
    });
    assert.equal(accepted.ok, true);
    const control = decryptRuntimeEnvelope<{ leaseId: string }>(
      accepted.resultEnvelope!,
      secret,
    );
    await completeOperatorRequest(live);
    const identity = await browser.getExistingBrowserSessionIdentity(agent.id);
    assert.ok(identity);
    const navigation = await reserve("browser_navigate", {
      url: `${origin}/page`,
      leaseId: control.leaseId,
    });
    assert.equal(
      (
        await deliver({
          kind: "browser_navigate",
          agentId: agent.id,
          url: `${origin}/page`,
          leaseId: control.leaseId,
          expectedSession: identity,
          operatorOwner: navigation,
        })
      ).ok,
      true,
    );
    await completeOperatorRequest(navigation);
    assert.equal(visits, 1);
    const stopped = await reserve("browser_navigate", {
      url: `${origin}/page`,
      leaseId: control.leaseId,
    });
    await db
      .update(runtimeControlsTable)
      .set({ version: sql`${runtimeControlsTable.version} + 2` })
      .where(eq(runtimeControlsTable.id, 1));
    assert.equal(
      (
        await deliver({
          kind: "browser_navigate",
          agentId: agent.id,
          url: `${origin}/page`,
          leaseId: control.leaseId,
          expectedSession: identity,
          operatorOwner: stopped,
        })
      ).ok,
      false,
    );
    assert.equal(visits, 1, "stop/resume cannot revive a queued old request");
    await failOperatorRequest(stopped, "execution_blocked");
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: true })
      .where(eq(runtimeControlsTable.id, 1));
    const release = await reserve("browser_release", {
      leaseId: control.leaseId,
    });
    assert.equal(
      (
        await deliver({
          kind: "browser_release",
          agentId: agent.id,
          leaseId: control.leaseId,
          expectedSession: identity,
          operatorOwner: release,
        })
      ).ok,
      true,
    );
    await completeOperatorRequest(release);
    assert.equal(
      (await browser.getBrowserControlState(agent.id)).owner,
      "agent",
    );
  },
);
