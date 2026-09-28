import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";
import { LOCALES } from "../../artifacts/agentic-company-os/src/lib/i18n";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import {
  inspectRoute,
  prepareRouteAudit,
  type RouteAuditVariant,
} from "./helpers/route-audit";

test("Russian project heading wraps with a wide platform font at 200 percent", async ({
  page,
}) => {
  await prepareRouteAudit(page, {
    locale: "ru",
    theme: "light",
    screen: "phone",
  });
  await installStudioFixtures(page);
  const session = await page.context().newCDPSession(page);
  await session.send("Page.setFontSizes", {
    fontSizes: { standard: 32, fixed: 26 },
  });
  try {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle");
    const heading = page.getByRole("heading", { name: "Проекты", exact: true });
    await expect(heading).toBeVisible();
    // A wider system family makes the fallback-font regression independent of OS.
    await heading.evaluate((element) => {
      element.style.fontFamily = "Verdana, sans-serif";
    });
    await expect
      .poll(() =>
        heading.evaluate((element) => getComputedStyle(element).fontSize),
      )
      .toBe("72px");
    await expect
      .poll(() =>
        page
          .locator("main > div.overflow-auto")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      )
      .toBe(0);
    const paintedTextFits = await heading.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects()).every(
        (rect) => rect.left >= bounds.left && rect.right <= bounds.right,
      );
    });
    expect(paintedTextFits).toBe(true);
  } finally {
    await session.detach();
  }
});

const variants: RouteAuditVariant[] = [
  ...LOCALES.map((locale): RouteAuditVariant => ({
    locale,
    theme: locale === "ar" ? "dark" : "light",
    screen: "phone",
  })),
  { locale: "en", theme: "dark", screen: "desktop" },
  { locale: "ar", theme: "dark", screen: "desktop" },
  { locale: "de", theme: "light", screen: "desktop" },
];
const routes = [
  ["home", "/"],
  ["directory", "/agents"],
  ["new-expert", "/agents/new"],
  ["projects-empty", "/projects"],
  ["new-project", "/projects/new"],
  ["skills", "/skills"],
  ["approvals-empty", "/approvals"],
  ["not-found", "/missing-route-for-acceptance"],
] as const;

for (const variant of variants) {
  test(`default text 200% ${variant.locale} ${variant.theme} ${variant.screen}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const errors = await prepareRouteAudit(page, variant);
    const harness = await installStudioFixtures(page);
    await page.route("**/api/skills?*", (route) =>
      route.fulfill({ json: getCapabilityCatalog(variant.locale) }),
    );
    const session = await page.context().newCDPSession(page);
    // Change the browser's default font preference, not page CSS or pinch zoom.
    // Fixed-pixel text can remain unchanged; captures must be checked for that too.
    await session.send("Page.setFontSizes", {
      fontSizes: { standard: 32, fixed: 26 },
    });
    try {
      async function inspectLargeText(name: string) {
        await expect(page.locator("main h1")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect
          .poll(() =>
            page.evaluate(
              () => getComputedStyle(document.documentElement).fontSize,
            ),
          )
          .toBe("32px");
        // CDP captures do not let the Playwright screenshot helper temporarily
        // reset emulation preferences while sizing a full-page image.
        const screenshot = await session.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        await writeFile(
          info.outputPath(`large-text-${name}-viewport.png`),
          Buffer.from(screenshot.data, "base64"),
        );
        await expect
          .poll(() =>
            page.evaluate(
              () => getComputedStyle(document.documentElement).fontSize,
            ),
          )
          .toBe("32px");
        const header = page.locator("main > header");
        for (const action of await header.getByRole("button").all()) {
          const bounds = await action.boundingBox();
          expect
            .soft(bounds!.x, "header action starts inside the viewport")
            .toBeGreaterThanOrEqual(0);
          expect
            .soft(
              bounds!.x + bounds!.width,
              "header action ends inside the viewport",
            )
            .toBeLessThanOrEqual((await page.viewportSize())!.width);
        }
        const content = await page
          .locator("main > div.overflow-auto")
          .evaluate((element) => ({
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
        expect
          .soft(
            content.scrollWidth,
            `${name}: content has no horizontal clipping`,
          )
          .toBeLessThanOrEqual(content.width);
        if (content.scrollWidth > content.width) {
          const overflow = await page
            .locator("main > div.overflow-auto")
            .evaluate((root) => {
              const bounds = root.getBoundingClientRect();
              return Array.from(root.querySelectorAll("*")).flatMap(
                (element) => {
                  const box = element.getBoundingClientRect();
                  if (
                    !element.checkVisibility() ||
                    !box.width ||
                    !box.height ||
                    (box.left >= bounds.left && box.right <= bounds.right)
                  )
                    return [];
                  return [
                    {
                      tag: element.tagName,
                      class: element.getAttribute("class"),
                      text: element.textContent?.slice(0, 100),
                      x: box.left,
                      right: box.right,
                      width: box.width,
                    },
                  ];
                },
              );
            });
          await writeFile(
            info.outputPath(`large-text-${name}-overflow.json`),
            JSON.stringify(overflow, null, 2),
          );
        }
        await inspectRoute(
          page,
          info,
          `large-text-${name}`,
          variant,
          undefined,
          false,
        );
        const heading = await page
          .locator("main h1")
          .evaluate((element) => getComputedStyle(element).fontSize);
        const typography = await page.evaluate(() => ({
          root: getComputedStyle(document.documentElement).fontSize,
          controls: Array.from(
            document.querySelectorAll("main input, main textarea, main button"),
          )
            .filter((element) => element.checkVisibility())
            .map((element) => ({
              tag: element.tagName,
              name:
                element.getAttribute("aria-label") ??
                element.textContent?.slice(0, 80),
              fontSize: getComputedStyle(element).fontSize,
            })),
        }));
        await writeFile(
          info.outputPath(`large-text-${name}-typography.json`),
          JSON.stringify(
            { typography: { ...typography, heading }, content },
            null,
            2,
          ),
        );
        await page.evaluate(async () => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          const scroller = document.querySelector("main > div.overflow-auto");
          scroller?.scrollTo({ top: scroller.scrollHeight });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        });
        const bottom = await session.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        await writeFile(
          info.outputPath(`large-text-${name}-bottom.png`),
          Buffer.from(bottom.data, "base64"),
        );
        expect(
          await page.evaluate(
            () => getComputedStyle(document.documentElement).fontSize,
          ),
        ).toBe("32px");
      }
      for (const [name, path] of routes) {
        await test.step(name, async () => {
          await page.goto(path);
          // These read-only fixtures have no long-lived requests. Wait for the
          // route's lazy copy/catalog chunks, including transient Suspense remounts.
          await page.waitForLoadState("networkidle");
          await expect(page.locator("main h1")).toBeVisible();
          await inspectLargeText(name);
          if (name === "new-expert" || name === "skills") {
            const advanced = page.locator("main details").first();
            const toggle = advanced.locator(":scope > summary");
            await toggle.focus();
            await toggle.press("Enter");
            await expect(advanced).toHaveAttribute("open", "");
            await expect(toggle).toBeFocused();
            await inspectLargeText(`${name}-expanded`);
            if (name === "new-expert") {
              await toggle.focus();
              await page.keyboard.press("Tab");
              await expect(advanced.getByRole("combobox")).toBeFocused();
              const modelValue = await advanced
                .getByRole("combobox")
                .locator(":scope > span")
                .first()
                .evaluate((element) => ({
                  text: element.textContent,
                  width: element.clientWidth,
                  contentWidth: element.scrollWidth,
                  height: element.clientHeight,
                  contentHeight: element.scrollHeight,
                }));
              await writeFile(
                info.outputPath("large-text-selected-model.json"),
                JSON.stringify(modelValue, null, 2),
              );
              expect
                .soft(
                  modelValue.contentWidth,
                  "selected model label is not horizontally clipped",
                )
                .toBeLessThanOrEqual(modelValue.width);
              expect
                .soft(
                  modelValue.contentHeight,
                  "selected model label is not vertically clipped",
                )
                .toBeLessThanOrEqual(modelValue.height);
              await page.keyboard.press("Tab");
              const firstSwitch = advanced.getByRole("switch").first();
              await expect(firstSwitch).toBeFocused();
              const bounds = (await firstSwitch.boundingBox())!;
              expect(bounds.x).toBeGreaterThanOrEqual(0);
              expect(bounds.y).toBeGreaterThanOrEqual(0);
              expect(bounds.x + bounds.width).toBeLessThanOrEqual(
                page.viewportSize()!.width,
              );
              expect(bounds.y + bounds.height).toBeLessThanOrEqual(
                page.viewportSize()!.height,
              );
              const focusCapture = await session.send(
                "Page.captureScreenshot",
                {
                  format: "png",
                  captureBeyondViewport: false,
                },
              );
              await writeFile(
                info.outputPath("large-text-expert-switch-focus.png"),
                Buffer.from(focusCapture.data, "base64"),
              );
              expect(
                await page.evaluate(
                  () => getComputedStyle(document.documentElement).fontSize,
                ),
              ).toBe("32px");
            }
          }
        });
      }
      expect([...harness.unexpected]).toEqual([]);
      expect(harness.requests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await session.send("Page.setFontSizes", {
        fontSizes: { standard: 16, fixed: 13 },
      });
      await session.detach();
    }
  });
}
