import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createSetupSession } from "./session";
import type { InstallationPlan } from "./plan";
import type { InstallationCredentials } from "./session";

test("portable setup selects its supported container mode and explains native source setup", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const session = await createSetupSession({
    capabilities: async () => ({
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.19.0",
      postgresClientVersion: null,
      composeVersion: "2.40.0",
      native: { ready: false, issues: ["native_source_required"] },
      container: { ready: true, issues: [] },
    }),
    execute: async () => ({ url: "http://127.0.0.1:5000" }),
  });
  t.after(() => session.close());
  const page = await browser.newPage();
  await page.goto(session.url);
  await page.locator("#next:not([disabled])").waitFor({ timeout: 3000 });
  assert.equal(
    await page.locator('[name="mode"][value="container"]').isChecked(),
    true,
  );
  assert.equal(
    await page.locator('[name="mode"][value="native"]').isDisabled(),
    true,
  );
  assert.equal(await page.locator("#native-source").isVisible(), true);
});

test("container setup blocks a missing engine and submits container settings when available", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  let ready = false;
  let installed: InstallationPlan | undefined;
  const session = await createSetupSession({
    capabilities: async () => ({
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.20.0",
      postgresClientVersion: null,
      composeVersion: "2.40.0",
      native: { ready: true, issues: [] },
      container: { ready, issues: ready ? [] : ["docker_unavailable"] },
    }),
    execute: async (plan, credentials) => {
      installed = plan;
      assert.deepEqual(credentials, {});
      return { url: "http://127.0.0.1:5000" };
    },
  });
  t.after(() => session.close());
  const page = await browser.newPage();
  await page.goto(session.url);
  await page.locator("#next:not([disabled])").waitFor();
  await page.locator('[name="mode"][value="container"]').check();
  assert.equal(await page.locator("#next").isDisabled(), true);
  await page.locator('[name="mode"][value="native"]').check();
  assert.equal(await page.locator("#next").isDisabled(), false);
  ready = true;
  await page.goto("about:blank");
  await page.goto(session.url);
  await page.locator("#next:not([disabled])").waitFor();
  await page.locator('[name="mode"][value="container"]').check();
  await page.locator("#next").click();
  assert.equal(await page.locator("#database-field").isVisible(), false);
  await page.locator('[name="accessMode"]').selectOption("custom");
  await page.locator('[name="customPermission"][value="files"]').check();
  await page.locator("#next").click();
  await page.locator("#review").waitFor({ state: "visible" });
  await page.locator("#next").click();
  await page.locator("#open").waitFor({ state: "visible" });
  assert.equal(installed?.settings.mode, "container");
  assert.deepEqual(installed?.settings.customPermissions, {
    files: true,
    terminal: false,
    browser: false,
    delegation: false,
    sudo: false,
  });
});

test("wizard preserves selections, seven locales and RTL, submits one reviewed plan without showing credentials", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const submissions: {
    plan: InstallationPlan;
    credentials: InstallationCredentials;
  }[] = [];
  const session = await createSetupSession({
    capabilities: async () => ({
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.20.0",
      postgresClientVersion: null,
      composeVersion: "2.40.0",
      native: { ready: true, issues: [] },
      container: { ready: true, issues: [] },
    }),
    execute: async (plan, credentials, progress) => {
      submissions.push({ plan, credentials: { ...credentials } });
      for (const step of plan.steps) {
        progress(step, false);
        progress(step, true);
      }
      return { url: "http://127.0.0.1:5000" };
    },
  });
  t.after(() => session.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(session.url);
  await page.locator("#next:not([disabled])").waitFor();
  assert.equal(new URL(page.url()).hash, "");
  for (const locale of ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"]) {
    await page.locator("#language").selectOption(locale);
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    assert.equal(
      await page.locator("html").getAttribute("dir"),
      locale === "ar" ? "rtl" : "ltr",
    );
    assert.ok((await page.locator("h1").innerText()).length > 3);
    assert.equal(
      await page.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth",
      ),
      true,
    );
  }
  await page.locator("#language").selectOption("en");
  await page.locator("#next").click();
  await page
    .locator('[name="databaseUrl"]')
    .fill("postgresql://test:setup-fixture@localhost/test");
  await page.locator('[name="accessMode"]').selectOption("read_only");
  await page.locator('[name="toolPacks"][value="documents"]').check();
  await page.locator("#next").click();
  await page.locator("#review").waitFor({ state: "visible" });
  assert.doesNotMatch(
    await page.locator("#summary").innerText(),
    /setup-fixture/u,
  );
  await page.locator("#back").click();
  assert.equal(
    await page.locator('[name="accessMode"]').inputValue(),
    "read_only",
  );
  await page.locator("#next").click();
  await page.locator("#review").waitFor({ state: "visible" });
  await page.locator("#language").selectOption("tr");
  await page.locator("#preferences").waitFor({ state: "visible" });
  await page.locator("#next").click();
  await page.locator("#review").waitFor({ state: "visible" });
  await page.locator("#next").click();
  await page.locator("#open").waitFor({ state: "visible" });
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].plan.settings.locale, "tr");
  assert.equal(submissions[0].plan.settings.mode, "native");
  assert.deepEqual(submissions[0].plan.settings.toolPacks, ["documents"]);
  assert.equal(await page.locator('[name="databaseUrl"]').inputValue(), "");
  assert.deepEqual(errors, []);
});
