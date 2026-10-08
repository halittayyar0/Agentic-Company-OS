import { test, expect } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
const locales = {
  tr: "Kaynak kodunu geliştir",
  en: "Improve source code",
  de: "Quellcode verbessern",
  ru: "Улучшить исходный код",
  "zh-CN": "改进源代码",
  "zh-TW": "改進原始碼",
  ar: "تحسين الشيفرة المصدرية",
};
for (const [locale, title] of Object.entries(locales)) {
  test(`source workspace controls are readable on mobile in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    await installStudioFixtures(page);
    await page.route("**/api/source-changes", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.goto("/settings");
    await page.getByText(title, { exact: true }).click();
    const panel = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: title }) })
      .first();
    await expect(panel.locator("input")).toBeVisible();
    await expect(panel.locator("textarea")).toBeVisible();
    await expect(panel.locator("button[type=submit]")).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (locale === "ar")
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
}
test("checked source version is explicitly applied once and its outcome remains visible", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  let calls = 0;
  const row = {
    id: "53c7e7af-5448-4351-8116-e14795711608",
    agentId: 1,
    sourcePath: "/workspace/project",
    request: "Update the welcome page",
    state: "verified",
    revision: 4,
    baseCommit: "a".repeat(40),
    candidateCommit: "b".repeat(40),
    error: null,
    check: {
      command: ["node", "--check", "page.mjs"],
      output: "check passed",
      passed: true,
    },
    diff: "+ Welcome",
  };
  await page.route("**/api/source-changes**", async (route) => {
    if (route.request().url().endsWith("/apply")) {
      calls++;
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: 4 });
      row.state = "applied";
      row.revision++;
      return route.fulfill({ json: row });
    }
    return route.fulfill({
      json: route.request().url().endsWith("/source-changes") ? [row] : row,
    });
  });
  await page.goto("/settings");
  await page.getByText("Improve source code", { exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByText("+ Welcome", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Apply checked version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Roll back", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply checked version", exact: true }),
  ).toHaveCount(0);
  expect(calls).toBe(1);
});

test("unrecognized source state stays unknown and cannot offer a mutation", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installStudioFixtures(page);
  const row = {
    id: "53c7e7af-5448-4351-8116-e14795711608",
    agentId: 1,
    sourcePath: "/workspace/project",
    request: "Update the welcome page",
    state: "future_state",
    revision: 1,
    baseCommit: "a".repeat(40),
    candidateCommit: null,
    error: null,
    check: null,
  };
  await page.route("**/api/source-changes**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/source-changes") ? [row] : row,
    }),
  );
  await page.goto("/settings");
  await page.getByText("Improve source code", { exact: true }).click();
  await expect(
    page.getByText("Outcome unknown", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(
    page.getByText("Status: Outcome unknown", { exact: true }),
  ).toBeVisible();
  for (const name of ["Run checks", "Apply checked version", "Roll back"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
});

const codingNotices: Record<string, string> = {
  tr: "Codex hâlâ çalışıyor veya sürecin temizlendiği doğrulanmadı. Kaynak kontrollerinden önce görevi açıp kodlama oturumunu incele.",
  en: "Codex is still running, or process cleanup is unverified. Open the task and inspect its coding session before running source checks.",
  de: "Codex läuft noch oder das Beenden der Prozesse ist nicht bestätigt. Öffne die Aufgabe und prüfe die Coding-Sitzung, bevor du den Quellcode prüfst.",
  ru: "Codex работает или остановка не подтверждена. Сначала проверьте сеанс в задаче.",
  "zh-CN":
    "Codex 仍在运行，或尚未确认进程清理完成。请先打开任务并查看编码会话，再运行源代码检查。",
  "zh-TW":
    "Codex 仍在執行，或尚未確認程序清理完成。請先開啟任務並查看編碼工作階段，再執行原始碼檢查。",
  ar: "لا يزال Codex يعمل، أو لم يُتحقق من إنهاء عملياته. افتح المهمة وراجع جلسة البرمجة قبل إجراء فحوص الشيفرة المصدرية.",
};

for (const [locale, title] of Object.entries(locales))
  test(`source coding conflict guides the operator to the task in ${locale}`, async ({
    page,
  }) => {
    const copy = (
      await import(
        `../../artifacts/agentic-company-os/src/lib/customization-copy/customization-${locale}.ts`
      )
    ).default.source;
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    await installStudioFixtures(page);
    let checks = 0;
    const row = {
      id: "53c7e7af-5448-4351-8116-e14795711608",
      agentId: 1,
      taskId: 83,
      sourcePath: "/workspace/project",
      request: "Update the welcome page",
      state: "draft",
      revision: 1,
      baseCommit: "a".repeat(40),
      candidateCommit: null,
      error: null,
      check: null,
      diff: "+ Welcome",
    };
    await page.route("**/api/source-changes**", async (route) => {
      if (route.request().url().endsWith("/check")) {
        checks++;
        expect(route.request().postDataJSON().expectedRevision).toBe(1);
        return route.fulfill({
          status: 409,
          json: {
            code: "SOURCE_CODING_ACTIVE",
            message: "PRIVATE_process_diagnostic",
          },
        });
      }
      return route.fulfill({
        json: route.request().url().endsWith("/source-changes") ? [row] : row,
      });
    });
    await page.goto("/settings");
    await page.getByText(title, { exact: true }).click();
    await page.getByRole("button", { name: copy[7], exact: true }).click();
    await page.getByRole("button", { name: copy[9], exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: codingNotices[locale] }),
    ).toBeVisible();
    await expect(page.locator('a[href="/tasks/83"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: copy[9], exact: true }),
    ).toBeEnabled();
    expect(checks).toBe(1);
    await expect(
      page.getByText("PRIVATE_process_diagnostic", { exact: false }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (locale === "ar")
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
