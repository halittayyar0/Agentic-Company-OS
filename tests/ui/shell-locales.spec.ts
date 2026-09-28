import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

test("Turkish shell download failure also keeps the workspace closed until retry", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "tr"));
  const harness = await installStudioFixtures(page);
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.route("**/shell-tr-*.js", (route) => route.abort());
  await page.goto("/agents/new?template=ux_designer");
  await expect(
    page.getByRole("heading", { name: "Arayüzün dil dosyası yüklenemedi." }),
  ).toBeVisible();
  expect(apiRequests).toEqual([]);
  await page.unroute("**/shell-tr-*.js");
  await page
    .getByRole("button", { name: "Yeniden denetle", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Uzmanın adı", exact: true }),
  ).toHaveValue("Tasarım Uzmanı");
  await expect(page).toHaveURL(/template=ux_designer/);
  expect([...harness.unexpected]).toEqual([]);
});

test("a failed shell language file keeps the workspace closed and reloads the same bookmark", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  const apiRequests: string[] = [];
  const packs: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
    const file = url.pathname.split("/").at(-1)!;
    if (file.startsWith("shell-") && file.endsWith(".js")) packs.push(file);
  });
  await page.route("**/shell-en-*.js", (route) => route.abort());
  await page.goto("/agents/new?template=ux_designer");
  await expect(
    page.getByRole("heading", {
      name: "Could not load the interface language file.",
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(apiRequests).toEqual([]);
  await page.unroute("**/shell-en-*.js");
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Expert name", exact: true }),
  ).toHaveValue("Design Expert");
  await expect(page).toHaveURL(/template=ux_designer/);
  expect(packs.length).toBeGreaterThan(0);
  expect(packs.every((file) => file.startsWith("shell-en-"))).toBe(true);
  expect([...harness.unexpected]).toEqual([]);
});

test("the Arabic shell loading state stays readable before any auth or workspace requests", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "ar"));
  await installStudioFixtures(page);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.route("**/shell-ar-*.js", async (route) => {
    await ready;
    await route.continue();
  });
  try {
    await page.goto("/agents", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status")).toHaveText("جارٍ تحميل الصفحة");
    await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
    expect(apiRequests).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    release();
    await expect(
      page.getByRole("heading", { name: "الخبير المناسب لعملك." }),
    ).toBeVisible();
  } finally {
    release();
  }
});
