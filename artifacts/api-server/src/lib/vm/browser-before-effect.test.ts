import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";

const browserRuntime = await import("./browser");
const sandboxRuntime = await import("./sandbox");

function refFor(snapshotLines: string[], label: string): number {
  const line = snapshotLines.find((candidate) => candidate.includes(label));
  const match = line?.match(/\[ref=(\d+)\]/);
  assert.ok(match, `snapshot must contain a ref for ${label}`);
  return Number(match[1]);
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

test(
  "browser effects await one hook after live preflight and screenshot capture",
  { timeout: 90_000 },
  async (t) => {
    const agentId = 9_000_000 + Math.floor(Math.random() * 100_000);
    let pageRequests = 0;
    let clickRequests = 0;
    let fillRequests = 0;
    let moveRequests = 0;
    let scrollRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/clicked") clickRequests += 1;
      else if (request.url === "/filled") fillRequests += 1;
      else if (request.url === "/moved") moveRequests += 1;
      else if (request.url === "/scrolled") scrollRequests += 1;
      else pageRequests += 1;

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (request.url === "/") {
        response.end(`<!doctype html>
          <html><body style="margin:0">
            <button onclick="document.querySelector('#state').textContent='clicked'; fetch('/clicked')">Boundary button</button>
            <input aria-label="Boundary input" oninput="fetch('/filled')" />
            <div id="state">idle</div>
            <div style="height:2400px"></div>
            <script>addEventListener('mousemove', () => fetch('/moved'))</script>
            <script>addEventListener('scroll', () => fetch('/scrolled'), { once: true })</script>
          </body></html>`);
      } else {
        response.end("ok");
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/`;

    t.after(async () => {
      await browserRuntime.closeSession(agentId).catch(() => undefined);
      const { closeBrowserEgressProxy } =
        await import("./browser-egress-proxy");
      await closeBrowserEgressProxy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await fsp.rm(sandboxRuntime.getSandboxRoot(agentId), {
        recursive: true,
        force: true,
      });
    });

    const assertAgentControlHeld = async () => {
      const control = await browserRuntime.getBrowserControlState(agentId);
      assert.equal(control.agentActionInFlight, true);
    };

    let navigateCalls = 0;
    await browserRuntime.navigateTo(
      agentId,
      url,
      "agent",
      undefined,
      async () => {
        navigateCalls += 1;
        await assertAgentControlHeld();
        assert.equal(pageRequests, 0);
        await Promise.resolve();
      },
    );
    assert.equal(navigateCalls, 1);
    assert.ok(pageRequests >= 1);

    let rejectedNavigateCalls = 0;
    await assert.rejects(() =>
      browserRuntime.navigateTo(
        agentId,
        "http://[",
        "agent",
        undefined,
        async () => {
          rejectedNavigateCalls += 1;
        },
      ),
    );
    assert.equal(rejectedNavigateCalls, 0);

    const snapshot = await browserRuntime.snapshotPage(agentId);
    const buttonRef = refFor(snapshot.lines, "Boundary button");
    const inputRef = refFor(snapshot.lines, "Boundary input");
    const buttonBinding = await browserRuntime.getBrowserActionBinding(
      agentId,
      buttonRef,
    );

    let clickCalls = 0;
    await browserRuntime.clickRef(
      agentId,
      buttonRef,
      buttonBinding,
      async () => {
        clickCalls += 1;
        await assertAgentControlHeld();
        assert.equal(clickRequests, 0);
        assert.match(await browserRuntime.extractText(agentId), /idle/);
      },
    );
    assert.equal(clickCalls, 1);
    await waitFor(() => clickRequests >= 1, "click effect did not reach page");
    assert.match(await browserRuntime.extractText(agentId), /clicked/);

    let rejectedClickCalls = 0;
    await assert.rejects(
      () =>
        browserRuntime.clickRef(
          agentId,
          buttonRef,
          { ...buttonBinding, text: "changed after approval" },
          async () => {
            rejectedClickCalls += 1;
          },
        ),
      /onaydan sonra degisti/,
    );
    assert.equal(rejectedClickCalls, 0);

    let fillCalls = 0;
    await browserRuntime.fillRef(
      agentId,
      inputRef,
      "Ada",
      undefined,
      async () => {
        fillCalls += 1;
        await assertAgentControlHeld();
        assert.equal(fillRequests, 0);
      },
    );
    assert.equal(fillCalls, 1);
    await waitFor(() => fillRequests >= 1, "fill effect did not reach page");

    let rejectedFillCalls = 0;
    await assert.rejects(
      () =>
        browserRuntime.fillRef(
          agentId,
          Number.MAX_SAFE_INTEGER,
          "blocked",
          undefined,
          async () => {
            rejectedFillCalls += 1;
          },
        ),
      /bulunamadi/,
    );
    assert.equal(rejectedFillCalls, 0);

    await new Promise((resolve) => setTimeout(resolve, 100));
    const moveRequestsBeforeRejectedScroll = moveRequests;
    const scrollRequestsBeforeRejectedScroll = scrollRequests;
    let rejectedScrollCalls = 0;
    await assert.rejects(
      () =>
        browserRuntime.scrollPage(agentId, "down", async () => {
          rejectedScrollCalls += 1;
          throw new Error("receipt start rejected");
        }),
      /receipt start rejected/,
    );
    assert.equal(rejectedScrollCalls, 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      moveRequests,
      moveRequestsBeforeRejectedScroll,
      "a rejected effect boundary must run before mouse movement",
    );
    assert.equal(
      scrollRequests,
      scrollRequestsBeforeRejectedScroll,
      "a rejected effect boundary must run before scrolling",
    );

    let scrollCalls = 0;
    await browserRuntime.scrollPage(agentId, "down", async () => {
      scrollCalls += 1;
      await assertAgentControlHeld();
      assert.equal(scrollRequests, 0);
    });
    assert.equal(scrollCalls, 1);
    await waitFor(
      () => scrollRequests >= 1,
      "scroll effect did not reach page",
    );

    const screenshotRel = "ekran-goruntuleri/boundary.png";
    const screenshotAbs = sandboxRuntime.safeResolve(
      agentId,
      screenshotRel,
    ).abs;
    await fsp.rm(screenshotAbs, { force: true });
    let screenshotCalls = 0;
    const saved = await browserRuntime.saveScreenshotToSandbox(
      agentId,
      "boundary.png",
      async () => {
        screenshotCalls += 1;
        assert.equal(await fsp.stat(screenshotAbs).catch(() => null), null);
        assert.equal(await browserRuntime.closeSession(agentId), true);
      },
    );
    assert.equal(screenshotCalls, 1);
    assert.equal(saved.path, screenshotRel);
    assert.ok(saved.sizeBytes > 0);
    assert.ok((await fsp.stat(screenshotAbs)).size > 0);
  },
);
