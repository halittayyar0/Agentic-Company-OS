import { expect, test } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";

test("English expert directory searches translated roles and restores filters and pagination", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const requestedPacks: string[] = [];
  const authPacks: string[] = [];
  page.on("request", (request) => {
    const name = new URL(request.url()).pathname.split("/").at(-1) ?? "";
    if (/^directory-.*\.js$/.test(name)) requestedPacks.push(name);
    if (/^auth-.*\.js$/.test(name)) authPacks.push(name);
  });
  const harness = await installStudioFixtures(page);
  const agents = studioAgents.map((agent, index) => ({
    ...agent,
    status: index === 0 ? "working" : "idle",
  }));
  await page.route("**/api/agents?*", (route) =>
    route.fulfill({ json: agents }),
  );
  await page.goto("/agents?source=bookmark");
  await expect(
    page.getByRole("heading", { name: "The right expert for your work." }),
  ).toBeVisible();
  const directory = page.getByRole("region", { name: "Expert directory" });
  const search = page.getByRole("searchbox", { name: "Search experts" });
  await search.fill("accessible");
  const designer = agents.find((agent) => agent.templateKey === "ux_designer")!;
  await expect(
    directory.locator(`a[href="/agents/${designer.id}"]`),
  ).toBeVisible();
  await expect(
    directory.getByText("Experts: 1 of 14", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(search).toHaveValue("accessible");
  expect(new URL(page.url()).searchParams.get("source")).toBe("bookmark");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toBeFocused();
  await page
    .getByRole("group", { name: "Filter experts by status" })
    .getByRole("button", { name: "Working", exact: true })
    .click();
  await expect(directory.getByRole("heading", { level: 2 })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Area of expertise" }).click();
  await page.getByRole("option", { name: "Finance", exact: true }).click();
  await expect(
    page.getByText("No matching experts", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/agents\?source=bookmark$/);
  const pagination = page.getByRole("navigation", { name: "Expert pages" });
  await pagination.getByRole("button", { name: "Next" }).click();
  await expect(pagination.getByText("Page 2 of 2")).toBeVisible();
  await expect(directory.getByRole("heading", { level: 2 })).toHaveCount(2);
  await expect(pagination.getByRole("button", { name: "Next" })).toBeFocused();
  await page.reload();
  await expect(pagination.getByText("Page 2 of 2")).toBeVisible();
  await pagination.getByRole("button", { name: "Previous" }).click();
  await expect(directory.getByRole("heading", { level: 2 })).toHaveCount(12);
  expect(requestedPacks.length).toBeGreaterThan(0);
  expect(authPacks).toEqual([]);
  expect(requestedPacks.every((name) => name.startsWith("directory-en-"))).toBe(
    true,
  );
  expect([...harness.unexpected]).toEqual([]);
});

test("Arabic expert filters support phone touch targets, RTL menus and marked search text", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
    localStorage.setItem("acos.color-mode.v2", "light");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/agents");
  await expect(
    page.getByRole("heading", { name: "الخبير المناسب لعملك." }),
  ).toBeVisible();
  const filter = page.getByRole("combobox", { name: "مجال التخصص" });
  await filter.click();
  const options = page.getByRole("listbox");
  await expect(options).toHaveAttribute("dir", "rtl");
  const design = page.getByRole("option", { name: "التصميم", exact: true });
  expect((await design.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await design.click();
  await expect(filter).toBeFocused();
  await page
    .getByRole("searchbox", { name: "ابحث عن خبير" })
    .fill("التَّصْـمِيم");
  const directory = page.getByRole("region", { name: "دليل الخبراء" });
  await expect(directory.getByRole("heading", { level: 2 })).toHaveCount(1);
  await expect(
    directory.getByText(/^الخبراء: (?:1 من 14|١ من ١٤)$/u),
  ).toBeVisible();
  const ready = page
    .getByRole("group", { name: "تصفية الخبراء حسب الحالة" })
    .getByRole("button", { name: "جاهز", exact: true });
  expect((await ready.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await ready.click();
  await page.screenshot({
    path: testInfo.outputPath("arabic-expert-directory.png"),
    animations: "disabled",
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  expect([...harness.unexpected]).toEqual([]);
});

test("expert directory distinguishes an unavailable roster from a stale snapshot and retries both", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let fail = true;
  await page.route("**/api/agents?*", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: "offline" } })
      : route.fulfill({ json: studioAgents }),
  );
  await page.goto("/agents");
  await expect(page.getByRole("alert")).toContainText("Could not load experts");
  await expect(
    page.getByText("Team count unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Add your first expert", { exact: true }),
  ).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Experts: 14", { exact: true })).toBeVisible();
  fail = true;
  // Opening the palette refreshes the same shared roster query.
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toContainText(
    "Could not refresh experts",
  );
  await expect(
    page.getByText(
      "Showing the last loaded team. Check your connection and try again.",
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Expert directory" })
      .getByRole("heading", { level: 2 }),
  ).toHaveCount(13);
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Expert directory" })
      .getByRole("heading", { level: 2 }),
  ).toHaveCount(12);
  expect([...harness.unexpected]).toEqual([]);
});

test("German directory reloads a failed language asset without losing the bookmark filter", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "de"));
  const harness = await installStudioFixtures(page);
  await page.route("**/assets/directory-de-*.js", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/agents?department=quality&source=bookmark");
  await expect(page.getByRole("alert")).toContainText(
    "Die Sprachdatei für das Fachkräfteverzeichnis konnte nicht geladen werden.",
  );
  await page.unroute("**/assets/directory-de-*.js");
  await page
    .getByRole("button", { name: "Erneut prüfen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Die passende Fachkraft für deine Arbeit.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Fachgebiet" })).toHaveText(
    "Qualität",
  );
  await expect(
    page.getByText("Fachkräfte: 1 von 14", { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("source")).toBe("bookmark");
  expect([...harness.unexpected]).toEqual([]);
});

for (const [locale, title, empty, add] of [
  [
    "ru",
    "Подходящий эксперт для вашей работы.",
    "Добавьте первого эксперта",
    "Добавить эксперта",
  ],
  ["zh-CN", "为工作找到合适的专家。", "添加你的第一位专家", "添加专家"],
  ["zh-TW", "為工作找到合適的專家。", "新增你的第一位專家", "新增專家"],
]) {
  test(`${locale} directory provides a localized first-expert state`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/agents?*", (route) => route.fulfill({ json: [] }));
    await page.goto("/agents");
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: empty, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region").getByRole("link", { name: add, exact: true }),
    ).toHaveAttribute("href", "/agents/new");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    expect([...harness.unexpected]).toEqual([]);
  });
}
