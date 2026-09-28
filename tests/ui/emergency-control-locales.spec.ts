import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";

test("English emergency stop keeps the reason after failure and resumes only after confirmation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
  });
  const harness = await installStudioFixtures(page);
  let state = {
    emergencyStopEnabled: false,
    reason: null as string | null,
    version: 1,
    updatedBy: "test",
    updatedAt: "2026-09-26T09:00:00.000Z",
    blockedScopes: [] as string[],
  };
  const changes: Array<{ emergencyStopEnabled: boolean; reason?: string }> = [];
  await page.route("**/api/ops/control", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: state });
      return;
    }
    const input = route.request().postDataJSON() as {
      emergencyStopEnabled: boolean;
      reason?: string;
    };
    changes.push(input);
    if (changes.length === 1) {
      await route.fulfill({ status: 503, json: { error: "backend failure" } });
      return;
    }
    state = {
      ...state,
      emergencyStopEnabled: input.emergencyStopEnabled,
      reason: input.emergencyStopEnabled ? (input.reason ?? null) : null,
      version: state.version + 1,
      blockedScopes: input.emergencyStopEnabled
        ? ["agent_chat", "task_scheduler", "agent_tools", "approved_actions"]
        : [],
    };
    await route.fulfill({ json: state });
  });
  await page.goto("/projects/new");

  await page.getByRole("button", { name: "Emergency stop" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Stop all agent work" }),
  ).toBeVisible();
  const reason = dialog.getByRole("textbox", { name: "Reason for stopping" });
  const confirmStop = dialog.getByRole("button", {
    name: "Yes, stop all work",
  });
  await expect(confirmStop).toBeDisabled();
  await reason.fill("Unexpected browser action under review");
  await confirmStop.click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "The action could not be completed. Try again.",
  );
  await expect(reason).toHaveValue("Unexpected browser action under review");
  await confirmStop.click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Emergency stop is active.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unexpected browser action under review"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Resume work" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Resume agent work" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Yes, resume work" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Emergency stop is active.", { exact: true }),
  ).toBeHidden();
  expect(changes).toEqual([
    {
      emergencyStopEnabled: true,
      reason: "Unexpected browser action under review",
    },
    {
      emergencyStopEnabled: true,
      reason: "Unexpected browser action under review",
    },
    { emergencyStopEnabled: false },
  ]);
  expect([...harness.unexpected]).toEqual([]);
});

test("Arabic emergency stop dialog is usable at phone width", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
    localStorage.setItem("acos.color-mode.v2", "light");
  });
  const harness = await installStudioFixtures(page);
  await page.goto("/projects/new");

  const stop = page.getByRole("button", { name: "إيقاف طارئ" });
  const target = await stop.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await stop.click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "إيقاف عمل جميع الوكلاء" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "سبب الإيقاف" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "نعم، إيقاف جميع الأعمال" }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("arabic-emergency-light.png"),
    animations: "disabled",
  });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "إلغاء" }).click();
  await expect(dialog).toBeHidden();
  expect([...harness.unexpected]).toEqual([]);
});

test("emergency stop stays usable if the selected safety translation fails to load", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "ar");
  });
  const harness = await installStudioFixtures(page);
  await page.route("**/assets/emergency-ar-*.js", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/projects/new");

  await page.getByRole("button", { name: "Emergency stop" }).click();
  await expect(
    page.getByRole("alertdialog").getByRole("heading", {
      name: "Stop all agent work",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect([...harness.unexpected]).toEqual([]);
});
