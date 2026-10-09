import { test, expect } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadNewProjectCopy } from "../../artifacts/agentic-company-os/src/lib/new-project-copy";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";
import type { Page } from "@playwright/test";
import {
  LOCALES,
  setupMessages,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadReusableWorkCopy } from "../../artifacts/agentic-company-os/src/lib/reusable-work-copy";

const oldTitle = "Unfinished source analysis";
const oldBrief =
  "Preserve this exact working brief.\nA second source remains to inspect.";
const incoming = {
  title: "  分析 — تحليل  ",
  brief: " First line\n\nSecond line 😀  ",
  source: {
    kind: "project",
    id: 42,
    status: "completed",
    updatedAt: "2026-10-09T05:00:00.000Z",
  },
};
async function inject(page: Page, seed: unknown = incoming) {
  await page.evaluate(
    (value) =>
      history.replaceState(
        { ...history.state, acosSkillDraft: value, preserveSibling: "keep" },
        "",
      ),
    seed,
  );
  await page.reload();
}
async function editable(page: Page, locale: Locale = "en") {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const fixture = await installStudioFixtures(page);
  const copy = await loadNewProjectCopy(locale),
    reuse = await loadReusableWorkCopy(locale);
  await page.goto("/projects/new");
  await page
    .getByRole("textbox", { name: copy.projectName, exact: true })
    .fill(oldTitle);
  await page
    .getByRole("textbox", { name: copy.brief, exact: true })
    .fill(oldBrief);
  return { fixture, copy, reuse };
}
test("an incoming guide must leave an existing saved draft intact until the operator chooses replacement", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page),
    c = await loadNewProjectCopy("en"),
    catalog = getCapabilityCatalog("en");
  await page.route("**/api/skills?*", (r) => r.fulfill({ json: catalog }));
  await page.goto("/projects/new");
  await page
    .getByRole("textbox", { name: c.projectName, exact: true })
    .fill("Unfinished source analysis");
  await page
    .getByRole("textbox", { name: c.brief, exact: true })
    .fill(
      "Preserve this exact working brief.\nA second source remains to inspect.",
    );
  await page.goto("/skills");
  const guide = page.locator('[data-skill-id="csv-quality"]');
  await guide.locator("summary").click();
  await guide
    .getByRole("button", { name: catalog.copy.use, exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(
    page.getByRole("textbox", { name: c.projectName, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("incoming-guide-with-prior-draft.png"),
    fullPage: true,
  });
  expect(harness.requests).toHaveLength(0);
  await expect(
    page.getByRole("textbox", { name: c.projectName, exact: true }),
  ).toHaveValue("Unfinished source analysis");
});

test("loading preparation code keeps Start blocked and never replaces late input", async ({
  page,
}) => {
  await page.addInitScript((seed) => {
    localStorage.setItem("acos.locale.v1", "en");
    history.replaceState({ ...history.state, acosSkillDraft: seed }, "");
  }, incoming);
  const fixture = await installStudioFixtures(page);
  const copy = await loadNewProjectCopy("en"),
    reuse = await loadReusableWorkCopy("en");
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (arrived = resolve));
  await page.route(
    "**/assets/project-preparation-choice-*.js",
    async (route) => {
      arrived();
      await gate;
      await route.continue();
    },
  );
  try {
    await page.goto("/projects/new");
    await requested;
    const title = page.getByRole("textbox", {
      name: copy.projectName,
      exact: true,
    });
    const brief = page.getByRole("textbox", { name: copy.brief, exact: true });
    await title.fill(oldTitle);
    await brief.fill(oldBrief);
    await expect(
      page.getByRole("button", { name: copy.start, exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      page.getByRole("button", { name: reuse.keepCurrent, exact: true }),
    ).toBeVisible();
    await expect(title).toHaveValue(oldTitle);
    await expect(brief).toHaveValue(oldBrief);
    await page
      .getByRole("button", { name: reuse.keepCurrent, exact: true })
      .click();
    await expect(brief).toBeFocused();
    await expect(title).toHaveValue(oldTitle);
    expect(fixture.requests).toHaveLength(0);
  } finally {
    release();
  }
});

for (const locale of LOCALES)
  for (const mode of ["light", "dark"] as const) {
    test(`${locale} ${mode} phone keeps the draft across reload and resolves incoming text deliberately`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("acos.color-mode.v2", value),
        mode,
      );
      const { fixture, copy, reuse } = await editable(page, locale);
      await inject(page);
      await expect(
        page.getByRole("button", { name: reuse.keepCurrent, exact: true }),
      ).toBeVisible();
      await page.reload();
      const title = page.getByRole("textbox", {
        name: copy.projectName,
        exact: true,
      });
      const brief = page.getByRole("textbox", {
        name: copy.brief,
        exact: true,
      });
      await expect(title).toHaveValue(oldTitle);
      await expect(brief).toHaveValue(oldBrief);
      await expect(
        page.getByRole("button", { name: copy.start, exact: true }),
      ).toBeDisabled();
      if (locale === "ar")
        await page.evaluate(
          () => (document.documentElement.style.fontSize = "32px"),
        );
      for (const label of [reuse.keepCurrent, reuse.useIncoming]) {
        const button = page.getByRole("button", { name: label, exact: true });
        const geometry = await button.evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          width: element.getBoundingClientRect().width,
          fits: element.scrollHeight <= element.clientHeight + 1,
        }));
        expect(geometry.height).toBeGreaterThanOrEqual(44);
        expect(geometry.width).toBeGreaterThanOrEqual(44);
        expect(geometry.fits).toBe(true);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (locale === "ar")
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await page.screenshot({
        path: test.info().outputPath(`incoming-choice-${locale}-${mode}.png`),
        fullPage: true,
      });
      const useIncoming = mode === "dark";
      const choice = page.getByRole("button", {
        name: useIncoming ? reuse.useIncoming : reuse.keepCurrent,
        exact: true,
      });
      await choice.focus();
      await expect(choice).toBeFocused();
      await choice.press("Enter");
      await expect(title).toHaveValue(useIncoming ? incoming.title : oldTitle);
      await expect(brief).toHaveValue(useIncoming ? incoming.brief : oldBrief);
      if (useIncoming) await expect(title).toBeFocused();
      expect(await page.evaluate(() => history.state.preserveSibling)).toBe(
        "keep",
      );
      expect(
        await page.evaluate(() => history.state.acosSkillDraft),
      ).toBeUndefined();
      await brief.fill("A later edit 原文 must survive reload.");
      await page.reload();
      await expect(brief).toHaveValue("A later edit 原文 must survive reload.");
      await expect(
        page.getByRole("button", { name: reuse.useIncoming, exact: true }),
      ).toHaveCount(0);
      expect(fixture.requests).toHaveLength(0);
      expect([...fixture.unexpected]).toEqual([]);
    });
  }

test("denied persistence retains incoming history and editable text without starting", async ({
  page,
}) => {
  const { fixture, copy, reuse } = await editable(page);
  await inject(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.composer-draft"))
        throw Error("owned write refusal");
      return original.call(this, key, value);
    };
  });
  await page
    .getByRole("button", { name: reuse.useIncoming, exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue(incoming.title);
  await expect(
    page.getByRole("alert").filter({ hasText: reuse.choiceError }),
  ).toBeVisible();
  expect(await page.evaluate(() => history.state.acosSkillDraft.title)).toBe(
    incoming.title,
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("acos.composer-draft.v1:project")!)
          .title,
    ),
  ).toBe(oldTitle);
  await expect(
    page.getByRole("button", { name: copy.start, exact: true }),
  ).toBeDisabled();
  expect(fixture.requests).toHaveLength(0);
});

test("corrupt storage does not silently accept or overwrite an incoming draft", async ({
  page,
}) => {
  const { fixture, copy, reuse } = await editable(page);
  await page.evaluate(() =>
    sessionStorage.setItem("acos.composer-draft.v1:project", "{broken"),
  );
  await inject(page);
  await expect(
    page.getByRole("button", { name: reuse.useIncoming, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.composer-draft.v1:project"),
    ),
  ).toBe("{broken");
  expect(await page.evaluate(() => history.state.acosSkillDraft.title)).toBe(
    incoming.title,
  );
  await expect(
    page.getByRole("button", { name: copy.start, exact: true }),
  ).toBeDisabled();
  expect(fixture.requests).toHaveLength(0);
});

test("a no-op history update retains the decision and reports its recovery limit", async ({
  page,
}) => {
  const { fixture, copy, reuse } = await editable(page);
  await inject(page);
  await page.evaluate(() => {
    history.replaceState = () => {};
  });
  await page
    .getByRole("button", { name: reuse.keepCurrent, exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: reuse.choiceError }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue(oldTitle);
  expect(await page.evaluate(() => history.state.acosSkillDraft.title)).toBe(
    incoming.title,
  );
  expect(fixture.requests).toHaveLength(0);
});

test("an existing uncertain start keeps its exact request when incoming text is used", async ({
  page,
}) => {
  const { fixture, copy, reuse } = await editable(page);
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  const frozen = await page.evaluate(() =>
    sessionStorage.getItem("acos.project-start.v1"),
  );
  await inject(page);
  await page
    .getByRole("button", { name: reuse.useIncoming, exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue(incoming.title);
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.project-start.v1")),
  ).toBe(frozen);
  await expect(
    page.getByRole("button", { name: copy.start, exact: true }),
  ).toBeDisabled();
  expect(fixture.requests).toHaveLength(1);
});

test("a fresh explicit Start uses new identity and ordinary finite controls without source authority", async ({
  page,
}) => {
  const { fixture, copy, reuse } = await editable(page);
  const oldIdentity = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await inject(page, {
    ...incoming,
    requestId: oldIdentity,
    priority: "urgent",
    autonomyMode: "continuous",
    permissions: ["all"],
  });
  await page
    .getByRole("button", { name: reuse.useIncoming, exact: true })
    .click();
  expect(fixture.requests).toHaveLength(0);
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  const body = fixture.requests[0].body as Record<string, unknown>;
  expect(body.requestId).not.toBe(oldIdentity);
  expect(body).toMatchObject({
    title: incoming.title.trim(),
    brief: incoming.brief.trim(),
    priority: "normal",
    autonomyMode: "finite",
  });
  expect(Object.keys(body).sort()).toEqual([
    "autonomyMode",
    "brief",
    "priority",
    "requestId",
    "title",
  ]);
});

test("a failed preparation language download can actually recover without losing the draft", async ({
  page,
}) => {
  const { fixture, copy, reuse } = await editable(page);
  let refuse = true,
    downloads = 0;
  await page.route("**/assets/reuse-en-*.js", (route) => {
    downloads++;
    return refuse ? route.abort("failed") : route.continue();
  });
  await inject(page);
  const error = page
    .getByRole("alert")
    .filter({ hasText: setupMessages.en.languageFileError });
  await expect(error).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue(oldTitle);
  expect(downloads).toBe(1);
  refuse = false;
  await error.getByRole("button").click();
  await expect(
    page.getByRole("button", { name: reuse.keepCurrent, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue(oldTitle);
  expect(await page.evaluate(() => history.state.acosSkillDraft.title)).toBe(
    incoming.title,
  );
  expect(downloads).toBeGreaterThan(1);
  expect(fixture.requests).toHaveLength(0);
});

test("a failed preparation language download cannot reload away text refused by storage", async ({
  page,
}) => {
  const { fixture, copy } = await editable(page);
  await page.route("**/assets/reuse-en-*.js", (route) => route.abort("failed"));
  await inject(page);
  const error = page
    .getByRole("alert")
    .filter({ hasText: setupMessages.en.languageFileError });
  await expect(error).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.composer-draft"))
        throw Error("owned write refusal");
      return original.call(this, key, value);
    };
  });
  const brief = page.getByRole("textbox", { name: copy.brief, exact: true });
  await brief.fill("Latest visible text without tab storage 原文");
  let reloaded = false;
  page.once("load", () => {
    reloaded = true;
  });
  await error.getByRole("button").click();
  await expect(brief).toHaveValue(
    "Latest visible text without tab storage 原文",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: copy.draftStorageError }),
  ).toBeVisible();
  expect(reloaded).toBe(false);
  expect(fixture.requests).toHaveLength(0);
});

test("an empty healthy composer still accepts a legacy built-in guide once", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const fixture = await installStudioFixtures(page);
  const copy = await loadNewProjectCopy("en"),
    reuse = await loadReusableWorkCopy("en");
  const catalog = getCapabilityCatalog("en");
  await page.route("**/api/skills?*", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/skills");
  const guide = page.locator('[data-skill-id="csv-quality"]');
  await guide.locator("summary").click();
  await guide
    .getByRole("button", { name: catalog.copy.use, exact: true })
    .click();
  const title = page.getByRole("textbox", {
    name: copy.projectName,
    exact: true,
  });
  await expect(title).toHaveValue(
    catalog.skills.find((skill) => skill.id === "csv-quality")!.title,
  );
  await expect(
    page.getByRole("button", { name: reuse.useIncoming, exact: true }),
  ).toHaveCount(0);
  await title.fill("A later edit after built-in preparation");
  await page.reload();
  await expect(title).toHaveValue("A later edit after built-in preparation");
  expect(
    await page.evaluate(() => history.state.acosSkillDraft),
  ).toBeUndefined();
  expect(fixture.requests).toHaveLength(0);
});

test("blank text with a saved nondefault work mode still requires a choice", async ({
  page,
}) => {
  const { fixture, copy, reuse } = await editable(page);
  await page
    .getByRole("textbox", { name: copy.projectName, exact: true })
    .fill("");
  await page.getByRole("textbox", { name: copy.brief, exact: true }).fill("");
  await page.getByRole("radio", { name: copy.continuous, exact: true }).click();
  await inject(page);
  await expect(
    page.getByRole("button", { name: reuse.keepCurrent, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("radio", { name: copy.continuous, exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  expect(fixture.requests).toHaveLength(0);
});

test("malformed incoming attribution cannot replace existing text", async ({
  page,
}) => {
  const { fixture, copy, reuse } = await editable(page);
  await inject(page, {
    ...incoming,
    source: { ...incoming.source, permissions: ["all"] },
  });
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue(oldTitle);
  await expect(
    page.getByRole("textbox", { name: copy.brief, exact: true }),
  ).toHaveValue(oldBrief);
  await expect(
    page.getByRole("button", { name: reuse.useIncoming, exact: true }),
  ).toHaveCount(0);
  expect(fixture.requests).toHaveLength(0);
});
