import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

test("English login keeps its copy after a 401, clears the key, and opens the workspace only after authentication", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let authenticated = false;
  let attempts = 0;
  const requestsBeforeSignIn: string[] = [];
  const copyPacks: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      !authenticated &&
      path.startsWith("/api/") &&
      !path.startsWith("/api/auth/")
    )
      requestsBeforeSignIn.push(path);
    if (/\/auth-.*\.js$/.test(path)) copyPacks.push(path);
  });
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      json: { enabled: true, authenticated, sessionExpiresAt: null },
    }),
  );
  await page.route("**/api/auth/login", (route) => {
    attempts += 1;
    if (attempts === 1)
      return route.fulfill({ status: 401, json: { error: "invalid" } });
    authenticated = true;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/agents");
  await expect(
    page.getByRole("heading", { name: "Access AgenticOS" }),
  ).toBeVisible();
  const key = page.getByLabel("Access key", { exact: true });
  await key.fill("synthetic-test-key-not-an-operator-secret");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid access key.");
  await expect(key).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Access AgenticOS" }),
  ).toBeVisible();
  expect(requestsBeforeSignIn).toEqual([]);
  await key.fill("second-synthetic-key-not-an-operator-secret");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(
    page.getByRole("heading", { name: "The right expert for your work." }),
  ).toBeVisible();
  expect(attempts).toBe(2);
  expect(copyPacks).toHaveLength(1);
  expect(copyPacks[0]).toMatch(/\/auth-en-/);
  expect([...harness.unexpected]).toEqual([]);
});

test("Traditional Chinese login stays closed when its language file fails and recovers on reload", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("acos.locale.v1", "zh-TW"),
  );
  const harness = await installStudioFixtures(page);
  const protectedRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") && !path.startsWith("/api/auth/"))
      protectedRequests.push(path);
  });
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      json: { enabled: true, authenticated: false, sessionExpiresAt: null },
    }),
  );
  await page.route("**/assets/auth-zh-TW-*.js", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/projects");
  await expect(page.getByRole("alert")).toContainText(
    "無法載入登入頁面語言檔案。",
  );
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(protectedRequests).toEqual([]);
  await page.unroute("**/assets/auth-zh-TW-*.js");
  await page.getByRole("button", { name: "重新檢查", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "進入 AgenticOS" }),
  ).toBeVisible();
  await expect(page.getByLabel("存取金鑰", { exact: true })).toBeVisible();
  expect(protectedRequests).toEqual([]);
  expect([...harness.unexpected]).toEqual([]);
});

test("German session-service errors allow a safe retry", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "de"));
  const harness = await installStudioFixtures(page);
  let fail = true;
  await page.route("**/api/auth/status", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: "offline" } })
      : route.fulfill({
          json: { enabled: true, authenticated: false, sessionExpiresAt: null },
        }),
  );
  await page.goto("/projects");
  await expect(page.getByRole("alert")).toContainText(
    "Sitzungsdienst nicht erreichbar",
  );
  fail = false;
  await page
    .getByRole("button", { name: "Erneut versuchen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "AgenticOS öffnen" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Zugangsschlüssel", { exact: true }),
  ).toBeVisible();
  expect([...harness.unexpected]).toEqual([]);
});
