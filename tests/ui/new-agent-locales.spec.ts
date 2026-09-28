import { expect, test } from "@playwright/test";
import { AGENT_TEMPLATES } from "../../artifacts/api-server/src/lib/agent-templates";
import { installStudioFixtures } from "./helpers/studio-fixtures";

test("English expert creation retries the role catalog and preserves edited identity and permissions after a failed save", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let catalogFails = true;
  const packs: string[] = [];
  page.on("request", (request) => {
    const file = new URL(request.url()).pathname.split("/").at(-1)!;
    if (file.startsWith("new-expert-") && file.endsWith(".js"))
      packs.push(file);
  });
  await page.route("**/api/agent-templates**", (route) =>
    route.fulfill({
      status: catalogFails ? 503 : 200,
      json: catalogFails ? { error: "offline" } : AGENT_TEMPLATES,
    }),
  );
  await page.goto("/agents/new?template=ux_designer");
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not load expertise." }),
  ).toBeVisible();
  const name = page.getByRole("textbox", { name: "Expert name", exact: true });
  await name.fill("Deniz / فريق");
  catalogFails = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Responsibility", exact: true }),
  ).toHaveValue("Design Expert");
  await page.getByRole("button", { name: /Quality Expert/ }).click();
  await expect(name).toHaveValue("Deniz / فريق");
  await expect(
    page.getByRole("textbox", { name: "Area of expertise", exact: true }),
  ).toHaveValue("Quality");
  await page.getByText("Advanced settings", { exact: true }).click();
  await page
    .getByRole("switch", { name: "Research information online", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Add expert", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Your entries are preserved." }),
  ).toBeVisible();
  await expect(name).toHaveValue("Deniz / فريق");
  await expect(
    page.getByRole("switch", {
      name: "Research information online",
      exact: true,
    }),
  ).not.toBeChecked();
  expect(harness.requests).toHaveLength(1);
  expect(harness.requests[0].body).toMatchObject({
    name: "Deniz / فريق",
    role: "Quality Expert",
    department: "quality",
    templateKey: "quality_engineer",
    modelMode: "auto",
    permissions: { canBrowse: false, canUseSudo: false },
  });
  expect(harness.requests[0].body).not.toHaveProperty("systemPrompt");
  expect(packs.length).toBeGreaterThan(0);
  expect(packs.every((file) => file.startsWith("new-expert-en-"))).toBe(true);
  expect([...harness.unexpected]).toEqual([]);
});

test("manual model selection explains unsupported models, retries the catalog and validates collapsed settings", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installStudioFixtures(page);
  let offline = true;
  const model = {
    id: "demo:free",
    label: "Demo tool model",
    provider: "openrouter",
    tier: "economy",
    supportsTools: true,
    isDefault: true,
    description: "Original description",
    contextWindow: 32000,
  };
  await page.route("**/api/model-catalog", (route) =>
    route.fulfill({
      status: offline ? 503 : 200,
      json: offline
        ? { error: "offline" }
        : {
            providers: [
              { id: "openrouter", label: "OpenRouter", available: true },
              { id: "openai", label: "OpenAI", available: false },
            ],
            models: [
              model,
              {
                ...model,
                id: "chat-only",
                label: "Chat only model",
                supportsTools: false,
              },
              {
                ...model,
                id: "not-connected",
                label: "Disconnected model",
                provider: "openai",
              },
            ],
          },
    }),
  );
  await page.goto("/agents/new?template=ux_designer");
  await expect(
    page.getByRole("textbox", { name: "Expert name", exact: true }),
  ).toHaveValue("Design Expert");
  await page.getByText("Advanced settings", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Model selection", exact: true })
    .click();
  await page.getByRole("option", { name: "Choose a model myself" }).click();
  await expect(
    page.getByText("Could not load the model catalog.", { exact: true }),
  ).toBeVisible();
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByRole("button", { name: "Add expert", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Fixed model", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText("Choose an available model that supports agent tools.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(harness.requests).toHaveLength(0);
  offline = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Chat only model/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Disconnected model/ }),
  ).toBeDisabled();
  const search = page.getByRole("searchbox", {
    name: "Search the fixed model catalog",
  });
  await search.fill("DEMO FREE");
  const choice = page.getByRole("button", { name: /Demo tool model/ });
  await expect(choice).toBeEnabled();
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  // Remounting an expired catalog keeps the selection visible but cannot
  // authorize it from a failed refresh.
  await page.clock.install();
  await page.clock.fastForward(61_000);
  offline = true;
  await page
    .getByRole("combobox", { name: "Model selection", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Automatic selection (recommended)" })
    .click();
  await page
    .getByRole("combobox", { name: "Model selection", exact: true })
    .click();
  await page.getByRole("option", { name: "Choose a model myself" }).click();
  await expect(
    page.getByText(
      "Could not refresh the model catalog. Retry to confirm availability before selecting a model.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await expect(choice).toBeDisabled();
  await page.getByRole("button", { name: "Add expert", exact: true }).click();
  expect(harness.requests).toHaveLength(0);
  offline = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(choice).toBeEnabled();
  await page.getByRole("button", { name: "Add expert", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Your entries are preserved." }),
  ).toBeVisible();
  expect(harness.requests).toHaveLength(1);
  expect(harness.requests[0].body).toMatchObject({
    modelMode: "manual",
    modelId: "demo:free",
  });
  expect([...harness.unexpected]).toEqual([]);
});

test("Arabic expert creation supports narrow RTL controls and retains custom instructions", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
    localStorage.setItem("acos.color-mode.v2", "light");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/agents/new?template=ux_designer");
  const name = page.getByRole("textbox", { name: "اسم الخبير", exact: true });
  await expect(name).toHaveValue("خبير التصميم");
  const parent = page.getByRole("combobox", { name: "إلى من يرفع تقاريره؟" });
  await parent.click();
  await expect(page.getByRole("listbox")).toHaveAttribute("dir", "rtl");
  await page.getByRole("option", { name: "إليّ مباشرة", exact: true }).click();
  await expect(parent).toBeFocused();
  await page
    .locator('section[aria-labelledby="expert-specialty-heading"]')
    .screenshot({ path: testInfo.outputPath("arabic-new-expert.png") });
  await page.getByText("الإعدادات المتقدمة", { exact: true }).click();
  const custom = page.getByRole("switch", {
    name: "سأكتب تعليمات العمل بنفسي",
  });
  await custom.check();
  const rail = (await custom.boundingBox())!;
  const thumb = (await custom.locator("span").boundingBox())!;
  expect(thumb.x).toBeGreaterThanOrEqual(rail.x);
  expect(thumb.x + thumb.width).toBeLessThanOrEqual(rail.x + rail.width);
  const prompt = page.getByRole("textbox", {
    name: "تعليمات العمل",
    exact: true,
  });
  await prompt.fill(
    "اختبر جودة الملفات وسجل الأدلة كما هي دون تغيير أسماء الملفات.",
  );
  await name.fill("نور / Deniz");
  await page.getByRole("button", { name: "إضافة الخبير", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "لم تفقد البيانات" }),
  ).toBeVisible();
  await expect(prompt).toHaveValue(
    "اختبر جودة الملفات وسجل الأدلة كما هي دون تغيير أسماء الملفات.",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  expect(harness.requests[0].body).toMatchObject({
    name: "نور / Deniz",
    systemPrompt:
      "اختبر جودة الملفات وسجل الأدلة كما هي دون تغيير أسماء الملفات.",
    permissions: { canUseSudo: false },
  });
  expect(harness.requests[0].body).not.toHaveProperty("templateKey");
  expect([...harness.unexpected]).toEqual([]);
});

test("Traditional Chinese expert creation recovers a failed language asset with the chosen template", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("acos.locale.v1", "zh-TW"),
  );
  await installStudioFixtures(page);
  await page.route("**/new-expert-zh-TW-*.js", (route) => route.abort());
  await page.goto("/agents/new?template=quality_engineer");
  await expect(
    page.getByRole("heading", { name: "無法載入新增專家頁面的語言檔案。" }),
  ).toBeVisible();
  await page.unroute("**/new-expert-zh-TW-*.js");
  await page.getByRole("button", { name: "重新檢查", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "專家名稱", exact: true }),
  ).toHaveValue("品質專家");
  await expect(page).toHaveURL(/template=quality_engineer/);
});

for (const [locale, title, name, submit, validation] of [
  [
    "de",
    "Einen Experten hinzufügen.",
    "Name des Experten",
    "Experten hinzufügen",
    "Der Name muss mindestens 2 Zeichen enthalten.",
  ],
  [
    "ru",
    "Добавьте нового эксперта.",
    "Имя эксперта",
    "Добавить эксперта",
    "Имя эксперта должно содержать не менее 2 символов.",
  ],
  [
    "zh-CN",
    "添加新专家。",
    "专家名称",
    "添加专家",
    "专家名称至少需要 2 个字符。",
  ],
] as const) {
  test(`${locale} expert form validates in the selected language on a phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const harness = await installStudioFixtures(page);
    await page.goto("/agents/new");
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.getByRole("textbox", { name, exact: true }).fill("A");
    await page.getByRole("button", { name: submit, exact: true }).click();
    await expect(page.getByText(validation, { exact: true })).toBeVisible();
    expect(harness.requests).toHaveLength(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
  });
}
