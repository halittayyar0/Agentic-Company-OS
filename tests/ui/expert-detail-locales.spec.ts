import {
  inspectRoute,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import { expect, test, type Page } from "@playwright/test";
import type { Agent } from "@workspace/api-client-react";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import {
  LOCALES,
  setupMessages,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadExpertDetailCopy } from "../../artifacts/agentic-company-os/src/lib/expert-detail-copy";
import { loadNewAgentCopy } from "../../artifacts/agentic-company-os/src/lib/new-agent-copy";

const source = "Original 原文 — gözden geçirilmiş talimat / تعليمات";
const toolSource =
  "Atlas sanal bilgisayarında özgün dosya sonucu: 原文 — retained.";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL8AAAAASUVORK5CYII=",
  "base64",
);

async function setup(page: Page, locale: Locale = "en") {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const harness = await installStudioFixtures(page);
  const agent = {
    ...structuredClone(studioAgents[1]),
    systemPrompt: source,
    isCustomPrompt: true,
    name: "Atlas 原文",
    role: "Source role",
    department: "Source department",
    configVersion: "a".repeat(64),
  } as Agent;
  const state = {
    agent,
    revision: 1,
    readError: false,
    missing: false,
    saveUnknown: false,
    conflict: false,
    statsError: false,
    tasksError: false,
    writes: [] as Record<string, any>[],
    portraits: [] as {
      method: string;
      expected: string | null;
      dataUrl?: string;
    }[],
  };
  function advance() {
    state.agent.configVersion = (++state.revision)
      .toString(16)
      .padStart(64, "0");
  }
  await page.route("**/api/agents/2", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        status: state.missing ? 404 : state.readError ? 503 : 200,
        json:
          state.missing || state.readError
            ? { error: "private-failure-sentinel" }
            : state.agent,
      });
    const body = route.request().postDataJSON();
    state.writes.push(body);
    if (state.conflict || body.expectedConfig !== state.agent.configVersion)
      return route.fulfill({
        status: 409,
        json: {
          code: "AGENT_CONFIG_CHANGED",
          error: "private-failure-sentinel",
        },
      });
    const { expectedConfig, ...update } = body;
    Object.assign(state.agent, update);
    if (update.modelMode === "auto") state.agent.modelId = null;
    if (update.isActive !== undefined)
      state.agent.status = update.isActive ? "idle" : "archived";
    advance();
    return route.fulfill({
      status: state.saveUnknown ? 503 : 200,
      json: state.saveUnknown
        ? { error: "private-failure-sentinel" }
        : state.agent,
    });
  });
  await page.route("**/api/agents/2/avatar**", (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({ contentType: "image/png", body: png });
    const body = request.method() === "PUT" ? request.postDataJSON() : {};
    const expected =
      body.expectedConfig ??
      new URL(request.url()).searchParams.get("expectedConfig");
    state.portraits.push({
      method: request.method(),
      expected,
      dataUrl: body.dataUrl,
    });
    if (expected !== state.agent.configVersion)
      return route.fulfill({
        status: 409,
        json: { code: "AGENT_CONFIG_CHANGED" },
      });
    state.agent.avatarVersion =
      request.method() === "DELETE" ? null : "portrait-" + state.revision;
    advance();
    return route.fulfill({
      status: state.saveUnknown ? 503 : 200,
      json: state.saveUnknown
        ? { error: "private-failure-sentinel" }
        : state.agent,
    });
  });
  await page.route("**/api/agents/2/messages**", (route) =>
    route.fulfill({
      json: [
        {
          id: 1,
          agentId: 2,
          role: "agent",
          content: source,
          taskId: null,
          modelId: "fixture/model",
          createdAt: "2026-09-27T08:00:00Z",
        },
        {
          id: 2,
          agentId: 2,
          role: "agent",
          content: source,
          taskId: null,
          modelId: null,
          createdAt: "2026-09-27T08:01:00Z",
        },
      ],
    }),
  );
  await page.route("**/api/activity**", (route) =>
    route.fulfill({
      status: state.statsError ? 503 : 200,
      json: state.statsError
        ? { error: "private-failure-sentinel" }
        : [
            {
              id: 5,
              agentId: 2,
              taskId: null,
              type: "vm_file",
              summary: toolSource,
              detail: null,
              severity: "info",
              createdAt: "2026-09-27T08:02:00Z",
            },
            {
              id: 4,
              agentId: 2,
              taskId: null,
              type: "judge_review",
              summary: "Original review",
              detail: null,
              severity: "info",
              createdAt: "2026-09-27T08:01:00Z",
            },
          ],
    }),
  );
  await page.route("**/api/tasks**", (route) =>
    route.fulfill({
      status: state.tasksError ? 503 : 200,
      json: state.tasksError
        ? { error: "private-failure-sentinel" }
        : [
            {
              id: 7,
              title: source,
              brief: source,
              status: "in_progress",
              priority: "urgent",
              ownerAgentId: 2,
              progressPercent: 25,
              updatedAt: "2026-09-27T08:00:00Z",
            },
          ],
    }),
  );
  await page.route("**/api/model-catalog", (route) =>
    route.fulfill({
      json: {
        providers: [{ id: "openai", label: "OpenAI", available: true }],
        models: [
          {
            id: "openai:fixture",
            label: "Fixture model",
            description: "Source model 原文",
            provider: "openai",
            tier: "economy",
            supportsTools: true,
            isDefault: true,
          },
          {
            id: "openai:unsupported",
            label: "No tools model",
            description: "Source model 原文",
            provider: "openai",
            tier: "economy",
            supportsTools: false,
            isDefault: false,
          },
        ],
      },
    }),
  );
  return {
    ...harness,
    state,
    advance,
    c: await loadExpertDetailCopy(locale),
    form: await loadNewAgentCopy(locale),
  };
}

for (const locale of LOCALES) {
  test(`${locale}: expert settings, tasks and sampled statistics work on a phone`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.emulateMedia({
      colorScheme: locale === "ar" || locale === "de" ? "light" : "dark",
    });
    const { state, c, form, unexpected } = await setup(page, locale);
    await page.goto("/agents/2?tab=settings&from=directory");
    await expect(
      page.getByRole("heading", { name: state.agent.name }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    const prompt = page.getByRole("textbox", {
      name: form.prompt,
      exact: true,
    });
    await expect(prompt).toHaveValue(source);
    await prompt.fill("   ");
    await expect(
      page.getByText(c.promptRequired, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: c.save, exact: true }),
    ).toBeDisabled();
    await expect(page.getByText(c.modelHelp, { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: c.hostShell })).toHaveCount(
      0,
    );
    await prompt.fill(source + " edited");
    await page.getByRole("tab", { name: c.tasks, exact: true }).click();
    await expect(prompt).toBeHidden();
    await expect(page.getByText(c.taskWindow)).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp("Original 原文") }),
    ).toHaveAttribute("href", "/projects/7");
    await expect(page).toHaveURL(/tab=tasks&from=directory/);
    await page.getByRole("tab", { name: c.settings, exact: true }).click();
    await expect(prompt).toHaveValue(source + " edited");
    await page.getByRole("button", { name: c.save, exact: true }).click();
    await expect(page.getByText(c.saved, { exact: true })).toBeVisible();
    expect(state.writes[0]).toEqual({
      systemPrompt: source + " edited",
      expectedConfig: "a".repeat(64),
    });
    const permission = page.getByRole("checkbox", {
      name: form.permissions.canBrowse,
      exact: true,
    });
    const previous = state.agent.permissions.canBrowse;
    await permission.click();
    await expect(permission).toBeChecked({ checked: !previous });
    await expect.poll(() => state.writes.length).toBe(2);
    await page.getByRole("tab", { name: c.stats, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(c.statsWindow)).toBeVisible();
    await expect(page.getByText(toolSource, { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        new Intl.NumberFormat(locale, { style: "percent" }).format(0.5),
        { exact: false },
      ),
    ).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("tab", { name: c.settings, exact: true }).click();
    await prompt.scrollIntoViewIfNeeded();
    if (locale === "ar")
      await page.screenshot({
        path: info.outputPath("expert-ar-phone.png"),
        fullPage: true,
      });
    if (locale === "en") {
      await page.setViewportSize({ width: 1365, height: 1000 });
      await expect
        .poll(
          async () => (await page.getByRole("complementary").boundingBox())?.x,
        )
        .toBe(0);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: info.outputPath("expert-en-desktop.png"),
        fullPage: true,
      });
    }
    expect([...unexpected]).toEqual([]);
  });
}

test("expert instruction survives concurrent edits, a failed refresh and an unknown commit", async ({
  page,
}) => {
  const { state, advance, c, form } = await setup(page);
  await page.goto("/agents/2?tab=settings");
  const prompt = page.getByRole("textbox", { name: form.prompt, exact: true });
  await prompt.fill("My preserved local instruction");
  state.agent.systemPrompt = "Concurrent server instruction";
  advance();
  await page.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.getByText(c.changed, { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue("My preserved local instruction");
  await expect(
    page.getByRole("button", { name: c.save, exact: true }),
  ).toBeDisabled();
  state.readError = true;
  await page.getByRole("button", { name: c.review, exact: true }).click();
  await expect(prompt).toHaveValue("My preserved local instruction");
  state.readError = false;
  await page.getByRole("button", { name: c.review, exact: true }).click();
  await expect(page.getByText(c.promptChanged, { exact: true })).toBeVisible();
  await page.getByText(c.serverPrompt, { exact: true }).click();
  await expect(
    page.getByText("Concurrent server instruction", { exact: true }),
  ).toBeVisible();
  state.saveUnknown = true;
  await page.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.getByText(c.unknown, { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue("My preserved local instruction");
  expect(state.agent.systemPrompt).toBe("My preserved local instruction");
  expect(state.writes).toHaveLength(2);
  await expect(page.getByText("private-failure-sentinel")).toHaveCount(0);
  await page.getByRole("button", { name: c.review, exact: true }).click();
  await page.getByRole("button", { name: c.discard, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.save, exact: true }),
  ).toBeDisabled();
  expect(state.writes).toHaveLength(2);
});

test("portrait preparation and unknown saving retain the preview until review", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  await page.goto("/agents/2?tab=settings");
  const file = page.getByLabel(c.chooseImage, { exact: true });
  await file.setInputFiles({
    name: "invalid.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByText(c.avatarFileError)).toBeVisible();
  const validPng = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 20;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#507050";
    context.fillRect(0, 0, 20, 20);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await file.setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: Buffer.from(validPng, "base64"),
  });
  await expect(page.getByText(c.preview, { exact: true })).toBeVisible();
  state.saveUnknown = true;
  await page.getByRole("button", { name: c.saveAvatar, exact: true }).click();
  await expect(page.getByText(c.unknown, { exact: true })).toBeVisible();
  await expect(page.getByText("portrait.png", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.saveAvatar, exact: true }),
  ).toBeDisabled();
  expect(state.portraits).toHaveLength(1);
  expect(state.portraits[0].expected).toBe("a".repeat(64));
  expect(
    Buffer.byteLength(state.portraits[0].dataUrl!.split(",")[1], "base64"),
  ).toBeLessThanOrEqual(65536);
  await page.getByRole("button", { name: c.review, exact: true }).click();
  await expect(page.getByText(c.avatarChanged, { exact: true })).toBeVisible();
  await expect(page.getByText(c.preview, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: c.cancel, exact: true }).click();
  state.saveUnknown = false;
  await page.getByRole("button", { name: c.resetAvatar, exact: true }).click();
  expect(state.portraits).toHaveLength(1);
  await page.getByRole("button", { name: c.saveAvatar, exact: true }).click();
  await expect(page.getByText(c.saved, { exact: true })).toBeVisible();
  expect(state.portraits[1].method).toBe("DELETE");
  expect(state.agent.avatarVersion).toBeNull();
});

test("model choice is explicit and archive cancellation has no write", async ({
  page,
}) => {
  const { state, c, form } = await setup(page);
  await page.goto("/agents/2?tab=settings");
  const opener = page.getByRole("button", { name: c.changeModel, exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: c.cancel, exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel(form.modelMode, { exact: true })
    .selectOption("manual");
  await expect(
    dialog.getByRole("button", { name: c.save, exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: /Fixture model/ }).click();
  await expect(
    dialog.getByRole("button", { name: /No tools model/ }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(page.getByText(c.saved, { exact: true })).toBeVisible();
  expect(state.writes[0].modelId).toBe("openai:fixture");
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByLabel(form.modelMode, { exact: true }).selectOption("auto");
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect.poll(() => state.agent.modelId).toBeNull();
  await page.getByRole("button", { name: c.archive, exact: true }).click();
  await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
  expect(state.writes).toHaveLength(2);
  await page.getByRole("button", { name: c.archive, exact: true }).click();
  await dialog.getByRole("button", { name: c.archive, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.restore, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.textContent))
    .toMatch(/^(Restore expert|Refresh record)$/);
  await page.getByRole("button", { name: c.restore, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.archive, exact: true }),
  ).toBeVisible();
  expect(
    state.writes
      .map((write) => write.isActive)
      .filter((value) => value !== undefined),
  ).toEqual([false, true]);
});

test("missing records, read failures and incomplete statistics have recoverable states", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  state.readError = true;
  await page.goto("/agents/2?tab=settings");
  await expect(page.getByRole("heading", { name: c.loadError })).toBeVisible();
  state.readError = false;
  state.missing = true;
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  await expect(page.getByRole("heading", { name: c.missing })).toBeVisible();
  state.missing = false;
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: state.agent.name }),
  ).toBeVisible();
  state.statsError = true;
  await page.getByRole("tab", { name: c.stats, exact: true }).click();
  await expect(page.getByText(c.statsError)).toBeVisible();
  await expect(page.getByText(c.replies, { exact: true })).toHaveCount(0);
  state.statsError = false;
  await page
    .getByRole("alert")
    .getByRole("button", { name: c.refresh })
    .click();
  await expect(page.getByText(c.replies, { exact: true })).toBeVisible();
  state.tasksError = true;
  await page.getByRole("tab", { name: c.tasks, exact: true }).click();
  await expect(page.getByText(c.taskError, { exact: true })).toBeVisible();
  await expect(page.getByText(c.taskEmpty, { exact: true })).toHaveCount(0);
  await page.goto("/agents/invalid");
  await expect(page.getByRole("heading", { name: c.invalid })).toBeVisible();
});

test("missing selected language pack offers a localized reload", async ({
  page,
}) => {
  await setup(page, "de");
  await page.route("**/assets/expert-detail-de-*.js", (route) => route.abort());
  await page.goto("/agents/2?tab=settings");
  await expect(
    page.getByText(setupMessages.de.languageFileError, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Working instructions" }),
  ).toHaveCount(0);
});

test("chat and instruction drafts survive switching tabs", async ({ page }) => {
  const { c, form } = await setup(page);
  await page.goto("/agents/2?tab=chat");
  const chat = page.getByRole("textbox", {
    name: "Message or work brief",
  });
  await chat.fill("Unsent chat 原文");
  await page.getByRole("tab", { name: c.settings, exact: true }).click();
  await expect(chat).toBeHidden();
  const instruction = page.getByRole("textbox", {
    name: form.prompt,
    exact: true,
  });
  await instruction.fill("Unsent instruction 原文");
  await page.getByRole("tab", { name: c.chat, exact: true }).click();
  await expect(chat).toHaveValue("Unsent chat 原文");
  await expect(instruction).toBeHidden();
  await page.getByRole("tab", { name: c.settings, exact: true }).click();
  await expect(instruction).toHaveValue("Unsent instruction 原文");
});

test("missing configuration versions block writes and only the marked root exposes host authority", async ({
  page,
}) => {
  const { state, advance, c, form } = await setup(page);
  delete state.agent.configVersion;
  Object.assign(state.agent, {
    templateKey: "ceo",
    depth: 0,
    parentAgentId: null,
    isRootCeo: false,
  });
  await page.goto("/agents/2?tab=settings");
  await expect(page.getByText(c.readonly, { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: form.prompt, exact: true })
    .fill("A local instruction");
  await expect(
    page.getByRole("button", { name: c.save, exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: c.changeModel, exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: c.hostShell })).toHaveCount(
    0,
  );
  expect(state.writes).toHaveLength(0);
  state.agent.isRootCeo = true;
  advance();
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  const permission = page.getByRole("checkbox", {
    name: c.hostShell,
    exact: true,
  });
  await permission.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(c.hostHelp, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
  await expect(permission).not.toBeChecked();
  await expect(permission).toBeFocused();
  expect(state.writes).toHaveLength(0);
  await permission.click();
  await dialog.getByRole("button", { name: c.save, exact: true }).click();
  await expect(permission).toBeChecked();
  await expect(permission).toBeFocused();
  expect(state.writes[0].permissions.canUseSudo).toBe(true);
});

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: expert profile views`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const { state, c, form, unexpected } = await setup(page, locale);
    const errors = await prepareRouteAudit(page, variant);
    await page.goto("/agents/2?tab=settings");
    await expect(
      page.getByRole("heading", { name: state.agent.name }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: form.prompt, exact: true }),
    ).toHaveValue(source);
    await inspectRoute(page, info, "expert-settings", variant);
    for (const [key, label, ready] of [
      ["tasks", c.tasks, c.taskWindow],
      ["stats", c.stats, c.statsWindow],
      ["chat", c.chat, source],
    ]) {
      await page.getByRole("tab", { name: label, exact: true }).click();
      await expect(
        page.getByText(ready, { exact: true }).first(),
      ).toBeVisible();
      await inspectRoute(page, info, `expert-${key}`, variant);
    }
    expect(state.writes).toEqual([]);
    expect(state.portraits).toEqual([]);
    expect([...unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
