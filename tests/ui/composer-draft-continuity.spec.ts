import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadHomeCopy } from "../../artifacts/agentic-company-os/src/lib/home-copy";
import { loadNewProjectCopy } from "../../artifacts/agentic-company-os/src/lib/new-project-copy";
import { LOCALES } from "../../artifacts/agentic-company-os/src/lib/i18n";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";
for (const locale of LOCALES) {
  test(`${locale} home task survives connection navigation and reload without submission`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const f = await installStudioFixtures(page),
      c = await loadHomeCopy(locale);
    await page.goto("/");
    const field = page.getByRole("textbox", {
      name: c.desiredOutcome,
      exact: true,
    });
    await field.fill("Keep my actual task while I connect a local model.");
    await page
      .getByRole("button", { name: c.modes.research.label, exact: true })
      .click();
    await page
      .locator('a[href="/settings"]')
      .filter({ hasText: /./ })
      .last()
      .click();
    await page.goBack();
    await expect(field).toHaveValue(
      "Keep my actual task while I connect a local model.",
    );
    await expect(
      page.getByRole("button", { name: c.modes.research.label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(field).toHaveValue(
      "Keep my actual task while I connect a local model.",
    );
    expect(f.requests).toHaveLength(0);
  });
  test(`${locale} recurring project retains title, brief, priority and cadence across reload`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const f = await installStudioFixtures(page),
      c = await loadNewProjectCopy(locale);
    await page.goto("/projects/new");
    await page
      .getByRole("textbox", { name: c.projectName, exact: true })
      .fill("Recurring source review");
    await page
      .getByRole("textbox", { name: c.brief, exact: true })
      .fill(
        "Review the supplied documents every day; retain verified results.",
      );
    await page
      .getByRole("radiogroup", { name: c.projectType })
      .getByRole("radio", { name: c.continuous, exact: true })
      .click();
    await page
      .getByRole("radiogroup", { name: c.priority })
      .getByRole("radio", { name: c.priorities.high, exact: true })
      .click();
    await page.getByRole("combobox", { name: c.cadence }).selectOption("86400");
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: c.projectName, exact: true }),
    ).toHaveValue("Recurring source review");
    await expect(
      page.getByRole("textbox", { name: c.brief, exact: true }),
    ).toHaveValue(
      "Review the supplied documents every day; retain verified results.",
    );
    await expect(
      page.getByRole("radio", { name: c.continuous, exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("radio", { name: c.priorities.high, exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("combobox", { name: c.cadence })).toHaveValue(
      "86400",
    );
    expect(f.requests).toHaveLength(0);
  });
}
async function editableDraft(page: Page, kind: "home" | "project") {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const f = await installStudioFixtures(page);
  const home = await loadHomeCopy("en"),
    project = await loadNewProjectCopy("en");
  const path = kind === "home" ? "/" : "/projects/new";
  await page.goto(path);
  if (kind === "project")
    await page
      .getByRole("textbox", { name: project.projectName, exact: true })
      .fill("Preserved project");
  const field = page.getByRole("textbox", {
    name: kind === "home" ? home.desiredOutcome : project.brief,
    exact: true,
  });
  await field.fill("Keep this useful task until I explicitly start it.");
  return {
    f,
    field,
    path,
    key: `acos.composer-draft.v1:${kind}`,
    error: kind === "home" ? home.draftStorageError : project.draftStorageError,
    start: kind === "home" ? home.startProject : project.start,
  };
}
for (const kind of ["home", "project"] as const) {
  test(`${kind} unconfirmed creation response cannot clear the draft or navigate to an invented task`, async ({
    page,
  }) => {
    const d = await editableDraft(page, kind);
    let writes = 0;
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      writes++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.getByRole("button", { name: d.start, exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await expect(page).toHaveURL(
      new RegExp(kind === "home" ? "/$" : "/projects/new$"),
    );
    await page.reload();
    await expect(d.field).toHaveValue(
      "Keep this useful task until I explicitly start it.",
    );
    expect(writes).toBe(1);
  });
  test(`${kind} storage denial keeps input editable through in-app connection navigation and sends no job`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key.startsWith("acos.composer-draft"))
          throw Error("fixture storage denial");
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("acos.composer-draft"))
          throw Error("fixture storage denial");
        return set.call(this, key, value);
      };
    });
    const d = await editableDraft(page, kind);
    await expect(
      page.getByRole("alert").filter({ hasText: d.error }),
    ).toBeVisible();
    await page.locator('a[href="/settings"]').last().click();
    await page.goBack();
    await expect(d.field).toHaveValue(
      "Keep this useful task until I explicitly start it.",
    );
    await d.field.fill("I can still edit my task without storage.");
    await expect(d.field).toHaveValue(
      "I can still edit my task without storage.",
    );
    expect(d.f.requests).toHaveLength(0);
  });
  test(`${kind} failed Start retains the same draft through reload`, async ({
    page,
  }) => {
    const d = await editableDraft(page, kind);
    await page.getByRole("button", { name: d.start, exact: true }).click();
    await expect.poll(() => d.f.requests.length).toBe(1);
    await page.reload();
    await expect(d.field).toHaveValue(
      "Keep this useful task until I explicitly start it.",
    );
    expect(d.f.requests).toHaveLength(1);
  });
  test(`${kind} a confirmed explicit Start clears only its submitted draft`, async ({
    page,
  }) => {
    const d = await editableDraft(page, kind);
    let writes = 0;
    if (kind === "project") {
      await page.route("**/api/task-creation-requests/*", (route) =>
        route.fulfill({
          json: {
            requestId: new URL(route.request().url()).pathname
              .split("/")
              .at(-1),
            state: "created",
            taskId: 990,
            failureCode: null,
            createdAt: "2026-10-09T00:00:00.000Z",
          },
        }),
      );
    }
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      writes++;
      return route.fulfill({ status: 200, json: { id: 990 } });
    });
    await page.getByRole("button", { name: d.start, exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/990$/);
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), d.key),
    ).toBeNull();
    expect(writes).toBe(1);
    await page.goto(d.path);
    await expect(d.field).toHaveValue("");
    expect(writes).toBe(1);
  });
  test(`${kind} language change preserves original task text without translating or starting it`, async ({
    page,
  }) => {
    const d = await editableDraft(page, kind);
    await page.locator('a[href="/settings"]').last().click();
    await page.locator("select#settings-language").selectOption("ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.goBack();
    const c =
      kind === "home"
        ? await loadHomeCopy("ar")
        : await loadNewProjectCopy("ar");
    const name = "desiredOutcome" in c ? c.desiredOutcome : c.brief;
    await expect(page.getByRole("textbox", { name, exact: true })).toHaveValue(
      "Keep this useful task until I explicitly start it.",
    );
    expect(d.f.requests).toHaveLength(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
test("a skill-prefilled project consumes its navigation seed once and preserves later edits on reload", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const f = await installStudioFixtures(page),
    catalog = getCapabilityCatalog("en");
  await page.route("**/api/skills?*", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/skills");
  await page
    .getByRole("searchbox", { name: catalog.copy.search })
    .fill("csv-quality");
  const skill = page.locator('[data-skill-id="csv-quality"]');
  await skill.locator("summary").click();
  await skill.getByRole("button", { name: catalog.copy.use }).click();
  await page
    .locator("textarea#brief")
    .fill("My reviewed source and scope 原文");
  await page.reload();
  await expect(page.locator("textarea#brief")).toHaveValue(
    "My reviewed source and scope 原文",
  );
  expect(
    await page.evaluate(() => window.history.state?.acosSkillDraft),
  ).toBeUndefined();
  expect(f.requests).toHaveLength(0);
});
test("Arabic draft-storage feedback fits a 320px phone with enlarged text and leaves task entry usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
    localStorage.setItem("acos.color-mode.v2", "light");
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.composer-draft"))
        throw Error("fixture storage refusal");
      return set.call(this, key, value);
    };
  });
  const f = await installStudioFixtures(page),
    c = await loadNewProjectCopy("ar");
  await page.goto("/projects/new");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  await page
    .getByRole("textbox", { name: c.projectName, exact: true })
    .fill("مراجعة المستندات");
  await page
    .getByRole("textbox", { name: c.brief, exact: true })
    .fill("مراجعة الملفات المقدمة مع إبقاء المسودة قابلة للتحرير.");
  const warning = page
    .getByRole("alert")
    .filter({ hasText: c.draftStorageError });
  await expect(warning).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await warning.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    await page
      .locator("form")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  expect(f.requests).toHaveLength(0);
  await page
    .locator("form")
    .screenshot({ path: ".tmp/task5-draft-ar-320-light-enlarged.png" });
});
