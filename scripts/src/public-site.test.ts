import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, type Browser } from "@playwright/test";

test("public start page supports seven languages, phone width and real task copy", async (t) => {
  const directory = fileURLToPath(new URL("../../site/", import.meta.url));
  const server = createServer(async (req, res) => {
    const file = (
      {
        "/": "index.html",
        "/app.js": "app.js",
        "/quick-tools.mjs": "quick-tools.mjs",
        "/style.css": "style.css",
        "/workspace.png": "workspace.png",
      } as Record<string, string>
    )[req.url ?? ""];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js") || file.endsWith(".mjs")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".png")
            ? "image/png"
            : "text/html; charset=utf-8",
    );
    res.end(await readFile(`${directory}/${file}`));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser: Browser | undefined;
  t.after(async () => {
    // Close the browser before waiting for the HTTP server's open connections.
    // Windows Chromium may otherwise keep the server.close callback pending.
    try {
      await browser?.close();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const dataRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() !== "GET")
      dataRequests.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(
    `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
  );
  for (const locale of ["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"]) {
    await page.locator("#language").selectOption(locale);
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    assert.equal(
      await page.locator("html").getAttribute("dir"),
      locale === "ar" ? "rtl" : "ltr",
    );
    assert.equal(await page.locator(".recipe button").count(), 3);
    const overflow = await page.evaluate<{
      viewport: number;
      document: number;
      elements: string[];
    }>(`(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")]
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width && (rect.right > innerWidth + 1 || rect.left < -1);
        })
        .slice(0, 8)
        .map(element => element.tagName.toLowerCase() + "#" + element.id + "." + element.className),
    }))()`);
    assert.ok(
      overflow.document <= overflow.viewport,
      `${locale}: ${JSON.stringify(overflow)}`,
    );
    assert.ok((await page.locator("h1").innerText()).length > 5);
    assert.ok((await page.locator("#quick-title").innerText()).length > 5);
    assert.equal(
      (await page.locator("body").innerText()).includes("undefined"),
      false,
    );
    await page.locator(".recipe button").first().click();
    const copied = await page.evaluate<string>(
      "navigator.clipboard.readText()",
    );
    assert.equal(copied, await page.locator(".recipe p").first().innerText());
  }
  await page.locator("#language").selectOption("en");
  await page.locator("#quick-sample").click();
  await page.locator("#quick-run").click();
  assert.match(await page.locator("#quick-summary").innerText(), /4 rows/);
  assert.match(
    await page.locator("#quick-report").innerText(),
    /Duplicate rows: 1/,
  );
  await page.locator('[data-tool="json"]').click();
  await page.locator("#quick-sample").click();
  await page.locator("#quick-run").click();
  assert.match(await page.locator("#quick-summary").innerText(), /nodes/);
  await page.locator('[data-tool="lists"]').click();
  assert.equal(await page.locator("#quick-file-label").isVisible(), false);
  await page.locator("#quick-sample").click();
  await page.locator("#quick-run").click();
  assert.match(
    await page.locator("#quick-summary").innerText(),
    /1 only in first/,
  );
  await page.locator("#quick-copy").click();
  assert.doesNotMatch(
    await page.evaluate("navigator.clipboard.readText()"),
    /alpha|beta|gamma|delta/,
  );
  const download = page.waitForEvent("download");
  await page.locator("#quick-download").click();
  assert.match(
    (await download).suggestedFilename(),
    /agentic-lists-report.txt/,
  );
  assert.deepEqual(dataRequests, []);
  assert.deepEqual(errors, []);
});
