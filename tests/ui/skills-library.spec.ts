import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";
import { WORKSPACE_LOCALES } from "../../artifacts/api-server/src/lib/workspace-locale";

test("personal capability creates, edits, exports and persists disabled state on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  const rows: Array<{
    id: string;
    revision: number;
    enabled: boolean;
    manifest: Record<string, unknown>;
  }> = [];
  await page.route("**/api/skills?*", (route) =>
    route.fulfill({ json: getCapabilityCatalog("en") }),
  );
  await page.route("**/api/skills/extensions", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: rows });
    const input = route.request().postDataJSON(),
      existing = rows.find((row) => row.id === input.manifest.id);
    if (input.expectedRevision !== (existing?.revision ?? 0))
      return route.fulfill({
        status: 409,
        json: { code: "CAPABILITY_REVISION_CONFLICT" },
      });
    const saved = {
      id: input.manifest.id,
      manifest: input.manifest,
      enabled: input.enabled,
      revision: input.expectedRevision + 1,
    };
    if (existing) Object.assign(existing, saved);
    else rows.push(saved);
    return route.fulfill({ json: saved });
  });
  await page.route("**/api/skills/extensions/*/export", (route) =>
    route.fulfill({ json: rows[0].manifest }),
  );
  await page.goto("/skills");
  await page
    .getByRole("region", { name: "Personal skills and tools" })
    .getByRole("button", { name: "Create new", exact: true })
    .click();
  await page
    .getByLabel("ID (starts with user-)", { exact: true })
    .fill("user-research-guide");
  await page.getByLabel("Title", { exact: true }).fill("My research guide");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Source-backed research");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Read the supplied sources and report uncertainties.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My research guide", exact: true }),
  ).toBeVisible();
  expect(rows).toHaveLength(1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("ID (starts with user-)")).toHaveAttribute(
    "readonly",
    "",
  );
  await page.getByLabel("Title", { exact: true }).fill("Updated guide");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Updated guide", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("user-research-guide.json");
  await expect(
    page.getByRole("button", { name: "Enabled", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Enabled", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Disabled", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Disabled", exact: true }),
  ).toBeVisible();
  expect(rows[0].enabled).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Import JSON", { exact: true }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"id":"../escape"}'),
  });
  await expect(page.getByRole("alert")).toContainText("Could not save");
  expect(rows).toHaveLength(1);
});

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale} phone library searches real skills and hands off a reviewable draft`, async ({
    page,
  }) => {
    const catalog = getCapabilityCatalog(locale);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript(
      (language) => localStorage.setItem("acos.locale.v1", language),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/skills?*", (route) =>
      route.fulfill({ json: catalog }),
    );
    await page.goto("/skills");
    await expect(
      page.getByRole("heading", { level: 1, name: catalog.copy.title }),
    ).toBeVisible();
    await expect(page.locator("[data-skill-id]")).toHaveCount(50);
    await page
      .getByRole("searchbox", { name: catalog.copy.search })
      .fill(" CSV-QUALITY ");
    await expect(page.locator("[data-skill-id]")).toHaveCount(1);
    const skill = page.locator('[data-skill-id="csv-quality"]');
    await skill.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(
      skill.getByText(catalog.copy.files, { exact: true }),
    ).toBeVisible();
    await expect(
      skill.getByText(catalog.skills[12].steps[0], { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`skills-${locale}.png`),
      fullPage: true,
    });
    await skill.getByRole("button", { name: catalog.copy.use }).click();
    await expect(page).toHaveURL(/\/projects\/new$/u);
    await expect(page.locator("input#title")).toHaveValue(
      catalog.skills[12].title,
    );
    await expect(page.locator("textarea#brief")).toHaveValue(
      new RegExp(
        catalog.skills[12].deliverable.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      ),
    );
    expect(harness.requests).toHaveLength(0);
    await page.locator("textarea#brief").fill("My reviewed scope 原文");
    await expect(page.locator("textarea#brief")).toHaveValue(
      "My reviewed scope 原文",
    );
    expect([...harness.unexpected]).toEqual([]);
  });
}

test("library recovers from loading and errors and shows an empty search without starting work", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let fail = true;
  await page.route("**/api/skills?*", async (route) => {
    if (fail)
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    return route.fulfill({ json: getCapabilityCatalog("en") });
  });
  await page.goto("/skills");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  fail = false;
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.locator("[data-skill-id]")).toHaveCount(50);
  await page
    .getByRole("searchbox", { name: "Search skills" })
    .fill("no-such-result");
  await expect(
    page.getByRole("status").filter({ hasText: "No skills" }),
  ).toBeVisible();
  expect(harness.requests).toHaveLength(0);
});

test("light desktop library shows loading and filters by area", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/skills?*", async (route) => {
    await gate;
    return route.fulfill({ json: getCapabilityCatalog("en") });
  });
  await page.goto("/skills");
  // Wait for this route, rather than accepting its earlier Suspense loader.
  // The independent emergency-stop status can also be loading at this point.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Skills & tools",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: /^Loading page$/ }),
  ).toBeVisible();
  release();
  await expect(page.locator("[data-skill-id]")).toHaveCount(50);
  await page
    .getByRole("combobox", { name: "All areas" })
    .selectOption("engineering");
  await expect(page.locator("[data-skill-id]")).toHaveCount(10);
  await page
    .getByRole("searchbox", { name: "Search skills" })
    .fill("code-review");
  const row = page.locator('[data-skill-id="code-review"]');
  await row.locator("summary").click();
  await expect(
    row.getByRole("button", { name: "Create project draft" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("skills-desktop-light.png"),
    fullPage: true,
  });
  expect(harness.requests).toHaveLength(0);
});

test("an operator can author and reload an executable tool without losing its declared permission", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  let saved: any = null;
  await page.route("**/api/skills/extensions", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: saved ? [saved] : [] });
    const input = route.request().postDataJSON();
    saved = {
      id: input.manifest.id,
      manifest: input.manifest,
      enabled: input.enabled,
      revision: input.expectedRevision + 1,
    };
    return route.fulfill({ json: saved });
  });
  await page.goto("/skills");
  const panel = page.getByRole("region", { name: "Personal skills and tools" });
  await panel.getByRole("button", { name: "Create new", exact: true }).click();
  await page
    .getByLabel("ID (starts with user-)", { exact: true })
    .fill("user-invoice");
  await page.getByLabel("Title", { exact: true }).fill("Invoice tool");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Calculate invoice totals from supplied units and price");
  await page.getByLabel("Type", { exact: true }).selectOption("program");
  await expect(page.getByText(/This code runs in Node/)).toBeVisible();
  await page
    .getByLabel("JavaScript body", { exact: true })
    .fill("return {total: input.units * input.price};");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Invoice tool", exact: true }),
  ).toBeVisible();
  expect(saved.manifest.permissions).toEqual(["terminal"]);
  expect(saved.manifest.kind).toBe("program");
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("JavaScript body", { exact: true })).toHaveValue(
    "return {total: input.units * input.price};",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale} advanced guide shows specific checks and transfers its complete scope`, async ({
    page,
  }) => {
    const catalog = getCapabilityCatalog(locale);
    const guide = catalog.skills[30];
    expect(guide).toBeDefined();
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript(
      (language) => localStorage.setItem("acos.locale.v1", language),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/skills?*", (route) =>
      route.fulfill({ json: catalog }),
    );
    await page.goto("/skills");
    await page
      .getByRole("searchbox", { name: catalog.copy.search })
      .fill(guide.id);
    await expect(page.locator("[data-skill-id]")).toHaveCount(1);
    const row = page.locator(`[data-skill-id="${guide.id}"]`);
    await row.locator("summary").click();
    for (const line of [...guide.inputs, ...guide.steps, ...guide.checks]) {
      await expect(row.getByText(line, { exact: true })).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await row.getByRole("button", { name: catalog.copy.use }).click();
    await expect(page).toHaveURL(/\/projects\/new$/u);
    await expect(page.locator("input#title")).toHaveValue(guide.title);
    const brief = await page.locator("textarea#brief").inputValue();
    for (const line of [
      guide.deliverable,
      ...guide.inputs,
      ...guide.steps,
      ...guide.checks,
    ])
      expect(brief).toContain(line);
    expect(harness.requests).toHaveLength(0);
    expect([...harness.unexpected]).toEqual([]);
  });
}

test("an operator can save and reload a new CSV processor as a personal tool", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  let saved: any = null;
  await page.route("**/api/skills/extensions", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: saved ? [saved] : [] });
    const input = route.request().postDataJSON();
    saved = {
      id: input.manifest.id,
      manifest: input.manifest,
      revision: input.expectedRevision + 1,
      enabled: input.enabled,
    };
    return route.fulfill({ json: saved });
  });
  await page.goto("/skills");
  await page
    .getByRole("region", { name: "Personal skills and tools" })
    .getByRole("button", { name: "Create new", exact: true })
    .click();
  await page
    .getByLabel("ID (starts with user-)", { exact: true })
    .fill("user-sales-totals");
  await page.getByLabel("Title", { exact: true }).fill("Sales totals");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Exact totals by region");
  await page.getByLabel("Type", { exact: true }).selectOption("tool");
  await page
    .getByLabel("Underlying tool", { exact: true })
    .selectOption("csv_group");
  const defaults = { keys: ["region"], column: "revenue", operation: "sum" };
  await page
    .getByRole("textbox", { name: "Fixed inputs (JSON)", exact: true })
    .fill(JSON.stringify(defaults));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sales totals", exact: true }),
  ).toBeVisible();
  expect(saved.manifest).toMatchObject({
    tool: "csv_group",
    kind: "tool",
    defaults,
  });
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Underlying tool", { exact: true })).toHaveValue(
    "csv_group",
  );
  expect(
    JSON.parse(
      await page
        .getByRole("textbox", { name: "Fixed inputs (JSON)", exact: true })
        .inputValue(),
    ),
  ).toEqual(defaults);
});
