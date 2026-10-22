import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { chromium } from "@playwright/test";
import { createSetupSession } from "./session";
import type { NativeUpgradeCandidate } from "./native-upgrade-candidate";

const candidate: NativeUpgradeCandidate = {
  mode: "upgrade",
  directory: path.resolve(
    "Private workspace/instance-00000000-0000-0000-0000-000000000001",
  ),
  installationId: "00000000-0000-0000-0000-000000000001",
  locale: "tr",
  sourceVersion: "0.5.5",
  targetVersion: "0.5.6",
  sourceCommit: "a".repeat(40),
  targetCommit: "b".repeat(40),
  metadataSha256: "c".repeat(64),
  pointerSha256: "d".repeat(64),
};
const capabilities = {
  platform: "win32",
  architecture: "x64",
  nodeVersion: "v24.21.0",
  postgresClientVersion: null,
  composeVersion: null,
  native: { ready: true, issues: [], managedDatabase: true },
  container: { ready: false, issues: [] },
};

test("native upgrade review waits for verified packages within its own bound while ordinary requests keep their deadline", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  for (const scenario of [
    "verified-review",
    "expired-review",
    "ordinary-state",
  ]) {
    let entered!: () => void,
      finish!: () => void,
      executions = 0;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const session = await createSetupSession({
      capabilities: async () => capabilities,
      execute: async () => {
        throw new Error("fresh installation forbidden");
      },
      upgrade: {
        freshAvailable: false,
        inspect: async () => {
          entered();
          await pending;
          return { ...candidate, locale: "en" };
        },
        execute: async () => {
          executions++;
          throw new Error("review must never start an upgrade");
        },
      },
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.clock.install();
      if (scenario === "ordinary-state") {
        await page.route("**/api/state", async (route) => {
          entered();
          await pending;
          await route.continue().catch(() => {});
        });
      }
      await page.goto(session.url);
      await started;
      await page.locator("#language").selectOption("en");
      // Advance the actual browser's request timer; the real authenticated
      // session is still waiting for its read-only verification to finish.
      await page.clock.fastForward(
        scenario === "expired-review" ? 90_001 : 16_000,
      );
      if (scenario === "verified-review") {
        finish();
        await page.locator("#upgrade-confirm").waitFor({ state: "visible" });
        assert.equal(await page.locator("#upgrade-confirm").isEnabled(), true);
        assert.equal(await page.locator("#upgrade-error").innerText(), "");
        assert.equal(
          await page.locator("#upgrade-source-version").innerText(),
          "0.5.5",
        );
        assert.equal(
          await page.locator("#upgrade-target-version").innerText(),
          "0.5.6",
        );
      } else {
        await page.locator("#upgrade-check").waitFor({ state: "visible" });
        assert.equal(await page.locator("#upgrade-confirm").isVisible(), false);
        assert.match(
          await page.locator("#upgrade-error").innerText(),
          /could not reach the installer/iu,
        );
        finish();
      }
      assert.equal(executions, 0, scenario);
    } finally {
      finish();
      await page.close();
      await session.close();
    }
  }
});

test("every installer upgrade message is authored for all seven languages", () => {
  const source = readFileSync(
    new URL("./setup-upgrade-client.js", import.meta.url),
    "utf8",
  );
  const context = vm.createContext({});
  vm.runInContext(
    source.slice(0, source.indexOf("  const $ =")) + "return {keys, words}; };",
    context,
  );
  const copy = vm.runInContext("initializeSetupUpgrade({})", context) as {
    keys: string[];
    words: Record<string, string>;
  };
  assert.equal(new Set(copy.keys).size, copy.keys.length);
  assert.deepEqual(Object.keys(copy.words).sort(), [
    "ar",
    "de",
    "en",
    "ru",
    "tr",
    "zh-CN",
    "zh-TW",
  ]);
  for (const [locale, text] of Object.entries(copy.words)) {
    const values = text.split("|");
    assert.equal(values.length, copy.keys.length, locale);
    assert.ok(
      values.every((value) => value.trim().length > 0),
      locale,
    );
  }
});

test("upgrade review, pause guidance and connection work in seven locales at phone width", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  for (const [locale, heading, paused] of [
    ["en", "Update", "paused"],
    ["tr", "Güncelle", "duraklat"],
    ["de", "aktualis", "pausiert"],
    ["ru", "Обнов", "приостанов"],
    ["zh-CN", "更新", "暂停"],
    ["zh-TW", "更新", "暫停"],
    ["ar", "تحديث", "متوقف"],
  ])
    await t.test(locale, async (t) => {
      let finish!: () => void,
        calls = 0;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const session = await createSetupSession({
        capabilities: async () => capabilities,
        execute: async () => {
          throw new Error("must not create a fresh workspace");
        },
        upgrade: {
          freshAvailable: false,
          inspect: async () => candidate,
          execute: async (reviewed, _signal, progress) => {
            calls++;
            assert.equal(reviewed.locale, "tr");
            progress({ phase: "copying", copiedFiles: 12 });
            await gate;
            return {
              url: "http://127.0.0.1:5031",
              operatorToken: "fake-access-key",
            };
          },
        },
      });
      t.after(async () => {
        finish();
        await session.close();
      });
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        colorScheme: locale === "ar" ? "dark" : "light",
      });
      t.after(() => page.close());
      page.setDefaultTimeout(3000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(session.url);
      await page.locator("#upgrade-confirm").waitFor({ state: "visible" });
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/locale") && response.status() === 200,
        ),
        page.locator("#language").selectOption(locale),
      ]);
      assert.match(
        await page.locator("#heading").innerText(),
        new RegExp(heading, "iu"),
      );
      assert.equal(await page.locator("#setup-form").isVisible(), false);
      assert.equal(
        await page.locator("#upgrade-source-version").innerText(),
        "0.5.5",
      );
      assert.equal(
        await page.locator("#upgrade-target-version").innerText(),
        "0.5.6",
      );
      await page.locator("#upgrade-confirm").click();
      await page.locator("#upgrade-cancel:not([disabled])").waitFor();
      assert.equal(calls, 1);
      assert.match(
        await page.locator("#upgrade-progress-text").innerText(),
        /12/u,
      );
      // The original private link restores the operation; the bearer is not stored.
      await page.goto(session.url);
      await page.locator("#upgrade-cancel").waitFor();
      assert.equal(calls, 1);
      assert.equal(await page.locator("#language").inputValue(), locale);
      finish();
      await page.locator("#upgrade-open").waitFor({ state: "visible" });
      assert.equal(await page.locator("#upgrade-keep").isVisible(), false);
      assert.match(
        await page.locator("#upgrade-paused").innerText(),
        new RegExp(paused, "iu"),
      );
      assert.equal(
        await page.locator("#upgrade-open").getAttribute("href"),
        "http://127.0.0.1:5031/",
      );
      await page.locator("#upgrade-connection").click();
      await page.locator("#upgrade-key-field").waitFor({ state: "visible" });
      assert.equal(
        await page.locator("#upgrade-key").inputValue(),
        "fake-access-key",
      );
      assert.equal(
        await page.evaluate(
          "document.documentElement.scrollWidth <= innerWidth",
        ),
        true,
      );
      assert.equal(
        await page.locator("html").getAttribute("dir"),
        locale === "ar" ? "rtl" : "ltr",
      );
      assert.deepEqual(errors, []);
    });
});

test("lost acknowledgement, cancellation, recovery and stale review stay bounded in the real installer session", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  let mode: NativeUpgradeCandidate["mode"] = "upgrade",
    calls = 0,
    finish!: () => void;
  let gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const session = await createSetupSession({
    capabilities: async () => capabilities,
    execute: async () => {
      throw Error("fresh forbidden");
    },
    upgrade: {
      freshAvailable: false,
      inspect: async () => ({ ...candidate, mode }),
      execute: async (_candidate, signal, progress) => {
        calls++;
        progress({ phase: mode === "recover" ? "recovering" : "copying" });
        await Promise.race([
          gate,
          new Promise<never>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          ),
        ]);
        return { url: "http://127.0.0.1:5031" };
      },
    },
  });
  t.after(async () => {
    finish();
    await session.close();
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.route("**/api/upgrade/install", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.goto(session.url);
  await page.locator("#upgrade-confirm").waitFor();
  await page.locator("#language").selectOption("en");
  await mkdir(".tmp/native-upgrade-ui-shots", { recursive: true });
  await page.screenshot({
    path: ".tmp/native-upgrade-ui-shots/en-desktop-light.png",
    fullPage: true,
  });
  await page.locator("#upgrade-confirm").focus();
  await page.keyboard.press("Enter");
  await page.locator("#upgrade-cancel:not([disabled])").waitFor();
  assert.equal(calls, 1);
  await page.locator("#upgrade-cancel").click();
  await page.locator("#upgrade-check").waitFor();
  assert.match(
    await page.locator("#upgrade-progress-text").innerText(),
    /stopped/u,
  );
  mode = "recover";
  gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.locator("#upgrade-check").click();
  await page.locator("#upgrade-confirm").waitFor();
  assert.match(await page.locator("#upgrade-confirm").innerText(), /recovery/u);
  assert.equal(await page.locator("#upgrade-keep").isVisible(), false);
  await page.locator("#upgrade-confirm").click();
  await page.locator("#upgrade-cancel[disabled]").waitFor();
  assert.equal(calls, 2);
  assert.equal(await page.locator("#upgrade-fresh").isVisible(), false);
  finish();
  await page.locator("#upgrade-open").waitFor();
  await page.goto(session.url);
  await page.locator("#upgrade-open").waitFor();
  assert.equal(calls, 2);
});

test("manual lookup, expired links, responsive text and theme states remain usable", async (t) => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  let now = 100,
    found = false;
  const session = await createSetupSession({
    now: () => now,
    lifetimeMs: 1000,
    capabilities: async () => capabilities,
    execute: async () => ({ url: "http://127.0.0.1:5031" }),
    upgrade: {
      freshAvailable: false,
      inspect: async ({ directory }) => {
        if (directory === "bad") throw Error("private internal detail");
        return found ? candidate : null;
      },
      execute: async () => {
        throw Error("native_upgrade_review_changed");
      },
    },
  });
  t.after(() => session.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  t.after(() => page.close());
  page.setDefaultTimeout(4000);
  await page.goto(session.url);
  await page.locator("#upgrade-find").waitFor();
  await page.locator("#upgrade-path").fill("bad");
  await page.locator("#upgrade-find").click();
  await page.locator('#upgrade-path[aria-invalid="true"]').waitFor();
  assert.equal(
    await page.evaluate("document.activeElement.id"),
    "upgrade-path",
  );
  assert.doesNotMatch(
    await page.locator("#upgrade-error").innerText(),
    /private internal/u,
  );
  found = true;
  await page.locator("#upgrade-path").fill(candidate.directory);
  await page.locator("#upgrade-find").click();
  await page.locator("#upgrade-confirm").waitFor();
  await page.locator("#language").selectOption("en");
  await page.evaluate("document.documentElement.style.fontSize='200%'");
  assert.equal(
    await page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  assert.equal(
    await page.evaluate(
      "Array.from(document.querySelectorAll('.upgrade-versions strong')).every(node => { const a=node.getBoundingClientRect(), b=document.querySelector('#upgrade-panel').getBoundingClientRect(); return a.left >= b.left && a.right <= b.right; })",
    ),
    true,
  );
  // Screenshots cover both schemes and the actual RTL content, without external assets.
  await mkdir(".tmp/native-upgrade-ui-shots", { recursive: true });
  await page.screenshot({
    path: ".tmp/native-upgrade-ui-shots/en-large-light.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/locale")),
    page.locator("#language").selectOption("ar"),
  ]);
  await page.screenshot({
    path: ".tmp/native-upgrade-ui-shots/ar-large-dark.png",
    fullPage: true,
  });
  await page.locator("#upgrade-confirm").click();
  await page.locator("#upgrade-check").waitFor();
  assert.match(
    await page.locator("#upgrade-progress-text").innerText(),
    /تغير/u,
  );
  await page.locator("#upgrade-check").click();
  await page.locator("#upgrade-confirm").waitFor();
  now = 1101;
  await page.locator("#upgrade-confirm").click();
  await page.locator("#upgrade-error").filter({ hasText: /رابط/u }).waitFor();
  const publicUrl = new URL(session.url);
  publicUrl.hash = "";
  await page.goto(publicUrl.href);
  assert.equal(await page.locator("#next").isEnabled(), false);
});
