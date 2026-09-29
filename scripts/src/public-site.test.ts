import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";

test("public start page supports seven languages, phone width and real task copy", async (t) => {
  const directory = fileURLToPath(new URL("../../site/", import.meta.url));
  const server = createServer(async (req, res) => {
    const file = (
      {
        "/": "index.html",
        "/app.js": "app.js",
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
      file.endsWith(".js")
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
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
    assert.equal(
      await page.evaluate<boolean>(
        "document.documentElement.scrollWidth <= innerWidth",
      ),
      true,
      locale,
    );
    assert.ok((await page.locator("h1").innerText()).length > 5);
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
  assert.deepEqual(errors, []);
});
