import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";
import customization from "../../artifacts/agentic-company-os/src/lib/customization-copy/customization-zh-TW";
import {
  waitForNativePageReady,
  expectNativePageValue,
} from "../../scripts/src/testing/native-page-readiness";

test.use({ storageState: { cookies: [], origins: [] } });

test("native first-page readiness accepts a delayed authenticated bootstrap", async ({
  page,
}) => {
  const harness = await installStudioFixtures(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.addInitScript(() =>
    localStorage.setItem("acos.locale.v1", "zh-CN"),
  );
  await page.route("**/api/auth/status", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6500));
    await route.fulfill({
      status: 200,
      json: { enabled: false, authenticated: true, sessionExpiresAt: null },
    });
  });
  await page.goto("/");
  const draft = page.getByRole("textbox", {
    name: "你想要的成果",
    exact: true,
  });
  await waitForNativePageReady(draft);
  await expect(draft).toHaveValue("");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(pageErrors).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
  expect(
    harness.requests.filter((row) => row.path.startsWith("/api/tasks")),
  ).toEqual([]);
});

test("native first-page readiness rejects a bootstrap that never finishes", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const harness = await installStudioFixtures(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.addInitScript(() =>
    localStorage.setItem("acos.locale.v1", "zh-CN"),
  );
  await page.route("**/api/auth/status", async (route) => {
    await pending;
    await route
      .fulfill({
        status: 200,
        json: { enabled: false, authenticated: true, sessionExpiresAt: null },
      })
      .catch(() => {});
  });
  try {
    await page.goto("/");
    await expect(
      waitForNativePageReady(
        page.getByRole("textbox", { name: "你想要的成果", exact: true }),
      ),
    ).rejects.toThrow(/Timeout:\s*30000ms/u);
    expect(
      harness.requests.filter((row) => row.path.startsWith("/api/tasks")),
    ).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
  } finally {
    release();
  }
});

test("first run can choose Arabic and restore the RTL choice", async ({
  page,
}) => {
  const harness = await installStudioFixtures(page);
  let syncedLocale: string | null = null;
  await page.route("**/api/settings/locale", async (route) => {
    const payload = route.request().postDataJSON() as { locale: string };
    syncedLocale = payload.locale;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: false,
        authenticated: true,
        sessionExpiresAt: null,
      }),
    }),
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dilini seç" })).toBeVisible();
  await page.getByRole("radio", { name: /العربية/ }).click();
  await expect(page.getByRole("heading", { name: "اختر لغتك" })).toBeVisible();
  await expect(
    page.getByText(
      "الترجمات بانتظار المراجعة. تبقى نصوصك والسجلات السابقة بلغتها الأصلية.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "متابعة" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect.poll(() => syncedLocale).toBe("ar");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("acos.locale.v1")))
    .toBe("ar");

  await page.reload();
  await expect(page.getByRole("heading", { name: "اختر لغتك" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(
    page.getByRole("heading", { name: "ما الذي سننجزه معًا اليوم؟" }),
  ).toBeVisible();
  expect([...harness.unexpected]).toEqual([]);
});

test("keyboard selection reaches Traditional Chinese", async ({ page }) => {
  await page.goto("/");
  const selected = page.getByRole("radio", { name: /Türkçe/ });
  await selected.focus();
  await selected.press("End");
  await expect(page.getByRole("radio", { name: /العربية/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("radio", { name: /العربية/ }).press("ArrowUp");
  await expect(page.getByRole("radio", { name: /繁體中文/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

const preparedTitle = "Reusable arithmetic zh-TW — 分析";
const preparedBrief =
  "Use calculate for 17 × 23, report 391, then complete this one task.\nDo not delegate.";
async function preparedNativeGuide(page: Page) {
  const harness = await installStudioFixtures(page);
  await page.route("**/api/skills?*", (route) =>
    route.fulfill({ json: getCapabilityCatalog("zh-TW") }),
  );
  const guideWrites: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/skills/extensions" &&
      request.method() === "PUT"
    )
      guideWrites.push("PUT");
  });
  await page.addInitScript(
    ({ title, brief }) => {
      localStorage.setItem("acos.locale.v1", "zh-TW");
      history.replaceState(
        {
          ...history.state,
          acosGuideDraft: {
            manifest: {
              schemaVersion: 1,
              id: "user-delayed-native-guide",
              kind: "skill",
              title,
              description: "Prepared from a completed project.",
              instructions: brief,
            },
            source: {
              kind: "project",
              id: 101,
              status: "completed",
              updatedAt: "2026-10-09T06:00:00.000Z",
            },
          },
        },
        "",
      );
    },
    { title: preparedTitle, brief: preparedBrief },
  );
  const panel = page.getByRole("region", { name: customization.extensions[0] });
  return {
    harness,
    guideWrites,
    panel,
    title: panel.getByLabel(customization.extensions[3], { exact: true }),
    brief: panel.getByLabel(customization.extensions[8], { exact: true }),
  };
}

test("native prepared draft waits for a cold personal-library section and preserves exact text", async ({
  page,
}) => {
  const f = await preparedNativeGuide(page);
  let delayedRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.name));
  await page.route(
    /\/assets\/extension-library-[^/]+\.js(?:\?.*)?$/u,
    async (route) => {
      delayedRequests++;
      await new Promise((resolve) => setTimeout(resolve, 7000));
      await route.continue();
    },
  );
  await page.goto("/skills");
  await expectNativePageValue(f.title, preparedTitle);
  await expect(f.brief).toHaveValue(preparedBrief);
  expect(delayedRequests).toBe(1);
  expect(errors).toEqual([]);
  expect(f.guideWrites).toEqual([]);
  expect(f.harness.requests).toEqual([]);
  expect([...f.harness.unexpected]).toEqual([]);
});

test("native prepared draft readiness still rejects the wrong visible text without saving or starting work", async ({
  page,
}) => {
  const f = await preparedNativeGuide(page);
  await page.goto("/skills");
  await waitForNativePageReady(f.title);
  await expect(
    expectNativePageValue(f.title, "Wrong prepared title"),
  ).rejects.toThrow(/toHaveValue/u);
  await expect(f.title).toHaveValue(preparedTitle);
  await expect(f.brief).toHaveValue(preparedBrief);
  expect(f.guideWrites).toEqual([]);
  expect(f.harness.requests).toEqual([]);
  expect([...f.harness.unexpected]).toEqual([]);
});
