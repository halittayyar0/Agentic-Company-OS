import { expect, test } from "@playwright/test";
import { inspectRoute } from "./helpers/route-audit";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";
import { LOCALES } from "../../artifacts/agentic-company-os/src/lib/i18n";

const surfaces = [
  ["home", "/"],
  ["directory", "/agents"],
  ["new-expert", "/agents/new"],
  ["projects-empty", "/projects"],
  ["new-project", "/projects/new"],
  ["skills", "/skills"],
  ["approvals-empty", "/approvals"],
  ["not-found", "/missing-route-for-acceptance"],
] as const;

// Shared layout/semantics evidence complements the route-specific mutation and
// recovery suites. Screenshots still require inspection; this is not a native
// phone, screen-reader or language-speaker acceptance test.
for (const locale of LOCALES) {
  for (const theme of ["light", "dark"] as const) {
    for (const screen of ["phone", "desktop"] as const) {
      test(`${locale} ${theme} ${screen}: primary routes retain readable structure`, async ({
        page,
      }, info) => {
        test.setTimeout(90_000);
        const variant = { locale, theme, screen };
        await page.setViewportSize(
          screen === "phone"
            ? { width: 320, height: 740 }
            : { width: 1366, height: 900 },
        );
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript(
          (value) => localStorage.setItem("acos.locale.v1", value),
          locale,
        );
        const harness = await installStudioFixtures(page);
        await page.route("**/api/skills?*", (route) =>
          route.fulfill({ json: getCapabilityCatalog(locale) }),
        );
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        for (const [name, path] of surfaces) {
          await test.step(name, async () => {
            await page.goto(path);
            await expect(page.locator("main h1")).toHaveCount(1);
            await expect(page.locator("main h1")).toBeVisible();
            await page.evaluate(() => document.fonts.ready);
            await expect(page.locator("html")).toHaveAttribute("lang", locale);
            await expect(page.locator("html")).toHaveAttribute(
              "dir",
              locale === "ar" ? "rtl" : "ltr",
            );
            await expect(page.locator("html")).toHaveClass(new RegExp(theme));

            await inspectRoute(page, info, name, variant);
          });
        }
        expect(pageErrors).toEqual([]);
        expect([...harness.unexpected]).toEqual([]);
        expect(harness.requests).toHaveLength(0);
      });
    }
  }
}
