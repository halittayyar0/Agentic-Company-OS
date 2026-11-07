import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const defaultBinary =
  process.platform === "win32" ? "acos-workbench.exe" : "acos-workbench";
const binary = path.resolve(
  process.argv[2] ?? path.join("rust", "target", "release", defaultBinary),
);
await mkdir(".tmp", { recursive: true });
const evidence = await mkdtemp(path.resolve(".tmp/rust-workbench-browser-"));
const calls = [];
const server = createServer(async (request, response) => {
  try {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : null;
    calls.push([request.method, request.url]);
    let reply;
    if (request.url === "/api/version" && request.method === "GET")
      reply = { version: "0.40.3" };
    if (request.url === "/api/show" && request.method === "POST") {
      assert.equal(body.model, "fixture:2b:local");
      reply = { capabilities: ["completion"] };
    }
    if (request.url === "/api/chat" && request.method === "POST") {
      assert.equal(body.model, "fixture:2b:local");
      assert.equal(body.messages[0].content, "37 + 36 = ?");
      assert.equal(body.options.num_predict, 512);
      reply = {
        done: true,
        done_reason: "stop",
        message: { role: "assistant", content: "73 <fixture>" },
        prompt_eval_count: 5,
        eval_count: 4,
      };
    }
    if (!reply) throw Error("Unexpected fixture route");
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(reply));
  } catch (error) {
    calls.push(["fixture_error", error.message]);
    response.writeHead(500).end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const origin = "http://127.0.0.1:" + port;
let processHandle;
let browser;
async function launch() {
  const env = {
    ...process.env,
    ACOS_RUST_PORT: String(port),
    ACOS_RUST_OLLAMA_PORT: String(server.address().port),
    ACOS_RUST_DATA_DIR: path.join(evidence, "data"),
  };
  delete env.ACOS_RUST_OPENROUTER_API_KEY;
  delete env.ACOS_RUST_OPENAI_API_KEY;
  processHandle = spawn(binary, [], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Workbench did not become ready")),
      12000,
    );
    processHandle.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    processHandle.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Workbench exited " + code));
    });
    processHandle.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
      const password = /Browser password for this run: ([a-z0-9]{32})/.exec(
        output,
      )?.[1];
      if (password) {
        clearTimeout(timer);
        resolve(password);
      }
    });
    processHandle.stderr.resume();
  });
}
async function stop() {
  if (
    !processHandle ||
    processHandle.exitCode !== null ||
    processHandle.signalCode !== null
  )
    return;
  const exited = once(processHandle, "exit");
  processHandle.kill();
  await exited;
}
try {
  let password = await launch();
  assert.equal((await fetch(origin)).status, 401);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 320, height: 840 },
    httpCredentials: { username: "operator", password, origin },
  });
  const page = await context.newPage();
  const widths = [];
  for (const locale of ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"]) {
    for (const width of [320, 1024]) {
      await page.setViewportSize({ width, height: 840 });
      const response = await page.goto(origin + "/?lang=" + locale);
      assert.equal(response.status(), 200);
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(
        await page.locator("html").getAttribute("dir"),
        locale === "ar" ? "rtl" : "ltr",
      );
      assert.equal(await page.locator("main h1").count(), 1);
      const measured = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      assert.ok(
        measured.page <= measured.viewport,
        JSON.stringify({ locale, width, measured }),
      );
      widths.push({ locale, width, ...measured });
      if (width === 320 && (locale === "ar" || locale === "tr"))
        await page.screenshot({
          path: path.join(evidence, "desk-" + locale + ".png"),
        });
    }
  }
  await page.setViewportSize({ width: 320, height: 840 });
  await page.goto(origin + "/?lang=tr");
  await page.locator('input[name="model"]').fill("fixture:2b");
  await page.locator('textarea[name="prompt"]').fill("37 + 36 = ?");
  const [submission] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.locator('button[type="submit"]').click(),
  ]);
  assert.equal(
    submission.status(),
    303,
    "The authenticated browser form must pass the Origin check",
  );
  await page.waitForURL(/\/tasks\/[a-f0-9-]+\?lang=tr/, { timeout: 6000 });
  const taskUrl = page.url();
  const result = page.getByText("73 <fixture>", { exact: true });
  for (let i = 0; i < 20 && !(await result.isVisible()); i++) {
    await delay(100);
    await page.reload();
  }
  assert.ok(await result.isVisible());
  assert.equal(await page.locator("fixture").count(), 0);
  const downloadLink = page.getByRole("link", { name: /Sonucu indir/ });
  assert.ok(await downloadLink.isVisible());
  const downloadUrl = new URL(await downloadLink.getAttribute("href"), origin);
  const download = await fetch(downloadUrl, {
    headers: {
      Authorization:
        "Basic " + Buffer.from("operator:" + password).toString("base64"),
    },
  });
  assert.equal(download.status, 200);
  assert.match(
    download.headers.get("content-disposition") ?? "",
    /^attachment;/,
  );
  assert.match(await download.text(), /73 <fixture>/);
  await page.screenshot({ path: path.join(evidence, "result-tr-320.png") });
  await context.close();
  await stop();
  password = await launch();
  const next = await browser.newContext({
    viewport: { width: 1024, height: 840 },
    httpCredentials: { username: "operator", password, origin },
  });
  const nextPage = await next.newPage();
  assert.equal((await nextPage.goto(taskUrl)).status(), 200);
  assert.ok(
    await nextPage.getByText("73 <fixture>", { exact: true }).isVisible(),
  );
  assert.deepEqual(calls, [
    ["GET", "/api/version"],
    ["POST", "/api/show"],
    ["POST", "/api/chat"],
  ]);
  await nextPage.screenshot({
    path: path.join(evidence, "result-tr-1024.png"),
  });
  await writeFile(
    path.join(evidence, "receipt.json"),
    JSON.stringify(
      {
        widths,
        fixtureCalls: calls,
        download: true,
        recoveredAfterRestart: true,
        noCloudCalls: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      evidence,
      combinations: widths.length,
      inferenceCalls: 1,
      download: true,
      recoveredAfterRestart: true,
    }),
  );
} finally {
  await browser?.close();
  await stop();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
