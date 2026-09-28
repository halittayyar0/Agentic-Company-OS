import { expect, test } from "@playwright/test";
import {
  LANGUAGE_OPTIONS,
  LOCALES,
  loadShellMessages,
  setupMessages,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadAuthCopy } from "../../artifacts/agentic-company-os/src/lib/auth-copy";
import { loadEmergencyControlCopy } from "../../artifacts/agentic-company-os/src/lib/emergency-control-copy";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import {
  startLargeText,
  finishLargeText,
  inspectLargeTextSurface,
} from "./helpers/large-text-audit";

test.use({ storageState: { cookies: [], origins: [] } });

const variants = [
  ...LOCALES.flatMap((locale) =>
    (["light", "dark"] as const).map((theme) => ({
      locale,
      theme,
      screen: "phone" as const,
    })),
  ),
  ...(["en", "de", "ar"] as const).map((locale) => ({
    locale,
    theme: locale === "de" ? ("light" as const) : ("dark" as const),
    screen: "desktop" as const,
  })),
];

for (const { locale, theme, screen } of variants) {
  const viewport =
    screen === "phone"
      ? { width: 320, height: 560 }
      : { width: 1366, height: 900 };
  test(`large text ${locale} ${theme} ${screen}: first run, unavailable session and sign-in recovery`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.addInitScript(
      (value) => localStorage.setItem("acos.color-mode.v2", value),
      theme,
    );
    const harness = await installStudioFixtures(page);
    let mode: "pending" | "down" | "login" | "authenticated" = "pending";
    let releaseStatus!: () => void;
    const statusReady = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    let attempts = 0;
    const protectedBeforeLogin: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        mode !== "authenticated" &&
        path.startsWith("/api/") &&
        !path.startsWith("/api/auth/")
      )
        protectedBeforeLogin.push(path);
    });
    await page.route("**/api/auth/status", async (route) => {
      if (mode === "pending") await statusReady;
      return mode === "down"
        ? route.fulfill({ status: 503, json: { error: "fixture offline" } })
        : route.fulfill({
            json: {
              enabled: true,
              authenticated: mode === "authenticated",
              sessionExpiresAt: null,
            },
          });
    });
    await page.route("**/api/auth/login", (route) => {
      attempts++;
      if (attempts === 1)
        return route.fulfill({ status: 401, json: { error: "invalid" } });
      mode = "authenticated";
      return route.fulfill({ status: 204 });
    });
    const session = await startLargeText(page);
    const auth = await loadAuthCopy(locale);
    const shell = await loadShellMessages(locale);
    try {
      await page.goto("/");
      const option = LANGUAGE_OPTIONS.find((option) => option.code === locale)!;
      await page.getByRole("radio").first().focus();
      for (let index = 0; index < LANGUAGE_OPTIONS.indexOf(option); index++) {
        await page.keyboard.press("ArrowDown");
      }
      await expect(
        page.getByRole("radio", { name: new RegExp(option.nativeName) }),
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        page.getByRole("heading", {
          name: setupMessages[locale].chooseLanguage,
        }),
      ).toBeVisible();
      expect
        .soft(
          await page.locator("main").getAttribute("lang"),
          "language preview announces its selected language",
        )
        .toBe(locale);
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "language-choice",
        page.locator("main"),
      );
      await page
        .getByRole("button", {
          name: setupMessages[locale].continue,
          exact: true,
        })
        .click();
      await expect(page.locator("main[role=status]")).toBeVisible();
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "session-loading",
        page.locator("main[role=status]"),
      );
      mode = "down";
      releaseStatus();
      await expect(
        page.getByRole("heading", {
          name: auth.serviceUnavailable,
          exact: true,
        }),
      ).toBeVisible();
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "session-unavailable",
        page.locator("main"),
      );
      mode = "login";
      await page.getByRole("button", { name: auth.retry, exact: true }).click();
      const key = page.getByLabel(auth.accessKey, { exact: true });
      await expect(key).toBeFocused();
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "sign-in",
        page.locator("main"),
      );
      await key.fill("synthetic-test-key-not-an-operator-secret");
      await key.press("Tab");
      const submit = page.getByRole("button", {
        name: auth.signIn,
        exact: true,
      });
      await expect(submit).toBeFocused();
      await submit.press("Enter");
      await expect(page.getByRole("alert")).toHaveText(auth.invalidKey);
      await expect(key).toHaveValue("");
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "invalid-key",
        page.locator("main"),
      );
      expect(protectedBeforeLogin).toEqual([]);
      await key.fill("second-synthetic-test-key");
      await submit.click();
      await expect(page.locator("main > header")).toBeVisible();
      expect(attempts).toBe(2);
      // End the authenticated document before changing the server fixture.
      // Its initial workspace requests belong to the successful login.
      await page.goto("about:blank");
      mode = "login";
      const languageAsset = `**/assets/auth-${locale}-*.js`;
      await page.route(languageAsset, (route) =>
        route.abort("internetdisconnected"),
      );
      await page.goto("/");
      await expect(page.getByRole("alert")).toContainText(shell.authCopyError);
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "sign-in-language-error",
        page.locator("main"),
      );
      await page.unroute(languageAsset);
      await page
        .getByRole("button", { name: shell.checkAgain, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: auth.title, exact: true }),
      ).toBeVisible();
      expect(protectedBeforeLogin).toEqual([]);
      expect([...harness.unexpected]).toEqual([]);
      expect(harness.requests).toEqual([]);
    } finally {
      releaseStatus();
      await finishLargeText(session);
    }
  });

  test(`large text ${locale} ${theme} ${screen}: search, navigation and emergency recovery`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.addInitScript(
      ({ locale, theme }) => {
        localStorage.setItem("acos.locale.v1", locale);
        localStorage.setItem("acos.color-mode.v2", theme);
      },
      { locale, theme },
    );
    const harness = await installStudioFixtures(page);
    await page.route("**/api/auth/status", (route) =>
      route.fulfill({
        json: { enabled: true, authenticated: true, sessionExpiresAt: null },
      }),
    );
    let stopAttempts = 0;
    await page.route("**/api/ops/control", (route) => {
      if (route.request().method() === "GET") return route.fallback();
      stopAttempts++;
      return route.fulfill({ status: 503, json: { error: "fixture offline" } });
    });
    const shell = await loadShellMessages(locale);
    const emergency = await loadEmergencyControlCopy[locale]();
    const session = await startLargeText(page);
    try {
      await page.goto("/projects");
      await page.waitForLoadState("networkidle");
      const opener = page.getByRole("button", {
        name: shell.openSearch,
        exact: true,
      });
      await opener.click();
      const dialog = page.getByRole("dialog");
      const search = dialog.getByRole("combobox");
      await expect(search).toBeFocused();
      for (const agent of studioAgents.slice(0, 12)) {
        const label = dialog.getByText(agent.name, { exact: true });
        await expect(label).toBeAttached();
        expect
          .soft(
            await label.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
            agent.name,
          )
          .toBe(true);
      }
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "search",
        dialog,
        true,
      );
      await search.fill("missing-expert-734");
      await expect(
        dialog.getByText(shell.noResults, { exact: true }),
      ).toBeVisible();
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "search-empty",
        dialog,
        true,
      );
      if (screen === "phone") {
        await search.fill("");
        await search.press("End");
        // Allow subpixel rounding at the scroll edge; partial rows still fail.
        await expect(dialog.getByRole("option").last()).toBeInViewport({
          ratio: 0.99,
        });
        await page.setViewportSize({ width: 320, height: 280 });
        await session.send("Page.setFontSizes", {
          fontSizes: { standard: 32, fixed: 26 },
        });
        await search.press("End");
        await expect(dialog.getByRole("option").last()).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect
          .soft(dialog.getByRole("option").last())
          .toBeInViewport({ ratio: 0.99 });
        await expect(
          dialog.getByRole("button", { name: shell.close, exact: true }),
        ).toBeInViewport();
        await inspectLargeTextSurface(
          page,
          session,
          info,
          "search-short-height",
          dialog,
          true,
        );
      }
      await page.keyboard.press("Escape");
      await expect(opener).toBeFocused();
      if (screen === "phone") {
        await page.setViewportSize(viewport);
        await session.send("Page.setFontSizes", {
          fontSizes: { standard: 32, fixed: 26 },
        });
      }
      const menu = page.getByRole("button", {
        name: shell.openMenu,
        exact: true,
      });
      const sidebar = page.locator("#app-navigation");
      const mobileMenu = await menu.isVisible();
      if (mobileMenu) await menu.click();
      else await sidebar.getByRole("link").first().focus();
      await expect(sidebar.getByRole("link").first()).toBeFocused();
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "navigation",
        sidebar,
        true,
      );
      const clippedNames = await sidebar
        .locator("nav a > span:not([aria-hidden])")
        .evaluateAll((elements) =>
          elements
            .filter((element) => element.scrollWidth > element.clientWidth)
            .map((element) => element.textContent),
        );
      expect
        .soft(
          clippedNames,
          "navigation destinations are readable without truncation",
        )
        .toEqual([]);
      for (const link of await sidebar.locator("nav").getByRole("link").all()) {
        await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
        await expect(link).toBeInViewport();
      }
      for (const button of await sidebar.getByRole("button").all()) {
        await page.keyboard.press("Tab");
        await expect(button).toBeFocused();
        await expect(button).toBeInViewport();
      }
      if (mobileMenu) {
        await page.keyboard.press("Tab");
        await expect(sidebar.getByRole("link").first()).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(sidebar.getByRole("button").last()).toBeFocused();
        await expect(sidebar.getByRole("button").last()).toBeInViewport();
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
      }
      await page
        .getByRole("button", { name: emergency.stop, exact: true })
        .click();
      const stop = page.getByRole("alertdialog");
      const reason = stop.getByRole("textbox");
      await expect(reason).toBeFocused();
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "emergency",
        stop,
        true,
      );
      await reason.fill("Synthetic review reason");
      await stop
        .getByRole("button", { name: emergency.confirmStop, exact: true })
        .click();
      await expect(stop.getByRole("alert")).toBeVisible();
      await expect(reason).toHaveValue("Synthetic review reason");
      expect
        .soft(
          await stop
            .getByText("23/500", { exact: true })
            .evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return new Set(
                Array.from(range.getClientRects(), (box) =>
                  Math.round(box.top),
                ),
              ).size;
            }),
          "the character count stays on one line",
        )
        .toBe(1);
      await inspectLargeTextSurface(
        page,
        session,
        info,
        "emergency-error",
        stop,
        true,
      );
      await stop
        .getByRole("button", { name: emergency.cancel, exact: true })
        .click();
      expect(stopAttempts).toBe(1);
      expect([...harness.unexpected]).toEqual([]);
      expect(harness.requests).toEqual([]);
    } finally {
      await finishLargeText(session);
    }
  });
}
