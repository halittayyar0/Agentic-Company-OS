import {
  expect,
  type Page,
  type Locator,
  type TestInfo,
  type CDPSession,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";

export async function startLargeText(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Page.setFontSizes", {
    fontSizes: { standard: 32, fixed: 26 },
  });
  return session;
}

export async function finishLargeText(session: CDPSession) {
  await session.send("Page.setFontSizes", {
    fontSizes: { standard: 16, fixed: 13 },
  });
  await session.detach();
}

export async function inspectLargeTextSurface(
  page: Page,
  session: CDPSession,
  info: TestInfo,
  name: string,
  scope: Locator,
  fixed = false,
  allowScrollableRegions = false,
) {
  await expect(scope).toBeVisible();
  await scope.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe("32px");
  const measurements = await scope.evaluate((root, allowScrolling) => {
    const bounds = root.getBoundingClientRect();
    const visible = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
      (element) =>
        element.checkVisibility() && !element.classList.contains("sr-only"),
    );
    // Workspace tabs and named, keyboard-focusable timeline groups deliberately
    // scroll horizontally. Their own bounds and selected tab are checked below.
    const strips = new Set<HTMLElement>();
    if (allowScrolling) {
      for (const item of visible.filter((element) =>
        element.matches(
          '[role="tablist"], [role="group"][tabindex="0"][aria-label]',
        ),
      )) {
        let candidate: HTMLElement | null = item;
        while (candidate && candidate !== root) {
          if (
            ["auto", "scroll"].includes(getComputedStyle(candidate).overflowX)
          ) {
            strips.add(candidate);
            break;
          }
          candidate = candidate.parentElement;
        }
      }
    }
    const scrollRegion = (element: Element) =>
      Array.from(strips).find((strip) => strip.contains(element));
    const clippedText = new Map<Element, string>();
    return {
      rootFont: getComputedStyle(document.documentElement).fontSize,
      viewport: { width: innerWidth, height: innerHeight },
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      width: root.clientWidth,
      scrollWidth: root.scrollWidth,
      scrollRegions: Array.from(strips, (strip) => {
        const box = strip.getBoundingClientRect();
        const selected = strip.querySelector<HTMLElement>(
          '[role="tab"][aria-selected="true"]',
        );
        const selectedBox = selected?.getBoundingClientRect();
        return {
          x: box.left,
          right: box.right,
          selected: selectedBox
            ? { x: selectedBox.left, right: selectedBox.right }
            : null,
        };
      }),
      clippers: visible
        .filter((element) => {
          if (
            element.matches("input,textarea") ||
            element.classList.contains("truncate") ||
            strips.has(element)
          )
            return false;
          if (!(
            ["hidden", "auto", "scroll"].includes(
              getComputedStyle(element).overflowX,
            ) && element.scrollWidth > element.clientWidth + 1
          ))
            return false;
          // Test painted text, not intentionally clipped decorative shapes or
          // cmdk's inline visually-hidden accessibility label.
          if (getComputedStyle(element).clip !== "auto") return false;
          const clip = element.getBoundingClientRect();
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (
              !node.textContent?.trim() ||
              !parent?.checkVisibility() ||
              parent.closest('[aria-hidden="true"],.sr-only,.truncate') ||
              scrollRegion(parent) ||
              getComputedStyle(parent).clip !== "auto"
            )
              continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if (
              Array.from(range.getClientRects()).some(
                (box) => box.left < clip.left - 1 || box.right > clip.right + 1,
              )
            ) {
              clippedText.set(element, node.textContent.trim().slice(0, 160));
              return true;
            }
          }
          return false;
        })
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          text: element.innerText?.slice(0, 100),
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clippedText: clippedText.get(element),
        })),
      controls: visible
        .filter((element) =>
          element.matches(
            "button,a,input,textarea,[role=radio],[role=combobox]",
          ),
        )
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            text: element.innerText?.slice(0, 100),
            x: box.x,
            right: box.right,
            height: element.clientHeight,
            contentHeight: element.scrollHeight,
            width: element.clientWidth,
            contentWidth: element.scrollWidth,
            inScrollRegion: Boolean(scrollRegion(element)),
          };
        }),
    };
  }, allowScrollableRegions);
  await writeFile(
    info.outputPath(`${name}-measurements.json`),
    JSON.stringify({ test: info.title, state: name, ...measurements }, null, 2),
  );
  const capture = await session.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(
    info.outputPath(`${name}.png`),
    Buffer.from(capture.data, "base64"),
  );
  expect
    .soft(measurements.bounds.x, `${name}: starts inside viewport`)
    .toBeGreaterThanOrEqual(0);
  expect
    .soft(
      measurements.bounds.x + measurements.bounds.width,
      `${name}: ends inside viewport`,
    )
    .toBeLessThanOrEqual(measurements.viewport.width);
  expect
    .soft(measurements.scrollWidth, `${name}: horizontal content extent`)
    .toBeLessThanOrEqual(measurements.width);
  expect
    .soft(measurements.clippers, `${name}: nested clipped content`)
    .toEqual([]);
  expect
    .soft(
      measurements.controls.filter(
        (control) =>
          !control.inScrollRegion &&
          (control.x < 0 || control.right > measurements.viewport.width),
      ),
      `${name}: offscreen controls`,
    )
    .toEqual([]);
  for (const region of measurements.scrollRegions) {
    expect
      .soft(region.x, `${name}: scroll region starts in viewport`)
      .toBeGreaterThanOrEqual(-1);
    expect
      .soft(region.right, `${name}: scroll region ends in viewport`)
      .toBeLessThanOrEqual(measurements.viewport.width + 1);
    if (region.selected) {
      expect
        .soft(
          region.selected.x,
          `${name}: selected tab starts inside its strip`,
        )
        .toBeGreaterThanOrEqual(region.x - 1);
      expect
        .soft(
          region.selected.right,
          `${name}: selected tab ends inside its strip`,
        )
        .toBeLessThanOrEqual(region.right + 1);
    }
  }
  expect
    .soft(
      measurements.controls.filter(
        (control) =>
          control.tag === "BUTTON" &&
          (control.contentHeight > control.height + 1 ||
            control.contentWidth > control.width + 1),
      ),
      `${name}: clipped button labels`,
    )
    .toEqual([]);
  if (fixed) {
    expect
      .soft(measurements.bounds.y, `${name}: top visible`)
      .toBeGreaterThanOrEqual(0);
    expect
      .soft(
        measurements.bounds.y + measurements.bounds.height,
        `${name}: bottom visible`,
      )
      .toBeLessThanOrEqual(measurements.viewport.height);
  }
  for (const control of await scope
    .getByRole("button")
    .or(scope.getByRole("radio"))
    .or(scope.getByRole("combobox"))
    .or(scope.getByRole("textbox"))
    .all()) {
    await expect
      .soft(control, `${name}: accessible name`)
      .toHaveAccessibleName(/\S/);
  }
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe("32px");
}
