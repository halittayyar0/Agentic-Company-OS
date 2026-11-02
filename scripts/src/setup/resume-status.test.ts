import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createSetupSession, type SetupProgress } from "./session";

const resumed = {
  url: "http://127.0.0.1:58762",
  operatorToken: "offline-status-fixture-key",
  phoneUnavailable: true as const,
  locale: "tr" as const,
};

test("resumed local status stays authenticated, read-only and reveals the access key only explicitly", async (t) => {
  let effects = 0;
  const session = await createSetupSession({
    resumed,
    capabilities: async () => {
      effects++;
      throw Error("status must not probe the host");
    },
    execute: async () => {
      effects++;
      throw Error("status cannot install");
    },
  });
  t.after(() => session.close());
  const origin = new URL(session.url).origin;
  const request = (
    route: string,
    body?: unknown,
    auth = true,
    suppliedOrigin = origin,
  ) =>
    fetch(`${origin}/api/${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(auth ? { authorization: `Bearer ${session.token}` } : {}),
        origin: suppliedOrigin,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await request("state", undefined, false)).status, 401);
  const state = (await (await request("state")).json()) as SetupProgress;
  assert.equal(state.phase, "complete");
  assert.equal(state.resumeOnly, true);
  assert.equal(state.phoneUnavailable, true);
  assert.equal(state.uiLocale, "tr");
  assert.equal(JSON.stringify(state).includes(resumed.operatorToken), false);
  for (const route of [
    "plan",
    "install",
    "upgrade/install",
    "upgrade/review",
    "upgrade/cancel",
  ])
    assert.equal((await request(route, {})).status, 409);
  assert.equal((await request("connection", {}, false)).status, 401);
  assert.equal(
    (await request("connection", {}, true, "https://other.invalid")).status,
    403,
  );
  assert.equal((await request("locale", { locale: "ar" })).status, 200);
  assert.equal(
    ((await (await request("state")).json()) as SetupProgress).uiLocale,
    "ar",
  );
  assert.deepEqual(await (await request("connection", {})).json(), {
    operatorToken: resumed.operatorToken,
  });
  assert.equal((await request("connection", {})).status, 409);
  assert.equal(effects, 0);
});

test("offline resume status explains local availability in seven languages at phone and desktop widths", async (t) => {
  const session = await createSetupSession({
    resumed,
    capabilities: async () => {
      throw Error("no probe expected");
    },
    execute: async () => {
      throw Error("no install expected");
    },
  });
  t.after(() => session.close());
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const fragments = {
    en: "Phone access",
    tr: "Telefon erişimi",
    de: "Telefonzugriff",
    ru: "Доступ с телефона",
    "zh-CN": "手机访问",
    "zh-TW": "手機存取",
    ar: "الوصول من الهاتف",
  };
  for (const width of [320, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("about:blank");
    await page.goto(session.url);
    await page
      .locator("#phone-unavailable:not([hidden])")
      .waitFor({ timeout: 3000 });
    assert.equal(await page.locator("#upgrade-existing").isVisible(), false);
    assert.equal(
      await page.locator("#language").inputValue(),
      width === 320 ? "tr" : "ar",
    );
    for (const [locale, text] of Object.entries(fragments)) {
      await page.locator("#language").selectOption(locale);
      if (locale === "en")
        assert.equal(
          await page.locator("#heading").innerText(),
          "Connection status",
        );
      assert.equal(await page.locator("#upgrade-existing").isVisible(), false);
      assert.ok(
        (await page.locator("#phone-unavailable").innerText()).includes(text),
      );
      assert.ok(
        (await page.locator("#phone-unavailable").innerText()).includes(
          "Tailscale",
        ),
      );
      assert.equal(
        await page.locator("#open").getAttribute("href"),
        resumed.url + "/",
      );
      assert.equal(await page.locator("#phone-link").isVisible(), false);
      assert.equal(await page.locator("#next").isVisible(), false);
      assert.equal(await page.locator("#language").isEnabled(), true);
      assert.equal(
        await page.locator("html").getAttribute("dir"),
        locale === "ar" ? "rtl" : "ltr",
      );
      assert.equal(
        await page.evaluate(
          "document.documentElement.scrollWidth <= innerWidth",
        ),
        true,
      );
      assert.equal(await page.locator("#operator-key").inputValue(), "");
      await page.locator("#language").focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate("document.activeElement.id"), "open");
    }
    // Reopen the original private link; no browser-storage credential persistence.
    await page.goto("about:blank");
    await page.goto(session.url);
    await page.locator("#phone-unavailable:not([hidden])").waitFor();
    assert.equal(await page.locator("#language").inputValue(), "ar");
  }
  await page.locator("#connection").click();
  assert.equal(
    await page.locator("#operator-key").inputValue(),
    resumed.operatorToken,
  );
  assert.equal(await page.locator("#connection").isVisible(), false);
  await page.locator("#language").selectOption("tr");
  assert.equal(await page.locator("#connection").isVisible(), false);
  // A plain refresh cannot recover the removed private fragment. Preserve the
  // existing no-browser-storage rule rather than silently retaining a bearer.
  await page.reload();
  assert.equal(await page.locator("#open").isVisible(), false);
  assert.equal(await page.locator("#phone-unavailable").isVisible(), false);
  assert.equal(await page.locator("#operator-key").inputValue(), "");
  assert.ok((await page.locator("#error").innerText()).length > 0);
  assert.equal(
    (await page.locator("body").innerText()).includes(resumed.operatorToken),
    false,
  );
});
