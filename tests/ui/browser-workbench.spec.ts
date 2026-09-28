import {
  inspectRoute,
  inspectReadableLabel,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import { operatorReceipt } from "./helpers/operator-receipts";
import { loadOperatorCopy } from "../../artifacts/agentic-company-os/src/lib/operator-copy";
import { test, expect, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import { loadBrowserCopy } from "../../artifacts/agentic-company-os/src/lib/browser-copy";
import { loadComputerCopy } from "../../artifacts/agentic-company-os/src/lib/computer-copy";
import { loadExpertDetailCopy } from "../../artifacts/agentic-company-os/src/lib/expert-detail-copy";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
const leaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secretText = "原文 中文繁體\nالعربية Русский Türkçe 🙂";

async function fixture(page: Page, locale: Locale = "en") {
  const harness = await installStudioFixtures(page);
  await page.addInitScript(
    (selected) => localStorage.setItem("acos.locale.v1", selected),
    locale,
  );
  const c = await loadBrowserCopy(locale),
    computer = await loadComputerCopy(locale),
    expert = await loadExpertDetailCopy(locale);
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 1280, 800);
    ctx.strokeStyle = "#667085";
    ctx.strokeRect(80, 120, 900, 220);
    ctx.fillStyle = "#182230";
    ctx.font = "30px sans-serif";
    ctx.fillText("Remote test page · 原文", 80, 70);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const state = {
    receipts: new Map<string, ReturnType<typeof operatorReceipt>>(),
    reads: 0,
    operator: false,
    available: true,
    lost: false,
    badReceipt: false,
    viewError: false,
    badImage: false,
    hold: null as Promise<void> | null,
    takeHold: null as Promise<void> | null,
    input: [] as Record<string, unknown>[],
    navigations: [] as Record<string, unknown>[],
    controls: [] as Record<string, unknown>[],
    closes: 0,
    views: 0,
    expiry: Date.now() + 30000,
  };
  const control = (privateLease = false) => ({
    owner: state.operator ? "operator" : "agent",
    leaseId: state.operator && privateLease ? leaseId : null,
    leaseExpiresAt: state.operator
      ? new Date(state.expiry).toISOString()
      : null,
    agentActionInFlight: false,
  });
  const view = () => ({
    available: state.available,
    pngBase64: state.available ? (state.badImage ? "AAAA" : png) : null,
    width: 1280,
    height: 800,
    url: state.available ? "https://example.org/" : null,
    title: "Remote page",
    visible: false,
    note: "PRIVATE-UPSTREAM-SENTINEL",
    control: control(),
  });
  await page.route("**/api/agents/2", (route) =>
    route.fulfill({
      json: {
        ...studioAgents[1],
        permissions: { ...studioAgents[1].permissions, canBrowse: true },
      },
    }),
  );
  await page.route("**/api/agents/2/messages**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/agents/2/vm/status", (route) =>
    route.fulfill({
      json: {
        agentId: 2,
        workspaceId: "agent-2",
        lifecycle: "ready",
        isolation: "filesystem_sandbox",
        persistent: true,
        processExecutionEnabled: false,
        exists: true,
        cwd: "/",
        totalBytes: 0,
        fileCount: 0,
        dirCount: 0,
      },
    }),
  );
  await page.route("**/api/agents/2/vm/files-list", (route) =>
    route.fulfill({
      json: { path: "", entries: [], total: 0, truncated: false, skipped: 0 },
    }),
  );
  await page.route("**/api/agents/2/browser/view", (route) => {
    state.views++;
    return route.fulfill({
      status: state.viewError ? 503 : 200,
      json: state.viewError ? { error: "PRIVATE-UPSTREAM-SENTINEL" } : view(),
    });
  });
  await page.route("**/api/agents/2/operator-requests/*", (route) => {
    state.reads++;
    const saved = state.receipts.get(route.request().url().split("/").at(-1)!);
    return route.fulfill({
      status: saved ? 200 : 404,
      json: saved ?? { error: "not_found" },
    });
  });
  const envelope = (
    body: Record<string, any>,
    kind: Parameters<typeof operatorReceipt>[1],
    result: unknown,
  ) => {
    const receipt = operatorReceipt(body.requestId, kind);
    state.receipts.set(body.requestId, receipt);
    return { receipt, result };
  };
  await page.route("**/api/agents/2/browser/control", async (route) => {
    const body = route.request().postDataJSON();
    state.controls.push(body);
    if (body.action === "take_over") {
      if (state.takeHold) await state.takeHold;
      state.operator = true;
      state.expiry = Date.now() + 30000;
    } else if (body.action === "release") state.operator = false;
    else if (body.action === "heartbeat" && state.operator)
      state.expiry = Date.now() + 30000;
    return route.fulfill({
      json:
        body.action === "heartbeat"
          ? { receipt: null, result: control(true) }
          : envelope(
              body,
              body.action === "take_over"
                ? "browser_take_over"
                : "browser_release",
              control(true),
            ),
    });
  });
  await page.route("**/api/agents/2/browser/navigate", async (route) => {
    const body = route.request().postDataJSON();
    state.navigations.push(body);
    if (state.hold) await state.hold;
    return route.fulfill({ json: envelope(body, "browser_navigate", view()) });
  });
  await page.route("**/api/agents/2/browser/input", async (route) => {
    const body = route.request().postDataJSON();
    state.input.push(body);
    state.expiry = Date.now() + 45000;
    if (state.hold) await state.hold;
    const response = envelope(body, "browser_input", {
      path: state.badReceipt ? "wrong" : body.action,
      deleted: true,
    });
    return route.fulfill({
      status: state.lost ? 503 : 200,
      json: state.lost ? { error: "PRIVATE-UPSTREAM-SENTINEL" } : response,
    });
  });
  await page.route("**/api/agents/2/browser/close", (route) => {
    state.closes++;
    state.available = false;
    state.operator = false;
    return route.fulfill({
      json: envelope(route.request().postDataJSON(), "browser_close", {
        path: "browser-session",
        deleted: true,
      }),
    });
  });
  await page.goto("/agents/2");
  await page.getByRole("tab", { name: expert.computer, exact: true }).click();
  const section = page.getByRole("region", {
    name: `${c.title}: ${studioAgents[1].name}`,
    exact: true,
  });
  await expect(section.getByText(new RegExp(`^${c.polling}`))).toBeVisible();
  await expect(
    section.getByRole("button", { name: c.take, exact: true }),
  ).toBeEnabled();
  const take = async () => {
    await section.getByRole("button", { name: c.take, exact: true }).click();
    await expect(
      section.getByRole("button", { name: c.send, exact: true }),
    ).toBeEnabled();
  };
  const openBrowser = async () => {
    await page
      .getByRole("tab", { name: computer.browser, exact: true })
      .click();
  };
  return { c, computer, expert, state, section, take, openBrowser, harness };
}

for (const locale of LOCALES)
  test(`${locale} browser has validated phone input, local Tab escape and readable controls`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: locale === "en" ? 1365 : locale === "ar" ? 320 : 390,
      height: 900,
    });
    await page.emulateMedia({
      colorScheme: locale === "ar" ? "light" : "dark",
    });
    const h = await fixture(page, locale);
    await h.take();
    const address = h.section.getByRole("textbox", {
      name: h.c.address,
      exact: true,
    });
    await address.fill("javascript:alert(1)");
    await h.section.getByRole("button", { name: h.c.go, exact: true }).click();
    await expect(address).toBeFocused();
    await expect(
      h.section.getByText(h.c.addressInvalid, { exact: true }),
    ).toBeVisible();
    expect(h.state.navigations).toHaveLength(0);
    await address.fill("example.org/new");
    await address.press("Enter");
    await expect.poll(() => h.state.navigations.length).toBe(1);
    await expect(address).toHaveValue("");
    const text = h.section.getByRole("textbox", {
      name: h.c.textLabel,
      exact: true,
    });
    await h.section
      .getByRole("button", { name: h.c.send, exact: true })
      .click();
    await expect(text).toBeFocused();
    await expect(
      h.section.getByText(h.c.textInvalid, { exact: true }),
    ).toBeVisible();
    await text.fill(secretText);
    await text.dispatchEvent("compositionstart");
    await h.section
      .getByRole("button", { name: h.c.send, exact: true })
      .click();
    expect(h.state.input).toHaveLength(0);
    await text.dispatchEvent("compositionend");
    await h.section
      .getByRole("button", { name: h.c.send, exact: true })
      .click();
    await expect.poll(() => h.state.input.length).toBe(1);
    expect(h.state.input[0]).toMatchObject({
      action: "type_text",
      text: secretText,
      leaseId,
    });
    await expect(text).toHaveValue("");
    await expect(
      h.section.getByRole("button", { name: h.c.release, exact: true }),
    ).toBeEnabled();
    const frame = h.section.getByRole("group", {
      name: `${h.c.imageLabel}: ${studioAgents[1].name}`,
      exact: true,
    });
    await frame.focus();
    await page.keyboard.press("Tab");
    await expect(text).toBeFocused();
    expect(h.state.input).toHaveLength(1);
    await frame.focus();
    await page.keyboard.press("Escape");
    await expect(
      h.section.getByRole("button", { name: h.c.release, exact: true }),
    ).toBeFocused();
    await h.section.getByRole("button", { name: h.c.tab, exact: true }).click();
    await expect.poll(() => h.state.input.length).toBe(2);
    expect(h.state.input[1].key).toBe("Tab");
    await h.section
      .getByRole("button", { name: h.c.close, exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("button", { name: h.c.cancel, exact: true }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: h.c.cancel, exact: true }).click();
    await expect(
      h.section.getByRole("button", { name: h.c.close, exact: true }),
    ).toBeFocused();
    expect(h.state.closes).toBe(0);
    expect(await text.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      "16px",
    );
    await expect(h.section).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    const targets = await h.section.getByRole("button").evaluateAll((els) =>
      els.map((el) => ({
        h: el.getBoundingClientRect().height,
        w: el.getBoundingClientRect().width,
      })),
    );
    expect(targets.every((t) => t.h >= 44 && t.w >= 44)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByText("PRIVATE-UPSTREAM-SENTINEL", { exact: false }),
    ).toHaveCount(0);
    if (locale === "en" || locale === "ar") {
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await h.section.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect
        .poll(async () => (await h.section.boundingBox())?.y ?? 9999)
        .toBeLessThan(100);
      await page.screenshot({
        path: info.outputPath(`browser-${locale}-viewport.png`),
      });
      await text.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`browser-${locale}-input.png`),
      });
      await info.attach("browser-layout", {
        body: JSON.stringify(
          await h.section.evaluate((el) => {
            const ancestors = [];
            let current: Element | null = el;
            while (current) {
              const r = current.getBoundingClientRect();
              ancestors.push({
                tag: current.tagName,
                cls: current.className,
                top: r.top,
                height: r.height,
                scroll: current.scrollTop,
                client: current.clientHeight,
                scrollHeight: current.scrollHeight,
              });
              current = current.parentElement;
            }
            return ancestors;
          }),
          null,
          2,
        ),
        contentType: "application/json",
      });
    }
  });

test("lost acknowledgements stop further input, survive reload without secrets and require a manual review", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  const h = await fixture(page);
  await h.take();
  h.state.lost = true;
  const text = h.section.getByRole("textbox", {
    name: h.c.textLabel,
    exact: true,
  });
  await text.fill(secretText);
  await h.section.getByRole("button", { name: h.c.send, exact: true }).click();
  await expect(h.section.getByText(h.c.unknown, { exact: true })).toBeVisible();
  await expect(text).toHaveValue(secretText);
  expect(h.state.input).toHaveLength(1);
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("acos.browser-request.v1.2"),
  );
  expect(stored).not.toContain(secretText);
  expect(stored).not.toContain(leaseId);
  expect(JSON.parse(stored!).status).toBe("unknown");
  await page.reload();
  await page.getByRole("tab", { name: h.expert.computer, exact: true }).click();
  await expect(h.section.getByText(h.c.unknown, { exact: true })).toBeVisible();
  expect(h.state.input).toHaveLength(1);
  await h.section
    .getByRole("button", { name: h.c.review, exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("button", { name: h.c.reviewDone, exact: true })
    .click();
  await expect(dialog.getByRole("checkbox")).toBeFocused();
  await expect(
    dialog.getByText(h.c.reviewRequired, { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: h.c.reviewDone, exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    h.section.getByRole("group", {
      name: `${h.c.imageLabel}: ${studioAgents[1].name}`,
      exact: true,
    }),
  ).toBeFocused();
  expect(h.state.input).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.browser-request.v1.2"),
    ),
  ).toBeNull();
});

test("one outstanding action preserves newer drafts and cannot be followed by queued input", async ({
  page,
}) => {
  const h = await fixture(page);
  await h.take();
  let release!: () => void;
  h.state.hold = new Promise<void>((r) => {
    release = r;
  });
  const text = h.section.getByRole("textbox", {
    name: h.c.textLabel,
    exact: true,
  });
  await text.fill("first");
  await h.section.getByRole("button", { name: h.c.send, exact: true }).click();
  await expect.poll(() => h.state.input.length).toBe(1);
  await text.fill("new draft");
  await h.section
    .getByRole("button", { name: h.c.enter, exact: true })
    .evaluate((el: HTMLButtonElement) => el.click());
  expect(h.state.input).toHaveLength(1);
  release();
  await expect(
    h.section.getByRole("button", { name: h.c.send, exact: true }),
  ).toBeEnabled();
  await expect(text).toHaveValue("new draft");
  await page.getByRole("tab", { name: h.computer.files, exact: true }).click();
  await h.openBrowser();
  await expect(text).toHaveValue("new draft");
  await expect(
    h.section.getByRole("button", { name: h.c.take, exact: true }),
  ).toBeEnabled();
});

test("late takeover after leaving the browser returns the captured lease and never navigates", async ({
  page,
}) => {
  const h = await fixture(page);
  let release!: () => void;
  h.state.takeHold = new Promise<void>((r) => {
    release = r;
  });
  await h.section.getByRole("button", { name: h.c.take, exact: true }).click();
  await expect
    .poll(() => h.state.controls.filter((v) => v.action === "take_over").length)
    .toBe(1);
  await page.getByRole("tab", { name: h.computer.files, exact: true }).click();
  release();
  await expect
    .poll(() => h.state.controls.filter((v) => v.action === "release").length)
    .toBe(1);
  expect(h.state.navigations).toHaveLength(0);
  expect(h.state.input).toHaveLength(0);
  await h.openBrowser();
  await expect(
    h.section.getByRole("button", { name: h.c.take, exact: true }),
  ).toBeEnabled();
});

test("failed image decoding retains the last image and disables input until a valid read", async ({
  page,
}) => {
  const h = await fixture(page);
  await h.take();
  const image = h.section.getByRole("img");
  const source = await image.getAttribute("src");
  h.state.badImage = true;
  await h.section
    .getByRole("button", { name: h.c.refresh, exact: true })
    .click();
  await expect(
    h.section.getByText(h.c.syncLost, { exact: true }),
  ).toBeVisible();
  await expect(image).toHaveAttribute("src", source!);
  await expect(
    h.section.getByRole("button", { name: h.c.send, exact: true }),
  ).toBeDisabled();
  h.state.badImage = false;
  await h.section
    .getByRole("button", { name: h.c.refresh, exact: true })
    .click();
  await expect(
    h.section.getByRole("button", { name: h.c.send, exact: true }),
  ).toBeEnabled();
  await h.section.getByRole("button", { name: h.c.pause, exact: true }).click();
  await expect(
    h.section.getByRole("button", { name: h.c.send, exact: true }),
  ).toBeDisabled();
});

test("storage failure blocks effects before dispatch and can be retried explicitly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    (window as any).failBrowserStorage = true;
    Storage.prototype.setItem = function (k, v) {
      if (
        k.startsWith("acos.browser-request") &&
        (window as any).failBrowserStorage
      )
        throw new DOMException("blocked", "SecurityError");
      return original.call(this, k, v);
    };
  });
  const h = await fixture(page);
  await h.section.getByRole("button", { name: h.c.take, exact: true }).click();
  await expect(
    h.section.getByText(h.c.storageError, { exact: true }),
  ).toBeVisible();
  expect(h.state.controls).toHaveLength(0);
  await page.evaluate(() => {
    (window as any).failBrowserStorage = false;
  });
  await h.section
    .getByRole("button", { name: h.c.retryStorage, exact: true })
    .click();
  await h.section
    .getByRole("button", { name: h.c.review, exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: h.c.reviewDone }).click();
  await h.take();
});

test("a malformed receipt stays unknown and magnified phone images scroll without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const h = await fixture(page);
  await h.take();
  await h.section
    .getByRole("button", { name: h.c.zoomIn, exact: true })
    .click();
  const frame = h.section.getByRole("group", {
    name: `${h.c.imageLabel}: ${studioAgents[1].name}`,
    exact: true,
  });
  expect((await frame.boundingBox())?.width).toBe(1280);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await frame.evaluate((el) => {
    el.parentElement!.scrollLeft = 500;
  });
  expect(await frame.evaluate((el) => el.parentElement!.scrollLeft)).toBe(500);
  await h.section
    .getByRole("button", { name: h.c.zoomOut, exact: true })
    .click();
  h.state.badReceipt = true;
  await h.section.getByRole("button", { name: h.c.enter, exact: true }).click();
  await expect(h.section.getByText(h.c.unknown, { exact: true })).toBeVisible();
  expect(h.state.input).toHaveLength(1);
  await expect(
    h.section.getByRole("button", { name: h.c.enter, exact: true }),
  ).toBeDisabled();
});

test("close requires explicit confirmation and stale image errors do not reopen the closed session", async ({
  page,
}) => {
  const h = await fixture(page);
  await h.take();
  await h.section.getByRole("button", { name: h.c.close, exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: h.c.confirm, exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  expect(h.state.closes).toBe(1);
  await expect(h.section.getByText(h.c.empty, { exact: true })).toBeVisible();
  await expect(
    h.section.getByRole("button", { name: h.c.take, exact: true }),
  ).toBeEnabled();
  await h.section
    .getByRole("button", { name: h.c.refresh, exact: true })
    .click();
  expect(h.state.controls.filter((x) => x.action === "take_over")).toHaveLength(
    1,
  );
});

test("full screen keeps close confirmation and a visible exit operable", async ({
  page,
}) => {
  const h = await fixture(page);
  await h.take();
  await h.section
    .getByRole("button", { name: h.c.fullscreen, exact: true })
    .click();
  await expect(
    h.section.getByRole("button", { name: h.c.exitFullscreen, exact: true }),
  ).toBeVisible();
  await h.section.getByRole("button", { name: h.c.close, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("button", { name: h.c.cancel, exact: true })
    .click({ timeout: 3000 });
  await expect(dialog).toBeHidden();
  await h.section
    .getByRole("button", { name: h.c.exitFullscreen, exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  expect(h.state.closes).toBe(0);
});

test("browser record lookup after a lost reply never restores a lease or repeats input", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  const h = await fixture(page);
  await h.take();
  h.state.lost = true;
  await h.section
    .getByRole("textbox", { name: h.c.textLabel, exact: true })
    .fill(secretText);
  await h.section.getByRole("button", { name: h.c.send, exact: true }).click();
  await expect(h.section.getByText(h.c.unknown, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: h.expert.computer, exact: true }).click();
  const rc = await loadOperatorCopy("en");
  await h.section.getByRole("button", { name: rc.check, exact: true }).click();
  await expect(h.section.getByText(rc.complete, { exact: true })).toBeVisible();
  await expect(
    h.section.getByRole("button", { name: h.c.send, exact: true }),
  ).toBeDisabled();
  expect(h.state.input).toHaveLength(1);
  expect(h.state.reads).toBe(1);
  expect(h.state.controls.filter((v) => v.action === "take_over")).toHaveLength(
    1,
  );
});

for (const locale of LOCALES)
  test(`${locale} browser recovery is read-only at phone width and review starts on cancel`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 950 });
    await page.emulateMedia({
      colorScheme: locale === "ar" ? "light" : "dark",
    });
    const h = await fixture(page, locale),
      rc = await loadOperatorCopy(locale);
    await h.take();
    h.state.lost = true;
    await h.section
      .getByRole("textbox", { name: h.c.textLabel, exact: true })
      .fill(secretText);
    await h.section
      .getByRole("button", { name: h.c.send, exact: true })
      .click();
    await expect(
      h.section.getByText(h.c.unknown, { exact: true }),
    ).toBeVisible();
    await h.section
      .getByRole("button", { name: rc.check, exact: true })
      .click();
    await expect(
      h.section.getByText(rc.complete, { exact: true }),
    ).toBeVisible();
    await expect(
      h.section.getByText(rc.browser, { exact: true }),
    ).toBeVisible();
    await expect(
      h.section.getByRole("heading", { name: h.c.unknown, exact: true }),
    ).toHaveCount(0);
    await expect(
      h.section.getByRole("button", { name: h.c.send, exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (locale === "ar" || locale === "en")
      await page.screenshot({
        path: info.outputPath(`browser-recovery-${locale}.png`),
        fullPage: true,
      });
    await h.section
      .getByRole("button", { name: h.c.review, exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("button", { name: h.c.cancel, exact: true }),
    ).toBeFocused();
    await dialog
      .getByRole("button", { name: h.c.cancel, exact: true })
      .press("Enter");
    await expect(
      h.section.getByRole("button", { name: h.c.review, exact: true }),
    ).toBeFocused();
    expect(h.state.input).toHaveLength(1);
    expect(h.state.reads).toBe(1);
  });

test("legacy browser recovery cannot query and review cannot erase changed local metadata", async ({
  page,
}) => {
  const h = await fixture(page),
    rc = await loadOperatorCopy("en");
  const legacy = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    agentId: 2,
    kind: "input",
    startedAt: Date.now(),
    status: "unknown",
  };
  await page.evaluate(
    (saved) =>
      sessionStorage.setItem(
        "acos.browser-request.v1.2",
        JSON.stringify(saved),
      ),
    legacy,
  );
  await page.reload();
  await page.getByRole("tab", { name: h.expert.computer, exact: true }).click();
  await expect(h.section.getByText(rc.legacy, { exact: true })).toBeVisible();
  await expect(h.section.getByRole("button", { name: rc.check })).toHaveCount(
    0,
  );
  await h.section
    .getByRole("button", { name: h.c.review, exact: true })
    .click();
  await page.evaluate(
    (saved) =>
      sessionStorage.setItem(
        "acos.browser-request.v1.2",
        JSON.stringify({ ...saved, kind: "navigate" }),
      ),
    legacy,
  );
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: h.c.reviewDone }).click();
  await expect(
    dialog.getByText(h.c.reviewRequired, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("acos.browser-request.v1.2")!).kind,
    ),
  ).toBe("navigate");
  expect(h.state.reads).toBe(0);
  expect(h.state.input).toHaveLength(0);
});

test("late browser takeover cannot restore authority after its saved intent changes", async ({
  page,
}) => {
  const h = await fixture(page);
  let release!: () => void;
  h.state.takeHold = new Promise((resolve) => {
    release = resolve;
  });
  await h.section.getByRole("button", { name: h.c.take, exact: true }).click();
  await expect
    .poll(
      () =>
        h.state.controls.filter((value) => value.action === "take_over").length,
    )
    .toBe(1);
  await page.evaluate(() => {
    const saved = JSON.parse(
      sessionStorage.getItem("acos.browser-request.v1.2")!,
    );
    saved.kind = "navigate";
    saved.status = "unknown";
    sessionStorage.setItem("acos.browser-request.v1.2", JSON.stringify(saved));
  });
  release();
  await expect
    .poll(
      () =>
        h.state.controls.filter((value) => value.action === "release").length,
    )
    .toBe(1);
  await expect(
    h.section.getByRole("button", { name: h.c.send, exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("acos.browser-request.v1.2")!).kind,
    ),
  ).toBe("navigate");
  expect(h.state.input).toHaveLength(0);
});

test("review regression: retrying browser storage cannot erase damaged recovery data", async ({
  page,
}) => {
  const h = await fixture(page);
  await page.evaluate(() =>
    sessionStorage.setItem("acos.browser-request.v1.2", "{damaged-original"),
  );
  await page.reload();
  await page.getByRole("tab", { name: h.expert.computer, exact: true }).click();
  await expect(h.section.getByText(h.c.damaged, { exact: true })).toBeVisible();
  const retry = h.section.getByRole("button", {
    name: h.c.retryStorage,
    exact: true,
  });
  if (await retry.isVisible()) await retry.click();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.browser-request.v1.2"),
    ),
  ).toBe("{damaged-original");
  expect(h.state.controls).toHaveLength(0);
});

test("review regression: browser dispatch rechecks stored recovery before overwriting it", async ({
  page,
}) => {
  const h = await fixture(page);
  const saved = {
    protocolVersion: 1,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    agentId: 2,
    kind: "input",
    status: "unknown",
    startedAt: Date.now(),
  };
  await page.evaluate(
    (value) =>
      sessionStorage.setItem(
        "acos.browser-request.v1.2",
        JSON.stringify(value),
      ),
    saved,
  );
  await h.section.getByRole("button", { name: h.c.take, exact: true }).click();
  await expect(h.section.getByText(h.c.unknown, { exact: true })).toBeVisible();
  expect(h.state.controls).toHaveLength(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("acos.browser-request.v1.2")!),
    ),
  ).toEqual(saved);
});

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: browser workbench`, async ({
    page,
  }, info) => {
    const errors = await prepareRouteAudit(page, variant);
    const h = await fixture(page, locale);
    await inspectRoute(page, info, "browser-workbench", variant);
    if (variant.largeText) {
      const heading = h.section.getByRole("heading", { level: 2 }).first();
      await inspectReadableLabel(heading, h.c.title);
      const identity = await heading
        .locator('[dir="auto"]')
        .evaluate((element) => ({
          width: element.clientWidth,
          content: element.scrollWidth,
        }));
      expect
        .soft(identity.content, "full expert identity in browser heading")
        .toBeLessThanOrEqual(identity.width + 1);
    }
    expect(h.state.input).toEqual([]);
    expect(h.state.navigations).toEqual([]);
    expect(h.state.controls).toEqual([]);
    expect(h.state.closes).toBe(0);
    expect([...h.harness.unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
