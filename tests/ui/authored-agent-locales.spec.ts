import { expect, test } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import {
  getLocalizedAgentTemplate,
  getLocalizedAgentTemplates,
} from "../../artifacts/api-server/src/lib/agent-template-localization";
import {
  LOCALES,
  loadShellMessages,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadNewAgentCopy } from "../../artifacts/agentic-company-os/src/lib/new-agent-copy";

for (const locale of ["en", "ar"] as const)
  for (const theme of ["dark", "light"] as const) {
    test(`${locale} ${theme}: managed instructions are readable with phone keyboard controls`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(
        (value) => localStorage.setItem("acos.locale.v1", value),
        locale,
      );
      await installStudioFixtures(page);
      await page.route("**/api/agents/2", (route) =>
        route.fulfill({ json: studioAgents[1] }),
      );
      await page.goto("/agents/2?tab=settings");
      await expect(page.locator("#expert-prompt")).toHaveValue(
        getLocalizedAgentTemplate(studioAgents[1].templateKey, locale)!
          .defaultSystemPrompt,
      );
      const shell = await loadShellMessages(locale);
      if (theme === "light") {
        await page
          .getByRole("button", { name: shell.openMenu, exact: true })
          .click();
        await page
          .getByRole("button", { name: shell.switchToLight, exact: true })
          .click();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("button", { name: shell.openMenu, exact: true }),
        ).toBeFocused();
      }
      const language = page.getByRole("combobox", {
        name: shell.language,
        exact: true,
      });
      await language.focus();
      await expect(language).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(language).not.toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await expect
        .poll(() =>
          page.getByRole("tab", { selected: true }).evaluate((tab) => {
            const list = tab.closest('[role="tablist"]')!.parentElement!;
            const item = tab.getBoundingClientRect();
            const strip = list.getBoundingClientRect();
            return item.left >= strip.left - 1 && item.right <= strip.right + 1;
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`managed-${locale}-${theme}.png`),
        fullPage: true,
      });
    });
  }

test("failed surface-language download returns to the prior language without losing a draft", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  const english = await loadNewAgentCopy("en");
  await page.route("**/new-expert-de-*.js", (route) => route.abort());
  await page.goto("/agents/new?template=ux_designer");
  await page
    .getByRole("textbox", { name: english.name, exact: true })
    .fill("Keep the unsaved name");
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("de");
  const alert = page.getByRole("alert").filter({
    has: page.getByRole("button", { name: "Schließen", exact: true }),
  });
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("textbox", { name: english.name, exact: true }),
  ).toHaveValue("Keep the unsaved name");
});

test("cancelled shell-language download never applies its late result or loses the current form", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/shell-ar-*.js", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/agents/new?template=ux_designer");
  await page
    .getByRole("textbox", { name: "Expert name", exact: true })
    .fill("Retain across cancellation");
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("ar");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const completed = page.waitForResponse((response) =>
    /\/shell-ar-[^/]+\.js$/.test(new URL(response.url()).pathname),
  );
  release();
  await completed;
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("textbox", { name: "Expert name", exact: true }),
  ).toHaveValue("Retain across cancellation");
});

test("initial profile-language failure reloads successfully after its asset becomes available", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "de"));
  await installStudioFixtures(page);
  await page.route("**/api/agents/2", (route) =>
    route.fulfill({ json: studioAgents[1] }),
  );
  await page.route("**/expert-detail-de-*.js", (route) => route.abort());
  await page.goto("/agents/2?tab=settings");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await page.unroute("**/expert-detail-de-*.js");
  await alert.getByRole("button").click();
  await expect(page.locator("#expert-prompt")).toHaveValue(
    getLocalizedAgentTemplate(studioAgents[1].templateKey, "de")!
      .defaultSystemPrompt,
  );
});

test("failed profile-language change returns to the previous language and retains the exact instruction draft", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  await page.route("**/api/agents/2", (route) =>
    route.fulfill({ json: studioAgents[1] }),
  );
  await page.route("**/expert-detail-de-*.js", (route) => route.abort());
  await page.goto("/agents/2?tab=settings");
  await expect(page.locator("#expert-prompt")).toHaveValue(
    getLocalizedAgentTemplate(studioAgents[1].templateKey, "en")!
      .defaultSystemPrompt,
  );
  const draft = "  Preserve my profile draft 原文 العربية\n  unchanged  ";
  await page.locator("#expert-prompt").fill(draft);
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("de");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await alert.getByRole("button").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#expert-prompt")).toHaveValue(draft);
});

for (const firstOutcome of ["saved", "failed"] as const) {
  test(`latest workspace language remains persisted after an older ${firstOutcome} request settles late`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("acos.locale.v1", "en"),
    );
    await installStudioFixtures(page);
    let persisted = "tr";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sawEnglish = false;
    let sawGerman!: () => void;
    const germanArrived = new Promise<void>((resolve) => {
      sawGerman = resolve;
    });
    await page.route("**/api/settings/locale", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { locale: persisted } });
      const { locale } = route.request().postDataJSON() as { locale: string };
      if (locale === "en") {
        sawEnglish = true;
        await gate;
        if (firstOutcome === "failed") return route.abort();
      }
      if (locale === "de") sawGerman();
      persisted = locale;
      return route.fulfill({ json: { locale } });
    });
    try {
      await page.goto("/agents/new?template=ux_designer");
      await expect.poll(() => sawEnglish).toBe(true);
      await page
        .getByRole("combobox", { name: "Language", exact: true })
        .selectOption("de");
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
      // Allow a broken concurrent writer to overtake the held request. A
      // serialized writer instead waits here until the first write settles.
      await Promise.race([germanArrived, page.waitForTimeout(500)]);
      release();
      await expect.poll(() => persisted).toBe("de");
      const saved = await page.evaluate(async () => {
        const response = await fetch("/api/settings/locale");
        return response.json();
      });
      expect(saved).toEqual({ locale: "de" });
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
    } finally {
      release();
    }
  });
}

for (const locale of LOCALES) {
  test(`${locale}: managed profile shows its selected-language playbook without changing saved source`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const harness = await installStudioFixtures(page);
    const agentWrites: string[] = [];
    await page.route("**/api/agents/2", (route) => {
      if (route.request().method() !== "GET")
        agentWrites.push(route.request().method());
      return route.fulfill({ json: studioAgents[1] });
    });
    await page.goto("/agents/2?tab=settings");
    await expect(page.locator("#expert-prompt")).toHaveValue(
      getLocalizedAgentTemplate(studioAgents[1].templateKey, locale)!
        .defaultSystemPrompt,
    );
    expect(harness.requests).toHaveLength(0);
    expect(agentWrites).toHaveLength(0);
  });
}

test("new expert keeps exact custom text, identity and permissions across an uncached language switch", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const english = await loadNewAgentCopy("en");
  const german = await loadNewAgentCopy("de");
  const source =
    "  Keep my original instructions 原文 العربية\n\n  exact whitespace  ";
  await page.goto("/agents/new?template=ux_designer");
  await page
    .getByRole("textbox", { name: english.name, exact: true })
    .fill("Draft 原文");
  await page.getByText(english.advanced, { exact: true }).click();
  await page.getByRole("switch", { name: english.custom, exact: true }).check();
  await page
    .getByRole("textbox", { name: english.prompt, exact: true })
    .fill(source);
  await page
    .getByRole("switch", { name: english.permissions.canBrowse, exact: true })
    .uncheck();
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("de");
  await expect(
    page.getByRole("textbox", { name: german.prompt, exact: true }),
  ).toHaveValue(source);
  await expect(
    page.getByRole("textbox", { name: german.name, exact: true }),
  ).toHaveValue("Draft 原文");
  await expect(
    page.getByRole("switch", {
      name: german.permissions.canBrowse,
      exact: true,
    }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: german.submit, exact: true }).click();
  await expect.poll(() => harness.requests.length).toBe(1);
  expect(harness.requests[0].body).toMatchObject({
    locale: "de",
    name: "Draft 原文",
    systemPrompt: source,
    permissions: { canBrowse: false },
  });
});

test("managed creation blocks a failed language catalog and preserves edits through retry", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const english = await loadNewAgentCopy("en");
  const german = await loadNewAgentCopy("de");
  let offline = true;
  await page.route("**/api/agent-templates?locale=de", (route) =>
    route.fulfill({
      status: offline ? 503 : 200,
      json: offline ? { error: "offline" } : getLocalizedAgentTemplates("de"),
    }),
  );
  await page.goto("/agents/new?template=ux_designer");
  await page
    .getByRole("textbox", { name: english.name, exact: true })
    .fill("Keep identity");
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("de");
  await expect(
    page.getByRole("alert").filter({ hasText: german.templatesError }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: german.submit, exact: true }),
  ).toBeDisabled();
  expect(harness.requests).toHaveLength(0);
  offline = false;
  await page.getByRole("button", { name: german.retry, exact: true }).click();
  await expect(
    page.getByRole("button", { name: german.submit, exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: german.name, exact: true }),
  ).toHaveValue("Keep identity");
  await page.getByText(german.advanced, { exact: true }).click();
  await page.getByText(german.promptReview, { exact: true }).click();
  await expect(
    page.getByText(
      getLocalizedAgentTemplate("ux_designer", "de")!.defaultSystemPrompt,
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: german.submit, exact: true }).click();
  await expect.poll(() => harness.requests.length).toBe(1);
  expect(harness.requests[0].body).toMatchObject({
    locale: "de",
    templateKey: "ux_designer",
    name: "Keep identity",
  });
});

test("managed profile draft survives late language catalog and saves as exact custom source", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  const agent = structuredClone(studioAgents[1]);
  const writes: object[] = [];
  await page.route("**/api/agents/2", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: agent });
    const body = route.request().postDataJSON();
    writes.push(body);
    Object.assign(agent, body, {
      isCustomPrompt: true,
      configVersion: "b".repeat(64),
    });
    return route.fulfill({ json: agent });
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/agent-templates?locale=ar", async (route) => {
    await gate;
    await route.fulfill({ json: getLocalizedAgentTemplates("ar") });
  });
  await page.goto("/agents/2?tab=settings");
  await expect(page.locator("#expert-prompt")).toHaveValue(
    getLocalizedAgentTemplate(agent.templateKey, "en")!.defaultSystemPrompt,
  );
  const draft = "  Edited instructions 原文 — keep across languages.  ";
  await page.locator("#expert-prompt").fill(draft);
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  release();
  await expect(page.locator("#expert-prompt")).toHaveValue(draft);
  const section = page
    .locator("section")
    .filter({ has: page.locator("#expert-prompt") });
  await section
    .getByRole("button", { name: "حفظ التغييرات", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    systemPrompt: draft,
    expectedConfig: "a".repeat(64),
  });
});
