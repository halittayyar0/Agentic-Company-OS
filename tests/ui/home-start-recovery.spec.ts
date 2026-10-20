import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadHomeCopy } from "../../artifacts/agentic-company-os/src/lib/home-copy";
import { loadNewProjectCopy } from "../../artifacts/agentic-company-os/src/lib/new-project-copy";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";

async function editable(page: Page, locale: Locale = "en") {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const fixture = await installStudioFixtures(page);
  const home = await loadHomeCopy(locale);
  const copy = await loadNewProjectCopy(locale);
  await page.goto("/");
  const brief = page.getByRole("textbox", {
    name: home.desiredOutcome,
    exact: true,
  });
  await brief.fill("Summarize these three supplied notes in one paragraph.");
  const start = page.getByRole("button", {
    name: home.startProject,
    exact: true,
  });
  return { fixture, home, copy, brief, start };
}

function receipt(requestId: string) {
  return {
    requestId,
    state: "created",
    taskId: 990,
    failureCode: null,
    createdAt: "2026-10-20T00:00:00.000Z",
  };
}

for (const locale of LOCALES) {
  for (const mode of ["light", "dark"] as const) {
    test(`${locale} ${mode} Home retains a lost start across reload and checks it without another job`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.emulateMedia({ colorScheme: mode });
      await page.addInitScript(
        (value) => localStorage.setItem("acos.color-mode.v2", value),
        mode,
      );
      const { fixture, copy, brief, start } = await editable(page, locale);
      await start.click();
      await expect.poll(() => fixture.requests.length).toBe(1);
      const first = fixture.requests[0].body as { requestId: string };
      expect(first).toHaveProperty(
        "requestId",
        expect.stringMatching(/^[0-9a-f-]{36}$/u),
      );
      await expect(
        page.getByRole("button", { name: copy.recovery.check, exact: true }),
      ).toBeVisible();
      await expect(start).toBeDisabled();
      await page.reload();
      await expect(
        page.getByRole("button", { name: copy.recovery.check, exact: true }),
      ).toBeVisible();
      await expect(start).toBeDisabled();
      await brief.fill(
        "Keep this later draft intact 原文, even when the old project opens.",
      );
      let reads = 0;
      await page.route("**/api/task-creation-requests/*", (route) => {
        reads++;
        expect(route.request().method()).toBe("GET");
        expect(new URL(route.request().url()).pathname).toBe(
          `/api/task-creation-requests/${first.requestId}`,
        );
        return route.fulfill({ json: receipt(first.requestId) });
      });
      const check = page.getByRole("button", {
        name: copy.recovery.check,
        exact: true,
      });
      await check.focus();
      await check.press("Enter");
      const open = page.getByRole("button", {
        name: copy.recovery.open,
        exact: true,
      });
      await expect(open).toBeVisible();
      expect(reads).toBe(1);
      expect(fixture.requests).toHaveLength(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (locale === "ar")
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await page.screenshot({
        path: test.info().outputPath(`${locale}-${mode}-home-recovery.png`),
        fullPage: true,
      });
      await open.click();
      await expect(page).toHaveURL(/\/projects\/990$/u);
      await page.goto("/");
      await expect(brief).toHaveValue(
        "Keep this later draft intact 原文, even when the old project opens.",
      );
      expect(fixture.requests).toHaveLength(1);
    });
  }
}

test("Home cannot dispatch when saving the request identity is refused", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage && key === "acos.project-start.v1")
        throw new Error("test storage refusal");
      return original.call(this, key, value);
    };
  });
  const { fixture, copy, brief, start } = await editable(page);
  await start.click();
  await expect(
    page.getByRole("alert").filter({ hasText: copy.recovery.storageError }),
  ).toBeVisible();
  expect(fixture.requests).toHaveLength(0);
  await expect(brief).toHaveValue(
    "Summarize these three supplied notes in one paragraph.",
  );
});

test("Home retries only the identical missing request and keeps a later draft", async ({
  page,
}) => {
  const { fixture, copy, brief, start } = await editable(page);
  await start.click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  const first = fixture.requests[0].body as { requestId: string };
  await page.route("**/api/task-creation-requests/*", (route) =>
    route.fulfill({ status: 404, json: { error: "missing" } }),
  );
  await page
    .getByRole("button", { name: copy.recovery.check, exact: true })
    .click();
  const retry = page.getByRole("button", {
    name: copy.recovery.retry,
    exact: true,
  });
  await expect(retry).toBeVisible();
  await brief.fill("A different draft to keep after opening the old job.");
  const writes: unknown[] = [];
  await page.route("**/api/tasks", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { id: 990 } });
  });
  await page.route("**/api/task-creation-requests/*", (route) =>
    route.fulfill({ json: receipt(first.requestId) }),
  );
  await retry.click();
  await expect(page).toHaveURL(/\/projects\/990$/u);
  expect(writes).toEqual([first]);
  await page.goto("/");
  await expect(brief).toHaveValue(
    "A different draft to keep after opening the old job.",
  );
});

test("Home does not trust a POST acknowledgement without the matching receipt", async ({
  page,
}) => {
  const { fixture, copy, start } = await editable(page);
  let writes = 0;
  await page.route("**/api/tasks", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes++;
    return route.fulfill({ status: 201, json: { id: 990 } });
  });
  await page.route("**/api/task-creation-requests/*", (route) =>
    route.fulfill({ json: receipt("f3083a55-7319-4adc-9120-ab54b6c4084c") }),
  );
  await start.click();
  await expect(
    page.getByRole("status").filter({ hasText: copy.recovery.uncertain }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/u);
  await expect(
    page.getByRole("button", { name: copy.recovery.open, exact: true }),
  ).toHaveCount(0);
  await expect(start).toBeDisabled();
  expect(writes).toBe(1);
  expect([...fixture.unexpected]).toEqual([]);
});

test("an unresolved detailed start also blocks Home without replacing its saved input", async ({
  page,
}) => {
  const { fixture, home, copy } = await editable(page);
  await page.goto("/projects/new");
  await page
    .getByRole("textbox", { name: copy.projectName, exact: true })
    .fill("Already submitted detailed job");
  await page
    .getByRole("textbox", { name: copy.brief, exact: true })
    .fill("Keep this saved detailed job and its own instructions.");
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  const saved = await page.evaluate(() =>
    sessionStorage.getItem("acos.project-start.v1"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: copy.recovery.check, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: home.startProject, exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.project-start.v1")),
  ).toBe(saved);
  expect(fixture.requests).toHaveLength(1);
});

for (const failed of ["home-project-start-recovery", "new-project-en"]) {
  test(`Home keeps editable text and sends nothing when ${failed} cannot load`, async ({
    page,
  }) => {
    await page.route(`**/${failed}-*.js`, (route) => route.abort("failed"));
    const { fixture, home, brief, start } = await editable(page);
    await expect(
      page.getByRole("alert").filter({ hasText: home.startUnavailable }),
    ).toBeVisible();
    await expect(start).toBeDisabled();
    await brief.fill(
      "An editable draft after the start controls failed to load.",
    );
    await expect(brief).toHaveValue(
      "An editable draft after the start controls failed to load.",
    );
    expect(fixture.requests).toHaveLength(0);
  });
}

test("a late Home acknowledgement cannot navigate away from Settings or clear its saved identity", async ({
  page,
}) => {
  const { start } = await editable(page);
  let captured = false,
    reads = 0,
    release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    captured = true;
    await waiting;
    return route.fulfill({ status: 201, json: { id: 990 } });
  });
  await page.route("**/api/task-creation-requests/*", (route) => {
    reads++;
    return route.fulfill({ status: 503, json: { error: "unused" } });
  });
  await start.click();
  await expect.poll(() => captured).toBe(true);
  await page.locator('a[href="/settings"]').last().click();
  await expect(page.locator("select#settings-language")).toBeVisible();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST",
  );
  release();
  await response;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(reads).toBe(0);
  await expect(page).toHaveURL(/\/settings$/u);
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.project-start.v1")),
  ).not.toBeNull();
});
