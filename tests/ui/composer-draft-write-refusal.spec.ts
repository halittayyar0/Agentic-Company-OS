import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadHomeCopy } from "../../artifacts/agentic-company-os/src/lib/home-copy";
import { loadNewProjectCopy } from "../../artifacts/agentic-company-os/src/lib/new-project-copy";

for (const kind of ["home", "project"] as const) {
  test(`${kind} latest draft and unsaved warning survive readable stale storage`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("acos.locale.v1", "en"),
    );
    const fixture = await installStudioFixtures(page);
    const home = await loadHomeCopy("en"),
      project = await loadNewProjectCopy("en");
    await page.goto(kind === "home" ? "/" : "/projects/new");
    const field = page.getByRole("textbox", {
      name: kind === "home" ? home.desiredOutcome : project.brief,
      exact: true,
    });
    await field.fill("Earlier saved draft A");
    const key = `acos.composer-draft.v1:${kind}`;
    await expect
      .poll(() =>
        page.evaluate((k) => {
          const saved = JSON.parse(sessionStorage.getItem(k)!);
          return saved.prompt ?? saved.brief;
        }, key),
      )
      .toBe("Earlier saved draft A");
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("acos.composer-draft"))
          throw Error("write-only refusal");
        return original.call(this, key, value);
      };
    });
    await field.fill("Latest original job B must survive settings");
    const warning = page.getByRole("alert").filter({
      hasText:
        kind === "home" ? home.draftStorageError : project.draftStorageError,
    });
    await expect(warning).toBeVisible();
    await page.locator('a[href="/settings"]').last().click();
    await expect(page).toHaveURL(/\/settings$/);
    // Pending Suspense can hide a field without unmounting the composer.
    await expect(page.locator("select#settings-language")).toBeVisible();
    await expect(field).toHaveCount(0);
    await page.goBack();
    await expect(field).toHaveValue(
      "Latest original job B must survive settings",
    );
    await expect(warning).toBeVisible();
    expect(fixture.requests).toHaveLength(0);
  });
}
