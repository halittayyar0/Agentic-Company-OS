import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.AGENT_BROWSER_HEADLESS = "true";
process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
const browser = await import("./browser");

test(
  "drag rechecks the owner between awaited effects and does not press after its first move loses authority",
  { timeout: 45000 },
  async (t) => {
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<html><body><pre id="counts">moves:0 down:0 up:0</pre><script>const n={moves:0,down:0,up:0};for(const [event,key] of [["mousemove","moves"],["mousedown","down"],["mouseup","up"]])document.addEventListener(event,()=>{n[key]++;document.getElementById("counts").textContent=`moves:${n.moves} down:${n.down} up:${n.up}`})</script></body></html>',
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    t.after(async () => {
      await browser.closeAllSessions();
      const { closeBrowserEgressProxy } =
        await import("./browser-egress-proxy");
      await closeBrowserEgressProxy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const { closeDatabase } = await import("@workspace/db");
      await closeDatabase();
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const agentId = 9670000;
    const control = await browser.takeOverBrowserControl(agentId);
    assert.ok(control.leaseId);
    await browser.navigateTo(
      agentId,
      `http://127.0.0.1:${address.port}/`,
      "operator",
      control.leaseId,
    );
    let checks = 0;
    await assert.rejects(
      browser.sendRawInput(
        agentId,
        { action: "drag", x: 50, y: 50, toX: 250, toY: 250 },
        control.leaseId,
        undefined,
        async () => {
          if (++checks > 1) throw Error("original receipt expired");
        },
      ),
      browser.isBrowserActionOutcomeUnknownError,
    );
    const snapshot = await browser.snapshotPage(agentId);
    assert.match(snapshot.lines.join("\n"), /moves:1 down:0 up:0/);
    assert.equal(checks, 2);
    await browser.navigateTo(
      agentId,
      `http://127.0.0.1:${address.port}/`,
      "operator",
      control.leaseId,
    );
    checks = 0;
    await assert.rejects(
      browser.sendRawInput(
        agentId,
        { action: "drag", x: 60, y: 60, toX: 250, toY: 250 },
        control.leaseId,
        undefined,
        async () => {
          if (++checks > 2)
            throw Error("original receipt expired while holding the button");
        },
      ),
      browser.isBrowserActionOutcomeUnknownError,
    );
    const interrupted = await browser.snapshotPage(agentId);
    assert.match(interrupted.lines.join("\n"), /moves:1 down:1 up:1/);
    assert.equal(checks, 3);
  },
);
