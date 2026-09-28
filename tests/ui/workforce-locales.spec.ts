import {
  inspectRoute,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import { expect, test, type Page } from "@playwright/test";
import { WORKFORCE_BLUEPRINTS } from "../../artifacts/api-server/src/lib/workforce-blueprints";
import { localizeWorkforceBlueprint } from "../../artifacts/api-server/src/lib/workforce-localization";
import { loadWorkforceCopy } from "../../artifacts/agentic-company-os/src/lib/workforce-copy";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";

async function setup(page: Page, locale: Locale) {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const harness = await installStudioFixtures(page);
  const queries: string[] = [];
  await page.route("**/api/workforce-blueprints?*", (route) => {
    const language = new URL(route.request().url()).searchParams.get(
      "locale",
    ) as Locale;
    queries.push(language);
    return route.fulfill({
      json: WORKFORCE_BLUEPRINTS.map((blueprint) =>
        localizeWorkforceBlueprint(blueprint, language),
      ),
    });
  });
  return { ...harness, queries };
}

for (const locale of LOCALES)
  test(`${locale} team studio installs the reviewed language, preserves authority and fits a phone`, async ({
    page,
  }) => {
    const harness = await setup(page, locale);
    const c = await loadWorkforceCopy(locale);
    const translated = localizeWorkforceBlueprint(
      WORKFORCE_BLUEPRINTS[0],
      locale,
    );
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    if (locale === "ar")
      await page.addInitScript(() =>
        localStorage.setItem("acos.color-mode.v2", "light"),
      );
    const packs: string[] = [];
    page.on("request", (request) => {
      const file = new URL(request.url()).pathname.split("/").at(-1)!;
      if (/^workforce-.+\.js$/.test(file)) packs.push(file);
    });
    const installs: Record<string, unknown>[] = [];
    await page.route("**/api/workforce-blueprints/*/install", (route) => {
      installs.push(route.request().postDataJSON());
      return route.fulfill({
        status: 201,
        json: {
          blueprintKey: translated.key,
          version: 1,
          agents: translated.members.map((member, index) => ({
            ...studioAgents[0],
            id: 100 + index,
            name: member.name,
            role: member.role,
          })),
          task: null,
        },
      });
    });
    await page.goto("/workforces");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: translated.name, exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    await page.getByRole("link", { name: c.configure, exact: true }).click();
    await expect(page.getByLabel(c.manager, { exact: true })).toHaveValue("1");
    if (locale === "ar") {
      await expect(page.locator("html")).not.toHaveClass(/dark/);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: "test-results/workforce-ar-preview.png",
        fullPage: true,
      });
    }
    const submit = page.getByRole("button", { name: c.install, exact: true });
    if (locale === "en") {
      await submit.focus();
      await page.keyboard.press("Enter");
    } else await submit.click();
    await expect(
      page.getByRole("heading", { name: c.receipt, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(translated.members[0].name) }),
    ).toBeVisible();
    expect(installs).toEqual([
      {
        managerAgentId: 1,
        locale,
        blueprintVersion: 1,
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
    expect(harness.queries).toContain(locale);
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.every((file) => file.startsWith(`workforce-${locale}-`))).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect([...harness.unexpected]).toEqual([]);
    if (locale === "ar")
      await page.screenshot({
        path: "test-results/workforce-ar-phone.png",
        fullPage: true,
      });
  });

test("lost installation response survives reload and reuses the same request; simultaneous clicks do not create another intent", async ({
  page,
}) => {
  await setup(page, "en");
  const c = await loadWorkforceCopy("en");
  const installs: Record<string, unknown>[] = [];
  let respond: (() => void) | undefined;
  await page.route("**/api/workforce-blueprints/*/install", async (route) => {
    installs.push(route.request().postDataJSON());
    if (installs.length === 1) {
      await new Promise<void>((resolve) => {
        respond = resolve;
      });
      return route.fulfill({
        status: 503,
        json: { error: "Upstream response lost" },
      });
    }
    return route.fulfill({
      status: 201,
      json: {
        blueprintKey: WORKFORCE_BLUEPRINTS[0].key,
        version: 1,
        agents: [{ ...studioAgents[0], id: 101 }],
        task: { id: 202 },
      },
    });
  });
  await page.goto("/workforces");
  await page
    .getByLabel(c.outcome, { exact: true })
    .fill("Preserve this exact outcome across a lost response.");
  await page.getByRole("button", { name: c.continuous, exact: true }).click();
  await page.getByLabel(c.cadence, { exact: true }).selectOption("86400");
  const button = page.getByRole("button", {
    name: c.installStart,
    exact: true,
  });
  await button.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => installs.length).toBe(1);
  await expect(page.getByLabel(c.outcome, { exact: true })).toBeDisabled();
  respond!();
  await expect(
    page.getByRole("alert").filter({ hasText: c.unknown }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(c.outcome, { exact: true })).toHaveValue(
    "Preserve this exact outcome across a lost response.",
  );
  await page.getByRole("button", { name: c.recover, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: c.receipt, exact: true }),
  ).toBeVisible();
  expect(installs).toHaveLength(2);
  expect(installs[1]).toEqual(installs[0]);
  expect(installs[0]).toMatchObject({
    cadenceSeconds: 86400,
    autonomyMode: "continuous",
    locale: "en",
    blueprintVersion: 1,
  });
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.workforce-intent.v1"),
    ),
  ).toBeNull();
  await expect(
    page.getByRole("button", { name: c.installStart, exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: c.another, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.install, exact: true }),
  ).toBeEnabled();
});

test("emergency stop also blocks a team without an initial task and unknown safety stays distinct", async ({
  page,
}) => {
  await setup(page, "en");
  const c = await loadWorkforceCopy("en");
  let unknown = false;
  await page.route("**/api/ops/control", (route) =>
    route.fulfill({
      status: unknown ? 503 : 200,
      json: unknown
        ? { error: "Offline" }
        : {
            emergencyStopEnabled: true,
            reason: "Test stop",
            updatedBy: "test",
            blockedScopes: [],
            version: 1,
            updatedAt: new Date().toISOString(),
          },
    }),
  );
  await page.goto("/workforces");
  await expect(page.getByText(c.stopped, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.install, exact: true }),
  ).toBeDisabled();
  unknown = true;
  await page.reload();
  await expect(page.getByText(c.safetyUnknown, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.install, exact: true }),
  ).toBeDisabled();
});

test("an empty team catalog has an empty state and a failed language pack has a localized recovery action", async ({
  page,
}) => {
  await setup(page, "de");
  const c = await loadWorkforceCopy("de");
  await page.route("**/api/workforce-blueprints?*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/workforces");
  await expect(page.getByText(c.empty, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.install, exact: true }),
  ).toHaveCount(0);
  await page.route("**/assets/workforce-de-*.js", (route) => route.abort());
  await page.reload();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Die Sprachdatei des Teamstudios konnte nicht geladen werden.",
    }),
  ).toBeVisible();
});

test("stale catalogs preserve the draft and disable installation until a successful refresh", async ({
  page,
}) => {
  await setup(page, "en");
  const c = await loadWorkforceCopy("en");
  await page.goto("/workforces");
  await page
    .getByLabel(c.outcome, { exact: true })
    .fill("Keep this draft while reconnecting.");
  let failed = true;
  await page.route("**/api/workforce-blueprints?*", (route) =>
    route.fulfill({
      status: failed ? 503 : 200,
      json: failed
        ? { error: "Offline" }
        : WORKFORCE_BLUEPRINTS.map((item) =>
            localizeWorkforceBlueprint(item, "en"),
          ),
    }),
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByText(c.stale, { exact: true })).toBeVisible();
  await expect(page.getByLabel(c.outcome, { exact: true })).toHaveValue(
    "Keep this draft while reconnecting.",
  );
  await expect(
    page.getByRole("button", { name: c.installStart, exact: true }),
  ).toBeDisabled();
  failed = false;
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.installStart, exact: true }),
  ).toBeEnabled();
});

test("a known version rejection releases the old intent while keeping the user's draft", async ({
  page,
}) => {
  await setup(page, "en");
  const c = await loadWorkforceCopy("en");
  await page.route("**/api/workforce-blueprints/*/install", (route) =>
    route.fulfill({
      status: 409,
      json: {
        code: "WORKFORCE_BLUEPRINT_VERSION_CHANGED",
        error: "Internal server copy must not leak",
      },
    }),
  );
  await page.goto("/workforces");
  await page
    .getByLabel(c.outcome, { exact: true })
    .fill("Keep this goal for the new version.");
  await page.getByRole("button", { name: c.installStart, exact: true }).click();
  await expect(page.getByText(c.versionChanged, { exact: true })).toBeVisible();
  await expect(page.getByLabel(c.outcome, { exact: true })).toHaveValue(
    "Keep this goal for the new version.",
  );
  await expect(page.getByLabel(c.outcome, { exact: true })).toBeEnabled();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.workforce-intent.v1"),
    ),
  ).toBeNull();
  await expect(
    page.getByText("Internal server copy must not leak"),
  ).toHaveCount(0);
});

test("leaving the page during installation retains recovery until its result can be shown", async ({
  page,
}) => {
  await setup(page, "en");
  const c = await loadWorkforceCopy("en");
  const requests: unknown[] = [];
  let respond: (() => void) | undefined;
  await page.route("**/api/workforce-blueprints/*/install", async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1)
      await new Promise<void>((resolve) => {
        respond = resolve;
      });
    return route.fulfill({
      status: 201,
      json: {
        blueprintKey: WORKFORCE_BLUEPRINTS[0].key,
        version: 1,
        agents: [{ ...studioAgents[0], id: 101 }],
        task: null,
      },
    });
  });
  await page.goto("/workforces");
  await page.getByRole("button", { name: c.install, exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/install") && response.status() === 201,
  );
  respond!();
  await (await completed).finished();
  await page.getByRole("link", { name: "Teams", exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.recover, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: c.recover, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: c.receipt, exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: team preview and configuration`, async ({
    page,
  }, info) => {
    const { unexpected, requests } = await setup(page, locale);
    const errors = await prepareRouteAudit(page, variant);
    const c = await loadWorkforceCopy(locale);
    const blueprint = localizeWorkforceBlueprint(
      WORKFORCE_BLUEPRINTS[0],
      locale,
    );
    await page.goto("/workforces");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: blueprint.name, exact: true }),
    ).toBeVisible();
    await inspectRoute(page, info, "team-studio", variant);
    expect(requests).toEqual([]);
    expect([...unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
