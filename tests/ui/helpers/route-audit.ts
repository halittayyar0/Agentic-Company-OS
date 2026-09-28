import {
  expect,
  type Page,
  type TestInfo,
  type Locator,
  type CDPSession,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
import {
  LOCALES,
  type Locale,
} from "../../../artifacts/agentic-company-os/src/lib/i18n";
import { startLargeText, inspectLargeTextSurface } from "./large-text-audit";

export type RouteAuditVariant = {
  locale: Locale;
  theme: "light" | "dark";
  screen: "phone" | "desktop";
  largeText?: boolean;
};
export const routeAuditMatrix: RouteAuditVariant[] = LOCALES.flatMap((locale) =>
  (["light", "dark"] as const).flatMap((theme) =>
    (["phone", "desktop"] as const).map((screen) => ({
      locale,
      theme,
      screen,
    })),
  ),
);
routeAuditMatrix.push(
  ...LOCALES.flatMap((locale) =>
    (["light", "dark"] as const).map((theme): RouteAuditVariant => ({
      locale,
      theme,
      screen: "phone",
      largeText: true,
    })),
  ),
  { locale: "en", theme: "dark", screen: "desktop", largeText: true },
  { locale: "de", theme: "light", screen: "desktop", largeText: true },
  { locale: "ar", theme: "dark", screen: "desktop", largeText: true },
);
const largeTextSessions = new WeakMap<Page, CDPSession>();
const auditedStrips = new WeakMap<Page, Set<string>>();

export async function inspectReadableLabel(
  scope: Locator,
  text: string,
  maximumLines = 2,
) {
  const lines = await scope.evaluate((element, value) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(value) ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + value.length);
      return new Set(
        Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
      ).size;
    }
    return 0;
  }, text);
  expect.soft(lines, `${text}: painted text present`).toBeGreaterThan(0);
  expect
    .soft(lines, `${text}: readable line length`)
    .toBeLessThanOrEqual(maximumLines);
}

async function inspectStripKeyboard(page: Page, info: TestInfo, name: string) {
  const checked = auditedStrips.get(page) ?? new Set<string>();
  auditedStrips.set(page, checked);
  const evidence: { label: string; keyboard: string }[] = [];
  // Inner surfaces first: activating an outer tab can unmount its contents.
  const labels = await page
    .getByRole("tablist")
    .evaluateAll((lists) =>
      lists.map((list) => list.getAttribute("aria-label")!),
    );
  for (const label of labels.reverse()) {
    if (checked.has(label)) continue;
    const list = page.getByRole("tablist", { name: label, exact: true });
    const tabs = list.getByRole("tab").and(list.locator(":not([disabled])"));
    const originalId = await list
      .locator('[role="tab"][aria-selected="true"]')
      .getAttribute("id");
    const original = list.locator(`[id=${JSON.stringify(originalId)}]`);
    await original.focus();
    for (const [key, target] of [
      ["End", tabs.last()],
      ["Home", tabs.first()],
    ] as const) {
      await page.keyboard.press(key);
      await expect(target).toBeFocused();
      await expect
        .poll(
          () =>
            target.evaluate((element) => {
              let strip: HTMLElement | null = element.parentElement;
              while (
                strip &&
                !["auto", "scroll"].includes(getComputedStyle(strip).overflowX)
              )
                strip = strip.parentElement;
              if (!strip) return true;
              const item = element.getBoundingClientRect();
              const bounds = strip.getBoundingClientRect();
              return (
                item.left >= bounds.left - 1 && item.right <= bounds.right + 1
              );
            }),
          { message: `${label}: ${key} tab fully visible` },
        )
        .toBe(true);
    }
    await original.focus();
    await page.keyboard.press("Enter");
    await expect(original).toHaveAttribute("aria-selected", "true");
    checked.add(label);
    evidence.push({
      label,
      keyboard:
        "End, Home, Enter; focus and visibility; original selection restored",
    });
  }
  for (const group of await page
    .locator('[role="group"][tabindex="0"][aria-label]:visible')
    .all()) {
    const label = (await group.getAttribute("aria-label"))!;
    if (checked.has(label)) continue;
    const metrics = await group.evaluate((element) => ({
      overflow:
        ["auto", "scroll"].includes(getComputedStyle(element).overflowX) &&
        element.scrollWidth > element.clientWidth + 1,
      rtl: getComputedStyle(element).direction === "rtl",
      before: element.scrollLeft,
    }));
    if (!metrics.overflow) continue;
    await group.focus();
    await expect(group).toBeFocused();
    await group.press(metrics.rtl ? "ArrowLeft" : "ArrowRight");
    await expect
      .poll(() => group.evaluate((element) => element.scrollLeft))
      .not.toBe(metrics.before);
    await group.evaluate(
      (element, left) => element.scrollTo({ left, behavior: "instant" }),
      metrics.before,
    );
    checked.add(label);
    evidence.push({
      label,
      keyboard: "directional arrow scroll; offset restored",
    });
  }
  await writeFile(
    info.outputPath(`${name}-keyboard.json`),
    JSON.stringify(evidence, null, 2),
  );
}

export async function prepareRouteAudit(
  page: Page,
  variant: RouteAuditVariant,
) {
  await page.setViewportSize(
    variant.screen === "phone"
      ? { width: 320, height: 740 }
      : { width: 1366, height: 900 },
  );
  await page.emulateMedia({ colorScheme: variant.theme });
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem("acos.locale.v1", locale);
    localStorage.setItem("acos.color-mode.v2", theme);
  }, variant);
  if (variant.largeText)
    largeTextSessions.set(page, await startLargeText(page));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export async function inspectRoute(
  page: Page,
  info: TestInfo,
  name: string,
  variant: RouteAuditVariant,
  scope?: Locator,
  capture = true,
) {
  const { locale, theme, screen } = variant;
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute(
    "dir",
    locale === "ar" ? "rtl" : "ltr",
  );
  await expect(page.locator("html")).toHaveClass(new RegExp(theme));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector("main > div.overflow-auto")?.scrollTo({ top: 0 });
  });
  const main = scope ?? page.locator("main");
  const controls = main
    .getByRole("button")
    .or(main.getByRole("link"))
    .or(main.getByRole("textbox"))
    .or(main.getByRole("searchbox"))
    .or(main.getByRole("combobox"))
    .or(main.getByRole("switch"))
    .or(main.getByRole("checkbox"))
    .or(main.getByRole("radio"))
    .or(main.getByRole("tab"))
    .or(main.getByRole("spinbutton"))
    .or(main.locator("summary:visible"));
  for (const control of await controls.all()) {
    await expect
      .soft(control, `${name}: accessible control name`)
      .toHaveAccessibleName(/\S/);
  }
  const controlSizes = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      // Associated labels are also clickable. Radix's hidden bubble
      // inputs and collapsed-details descendants are not role matches.
      const labels =
        "labels" in element
          ? Array.from((element as HTMLInputElement).labels ?? [])
          : [];
      const labelBounds = labels
        .map((label) => label.getBoundingClientRect())
        .filter((box) => box.width && box.height);
      return {
        tag: element.tagName,
        label: (
          element.getAttribute("aria-label") ||
          (element as HTMLElement).innerText ||
          element.id ||
          ""
        ).slice(0, 100),
        width: Math.max(bounds.width, ...labelBounds.map((box) => box.width)),
        height: Math.max(
          bounds.height,
          ...labelBounds.map((box) => box.height),
        ),
      };
    }),
  );
  const measurements = await page.evaluate((controls) => {
    const ids = Array.from(
      document.querySelectorAll("[id]"),
      (element) => element.id,
    );
    return {
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      controls,
    };
  }, controlSizes);
  await info.attach(`${name}-measurements`, {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  await writeFile(
    info.outputPath(
      `${name}-${variant.largeText ? "controls" : "measurements"}.json`,
    ),
    JSON.stringify(measurements, null, 2),
  );
  expect
    .soft(measurements.scrollWidth, `${name}: horizontal overflow`)
    .toBeLessThanOrEqual(measurements.viewport);
  expect.soft(measurements.duplicateIds, `${name}: duplicate IDs`).toEqual([]);
  const minimum = screen === "phone" ? 28 : 20;
  expect
    .soft(
      measurements.controls.filter(
        (control) =>
          control.width < minimum - 0.5 || control.height < minimum - 0.5,
      ),
      `${name}: controls below the HIG minimum`,
    )
    .toEqual([]);
  if (!capture) return;
  if (variant.largeText) {
    const session = largeTextSessions.get(page)!;
    await inspectLargeTextSurface(
      page,
      session,
      info,
      name,
      scope ?? main.locator(":scope > div.overflow-auto"),
      Boolean(scope),
      true,
    );
    // Preserve the bottom of long pages without resetting font preferences.
    const scroller = scope ?? main.locator(":scope > div.overflow-auto");
    await scroller.evaluate((element) =>
      element.scrollTo({ top: element.scrollHeight }),
    );
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const bottom = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      info.outputPath(`${name}-bottom.png`),
      Buffer.from(bottom.data, "base64"),
    );
    await scroller.evaluate((element) =>
      element.scrollTo({
        top: (element.scrollHeight - element.clientHeight) / 2,
      }),
    );
    await page.evaluate(() =>
      window.scrollTo(
        0,
        (document.documentElement.scrollHeight - innerHeight) / 2,
      ),
    );
    const middle = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      info.outputPath(`${name}-middle.png`),
      Buffer.from(middle.data, "base64"),
    );
    const panels = main.getByRole("tabpanel");
    for (const [index, panel] of (await panels.all()).entries()) {
      await panel.evaluate((element) =>
        element.scrollIntoView({ block: "start", inline: "nearest" }),
      );
      const image = await session.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      await writeFile(
        info.outputPath(`${name}-panel-${index + 1}.png`),
        Buffer.from(image.data, "base64"),
      );
    }
    await inspectStripKeyboard(page, info, name);
    return;
  }
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
  // Desktop pages scroll inside the shell, so fullPage alone only
  // captures the initial viewport. Preserve overlapping segments too.
  if (screen === "desktop") {
    const scroller = scope ?? main.locator(":scope > div.overflow-auto");
    const extent = await scroller.evaluate((element) => ({
      maximum: element.scrollHeight - element.clientHeight,
      step: Math.max(1, element.clientHeight - 80),
    }));
    for (
      let top = extent.step, segment = 1;
      top < extent.maximum + extent.step;
      top += extent.step, segment++
    ) {
      await scroller.evaluate(
        (element, value) => element.scrollTo({ top: value }),
        Math.min(top, extent.maximum),
      );
      await page.screenshot({
        path: info.outputPath(`${name}-scroll-${segment}.png`),
      });
    }
  }
}
