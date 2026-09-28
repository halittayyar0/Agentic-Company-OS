import { expect, test } from "@playwright/test";
import { AGENT_TEMPLATES } from "../../artifacts/api-server/src/lib/agent-templates";
import { installStudioFixtures } from "./helpers/studio-fixtures";

test("a delayed role catalog preserves custom instructions entered before it arrived", async ({
  page,
}) => {
  await installStudioFixtures(page);
  let release!: () => void;
  const catalogReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/agent-templates**", async (route) => {
    await catalogReady;
    await route.fulfill({ json: AGENT_TEMPLATES });
  });
  try {
    await page.goto("/agents/new?template=ux_designer");
    await page.getByText("Gelişmiş ayarlar", { exact: true }).click();
    const custom = page.getByRole("switch", {
      name: "Çalışma talimatını kendim yazacağım",
    });
    await custom.click();
    const prompt = page.getByRole("textbox", {
      name: "Çalışma talimatı",
      exact: true,
    });
    await prompt.fill(
      "Her teslimatta özgün kalite kurallarımızı uygula ve kanıtları kaydet.",
    );
    release();
    await expect(
      page.getByRole("button", { name: /Tasarım Uzmanı/ }),
    ).toBeVisible();
    await expect(custom).toBeChecked();
    await expect(prompt).toHaveValue(
      "Her teslimatta özgün kalite kurallarımızı uygula ve kanıtları kaydet.",
    );
  } finally {
    release();
  }
});

test("a delayed role catalog preserves the identity entered by the user", async ({
  page,
}) => {
  await installStudioFixtures(page);
  let release!: () => void;
  const catalogReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/agent-templates**", async (route) => {
    await catalogReady;
    await route.fulfill({ json: AGENT_TEMPLATES });
  });
  try {
    await page.goto("/agents/new?template=ux_designer");
    const name = page.getByRole("textbox", {
      name: "Uzmanın adı",
      exact: true,
    });
    await name.fill("Deniz Özel");
    release();
    await expect(
      page.getByRole("textbox", { name: "Sorumluluğu", exact: true }),
    ).toHaveValue(/Tasarım/);
    await expect(name).toHaveValue("Deniz Özel");
    await page.getByRole("button", { name: /Kalite Uzmanı/ }).click();
    await expect(
      page.getByRole("textbox", { name: "Sorumluluğu", exact: true }),
    ).toHaveValue(/Kalite/);
    await expect(name).toHaveValue("Deniz Özel");
  } finally {
    release();
  }
});

test("a confirmed expert save returns to the refreshed directory", async ({
  page,
}) => {
  await installStudioFixtures(page);
  let savedName = "";
  let getRequestsAfterSave = 0;
  await page.route("**/api/agents*", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/agents")
      return route.fallback();
    if (route.request().method() === "POST") {
      savedName = route.request().postDataJSON().name;
      return route.fulfill({ status: 201, json: { id: 15, name: savedName } });
    }
    if (savedName) getRequestsAfterSave += 1;
    return route.fallback();
  });
  await page.goto("/agents/new?template=quality_engineer");
  await expect(
    page.getByRole("textbox", { name: "Uzmanın adı", exact: true }),
  ).toHaveValue("Kalite Uzmanı");
  await page.getByRole("button", { name: "Uzmanı ekle", exact: true }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "İşin için doğru uzman." }),
  ).toBeVisible();
  expect(savedName).toBe("Kalite Uzmanı");
  expect(getRequestsAfterSave).toBeGreaterThan(0);
});

test("repeated submit events create only one pending request", async ({
  page,
}) => {
  const harness = await installStudioFixtures(page);
  for (const route of ["/", "/agents/new?template=ux_designer"]) {
    await page.goto(route);
    if (route === "/")
      await page
        .getByRole("textbox", { name: "Üretmek istediğin sonuç" })
        .fill("Bir rezervasyon sitesi hazırla ve test et.");
    else
      await expect(
        page.getByRole("textbox", { name: "Uzmanın adı" }),
      ).toHaveValue("Tasarım Uzmanı");
    const before = harness.requests.length;
    await page.locator("form").evaluate((node: HTMLFormElement) => {
      node.requestSubmit();
      node.requestSubmit();
    });
    await expect(
      page.getByRole("alert").filter({ hasText: /korunuyor/ }),
    ).toBeVisible();
    expect(harness.requests.length - before).toBe(1);
  }
});

test("validation opens collapsed advanced settings and focuses the missing model", async ({
  page,
}) => {
  await installStudioFixtures(page);
  await page.goto("/agents/new?template=ux_designer");
  await expect(page.getByRole("textbox", { name: "Uzmanın adı" })).toHaveValue(
    "Tasarım Uzmanı",
  );
  await page.getByText("Gelişmiş ayarlar", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Model seçimi", exact: true })
    .click();
  await page.getByRole("option", { name: "Modeli kendim seçeceğim" }).click();
  await page.getByText("Gelişmiş ayarlar", { exact: true }).click();
  await page.getByRole("button", { name: "Uzmanı ekle", exact: true }).click();
  await expect(
    page.getByText(
      "Araç kullanımını destekleyen kullanılabilir bir model seç.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Sabit model", exact: true }),
  ).toBeFocused();
});

test("guided project start fills an editable example and preserves the brief on failure", async ({
  page,
}) => {
  const harness = await installStudioFixtures(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bugün neyi birlikte başarmalıyız?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Bir web sitesi hazırla", exact: true })
    .click();
  const brief = page.getByRole("textbox", { name: "Üretmek istediğin sonuç" });
  await expect(brief).toBeFocused();
  await expect(brief).toHaveValue(/web sitesi/);
  await expect(
    page.getByRole("button", { name: "Ürün geliştir", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await brief.fill(
    "Müşterilerim için erişilebilir bir rezervasyon deneyimi hazırla.",
  );
  await brief.press("Enter");
  expect(harness.requests).toHaveLength(0);
  await page
    .getByRole("button", { name: "Projeyi başlat", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Taslağın korunuyor" }),
  ).toBeVisible();
  await expect(brief).toHaveValue(/rezervasyon deneyimi/);
  expect(harness.requests).toHaveLength(1);
  expect(harness.requests[0].body).toMatchObject({
    autonomyMode: "finite",
    priority: "normal",
  });
  expect([...harness.unexpected]).toEqual([]);
});

test("expert directory has clearable search, restorable filters and mobile overflow safety", async ({
  page,
}) => {
  const harness = await installStudioFixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents");
  await expect(
    page.getByRole("heading", { level: 1, name: "İşin için doğru uzman." }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Uzman ara" });
  await search.fill("tasarım");
  await expect(
    page.getByRole("link", { name: /Tasarım Uzmanı/ }).first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=/);
  await page.reload();
  await expect(search).toHaveValue("tasarım");
  await page
    .getByRole("button", { name: "Aramayı temizle", exact: true })
    .click();
  await expect(search).toBeFocused();
  await search.fill("hiçbir-sonuç-yok");
  await expect(
    page.getByText("Eşleşen uzman bulunamadı", { exact: true }),
  ).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect([...harness.unexpected]).toEqual([]);
});

test("new expert starts from a role, shows actionable validation and keeps values after a failed save", async ({
  page,
}) => {
  const harness = await installStudioFixtures(page);
  await page.goto("/agents/new?template=ux_designer");
  const name = page.getByRole("textbox", { name: "Uzmanın adı", exact: true });
  await expect(name).toHaveValue("Tasarım Uzmanı");
  await expect(
    page.getByRole("textbox", { name: "Uzmanlık alanı", exact: true }),
  ).toHaveValue("Tasarım");
  await name.fill("");
  await page.getByRole("button", { name: "Uzmanı ekle", exact: true }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await name.fill("Deniz");
  await page.getByRole("button", { name: "Uzmanı ekle", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Bilgilerin korunuyor" }),
  ).toBeVisible();
  await expect(name).toHaveValue("Deniz");
  expect(harness.requests[0].body).toMatchObject({
    name: "Deniz",
    department: "design",
    templateKey: "ux_designer",
    modelMode: "auto",
    permissions: { canUseSudo: false, canSpend: false },
  });
  expect([...harness.unexpected]).toEqual([]);
});

test("home and expert directory remain readable across themes, narrow viewports and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await installStudioFixtures(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of ["/", "/agents/new?template=ux_designer", "/agents"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Açık temaya geç" }).click();
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--primary"),
    ),
  ).toBe("");
  await expect(page.locator('a[href="/agents/1"]').first()).toHaveCSS(
    "color",
    "rgb(25, 35, 52)",
  );
  await expect(page.locator('a[href="/agents/1"]').first()).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await page.screenshot({
    path: "test-results/studio-experts-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Koyu temaya geç" }).click();
  await page.screenshot({
    path: "test-results/studio-experts-dark.png",
    fullPage: true,
  });
  await page.goto("/");
  await page.screenshot({
    path: "test-results/studio-home-dark.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
