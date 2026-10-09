import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createSetupSession } from "./session";
import type { InstallationPlan } from "./plan";
import type { InstallationCredentials } from "./session";

test("optional coding selection is localized, reviewed and cleared when terminal permission is removed", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const session = await createSetupSession({
    capabilities: async () => ({
      platform: "linux",
      architecture: "x64",
      nodeVersion: "v24.20.0",
      postgresClientVersion: null,
      composeVersion: "2.40.0",
      native: { ready: true, issues: [] },
      container: { ready: true, issues: [] },
      coding: { ready: true, issues: [], apparmor: true },
    }),
    execute: async () => ({ url: "http://127.0.0.1:5000" }),
  });
  t.after(() => session.close());
  for (const locale of ["en", "tr", "de", "ru", "zh-CN", "zh-TW", "ar"]) {
    const page = await browser.newPage({
      viewport: { width: 320, height: 844 },
    });
    await page.goto(session.url);
    await page.locator("#next:not([disabled])").waitFor();
    await page.locator("#language").selectOption(locale);
    await page.locator('[name="mode"][value="container"]').check();
    await page.locator("#next").click();
    const coding = page.locator('[name="codingRuntime"]');
    assert.equal(await coding.isChecked(), false);
    await coding.check();
    const title = await page.locator('[data-copy="codingTitle"]').innerText();
    assert.ok(title.length > 8);
    assert.equal(await page.locator("#coding-apparmor").isVisible(), true);
    await page.locator("#next").click();
    await page.locator("#review:not([hidden])").waitFor({ timeout: 5000 });
    assert.ok((await page.locator("#summary").innerText()).includes(title));
    assert.equal(
      await page.evaluate("document.documentElement.scrollWidth > innerWidth"),
      false,
    );
    assert.equal(
      await page.locator("html").getAttribute("dir"),
      locale === "ar" ? "rtl" : "ltr",
    );
    await page.locator("#back").click();
    await page.locator('[name="accessMode"]').selectOption("read_only");
    assert.equal(await coding.isChecked(), false);
    assert.equal(await coding.isDisabled(), true);
    await page.close();
  }
});

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
  assert.equal(
    await page.locator("#requirements-list").getByRole("listitem").count(),
    0,
  );
  assert.equal(
    await page.locator("#native-source").getAttribute("target"),
    "_blank",
  );
});

test("setup names blocked requirements in seven languages and rechecks without losing the chosen mode", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  let ready = false;
  const session = await createSetupSession({
    capabilities: async () => ({
      platform: "win32",
      architecture: "x64",
      nodeVersion: "v24.20.0",
      postgresClientVersion: null,
      composeVersion: ready ? "2.40.0" : null,
      native: { ready: true, issues: [] },
      container: {
        ready,
        issues: ready
          ? []
          : ["docker_engine_unavailable", "compose_v2_required"],
      },
    }),
    execute: async () => ({ url: "http://127.0.0.1:5000" }),
  });
  t.after(() => session.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(session.url);
  await page.locator("#next:not([disabled])").waitFor();
  await page.locator('[name="mode"][value="container"]').check();
  const issueFragments: Record<string, string> = {
    tr: "Docker motoru",
    en: "Docker's engine",
    de: "Docker-Engine",
    ru: "Движок Docker",
    "zh-CN": "Docker 引擎",
    "zh-TW": "Docker 引擎",
    ar: "محرك Docker",
  };
  for (const locale of ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"]) {
    await page.locator("#language").selectOption(locale);
    assert.equal(
      await page.locator("#requirements-list").getByRole("listitem").count(),
      2,
    );
    assert.ok(
      (await page.locator("#requirements-list").innerText()).includes(
        issueFragments[locale],
      ),
    );
    assert.equal(await page.locator("#next").isDisabled(), true);
    assert.equal(
      await page.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth",
      ),
      true,
    );
  }
  await page.locator("#language").selectOption("en");
  assert.match(
    await page.locator("#requirements-list").innerText(),
    /Docker.*engine.*start/i,
  );
  assert.match(
    await page.locator("#requirements-list").innerText(),
    /Compose v2/i,
  );
  assert.equal(
    await page.locator("#requirements-guide").getAttribute("target"),
    "_blank",
  );
  ready = true;
  await page.locator("#recheck").click();
  await page.locator("#next:not([disabled])").waitFor();
  assert.equal(
    await page.locator('[name="mode"][value="container"]').isChecked(),
    true,
  );
  assert.equal(
    await page.locator("#requirements-list").getByRole("listitem").count(),
    0,
  );
});

test("a failed readiness recheck remains retryable and never keeps a stale result", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  let probes = 0;
  const session = await createSetupSession({
    capabilities: async () => {
      probes++;
      if (probes === 2) throw Error("fixture probe failure");
      return {
        platform: "linux",
        architecture: "x64",
        nodeVersion: "v24.20.0",
        postgresClientVersion: null,
        composeVersion: "2.40.0",
        native: { ready: true, issues: [] },
        container: { ready: true, issues: [] },
      };
    },
    execute: async () => ({ url: "http://127.0.0.1:5000" }),
  });
  t.after(() => session.close());
  const page = await browser.newPage();
  await page.goto(session.url);
  await page.locator("#next:not([disabled])").waitFor();
  await page.locator('[name="mode"][value="container"]').check();
  assert.equal(await page.locator("#next").isDisabled(), false);
  await page.locator("#recheck").click();
  await page.locator("#error:not(:empty)").waitFor();
  assert.equal(await page.locator("#next").isDisabled(), true);
  assert.equal(await page.locator("#recheck").isVisible(), true);
  assert.equal(
    await page.locator("#requirements-status").innerText(),
    await page.locator("#error").innerText(),
  );
  await page.locator("#recheck").click();
  await page.locator("#next:not([disabled])").waitFor();
  assert.equal(await page.locator("#error").innerText(), "");
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
