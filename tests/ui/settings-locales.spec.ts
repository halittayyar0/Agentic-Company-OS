import {
  inspectRoute,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import { expect, test, type Page } from "@playwright/test";
import type { LlmSettings } from "@workspace/api-client-react";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadSettingsCopy } from "../../artifacts/agentic-company-os/src/lib/settings-copy";
import { recoveryCopy } from "../../artifacts/agentic-company-os/src/lib/recovery-copy";

async function setup(page: Page, locale: Locale = "en") {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const harness = await installStudioFixtures(page);
  const key = {
    configured: true,
    hasKeyInEnv: true,
    keySource: "environment" as const,
    keyPreview: "env-********-key",
    baseUrl: "https://api.openai.com/v1",
  };
  const settings: LlmSettings = {
    revision: 0,
    storage: "local-file",
    openai: { ...key },
    openrouter: { ...key, baseUrl: "https://openrouter.ai/api/v1" },
    ollama: {
      configured: false,
      reachable: false,
      baseUrl: null,
      modelCount: 0,
      toolModelCount: 0,
      catalogSyncedAt: null,
      error: null,
    },
    replitFleet: { configured: false, baseUrl: null },
    catalog: {
      providers: [
        { id: "openai", label: "OpenAI", available: true },
        { id: "openrouter", label: "OpenRouter", available: true },
        { id: "ollama", label: "Ollama", available: false },
        { id: "replit", label: "Replit", available: false },
      ],
      models: Array.from({ length: 12 }, (_, index) => ({
        id: index === 0 ? "source/model:free" : "openai:fixture-" + index,
        label: "Source model 原文 " + index,
        description: "Original 原文: $-1/M, punctuation — unchanged.",
        provider: index === 0 ? "openrouter" : "openai",
        tier: index === 2 ? "premium" : "economy",
        supportsTools: index % 2 === 0,
        isDefault: index === 1,
      })),
    },
  };
  const state = {
    settings,
    readError: false,
    saveError: false,
    conflict: false,
    testError: false,
    stopped: false,
    writes: [] as Record<string, unknown>[],
    tests: [] as Record<string, unknown>[],
    hold: null as Promise<void> | null,
  };
  await page.route("**/api/ops/control", (route) =>
    route.fulfill({
      json: {
        emergencyStopEnabled: state.stopped,
        reason: null,
        version: 1,
        updatedBy: "fixture",
        updatedAt: "2026-09-27T00:00:00Z",
        blockedScopes: [],
      },
    }),
  );
  await page.route("**/api/settings/llm", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        status: state.readError ? 503 : 200,
        json: state.readError
          ? { error: "private-error-sentinel" }
          : state.settings,
      });
    const body = route.request().postDataJSON();
    state.writes.push(body);
    if (state.hold) await state.hold;
    if (state.conflict || body.expectedRevision !== state.settings.revision)
      return route.fulfill({
        status: 409,
        json: { code: "LLM_CONFIG_CHANGED", error: "private-error-sentinel" },
      });
    const provider = "openaiApiKey" in body ? "openai" : "openrouter";
    const value =
      body[provider === "openai" ? "openaiApiKey" : "openrouterApiKey"];
    state.settings.revision++;
    state.settings[provider] = {
      ...state.settings[provider],
      keySource: value ? "runtime" : "environment",
      keyPreview: value ? "***********" : "env-********-key",
    };
    return route.fulfill({
      status: state.saveError ? 503 : 200,
      json: state.saveError
        ? { code: "LLM_SETTINGS_UNCONFIRMED", error: "private-error-sentinel" }
        : {
            ok: true,
            revision: state.settings.revision,
            configured: true,
            configuredProviders: ["openai", "openrouter"],
            catalog: state.settings.catalog,
          },
    });
  });
  await page.route("**/api/settings/llm/test", async (route) => {
    const body = route.request().postDataJSON();
    state.tests.push(body);
    if (state.hold) await state.hold;
    return route.fulfill({
      status: state.testError ? 502 : 200,
      json: state.testError
        ? {
            ok: false,
            code: "LLM_TEST_FAILED",
            error: "private-error-sentinel",
          }
        : {
            ok: true,
            provider: body.model.startsWith("openai:")
              ? "openai"
              : "openrouter",
            model: body.model,
            revision: body.expectedRevision,
            latencyMs: 42,
            sample: "",
          },
    });
  });
  return { ...harness, state, c: await loadSettingsCopy(locale) };
}

test("Settings opens the same guided local connection without inference or a write on viewing", async ({
  page,
}) => {
  const harness = await setup(page, "en");
  await page.goto("/settings");
  const opener = page.getByRole("button", {
    name: "Connect a model",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", {
    name: "Connect a model",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Ollama address", exact: true }),
  ).toHaveValue("http://127.0.0.1:11434");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/\/settings$/);
  expect(harness.state.writes).toEqual([]);
  expect(harness.state.tests).toEqual([]);
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("execution permissions save explicit custom rights and recover a stale revision", async ({
  page,
}) => {
  await setup(page, "en");
  let saved: Record<string, unknown> = {
    id: 1,
    mode: "approval",
    custom: null,
    revision: 1,
    updatedAt: "2026-09-28T00:00:00Z",
  };
  const writes: Record<string, unknown>[] = [];
  let conflict = false;
  await page.route("**/api/settings/execution-policy", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: saved });
    const body = route.request().postDataJSON();
    writes.push(body);
    if (conflict) {
      saved = { ...saved, mode: "read_only", revision: 3 };
      return route.fulfill({
        status: 409,
        json: { code: "EXECUTION_POLICY_CONFLICT" },
      });
    }
    saved = {
      ...saved,
      mode: body.mode,
      custom: body.custom ?? null,
      revision: Number(saved.revision) + 1,
    };
    return route.fulfill({ json: saved });
  });
  await page.goto("/settings");
  const panel = page.locator(
    'section[aria-labelledby="execution-policy-title"]',
  );
  await panel.getByRole("radio", { name: "Custom", exact: true }).check();
  await panel
    .getByRole("checkbox", { name: "File changes", exact: true })
    .check();
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    panel.getByText("Permissions saved.", { exact: true }),
  ).toBeVisible();
  expect(writes[0]).toEqual({
    mode: "custom",
    expectedRevision: 1,
    custom: {
      files: true,
      terminal: false,
      browser: false,
      delegation: false,
      sudo: false,
    },
  });
  conflict = true;
  await panel.getByRole("radio", { name: "Full access", exact: true }).check();
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    panel.getByRole("radio", { name: "Read only", exact: true }),
  ).toBeChecked();
  await expect(
    panel.getByText(/Permissions could not be loaded or have changed/),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
});

for (const locale of LOCALES) {
  test(`${locale} settings save, test with consent, preserve catalog and remove with environment fallback on a phone`, async ({
    page,
  }, testInfo) => {
    const { state, c, unexpected } = await setup(page, locale);
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    const packs: string[] = [];
    page.on("request", (req) => {
      const file = new URL(req.url()).pathname.split("/").at(-1)!;
      if (/^settings-(?:tr|en|de|ru|ar|zh-CN|zh-TW)-.*\.js$/.test(file))
        packs.push(file);
    });
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    const openai = page.locator('[data-provider="openai"]');
    await expect(page.locator("#openai-model")).toHaveValue("openai:fixture-4");
    const draft = page.locator("#openai-key");
    await draft.fill("new-key-1234");
    await openai.getByRole("button", { name: c.save, exact: true }).click();
    await expect(page.getByText(c.saved, { exact: true })).toBeVisible();
    expect(state.writes).toEqual([
      { expectedRevision: 0, openaiApiKey: "new-key-1234" },
    ]);
    await expect(draft).toHaveValue("");
    await expect(
      openai.getByText(c.sourceRuntime, { exact: true }),
    ).toBeVisible();
    await page.locator("#openai-model").selectOption("openai:fixture-3");
    await expect(
      openai.getByText(c.chatOnlyProjectWarning, { exact: true }),
    ).toBeVisible();
    const trigger = openai.getByRole("button", { name: c.test, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(c.testHelp, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("openai:fixture-3", { exact: true }),
    ).toBeVisible();
    expect(state.tests).toHaveLength(0);
    await expect(
      dialog.getByRole("button", { name: c.cancel, exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(state.tests).toHaveLength(0);
    await trigger.click();
    await dialog
      .getByRole("button", { name: c.confirmTest, exact: true })
      .click();
    await expect(page.getByText(c.testPassed, { exact: true })).toBeVisible();
    await expect(page.getByText(c.chatTestOnly, { exact: true })).toBeVisible();
    expect(state.tests).toEqual([
      { model: "openai:fixture-3", expectedRevision: 1 },
    ]);
    await page.getByRole("button", { name: c.more, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Source model 原文 11", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Original 原文: $-1/M, punctuation — unchanged.", {
        exact: true,
      }),
    ).toHaveCount(12);
    await page.getByLabel(c.search, { exact: true }).fill(c.tools);
    await expect(
      page.getByRole("heading", { name: "Source model 原文 1", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: c.clear, exact: true }).click();
    await page.locator("#settings-appearance").selectOption("light");
    await expect(page.locator("html")).toHaveClass(/light/);
    if (locale === "ar") {
      await expect(
        page.getByRole("button", { name: c.refresh, exact: true }),
      ).toBeEnabled();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath("settings-ar-phone.png"),
        animations: "disabled",
      });
    }
    await page.locator("#settings-appearance").selectOption("dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    if (locale === "en") {
      await page.setViewportSize({ width: 1365, height: 900 });
      await expect(page.locator("#app-navigation")).not.toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await expect
        .poll(() =>
          page
            .locator("#app-navigation")
            .evaluate((element) =>
              Math.round(element.getBoundingClientRect().x),
            ),
        )
        .toBe(0);
      await expect(
        page.getByRole("button", { name: c.refresh, exact: true }),
      ).toBeEnabled();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath("settings-en-desktop.png"),
        animations: "disabled",
      });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.locator("#settings-appearance").selectOption("system");
    await expect(page.locator("html")).toHaveAttribute(
      "data-color-mode",
      "system",
    );
    await openai.getByRole("button", { name: c.remove, exact: true }).click();
    await expect(dialog.getByText(c.removeHelp, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: c.remove, exact: true }).click();
    await expect(
      openai.getByText(c.sourceEnvironment, { exact: true }),
    ).toBeVisible();
    expect(state.writes[1]).toEqual({
      openaiApiKey: null,
      expectedRevision: 1,
    });
    await expect(
      openai.getByRole("button", { name: c.remove, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(c.currentChanged, { exact: true }),
    ).toBeVisible();
    const storage = await page.evaluate(
      () =>
        JSON.stringify({ ...localStorage }) +
        JSON.stringify({ ...sessionStorage }),
    );
    expect(storage).not.toContain("new-key-1234");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toContain("settings-" + locale + "-");
    expect([...unexpected]).toEqual([]);
  });
}

test("a chat-only connection check does not imply a project can run", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  await page.goto("/settings");
  const openai = page.locator('[data-provider="openai"]');
  const model = page.locator("#openai-model");
  await model.selectOption("openai:fixture-3");
  await expect(
    openai.getByText("Agent projects need a model with tool support."),
  ).toBeVisible();
  await openai.getByRole("button", { name: c.test, exact: true }).click();
  expect(state.tests).toHaveLength(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: c.confirmTest, exact: true })
    .click();
  await expect(
    page.getByText("This reply confirms chat only, not agent task readiness."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "View projects" })).toHaveCount(
    0,
  );

  await model.selectOption("openai:fixture-2");
  await openai.getByRole("button", { name: c.test, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: c.confirmTest, exact: true })
    .click();
  await expect(
    page.getByText(
      "This model is listed as tool-capable and replied. Check your project for its next attempt.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View projects" }),
  ).toHaveAttribute("href", "/projects");
  expect(state.tests).toEqual([
    { model: "openai:fixture-3", expectedRevision: 0 },
    { model: "openai:fixture-2", expectedRevision: 0 },
  ]);
});

test("settings distinguish unknown reads, uncertain committed saves, conflicts and safe retries", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  state.readError = true;
  await page.goto("/settings");
  await expect(page.getByText(c.loadError, { exact: true })).toBeVisible();
  await expect(page.locator("[data-provider]")).toHaveCount(0);
  state.readError = false;
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  const openai = page.locator('[data-provider="openai"]');
  const draft = page.locator("#openai-key");
  const save = openai.getByRole("button", { name: c.save, exact: true });
  await draft.fill("retained-secret-draft");
  state.saveError = true;
  await save.click();
  await expect(page.getByText(c.unconfirmed, { exact: true })).toBeVisible();
  await expect(draft).toHaveValue("retained-secret-draft");
  await expect(save).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  expect(state.settings.revision).toBe(1);
  state.readError = true;
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  await expect(save).toBeDisabled();
  state.readError = false;
  state.saveError = false;
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  await expect(save).toBeEnabled();
  state.conflict = true;
  await save.click();
  await expect(page.getByText(c.changed, { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  expect(state.writes).toHaveLength(2);
  state.conflict = false;
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  await save.click();
  await expect(draft).toHaveValue("");
  expect(state.writes[2].expectedRevision).toBe(1);
  await expect(
    page.getByText("private-error-sentinel", { exact: false }),
  ).toHaveCount(0);
});

test("settings prevent overlapping writes, do not persist draft keys, and redact test failures", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  await page.goto("/settings");
  const openai = page.locator('[data-provider="openai"]');
  await page.locator("#openai-key").fill("private-draft");
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await openai.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.locator("#openrouter-key")).toBeDisabled();
  await expect(
    openai.getByRole("button", { name: c.test, exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#settings-language")).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  state.hold = null;
  release();
  await expect(page.getByText(c.saved, { exact: true })).toBeVisible();
  state.testError = true;
  await openai.getByRole("button", { name: c.test, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: c.confirmTest, exact: true })
    .click();
  await expect(page.getByText(c.testFailed, { exact: true })).toBeVisible();
  expect(state.tests).toHaveLength(1);
  await expect(
    page.getByText("private-error-sentinel", { exact: false }),
  ).toHaveCount(0);
  await page.locator("#openai-key").fill("never-store-draft");
  await page.reload();
  await expect(page.locator("#openai-key")).toHaveValue("");
  expect(
    await page.evaluate(
      () =>
        JSON.stringify({ ...localStorage }) +
        JSON.stringify({ ...sessionStorage }),
    ),
  ).not.toContain("never-store-draft");
});

test("settings keep credential edits available under stop but block paid probes", async ({
  page,
}) => {
  const { state, c } = await setup(page, "ar");
  state.stopped = true;
  await page.goto("/settings");
  await expect(page.getByText(c.testBlocked, { exact: true })).toBeVisible();
  await expect(
    page
      .locator('[data-provider="openai"]')
      .getByRole("button", { name: c.test, exact: true }),
  ).toBeDisabled();
  await page.locator("#openai-key").fill("test-draft");
  await expect(
    page
      .locator('[data-provider="openai"]')
      .getByRole("button", { name: c.save, exact: true }),
  ).toBeEnabled();
  expect(state.tests).toHaveLength(0);
});

test("settings pack failure keeps writes unavailable and offers recovery", async ({
  page,
}) => {
  const { state } = await setup(page, "de");
  await page.route("**/assets/settings-de-*.js", (route) => route.abort());
  await page.goto("/settings");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Sprachdatei",
  );
  await expect(page.locator("[data-provider]")).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

for (const locale of LOCALES)
  test(`${locale} route failure recovers without exposing upstream error details`, async ({
    page,
  }) => {
    await setup(page, locale);
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    const c = recoveryCopy[locale];
    let broken = true;
    const logged: string[] = [];
    page.on("console", (event) => logged.push(event.text()));
    await page.route(/\/assets\/settings-[a-zA-Z0-9_-]+\.js$/, (route) => {
      // Fail the route itself, not a selected language file (which has its own recovery).
      if (
        broken &&
        !/settings-(?:tr|en|de|ru|ar|zh-CN|zh-TW)-/.test(route.request().url())
      ) {
        return route.fulfill({
          contentType: "application/javascript",
          body: 'throw new Error("private-render-error-sentinel");',
        });
      }
      return route.continue();
    });
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeFocused();
    await expect(page.getByText(c.body, { exact: true })).toBeVisible();
    await expect(
      page.getByText("private-render-error-sentinel", { exact: false }),
    ).toHaveCount(0);
    expect(logged.join("\n")).not.toContain("private-render-error-sentinel");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    broken = false;
    await page.getByRole("button", { name: c.reload, exact: true }).click();
    const settings = await loadSettingsCopy(locale);
    await expect(
      page.getByRole("heading", { name: settings.title, exact: true }),
    ).toBeVisible();
  });

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: settings and model metadata`, async ({
    page,
  }, info) => {
    const { state, c, unexpected } = await setup(page, locale);
    const errors = await prepareRouteAudit(page, variant);
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator("#openai-key")).toBeVisible();
    await inspectRoute(page, info, "settings", variant);
    expect(state.writes).toEqual([]);
    expect(state.tests).toEqual([]);
    expect([...unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
