import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
// This scenario toggles workspace-wide controls. Always use its own ephemeral
// PGlite database, even when the caller's shell points at a real installation.
delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
const {
  agentsTable,
  activityEventsTable,
  runtimeControlsTable,
  db,
  dbReady,
  closeDatabase,
} = await import("@workspace/db");

process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";
const { default: vmRouter } = await import("./vm");
const browser = await import("../lib/vm/browser");
const { assertExecutionAllowed } =
  await import("../lib/orchestrator/runtime-emergency-stop");
const { activateLocalEmergencyStop, deactivateLocalEmergencyStop } =
  await import("../lib/orchestrator/local-emergency-epoch");

test(
  "operator browser HTTP preserves Unicode, checks persisted stops and never replays against a closed session",
  { timeout: 90000 },
  async (t) => {
    await dbReady;
    await assertExecutionAllowed();
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: randomUUID(),
        role: "Browser test",
        systemPrompt: "Test",
      })
      .returning();
    const inputs: string[] = [];
    const keys: string[] = [];
    const barriers: Array<{ x: number; text: string }> = [];
    let pages = 0;
    const target = createServer((req, res) => {
      if (req.url === "/input") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const event = JSON.parse(body);
          if (event.kind === "barrier") barriers.push(event.value);
          else if (event.kind === "key") keys.push(event.value);
          else inputs.push(event.value);
          res.end("ok");
        });
        return;
      }
      pages++;
      if (req.url?.startsWith("/download")) {
        // The HTTP request is received, but Chromium aborts page navigation
        // when it becomes a download. This crosses the navigation boundary.
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="fixture.txt"',
        );
        res.end("fixture");
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><title>Operator fixture</title><script>function emit(kind,value){window.pending=(window.pending||Promise.resolve()).then(()=>fetch('/input',{method:'POST',body:JSON.stringify({kind,value})}))}</script><textarea autofocus aria-label="Text" style="position:fixed;inset:0;width:100%;height:100%" onkeydown="emit('key',event.key)" oninput="emit('input',this.value)" onmousemove="emit('barrier',{x:event.clientX,text:this.value})"></textarea>`,
      );
    });
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    const targetAddress = target.address();
    assert.ok(targetAddress && typeof targetAddress === "object");
    const url = `http://127.0.0.1:${targetAddress.port}/`;
    const app = express();
    app.use(express.json());
    app.use("/api", vmRouter);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api/agents/${agent.id}/browser`;
    t.after(async () => {
      deactivateLocalEmergencyStop();
      await db
        .update(runtimeControlsTable)
        .set({ emergencyStopEnabled: false, emergencyStopReason: null })
        .where(eq(runtimeControlsTable.id, 1));
      const control = await browser.getBrowserControlState(agent.id);
      if (control.owner === "operator" && leaseId)
        await browser
          .releaseBrowserControl(agent.id, leaseId)
          .catch(() => undefined);
      await browser.closeSession(agent.id).catch(() => undefined);
      const { closeBrowserEgressProxy } =
        await import("../lib/vm/browser-egress-proxy");
      await closeBrowserEgressProxy();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => target.close(() => resolve())),
      ]);
      await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
      await closeDatabase();
    });
    let leaseId: string | undefined;
    async function call(path: string, body?: unknown, method = "POST") {
      if (
        body &&
        typeof body === "object" &&
        "action" in body &&
        body.action === "heartbeat"
      ) {
        // Heartbeats only renew current authority and have no request receipt.
      } else if (body && typeof body === "object") {
        body = { requestId: randomUUID(), ...body };
      }
      const response = await fetch(`${base}/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    }
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: true })
      .where(eq(runtimeControlsTable.id, 1));
    assert.equal((await call("control", { action: "take_over" })).status, 423);
    assert.equal((await browser.inspectBrowserSession(agent.id)).active, false);
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
    const takeover = { action: "take_over", requestId: randomUUID() };
    const acquired = await call("control", takeover);
    assert.equal(acquired.status, 200);
    leaseId = acquired.body.result.leaseId;
    assert.ok(leaseId);
    const takeoverReplay = await call("control", takeover);
    assert.equal(takeoverReplay.status, 200);
    assert.equal(
      takeoverReplay.body.result,
      null,
      "receipt replay must not replay private control authority",
    );
    assert.equal(JSON.stringify(takeoverReplay.body).includes(leaseId!), false);
    const navigation = { url, leaseId, requestId: randomUUID() };
    const navigated = await call("navigate", navigation);
    assert.equal(navigated.status, 200);
    assert.equal(navigated.body.result.available, true);
    const navigationPages = pages;
    assert.equal((await call("navigate", navigation)).body.result, null);
    assert.equal(
      pages,
      navigationPages,
      "receipt replay performs no new navigation",
    );
    await call("input", { action: "click", x: 200, y: 100, leaseId });
    const text = "原文 中文繁體\nالعربية Русский Türkçe 🙂";
    const inputRequest = {
      action: "type_text",
      text,
      leaseId,
      requestId: randomUUID(),
    };
    assert.equal((await call("input", inputRequest)).status, 200);
    async function drainInputEvents(x: number) {
      assert.equal(
        (await call("input", { action: "move", x, y: 100, leaseId })).status,
        200,
      );
      const deadline = Date.now() + 5000;
      while (!barriers.some((entry) => entry.x === x) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      const marker = barriers.find((entry) => entry.x === x);
      assert.ok(marker, "page event queue must drain before counting inputs");
      assert.equal(marker.text, text);
    }
    await drainInputEvents(300);
    assert.ok(inputs.length > 0);
    const inputCount = inputs.length;
    assert.equal((await call("input", inputRequest)).body.result, null);
    assert.equal(
      (await call("input", { ...inputRequest, text: "changed" })).status,
      409,
    );
    await drainInputEvents(301);
    assert.equal(
      inputs.length,
      inputCount,
      "duplicate identity cannot type again",
    );
    assert.ok(
      inputs.every((value) => value === text),
      "completed multilingual text is preserved exactly",
    );
    assert.deepEqual(
      keys,
      [],
      "insertText does not fabricate keydown events; the browser may emit multiple input events for line breaks",
    );
    for (const invalid of ["x".repeat(4097), "bad\0text", "\ud800"])
      assert.equal(
        (await call("input", { action: "type_text", text: invalid, leaseId }))
          .status,
        400,
      );
    assert.equal(
      (
        await call("input", {
          action: "type_text",
          text: "discard",
          leaseId,
          force: true,
        })
      ).status,
      400,
    );
    const uncertain = await call("navigate", {
      url: `${url}download?secret=PRIVATE-SENTINEL`,
      leaseId,
    });
    assert.equal(uncertain.status, 503);
    assert.equal(uncertain.body.code, "BROWSER_RUNTIME_OUTCOME_UNKNOWN");
    assert.equal(
      JSON.stringify(uncertain.body).includes("PRIVATE-SENTINEL"),
      false,
    );
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.agentId, agent.id));
    assert.ok(
      events.some(
        (event) =>
          event.detail?.tool === "browser_navigate" &&
          event.detail?.status === "unknown",
      ),
    );
    const pagesBefore = pages;
    const inputsBefore = [...inputs];
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: true })
      .where(eq(runtimeControlsTable.id, 1));
    assert.equal(
      (await call("input", { action: "type_text", text: "blocked", leaseId }))
        .status,
      423,
    );
    assert.equal(
      (await call("navigate", { url: `${url}?blocked=1`, leaseId })).status,
      423,
    );
    assert.equal(pages, pagesBefore);
    assert.deepEqual(inputs, inputsBefore);
    assert.equal((await call("view", undefined, "GET")).status, 200);
    assert.equal(
      (await call("control", { action: "release", leaseId })).status,
      200,
      "release remains available while stopped",
    );
    assert.equal(
      (await call("close", { leaseId }, "DELETE")).status,
      409,
      "released leases do not become agent-owned close authority",
    );
    assert.equal(
      (await call("close", { leaseId: null }, "DELETE")).status,
      200,
    );
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
    const missing = await call("view", undefined, "GET");
    assert.equal(missing.status, 200);
    assert.equal(missing.body.available, false);
    assert.equal((await browser.inspectBrowserSession(agent.id)).active, false);
    assert.equal(
      (await call("input", { action: "type_text", text: "stale", leaseId }))
        .status,
      409,
    );
    assert.equal((await browser.inspectBrowserSession(agent.id)).active, false);

    // Invalidate a queued operation even if a local stop is lifted before its turn.
    const next = await browser.takeOverBrowserControl(agent.id);
    leaseId = next.leaseId!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = browser.runWithOperatorBrowserControl(
      agent.id,
      leaseId,
      () => {
        started();
        return gate;
      },
    );
    await running;
    const queued = browser.sendRawInput(
      agent.id,
      { action: "keydown", key: "Tab" },
      leaseId,
    );
    const rejected = assert.rejects(queued, /Emergency stop/);
    activateLocalEmergencyStop();
    deactivateLocalEmergencyStop();
    release();
    await Promise.allSettled([first]);
    await rejected;
  },
);
