import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadConnectionCopy } from "../../artifacts/agentic-company-os/src/lib/connection-copy";

const catalog = { providers: [], models: [] };
const settings = {
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
    configured: false,
    reachable: false,
    baseUrl: null,
    hasAddressInEnv: false,
    addressSource: "none",
    modelCount: 0,
    toolModelCount: 0,
    catalogSyncedAt: null,
    error: null,
  },
  replitFleet: { configured: false, baseUrl: null },
  catalog,
};

test("reopening setup reads the current endpoint and revision before initializing its editable fields", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let updated = false;
  const writes: unknown[] = [];
  await page.route("**/api/settings/llm", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          ...settings,
          revision: updated ? 8 : 7,
          ollama: {
            ...settings.ollama,
            baseUrl: updated
              ? "http://10.0.0.3:11434"
              : "http://127.0.0.1:11434",
          },
        },
      });
    writes.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        ok: true,
        revision: 9,
        configured: false,
        configuredProviders: [],
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
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Ollama address", exact: true }),
  ).toHaveValue("http://127.0.0.1:11434");
  await page.keyboard.press("Escape");
  updated = true;
  await opener.click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Ollama address", exact: true }),
  ).toHaveValue("http://10.0.0.3:11434");
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Connection saved");
  expect(writes).toEqual([
    { expectedRevision: 8, ollamaBaseUrl: "http://10.0.0.3:11434" },
  ]);
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("first run reaches a useful connection choice after choosing English without launching a job", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("acos.locale.v1"));
  const harness = await installStudioFixtures(page);
  await page.goto("/");
  await page.getByRole("radio", { name: /English/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .locator("#project-outcome")
    .fill("Create a concise summary of my meeting notes.");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Local model", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "ChatGPT", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "API key", exact: true }),
  ).toBeVisible();
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("Arabic connection remains usable at 320px with enlarged text and reduced motion in light mode", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
    localStorage.setItem("acos.color-mode.v2", "light");
  });
  const harness = await installStudioFixtures(page);
  await page.route("**/api/connections/chatgpt", (route) =>
    route.fulfill({ json: { registrations: [], activeRegistrationId: null } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "اربط نموذجًا", exact: true }).click();
  await page.addStyleTag({ content: "html { font-size:32px !important; }" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  const chat = dialog.getByRole("button", { name: "ChatGPT", exact: true });
  await expect(chat).toBeVisible();
  expect(
    await chat.evaluate((e) => e.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await chat.click();
  await expect(
    dialog.getByRole("button", {
      name: "المتابعة باستخدام ChatGPT",
      exact: true,
    }),
  ).toBeDisabled();
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("connection-ar-320-light-enlarged.png"),
  });
  await page.keyboard.press("Escape");
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("a missing connection module can be dismissed without abandoning the job", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  await page.route("**/assets/guided-model-connection-*.js", (route) =>
    route.abort(),
  );
  await page.goto("/");
  const draft = page.locator("#project-outcome");
  await draft.fill("Draft a summary of my meeting notes with next steps.");
  const opener = page.getByRole("button", {
    name: "Connect a model",
    exact: true,
  });
  await opener.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "This screen could not open" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(opener).toBeFocused();
  await expect(draft).toHaveValue(
    "Draft a summary of my meeting notes with next steps.",
  );
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("pending ChatGPT sign-in survives closing without replay and cancellation is explicit", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const attemptId = "3f6835ba-17ba-4191-b50f-e6b8c5b5460c";
  const mutations: Array<{ path: string; method: string }> = [];
  await page.route("**/api/connections/chatgpt**", (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() !== "GET")
      mutations.push({ path, method: request.method() });
    if (request.method() === "DELETE") return route.fulfill({ status: 204 });
    if (path.endsWith("/sign-in"))
      return route.fulfill({
        status: 201,
        json: {
          attemptId,
          authorizeUrl:
            "https://auth.openai.com/api/accounts/authorize?state=fixture",
          expiresAt: Date.now() + 300000,
        },
      });
    if (path.endsWith(attemptId))
      return route.fulfill({
        json: { attemptId, state: "pending", expiresAt: Date.now() + 300000 },
      });
    return route.fulfill({
      json: { registrations: [], activeRegistrationId: null },
    });
  });
  await page.goto("/");
  const draft = page.locator("#project-outcome");
  await draft.fill("Check my meeting notes and list follow-up actions.");
  const opener = page.getByRole("button", {
    name: "Connect a model",
    exact: true,
  });
  await opener.click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ChatGPT", exact: true }).click();
  await dialog
    .getByRole("checkbox", {
      name: "The browser and backend run on this same computer.",
    })
    .check();
  await dialog
    .getByRole("button", { name: "Continue with ChatGPT", exact: true })
    .click();
  await expect(
    dialog.getByRole("link", { name: "Open official sign-in", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await opener.click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ChatGPT", exact: true }).click();
  const cancel = dialog.getByRole("button", {
    name: "Cancel sign-in",
    exact: true,
  });
  await expect(cancel).toBeEnabled();
  expect(mutations).toEqual([
    { path: "/api/connections/chatgpt/sign-in", method: "POST" },
  ]);
  await cancel.click();
  await expect(dialog.getByRole("status")).toContainText(
    "previous account selection is unchanged",
  );
  expect(mutations).toEqual([
    { path: "/api/connections/chatgpt/sign-in", method: "POST" },
    { path: `/api/connections/chatgpt/sign-in/${attemptId}`, method: "DELETE" },
  ]);
  await page.keyboard.press("Escape");
  await expect(draft).toHaveValue(
    "Check my meeting notes and list follow-up actions.",
  );
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("an authorization URL outside the exact official origin is never shown or stored", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let starts = 0;
  await page.route("**/api/connections/chatgpt**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { registrations: [], activeRegistrationId: null },
      });
    starts++;
    return route.fulfill({
      status: 201,
      json: {
        attemptId: "3f6835ba-17ba-4191-b50f-e6b8c5b5460c",
        authorizeUrl:
          "https://auth.openai.com.evil.invalid/api/accounts/authorize?private_hint=fixture",
        expiresAt: Date.now() + 300000,
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ChatGPT", exact: true }).click();
  await dialog
    .getByRole("checkbox", {
      name: "The browser and backend run on this same computer.",
    })
    .check();
  const start = dialog.getByRole("button", {
    name: "Continue with ChatGPT",
    exact: true,
  });
  await start.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "result is unconfirmed",
  );
  await expect(start).toBeDisabled();
  await expect(
    dialog.getByRole("link", { name: "Open official sign-in", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Check current connection", exact: true })
    .click();
  await expect(start).toBeDisabled();
  expect(starts).toBe(1);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("private_hint");
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("a ready catalog keeps the connection dialog open until returning focus to the original job", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let saved = false;
  const ready = {
    providers: [{ id: "ollama", label: "Ollama", available: true }],
    models: [
      {
        id: "ollama:fixture",
        provider: "ollama",
        label: "Fixture local model",
        description: "Synthetic model",
        tier: "standard",
        supportsTools: true,
        isDefault: true,
      },
    ],
  };
  await page.route("**/api/model-catalog", (route) =>
    route.fulfill({ json: saved ? ready : catalog }),
  );
  await page.route("**/api/settings/llm", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          ...settings,
          revision: saved ? 8 : 7,
          catalog: saved ? ready : catalog,
        },
      });
    saved = true;
    return route.fulfill({
      json: {
        ok: true,
        revision: 8,
        configured: true,
        configuredProviders: ["ollama"],
        catalog: ready,
      },
    });
  });
  await page.goto("/");
  const draft = page.locator("#project-outcome");
  await draft.fill("Prepare a delivery checklist from my project notes.");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("not been tested");
  await expect(
    dialog.getByText("Fixture local model", { exact: true }),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Return to my job", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue(
    "Prepare a delivery checklist from my project notes.",
  );
  await expect(
    page.getByRole("button", { name: "Connect a model", exact: true }),
  ).toHaveCount(0);
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("installation default restoration sends null and retains an environment-backed endpoint", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let restored = false;
  const writes: unknown[] = [];
  await page.route("**/api/settings/llm", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          ...settings,
          revision: restored ? 8 : 7,
          ollama: {
            ...settings.ollama,
            configured: true,
            hasAddressInEnv: true,
            addressSource: restored ? "environment" : "runtime",
            baseUrl: restored
              ? "http://10.0.0.2:11434"
              : "http://127.0.0.1:11434",
          },
        },
      });
    restored = true;
    writes.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        ok: true,
        revision: 8,
        configured: true,
        configuredProviders: ["ollama"],
        catalog,
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Use installation default", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Connection saved");
  await expect(
    dialog.getByRole("textbox", { name: "Ollama address", exact: true }),
  ).toHaveValue("http://10.0.0.2:11434");
  expect(writes).toEqual([{ expectedRevision: 7, ollamaBaseUrl: null }]);
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("denied official sign-in removes its one-time link and preserves the previous selection", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const attemptId = "d737d27c-470c-4543-a157-f2f3e7fd504d";
  const account = {
    id: "a456e7b3-c5c5-464a-9c91-09357c5f28e2",
    accountId: "prior-account",
    revision: 3,
    signedIn: true,
    canUsePlan: true,
    expiresAt: null,
    email: "prior@example.test",
  };
  let denied = false;
  const mutations: string[] = [];
  await page.route("**/api/connections/chatgpt**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") mutations.push(path);
    if (path.endsWith("/sign-in"))
      return route.fulfill({
        status: 201,
        json: {
          attemptId,
          authorizeUrl:
            "https://auth.openai.com/api/accounts/authorize?state=fixture",
          expiresAt: Date.now() + 300000,
        },
      });
    if (path.endsWith(attemptId))
      return route.fulfill({
        json: {
          attemptId,
          state: denied ? "denied" : "pending",
          expiresAt: Date.now() + 300000,
        },
      });
    return route.fulfill({
      json: { registrations: [account], activeRegistrationId: account.id },
    });
  });
  await page.goto("/");
  await page
    .locator("#project-outcome")
    .fill("Create an action list from the attached meeting notes.");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ChatGPT", exact: true }).click();
  await expect(dialog.getByText("Selected", { exact: true })).toBeVisible();
  await dialog
    .getByRole("checkbox", {
      name: "The browser and backend run on this same computer.",
    })
    .check();
  await dialog
    .getByRole("button", { name: "Continue with ChatGPT", exact: true })
    .click();
  await expect(
    dialog.getByRole("link", { name: "Open official sign-in", exact: true }),
  ).toBeVisible();
  denied = true;
  await dialog
    .getByRole("button", { name: "Check current connection", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "previous account selection is unchanged",
  );
  await expect(
    dialog.getByRole("link", { name: "Open official sign-in", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByText("Selected", { exact: true })).toBeVisible();
  expect(mutations).toEqual(["/api/connections/chatgpt/sign-in"]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#project-outcome")).toHaveValue(
    "Create an action list from the attached meeting notes.",
  );
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("an existing signed-out ChatGPT account is shown honestly and renewed under its registration", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const account = {
    id: "a456e7b3-c5c5-464a-9c91-09357c5f28e2",
    accountId: "prior-account",
    revision: 3,
    signedIn: false,
    canUsePlan: true,
    expiresAt: null,
    email: "prior@example.test",
  };
  const writes: unknown[] = [];
  await page.route("**/api/connections/chatgpt**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { registrations: [account], activeRegistrationId: account.id },
      });
    writes.push(route.request().postDataJSON());
    return route.fulfill({
      status: 422,
      json: { error: "protected_handoff_required" },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ChatGPT", exact: true }).click();
  await expect(
    dialog.getByText(
      "This account is signed out. Sign in again before using it.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(dialog.getByText(/Plan permission granted/u)).toHaveCount(0);
  await dialog
    .getByRole("checkbox", {
      name: "The browser and backend run on this same computer.",
    })
    .check();
  await dialog
    .getByRole("button", { name: "Sign in again", exact: true })
    .click();
  await expect(
    dialog.getByText(/A remote browser cannot reach/u),
  ).toBeVisible();
  expect(writes).toEqual([
    { callbackLocation: "same-computer", registrationId: account.id },
  ]);
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("connect a local model in place with a fenced save and no automatic job or inference", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const calls: unknown[] = [];
  await page.route("**/api/settings/llm", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: settings });
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        ok: true,
        revision: 8,
        configured: false,
        configuredProviders: [],
        catalog,
      },
    });
  });
  await page.goto("/");
  const draft = page.locator("#project-outcome");
  await draft.fill("Find the owners and deadlines in my meeting notes.");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Connect a model" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Ollama address", exact: true })
    .fill("http://127.0.0.1:11434");
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Connection saved");
  await expect(dialog.getByRole("status")).toContainText("not been tested");
  expect(calls).toEqual([
    { expectedRevision: 7, ollamaBaseUrl: "http://127.0.0.1:11434" },
  ]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(draft).toHaveValue(
    "Find the owners and deadlines in my meeting notes.",
  );
  await expect(
    page.getByRole("button", { name: "Connect a model", exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(/\/$/u);
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

for (const [locale, action] of [
  ["tr", "Model bağla"],
  ["en", "Connect a model"],
  ["de", "Modell verbinden"],
  ["ru", "Подключить"],
  ["zh-CN", "连接模型"],
  ["zh-TW", "連接模型"],
  ["ar", "اربط نموذجًا"],
] as const) {
  test(`${locale} phone connection choices preserve a complete recurring job and only load the selected language`, async ({
    page,
  }, testInfo) => {
    const c = await loadConnectionCopy(locale);
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.addInitScript(
      (selected) => localStorage.setItem("acos.locale.v1", selected),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/settings/llm", (route) =>
      route.fulfill({ json: settings }),
    );
    await page.route("**/api/connections/chatgpt", (route) =>
      route.fulfill({
        json: { registrations: [], activeRegistrationId: null },
      }),
    );
    const languageAssets: string[] = [];
    page.on("request", (request) => {
      const name = new URL(request.url()).pathname.split("/").pop()!;
      if (/^connection-(tr|en|de|ru|zh-CN|zh-TW|ar)-/.test(name))
        languageAssets.push(name);
    });
    await page.goto("/projects/new");
    await page.locator("#title").fill("A weekly meeting report");
    await page
      .locator("#brief")
      .fill("Gather my notes and prepare a weekly decision summary.");
    const ongoing = page
      .getByRole("radiogroup")
      .first()
      .getByRole("radio")
      .nth(1);
    const priority = page
      .getByRole("radiogroup")
      .nth(1)
      .getByRole("radio")
      .last();
    await ongoing.click();
    await priority.click();
    await page.locator("#cadence").selectOption("900");
    const opener = page.getByRole("button", { name: action, exact: true });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: action, exact: true });
    await expect(
      dialog.getByRole("button", { name: c.local, exact: true }),
    ).toBeVisible();
    for (const choice of [c.local, c.api, "ChatGPT"]) {
      await dialog.getByRole("button", { name: choice, exact: true }).click();
      if (choice === c.local)
        await expect(
          dialog.getByRole("textbox", { name: c.endpoint }),
        ).toHaveValue("http://127.0.0.1:11434");
      if (choice === c.api)
        await expect(dialog.getByLabel(c.key, { exact: true })).toHaveAttribute(
          "type",
          "password",
        );
      if (choice === "ChatGPT") {
        await expect(
          dialog.getByText(c.handoffText, { exact: true }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: c.signIn, exact: true }),
        ).toBeDisabled();
        await expect(
          dialog.getByRole("link", { name: c.handoffGuide, exact: true }),
        ).toHaveAttribute("target", "_blank");
      }
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await dialog.getByRole("button", { name: c.back, exact: true }).click();
    }
    if (locale === "ar" || locale === "en")
      await page.screenshot({
        path: testInfo.outputPath("phone-connection-choices.png"),
      });
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await expect(page.locator("#title")).toHaveValue("A weekly meeting report");
    await expect(page.locator("#brief")).toHaveValue(
      "Gather my notes and prepare a weekly decision summary.",
    );
    await expect(ongoing).toHaveAttribute("aria-checked", "true");
    await expect(priority).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#cadence")).toHaveValue("900");
    expect(languageAssets).toHaveLength(1);
    expect(languageAssets[0]).toMatch(new RegExp(`^connection-${locale}-`));
    expect(harness.requests).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("an unknown local save blocks repeat writes until a deliberate read and keeps the draft", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let writes = 0,
    reads = 0;
  await page.route("**/api/settings/llm", (route) => {
    if (route.request().method() === "GET") {
      reads++;
      return route.fulfill({ json: { ...settings, revision: writes ? 8 : 7 } });
    }
    writes++;
    return route.fulfill({
      status: 503,
      json: { code: "LLM_SETTINGS_UNCONFIRMED" },
    });
  });
  await page.goto("/");
  await page
    .locator("#project-outcome")
    .fill("Summarize my project notes with owners and next steps.");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  const save = dialog.getByRole("button", {
    name: "Save connection",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "save could not be confirmed",
  );
  await expect(save).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: "Ollama address", exact: true })
    .fill("http://10.0.0.4:11434");
  await expect(dialog.getByRole("alert")).toContainText(
    "save could not be confirmed",
  );
  expect(writes).toBe(1);
  expect(reads).toBe(1);
  await dialog
    .getByRole("button", { name: "Check current connection", exact: true })
    .click();
  await expect(save).toBeEnabled();
  expect(writes).toBe(1);
  expect(reads).toBe(2);
  await page.keyboard.press("Escape");
  await expect(page.locator("#project-outcome")).toHaveValue(
    "Summarize my project notes with owners and next steps.",
  );
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("API keys are saved only on demand, never survive closing or enter browser storage", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const writes: unknown[] = [];
  let saved = false;
  await page.route("**/api/settings/llm", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { ...settings, revision: saved ? 8 : 7 } });
    writes.push(route.request().postDataJSON());
    saved = true;
    return route.fulfill({
      json: {
        ok: true,
        revision: 8,
        configured: true,
        configuredProviders: ["openai"],
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
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "API key", exact: true }).click();
  await dialog
    .getByLabel("API key", { exact: true })
    .fill("fixture-key-not-a-real-secret");
  expect(writes).toEqual([]);
  await page.keyboard.press("Escape");
  await opener.click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "API key", exact: true }).click();
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("");
  await dialog
    .getByLabel("API key", { exact: true })
    .fill("fixture-key-not-a-real-secret");
  await dialog
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Connection saved");
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("");
  expect(writes).toEqual([
    { expectedRevision: 7, openaiApiKey: "fixture-key-not-a-real-secret" },
  ]);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("fixture-key");
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("remote ChatGPT sign-in falls back to protected handoff without a guessed authorization URL", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let starts = 0;
  await page.route("**/api/connections/chatgpt**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { registrations: [], activeRegistrationId: null },
      });
    starts++;
    return route.fulfill({
      status: 422,
      json: { error: "protected_handoff_required" },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ChatGPT", exact: true }).click();
  await dialog
    .getByRole("checkbox", {
      name: "The browser and backend run on this same computer.",
    })
    .check();
  await dialog
    .getByRole("button", { name: "Continue with ChatGPT", exact: true })
    .click();
  await expect(
    dialog.getByText(/A remote browser cannot reach/u),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Open official sign-in", exact: true }),
  ).toHaveCount(0);
  expect(starts).toBe(1);
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("official ChatGPT account review and selection are separate explicit actions", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const calls: Array<{ path: string; body: unknown }> = [];
  const attemptId = "77c88b29-5c50-4f90-aab3-1cba24b96690";
  const account = {
    id: "8f8bf7df-1e30-4c3c-8ed1-4c34a40456cc",
    accountId: "fixture-subject",
    revision: 1,
    signedIn: true,
    canUsePlan: false,
    expiresAt: Date.now() + 3600000,
    email: "fixture@example.test",
  };
  let saved = false,
    selected = false;
  let completed = false;
  await page.route("**/api/connections/chatgpt**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET")
      calls.push({
        path,
        body: route.request().postData()
          ? route.request().postDataJSON()
          : null,
      });
    if (path.endsWith("/select")) {
      selected = true;
      return route.fulfill({ json: account });
    }
    if (path.endsWith("/confirm")) {
      saved = true;
      return route.fulfill({ json: account });
    }
    if (path.endsWith(attemptId))
      return route.fulfill({
        json: {
          attemptId,
          state: completed ? "review" : "pending",
          expiresAt: Date.now() + 300000,
          expectedRevision: 0,
          proposedAccount: account,
        },
      });
    if (path.endsWith("/sign-in"))
      return route.fulfill({
        status: 201,
        json: {
          attemptId,
          authorizeUrl:
            "https://auth.openai.com/api/accounts/authorize?private_fixture_hint=not-a-token",
          expiresAt: Date.now() + 300000,
        },
      });
    return route.fulfill({
      json: {
        registrations: saved ? [account] : [],
        activeRegistrationId: selected ? account.id : null,
      },
    });
  });
  await page.goto("/");
  await page
    .locator("#project-outcome")
    .fill("Turn meeting notes into a prioritized checklist.");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ChatGPT", exact: true }).click();
  await expect(dialog.getByText("No saved account yet.")).toBeVisible();
  expect(calls).toEqual([]);
  await dialog
    .getByRole("checkbox", {
      name: "The browser and backend run on this same computer.",
    })
    .check();
  await dialog
    .getByRole("button", { name: "Continue with ChatGPT", exact: true })
    .click();
  const official = dialog.getByRole("link", {
    name: "Open official sign-in",
    exact: true,
  });
  await expect(official).toHaveAttribute(
    "href",
    /^https:\/\/auth\.openai\.com\/api\/accounts\/authorize\?/,
  );
  completed = true;
  await dialog
    .getByRole("button", { name: "Check current connection", exact: true })
    .click();
  await expect(
    dialog.getByText("fixture@example.test", { exact: true }),
  ).toBeVisible();
  expect(calls).toEqual([
    {
      path: "/api/connections/chatgpt/sign-in",
      body: { callbackLocation: "same-computer" },
    },
  ]);
  await dialog
    .getByRole("button", { name: "Save reviewed account", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Select this account", exact: true }),
  ).toBeVisible();
  expect(selected).toBe(false);
  await dialog
    .getByRole("button", { name: "Select this account", exact: true })
    .click();
  await expect(dialog.getByText("Selected", { exact: true })).toBeVisible();
  expect(calls.map((call) => call.path)).toEqual([
    "/api/connections/chatgpt/sign-in",
    `/api/connections/chatgpt/sign-in/${attemptId}/confirm`,
    `/api/connections/chatgpt/accounts/${account.id}/select`,
  ]);
  expect(calls[1].body).toEqual({ expectedRevision: 0 });
  expect(calls[2].body).toEqual({ expectedRevision: 1 });
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("private_fixture_hint");
  await page.keyboard.press("Escape");
  await expect(page.locator("#project-outcome")).toHaveValue(
    "Turn meeting notes into a prioritized checklist.",
  );
  expect(harness.requests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});
