import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadNewProjectCopy } from "../../artifacts/agentic-company-os/src/lib/new-project-copy";
import { LOCALES } from "../../artifacts/agentic-company-os/src/lib/i18n";
import type { Page } from "@playwright/test";
test("a late start response after leaving the composer cannot navigate or remove recovery", async ({
  page,
}) => {
  const { copy } = await editable(page);
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
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => captured).toBe(true);
  await page.locator('a[href="/settings"]').last().click();
  await expect(page.locator("select#settings-language")).toBeVisible();
  release();
  await page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tasks") &&
      response.request().method() === "POST",
  );
  // Wait for the browser event queue through an explicit frame, not a guessed delay.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(reads).toBe(0);
  await expect(page).toHaveURL(/\/settings$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.project-start.v1")),
  ).not.toBeNull();
});
async function editable(
  page: Page,
  locale: "en" | "tr" | "de" | "ru" | "zh-CN" | "zh-TW" | "ar" = "en",
) {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const fixture = await installStudioFixtures(page),
    copy = await loadNewProjectCopy(locale);
  await page.goto("/projects/new");
  await page
    .getByRole("textbox", { name: copy.projectName, exact: true })
    .fill("Recover my project");
  await page
    .getByRole("textbox", { name: copy.brief, exact: true })
    .fill("Use the same job after a lost response.");
  return { fixture, copy };
}
function receipt(requestId: string, state: "created" | "rejected" = "created") {
  return {
    requestId,
    state,
    taskId: state === "created" ? 990 : null,
    failureCode: state === "rejected" ? "AGENT_UNAVAILABLE" : null,
    createdAt: "2026-10-09T00:00:00.000Z",
  };
}
test("a lost project response retains a recoverable identity after reload without another POST", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const fixture = await installStudioFixtures(page),
    copy = await loadNewProjectCopy("en");
  await page.goto("/projects/new");
  await page
    .getByRole("textbox", { name: copy.projectName, exact: true })
    .fill("Recover my project");
  await page
    .getByRole("textbox", { name: copy.brief, exact: true })
    .fill("Use the same job after a lost response.");
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Check request", exact: true }),
  ).toBeVisible();
  const initial = fixture.requests[0].body;
  expect(initial).toHaveProperty("requestId");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check request", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: copy.start, exact: true }),
  ).toBeDisabled();
  expect(fixture.requests).toHaveLength(1);
});
for (const locale of LOCALES)
  for (const mode of ["light", "dark"] as const) {
    test(`${locale} ${mode} phone recovery checks without dispatch and retains edited draft`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("acos.color-mode.v2", value),
        mode,
      );
      const { fixture, copy } = await editable(page, locale);
      if (locale === "ar")
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "32px";
        });
      await page.getByRole("button", { name: copy.start, exact: true }).click();
      await expect.poll(() => fixture.requests.length).toBe(1);
      await page.reload();
      if (locale === "ar")
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "32px";
        });
      const brief = page.getByRole("textbox", {
        name: copy.brief,
        exact: true,
      });
      await brief.fill("A later task draft that must remain intact 原文");
      let reads = 0;
      const input = fixture.requests[0].body as { requestId: string };
      expect([...fixture.unexpected]).toEqual([]);
      await page.route("**/api/task-creation-requests/*", (route) => {
        reads++;
        return route.fulfill({ json: receipt(input.requestId) });
      });
      const check = page.getByRole("button", {
        name: copy.recovery.check,
        exact: true,
      });
      await check.focus();
      await expect(check).toBeFocused();
      await check.press("Enter");
      await expect(
        page.getByRole("button", { name: copy.recovery.open, exact: true }),
      ).toBeVisible();
      expect(reads).toBe(1);
      expect(fixture.requests).toHaveLength(1);
      await expect(brief).toHaveValue(
        "A later task draft that must remain intact 原文",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (locale === "ar")
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await page.screenshot({
        path: test.info().outputPath(`${locale}-${mode}-recovery.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: copy.recovery.open, exact: true })
        .click();
      await expect(page).toHaveURL(/\/projects\/990$/);
      await page.goto("/projects/new");
      await expect(brief).toHaveValue(
        "A later task draft that must remain intact 原文",
      );
      expect(fixture.requests).toHaveLength(1);
    });
  }
test("a missing receipt permits only an explicit identical retry even after editing", async ({
  page,
}) => {
  const { fixture, copy } = await editable(page);
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  const first = fixture.requests[0].body as { requestId: string };
  await page.route("**/api/task-creation-requests/*", (route) =>
    route.fulfill({ status: 404, json: { error: "not_found" } }),
  );
  await page
    .getByRole("button", { name: copy.recovery.check, exact: true })
    .click();
  const retry = page.getByRole("button", {
    name: copy.recovery.retry,
    exact: true,
  });
  await expect(retry).toBeVisible();
  await page
    .getByRole("textbox", { name: copy.brief, exact: true })
    .fill("A different future job");
  const writes: unknown[] = [];
  await page.route("**/api/tasks", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { id: 990 } });
  });
  await page.route("**/api/task-creation-requests/*", (route) =>
    route.fulfill({ json: receipt(first.requestId) }),
  );
  await retry.click();
  await expect(page).toHaveURL(/\/projects\/990$/);
  expect(writes).toEqual([first]);
  expect(fixture.requests).toHaveLength(1);
  await page.goto("/projects/new");
  await expect(
    page.getByRole("textbox", { name: copy.brief, exact: true }),
  ).toHaveValue("A different future job");
});
test("read failure and malformed receipt preserve the record and cannot open a fabricated project", async ({
  page,
}) => {
  const { fixture, copy } = await editable(page);
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  for (const response of [
    { status: 503, json: { error: "offline" } },
    {
      status: 200,
      json: { ...receipt("11829287-003c-4515-b7cc-6d15d97773be") },
    },
    { status: 200, json: { ok: true } },
  ]) {
    await page.route("**/api/task-creation-requests/*", (route) =>
      route.fulfill(response),
    );
    await page
      .getByRole("button", { name: copy.recovery.check, exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: copy.recovery.title }),
    ).toHaveAttribute("aria-busy", "false");
    await expect(
      page.getByRole("button", { name: copy.recovery.open, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: copy.recovery.retry, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: copy.start, exact: true }),
    ).toBeDisabled();
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: copy.recovery.check, exact: true }),
  ).toBeVisible();
  expect(fixture.requests).toHaveLength(1);
});
test("a terminal rejection can prepare a new identity while retaining the draft", async ({
  page,
}) => {
  const { fixture, copy } = await editable(page);
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  const first = fixture.requests[0].body as { requestId: string };
  await page.route("**/api/task-creation-requests/*", (route) =>
    route.fulfill({ json: receipt(first.requestId, "rejected") }),
  );
  await page
    .getByRole("button", { name: copy.recovery.check, exact: true })
    .click();
  await expect(
    page.getByText(copy.recovery.reasons.AGENT_UNAVAILABLE, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: copy.recovery.prepare, exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: copy.brief, exact: true }),
  ).toHaveValue("Use the same job after a lost response.");
  expect(fixture.requests).toHaveLength(1);
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(2);
  expect(
    (fixture.requests[1].body as { requestId: string }).requestId,
  ).not.toBe(first.requestId);
});
for (const mode of ["denied", "corrupt", "refused"] as const)
  test(`${mode} request storage sends no project and retains editable draft`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      if (value === "corrupt") {
        sessionStorage.setItem("acos.project-start.v1", "{");
        return;
      }
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) {
        if (k === "acos.project-start.v1" && value === "denied")
          throw Error("denied");
        return get.call(this, k);
      };
      Storage.prototype.setItem = function (k, v) {
        if (k === "acos.project-start.v1") return;
        return set.call(this, k, v);
      };
    }, mode);
    const { fixture, copy } = await editable(page);
    await page.getByRole("button", { name: copy.start, exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: copy.recovery.storageError }),
    ).toBeVisible();
    expect(fixture.requests).toHaveLength(0);
    await page
      .getByRole("textbox", { name: copy.brief, exact: true })
      .fill("Still editable after failed storage");
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: copy.brief, exact: true }),
    ).toHaveValue("Still editable after failed storage");
    expect(fixture.requests).toHaveLength(0);
  });
test("failed clearing of a confirmed request preserves its record and cannot start a fresh job", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) {
      if (k === "acos.project-start.v1") return;
      remove.call(this, k);
    };
  });
  const { fixture, copy } = await editable(page);
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  const first = fixture.requests[0].body as { requestId: string };
  await page.route("**/api/task-creation-requests/*", (route) =>
    route.fulfill({ json: receipt(first.requestId) }),
  );
  await page
    .getByRole("button", { name: copy.recovery.check, exact: true })
    .click();
  await page
    .getByRole("button", { name: copy.recovery.open, exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/990$/);
  await page.goto("/projects/new");
  await expect(
    page.getByRole("button", { name: copy.start, exact: true }),
  ).toBeDisabled();
  expect(fixture.requests).toHaveLength(1);
  await expect(
    page.getByRole("textbox", { name: copy.brief, exact: true }),
  ).toHaveValue("Use the same job after a lost response.");
});
test("a delayed successful response never erases a later edited draft", async ({
  page,
}) => {
  const { copy } = await editable(page);
  let input: { requestId: string } | null = null;
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    input = route.request().postDataJSON();
    await wait;
    return route.fulfill({ status: 201, json: { id: 990 } });
  });
  await page.route("**/api/task-creation-requests/*", (route) =>
    route.fulfill({ json: receipt(input!.requestId) }),
  );
  await page.getByRole("button", { name: copy.start, exact: true }).click();
  await expect.poll(() => input).not.toBeNull();
  await page
    .getByRole("textbox", { name: copy.brief, exact: true })
    .fill("Later edit while the first response was delayed");
  release();
  await expect(page).toHaveURL(/\/projects\/990$/);
  await page.goto("/projects/new");
  await expect(
    page.getByRole("textbox", { name: copy.brief, exact: true }),
  ).toHaveValue("Later edit while the first response was delayed");
});
test("recovery loads only with New project and validates saved state before enabling Start", async ({
  page,
}) => {
  const chunks: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (/\/project-start-recovery-[^/]+\.js$/u.test(p)) chunks.push(p);
  });
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const fixture = await installStudioFixtures(page),
    copy = await loadNewProjectCopy("en");
  await page.goto("/");
  await expect(page.locator('a[href="/settings"]').last()).toBeVisible();
  expect(chunks).toHaveLength(0);
  await page.locator('a[href="/settings"]').last().click();
  await expect(page.locator("select#settings-language")).toBeVisible();
  expect(chunks).toHaveLength(0);
  await page.goto("/projects/new");
  await expect(
    page.getByRole("button", { name: copy.start, exact: true }),
  ).toBeEnabled();
  expect(chunks).toHaveLength(1);
  expect(fixture.requests).toHaveLength(0);
});
