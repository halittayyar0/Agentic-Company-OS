import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadConnectionCopy } from "../../artifacts/agentic-company-os/src/lib/connection-copy";
import { loadNewAgentCopy } from "../../artifacts/agentic-company-os/src/lib/new-agent-copy";
import { loadSettingsCopy } from "../../artifacts/agentic-company-os/src/lib/settings-copy";
import {
  loadShellMessages,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";

const labels = {
  en: [
    "Allow cloud models for this server",
    "Runs locally",
    "Uses Ollama cloud",
    "Location unverified",
  ],
  tr: [
    "Bu sunucu için bulut modellerine izin ver",
    "Yerelde çalışır",
    "Ollama bulutunu kullanır",
    "Konum doğrulanamadı",
  ],
  de: [
    "Cloud-Modelle für diesen Server erlauben",
    "Läuft lokal",
    "Nutzt die Ollama-Cloud",
    "Ausführungsort ungeprüft",
  ],
  ru: [
    "Разрешить облачные модели для этого сервера",
    "Работает локально",
    "Использует облако Ollama",
    "Место выполнения не проверено",
  ],
  "zh-CN": [
    "允许此服务器使用云端模型",
    "在本地运行",
    "使用 Ollama 云端",
    "运行位置未验证",
  ],
  "zh-TW": [
    "允許此伺服器使用雲端模型",
    "在本機執行",
    "使用 Ollama 雲端",
    "執行位置未驗證",
  ],
  ar: [
    "السماح بالنماذج السحابية لهذا الخادم",
    "يعمل محليًا",
    "يستخدم سحابة Ollama",
    "موقع التشغيل غير متحقق منه",
  ],
} satisfies Record<Locale, readonly string[]>;
const models = [
  {
    id: "ollama:local-fixture",
    label: "Local fixture",
    executionLocation: "local",
  },
  {
    id: "ollama-cloud:cloud-fixture:free",
    label: "Cloud fixture",
    executionLocation: "cloud",
  },
  {
    id: "ollama:unknown-fixture",
    label: "Unknown fixture",
    executionLocation: "unknown",
  },
].map((model) => ({
  ...model,
  provider: "ollama",
  description: "Owned metadata fixture",
  tier: "economy",
  supportsTools: true,
  isDefault: false,
}));
const catalog = {
  providers: [{ id: "ollama", label: "Ollama", available: true }],
  models,
  liveSyncedAt: null,
};
function settings(supported = true) {
  return {
    revision: 7,
    storage: "local-file",
    openai: {
      configured: false,
      hasKeyInEnv: false,
      keyPreview: null,
      baseUrl: "https://api.openai.com/v1",
      keySource: "none",
    },
    openrouter: {
      configured: false,
      hasKeyInEnv: false,
      keyPreview: null,
      baseUrl: "https://openrouter.ai/api/v1",
      keySource: "none",
    },
    ollama: {
      configured: true,
      reachable: true,
      baseUrl: "http://127.0.0.1:11434",
      hasAddressInEnv: false,
      addressSource: "settings",
      modelCount: 3,
      toolModelCount: 2,
      catalogSyncedAt: null,
      error: null,
      cloudEnabled: false,
      serverVersion: supported ? "0.18.0" : "0.17.9",
      localEnforcementSupported: supported,
      localModelCount: 1,
      cloudModelCount: 1,
      unknownModelCount: 1,
    },
    replitFleet: { configured: false, baseUrl: null },
    catalog,
  };
}

for (const locale of Object.keys(labels) as Locale[]) {
  test(`${locale}: explicit server cloud consent and honest locality at 390px`, async ({
    page,
  }, testInfo) => {
    const c = await loadConnectionCopy(locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const harness = await installStudioFixtures(page);
    let current = settings();
    const writes: Record<string, unknown>[] = [];
    await page.route("**/api/settings/llm", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: current });
      const body = route.request().postDataJSON();
      writes.push(body);
      current = {
        ...current,
        revision: current.revision + 1,
        ollama: {
          ...current.ollama,
          cloudEnabled: body.ollamaCloudEnabled === true,
          baseUrl: body.ollamaBaseUrl ?? "http://127.0.0.1:11434",
        },
      };
      return route.fulfill({
        json: {
          ok: true,
          revision: current.revision,
          configured: true,
          configuredProviders: ["ollama"],
          catalog,
        },
      });
    });
    await page.goto("/");
    await page
      .getByRole("button", {
        name: (await loadShellMessages(locale)).providerSetupAction,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: c.local, exact: true }).click();
    const cloud = dialog.getByRole("checkbox", {
      name: labels[locale][0],
      exact: true,
    });
    await expect(cloud).not.toBeChecked();
    for (const label of labels[locale].slice(1))
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    await dialog.screenshot({
      path: testInfo.outputPath(`ollama-consent-${locale}-390px.png`),
    });
    expect(writes).toEqual([]);
    await cloud.focus();
    await page.keyboard.press("Space");
    await expect(cloud).toBeChecked();
    expect(writes).toEqual([]);
    await dialog.getByRole("button", { name: c.save, exact: true }).click();
    await expect(cloud).toBeChecked();
    expect(writes).toEqual([
      {
        expectedRevision: 7,
        ollamaBaseUrl: "http://127.0.0.1:11434",
        ollamaCloudEnabled: true,
      },
    ]);
    const address = dialog.getByRole("textbox", {
      name: c.endpoint,
      exact: true,
    });
    await address.fill("http://10.0.0.8:11434");
    await expect(cloud).not.toBeChecked();
    await address.fill("http://127.0.0.1:11434");
    await expect(cloud).not.toBeChecked();
    await dialog.getByRole("button", { name: c.save, exact: true }).click();
    expect(writes[1]).toEqual({
      expectedRevision: 8,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaCloudEnabled: false,
    });
    await cloud.check();
    await dialog.getByRole("button", { name: c.restore, exact: true }).click();
    expect(writes[2]).toEqual({
      expectedRevision: 9,
      ollamaBaseUrl: null,
      ollamaCloudEnabled: false,
    });
    await expect(cloud).not.toBeChecked();
    await expect(address).toHaveValue("http://127.0.0.1:11434");
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await cloud
        .locator("..")
        .evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    if (locale === "ar")
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", {
        name: (await loadShellMessages(locale)).providerSetupAction,
        exact: true,
      }),
    ).toBeFocused();
    expect(harness.requests).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
  });

  test(`${locale}: unsupported local enforcement blocks cloud permission`, async ({
    page,
  }) => {
    const c = await loadConnectionCopy(locale);
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/settings/llm", (route) =>
      route.fulfill({ json: settings(false) }),
    );
    await page.goto("/");
    await page
      .getByRole("button", {
        name: (await loadShellMessages(locale)).providerSetupAction,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: c.local, exact: true }).click();
    await expect(
      dialog.getByRole("checkbox", { name: labels[locale][0], exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByText(/0\.18\.0/)).toBeVisible();
    expect(harness.requests).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
  });

  test(`${locale}: expert model choices distinguish cloud usage and unknown locality`, async ({
    page,
  }) => {
    const c = await loadNewAgentCopy(locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/model-catalog", (route) =>
      route.fulfill({ json: catalog }),
    );
    await page.goto("/agents/new?template=ux_designer");
    await page.getByText(c.advanced, { exact: true }).click();
    await page
      .getByRole("combobox", { name: c.modelMode, exact: true })
      .click();
    await page
      .getByRole("option", { name: c.modelManual, exact: true })
      .click();
    const local = page.getByRole("button", { name: /Local fixture/ });
    const cloud = page.getByRole("button", { name: /Cloud fixture/ });
    const unknown = page.getByRole("button", { name: /Unknown fixture/ });
    await expect(local).toContainText(labels[locale][1]);
    await expect(cloud).toContainText(labels[locale][2]);
    await expect(cloud).not.toContainText(c.model.free);
    await expect(unknown).toContainText(labels[locale][3]);
    await expect(unknown).toBeDisabled();
    await expect(local).toBeEnabled();
    await local.click();
    await expect(local).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(harness.requests).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
  });

  test(`${locale}: advanced settings explain locality and refuse unknown model tests`, async ({
    page,
  }) => {
    const c = await loadSettingsCopy(locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/settings/llm", (route) =>
      route.fulfill({ json: settings() }),
    );
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    const provider = page.locator('[data-provider="ollama"]');
    const selector = provider.getByRole("combobox");
    await expect(
      selector.locator('option[value="ollama:unknown-fixture"]'),
    ).toBeDisabled();
    await expect(selector).toHaveValue("ollama:local-fixture");
    await selector.selectOption(models[1].id);
    await expect(
      provider.getByText(labels[locale][2], { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("heading", { name: "Cloud fixture", exact: true })
        .locator(".."),
    ).not.toContainText(c.freeIdentifier);
    await expect(
      provider.getByRole("button", { name: c.test, exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(harness.requests).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
  });
}

test("a lost locality language pack blocks Ollama selection and preserves expert edits", async ({
  page,
}) => {
  const c = await loadNewAgentCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  await page.route("**/api/model-catalog", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.route("**/assets/connection-en-*.js", (route) => route.abort());
  await page.goto("/agents/new?template=ux_designer");
  const name = page.getByRole("textbox", { name: "Expert name", exact: true });
  await name.fill("My private expert");
  await page.getByText(c.advanced, { exact: true }).click();
  await page.getByRole("combobox", { name: c.modelMode, exact: true }).click();
  await page.getByRole("option", { name: c.modelManual, exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Local fixture/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Cloud fixture/ }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(/language/i);
  await expect(name).toHaveValue("My private expert");
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("a cloud save whose readback contradicts consent stays unconfirmed until reviewed", async ({
  page,
}) => {
  const c = await loadConnectionCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let current = settings();
  const writes: unknown[] = [];
  await page.route("**/api/settings/llm", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: current });
    writes.push(route.request().postDataJSON());
    current = { ...current, revision: current.revision + 1 };
    return route.fulfill({
      json: {
        ok: true,
        revision: current.revision,
        configured: true,
        configuredProviders: ["ollama"],
        catalog,
      },
    });
  });
  await page.goto("/");
  const opener = page.getByRole("button", {
    name: "Connect a model",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: c.local, exact: true }).click();
  await dialog
    .getByRole("checkbox", { name: labels.en[0], exact: true })
    .check();
  const save = dialog.getByRole("button", { name: c.save, exact: true });
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText(c.unconfirmed);
  await expect(save).toBeDisabled();
  expect(writes).toHaveLength(1);
  await dialog.getByRole("button", { name: c.refresh, exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(
    dialog.getByRole("checkbox", { name: labels.en[0], exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});
