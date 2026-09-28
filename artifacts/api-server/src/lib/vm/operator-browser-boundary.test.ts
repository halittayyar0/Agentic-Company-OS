import assert from "node:assert/strict";
import test from "node:test";
process.env.AGENT_BROWSER_HEADLESS = "true";
const browser = await import("./browser");

test(
  "operator release and close retain the live session when durable admission is rejected",
  { timeout: 45000 },
  async (t) => {
    const agentId = 9500000 + Math.floor(Math.random() * 10000);
    const control = await browser.takeOverBrowserControl(agentId);
    assert.ok(control.leaseId);
    const identity = await browser.getExistingBrowserSessionIdentity(agentId);
    assert.ok(identity);
    t.after(async () => {
      await browser.closeAllSessions();
      const { closeBrowserEgressProxy } =
        await import("./browser-egress-proxy");
      await closeBrowserEgressProxy();
    });
    const reject = async () => {
      throw Error("receipt owner no longer live");
    };
    await assert.rejects(
      browser.releaseBrowserControl(agentId, control.leaseId, reject),
      /receipt owner no longer live/,
    );
    assert.equal(
      (await browser.getBrowserControlState(agentId)).owner,
      "operator",
    );
    await assert.rejects(
      browser.closeSession(agentId, control.leaseId, identity, reject),
      /receipt owner no longer live/,
    );
    assert.deepEqual(
      await browser.getExistingBrowserSessionIdentity(agentId),
      identity,
    );
    assert.equal(
      (await browser.heartbeatBrowserControl(agentId, control.leaseId)).leaseId,
      control.leaseId,
    );
  },
);
