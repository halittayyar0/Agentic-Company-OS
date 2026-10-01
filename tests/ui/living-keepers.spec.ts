import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";

async function setup(page: Page, locale = "en", status = "idle") {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const harness = await installStudioFixtures(page);
  const agent = { ...structuredClone(studioAgents[1]), status };
  const writes: string[] = [];
  const read = { failed: false };
  await page.route("**/api/agents/2", (route) => {
    if (route.request().method() !== "GET") {
      writes.push(route.request().method());
      return route.fulfill({ status: 501, json: {} });
    }
    return route.fulfill({
      status: read.failed ? 503 : 200,
      json: read.failed ? { error: "Unavailable" } : agent,
    });
  });
  await page.route("**/api/agents/2/messages**", (route) => {
    if (route.request().method() !== "GET")
      writes.push(route.request().method());
    return route.fulfill({ json: [] });
  });
  return { agent, writes, harness, read };
}

test("live mascots can be stopped everywhere and the choice survives reload", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const state = await setup(page);
  await page.goto("/agents/2");
  const mascot = page.locator("header [data-keeper]").last();
  const body = mascot.locator(".keeper-body");
  await expect(body).toBeVisible();
  await expect
    .poll(() => body.evaluate((el) => getComputedStyle(el).animationName))
    .toBe("keeper-breathe");
  await page
    .getByRole("button", { name: "Pause mascot motion", exact: true })
    .first()
    .click();
  await expect
    .poll(() => body.evaluate((el) => getComputedStyle(el).animationName))
    .toBe("none");
  await page.reload();
  await expect
    .poll(() => body.evaluate((el) => getComputedStyle(el).animationName))
    .toBe("none");
  await page
    .getByRole("button", { name: "Enable mascot motion", exact: true })
    .first()
    .click();
  await expect
    .poll(() => body.evaluate((el) => getComputedStyle(el).animationName))
    .toBe("keeper-breathe");
  expect(state.writes).toEqual([]);
  expect([...state.harness.unexpected]).toEqual([]);
});

test("motion choices synchronize across tabs and work when preference storage is blocked", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const state = await setup(page);
  await page.goto("/agents/2");
  const peer = await page.context().newPage();
  await peer.emulateMedia({ reducedMotion: "no-preference" });
  await setup(peer);
  await peer.goto("/agents/2");
  await page
    .getByRole("button", { name: "Pause mascot motion", exact: true })
    .first()
    .click();
  await expect(
    peer
      .getByRole("button", { name: "Enable mascot motion", exact: true })
      .first(),
  ).toBeVisible();
  await peer
    .getByRole("button", { name: "Enable mascot motion", exact: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("button", { name: "Pause mascot motion", exact: true })
      .first(),
  ).toBeVisible();
  await peer.close();
  await page.evaluate(() => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "acos.keeper-motion.v1") throw new Error("Blocked");
      return originalGet.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "acos.keeper-motion.v1") throw new Error("Blocked");
      originalSet.call(this, key, value);
    };
  });
  await page
    .getByRole("button", { name: "Pause mascot motion", exact: true })
    .first()
    .click();
  await expect
    .poll(() =>
      page
        .locator("header .keeper-body")
        .last()
        .evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe("none");
  expect(state.writes).toEqual([]);
});

test("archived and unconfirmed profiles keep truthful static guidance and do not start chat", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const state = await setup(page, "en", "archived");
  state.agent.isActive = false;
  await page.goto("/agents/2?tab=settings");
  const mascot = page.locator("header [data-keeper]").last();
  const talk = page.getByRole("button", { name: "Let's talk", exact: true });
  await expect(talk).toBeDisabled();
  await expect(mascot).toHaveAttribute("data-keeper-mood", "archived");
  await expect
    .poll(() =>
      mascot
        .locator(".keeper-body")
        .evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe("none");
  state.read.failed = true;
  await page
    .getByRole("button", { name: "Refresh record", exact: true })
    .click();
  await expect(
    page.getByText(
      "The current state could not be confirmed. Refresh the record before relying on it.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(mascot).toHaveAttribute("data-keeper-mood", "unknown");
  await expect(talk).toBeDisabled();
  expect(state.writes).toEqual([]);
});

test("reported work changes motion; hidden documents and offscreen mascots pause", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const state = await setup(page, "en", "working");
  await page.goto("/agents/2");
  const mascot = page.locator("header [data-keeper]").last();
  const body = mascot.locator(".keeper-body");
  await expect(mascot).toHaveAttribute("data-keeper-mood", "working");
  await expect
    .poll(() => body.evaluate((el) => getComputedStyle(el).animationName))
    .toBe("keeper-work");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => body.evaluate((el) => getComputedStyle(el).animationPlayState))
    .toBe("paused");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => body.evaluate((el) => getComputedStyle(el).animationPlayState))
    .toBe("running");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page
    .getByRole("heading", { name: "Saved configuration" })
    .scrollIntoViewIfNeeded();
  await expect(mascot).toHaveAttribute("data-keeper-visible", "false");
  await expect
    .poll(() => body.evaluate((el) => getComputedStyle(el).animationPlayState))
    .toBe("paused");
  expect(state.writes).toEqual([]);
});

test("reduced motion overrides a live preference and custom portraits remain still", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await setup(page);
  state.agent.avatarVersion = "custom";
  await page.route("**/api/agents/2/avatar**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>',
    }),
  );
  await page.goto("/agents/2");
  const mascot = page.locator("header [data-keeper]").last();
  await expect(mascot.locator("img")).toBeVisible();
  await expect(mascot.locator(".keeper-body")).toHaveCount(0);
  state.agent.avatarVersion = null;
  await page
    .getByRole("button", { name: "Refresh record", exact: true })
    .click();
  await expect(mascot.locator(".keeper-body")).toBeVisible();
  await expect
    .poll(() =>
      mascot
        .locator(".keeper-body")
        .evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe("none");
  expect(state.writes).toEqual([]);
});

const locales = [
  ["en", "Let's talk", "Together, one step at a time."],
  ["tr", "Birlikte konuşalım", "Birlikte, adım adım."],
  ["de", "Lass uns sprechen", "Gemeinsam, Schritt für Schritt."],
  ["ru", "Давай поговорим", "Вместе, шаг за шагом."],
  ["zh-CN", "聊一聊", "一起，一步一步来。"],
  ["zh-TW", "聊一聊", "一起，一步一步來。"],
  ["ar", "لنتحدث معًا", "معًا، خطوة بخطوة."],
] as const;
for (const [locale, talk, greeting] of locales) {
  test(`${locale}: a phone companion opens chat by keyboard without sending or changing a draft`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await setup(page, locale);
    await page.goto("/agents/2?tab=settings");
    await expect(page.getByText(greeting, { exact: true })).toBeVisible();
    const button = page.getByRole("button", { name: talk, exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/tab=chat/);
    await expect(page.locator("[data-keeper-chat-focus]")).toBeFocused();
    await page
      .locator("[data-keeper-chat-focus]")
      .fill("My existing draft 原文");
    await button.click();
    await expect(page.locator("[data-keeper-chat-focus]")).toHaveValue(
      "My existing draft 原文",
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    expect(state.writes).toEqual([]);
    expect([...state.harness.unexpected]).toEqual([]);
    if (locale === "tr")
      await page.screenshot({
        path: process.env.TEMP + "/acos-living-keepers-phone.png",
        fullPage: true,
      });
  });
}
