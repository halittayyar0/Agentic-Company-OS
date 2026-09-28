import { expect, test, type Page } from "@playwright/test";
import type { ApprovalRequest } from "@workspace/api-client-react";
import { loadApprovalCopy } from "../../artifacts/agentic-company-os/src/lib/approval-copy";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { installStudioFixtures } from "./helpers/studio-fixtures";

const scope = {
  toolName: "vm_run_sudo_command",
  argsHash: "ab".repeat(32),
  target: "host:fixture-account",
  preview: "printf '%s' 'Exact original command 原文'",
};
function approval(id = 21, host = false): ApprovalRequest {
  return {
    id,
    taskId: 7,
    agentId: 999,
    category: "other",
    title: `Original request #${id}`,
    description: "Original agent text 原文",
    amountUsd: null,
    scope: host ? { ...scope } : null,
    status: "pending",
    decisionNote: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    consumedAt: null,
  };
}
async function setup(page: Page, locale: Locale, initial = [approval()]) {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const harness = await installStudioFixtures(page);
  const state = {
    records: initial,
    listError: false,
    decisionError: false,
    stopped: false,
    safetyError: false,
    decisions: [] as Record<string, unknown>[],
    queries: [] as URLSearchParams[],
  };
  await page.route("**/api/ops/control", (route) =>
    route.fulfill({
      status: state.safetyError ? 503 : 200,
      json: state.safetyError
        ? { error: "Unavailable" }
        : {
            emergencyStopEnabled: state.stopped,
            reason: null,
            version: 1,
            updatedBy: "test",
            updatedAt: new Date().toISOString(),
            blockedScopes: [],
          },
    }),
  );
  await page.route("**/api/approvals?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    state.queries.push(query);
    return route.fulfill({
      status: state.listError ? 503 : 200,
      json: state.listError
        ? { error: "Unavailable" }
        : state.records
            .filter(
              (row) =>
                row.status === query.get("status") &&
                (!query.has("beforeId") ||
                  row.id < Number(query.get("beforeId"))),
            )
            .slice(0, Number(query.get("limit"))),
    });
  });
  await page.route("**/api/approvals/*/decision", async (route) => {
    const body = route.request().postDataJSON();
    state.decisions.push(body);
    if (state.decisionError)
      return route.fulfill({ status: 503, json: { error: "Outcome unknown" } });
    const id = Number(
      new URL(route.request().url()).pathname.split("/").at(-2),
    );
    const row = state.records.find((row) => row.id === id)!;
    row.status = body.decision;
    row.decisionNote = body.note ?? null;
    row.resolvedAt = new Date().toISOString();
    return route.fulfill({ json: row });
  });
  return { ...harness, state, c: await loadApprovalCopy(locale) };
}

for (const locale of LOCALES)
  test(`${locale} approval decisions preserve source text and fit a phone`, async ({
    page,
  }) => {
    const { c, state, unexpected } = await setup(page, locale, [
      approval(22),
      approval(21),
    ]);
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    const packs: string[] = [];
    page.on("request", (request) => {
      const file = new URL(request.url()).pathname.split("/").at(-1)!;
      if (/^approval-.+\.js$/.test(file)) packs.push(file);
    });
    await page.goto("/approvals");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    const first = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Original request #22",
        exact: true,
      }),
    });
    await expect(
      first.getByText("Original agent text 原文", { exact: true }),
    ).toBeVisible();
    await expect(
      first.getByText(`${c.unknownRequester} #999`, { exact: true }),
    ).toBeVisible();
    await first.getByRole("textbox").fill("My original decision 原文");
    const approve = first.getByRole("button", { name: c.approve, exact: true });
    expect((await approve.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (locale === "en") {
      await approve.focus();
      await page.keyboard.press("Enter");
    } else await approve.click();
    await expect(
      page.getByRole("heading", { name: c.approvedSaved, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(c.approvedHelp, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: c.reject, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: c.rejectedSaved, exact: true }),
    ).toBeVisible();
    expect(state.decisions).toEqual([
      {
        decision: "approved",
        locale,
        note: "My original decision 原文",
        expectedArgsHash: null,
      },
      { decision: "rejected", locale },
    ]);
    await page.getByRole("tab", { name: c.approved, exact: true }).click();
    await expect(
      page.getByText("My original decision 原文", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatch(new RegExp(`^approval-${locale}-`));
    expect([...unexpected]).toEqual([]);
  });

for (const locale of ["en", "ar"] as const)
  test(`${locale} host confirmation shows the exact action inside the keyboard dialog`, async ({
    page,
  }) => {
    const { c, state } = await setup(page, locale, [approval(21, true)]);
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 1000,
      height: 844,
    });
    if (locale === "ar")
      await page.addInitScript(() =>
        localStorage.setItem("acos.color-mode.v2", "light"),
      );
    await page.goto("/approvals");
    const opener = page.getByRole("button", { name: c.approve, exact: true });
    await expect(opener).toBeEnabled();
    if (locale === "ar")
      await page.screenshot({
        path: "test-results/approval-ar-card.png",
        fullPage: true,
      });
    await opener.click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("heading", { name: c.hostConfirm, exact: true }),
    ).toBeVisible();
    await expect(dialog.locator("pre")).toHaveText(scope.preview);
    await expect(dialog.getByText(scope.target, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(scope.argsHash, { exact: true }),
    ).toBeVisible();
    const input = dialog.getByLabel(c.confirmInput, { exact: true });
    await expect(input).toBeFocused();
    const submit = dialog.getByRole("button", {
      name: c.confirmSubmit,
      exact: true,
    });
    await input.fill("00000000");
    await expect(submit).toBeDisabled();
    await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.press("Enter");
    await input.fill("ABABABAB");
    await expect(submit).toBeEnabled();
    // Measure the settled dialog, including a quick close/reopen. The entry
    // animation deliberately translates it outside its final rectangle.
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations()
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
    await page.screenshot({
      path: `test-results/approval-${locale}-dialog.png`,
      fullPage: false,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await submit.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: c.approvedSaved, exact: true }),
    ).toBeVisible();
    expect(state.decisions).toEqual([
      {
        decision: "approved",
        locale,
        expectedArgsHash: scope.argsHash,
        confirmation: "abababab",
      },
    ]);
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeFocused();
  });

test("host permission expires while the confirmation remains open", async ({
  page,
}) => {
  const now = Date.now();
  const row = approval(21, true);
  row.expiresAt = new Date(now + 10000).toISOString();
  await page.clock.install({ time: now });
  const { c, state } = await setup(page, "en", [row]);
  await page.goto("/approvals");
  await page.getByRole("button", { name: c.approve, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel(c.confirmInput, { exact: true }).fill("abababab");
  await expect(
    dialog.getByRole("button", { name: c.confirmSubmit, exact: true }),
  ).toBeEnabled();
  await page.clock.fastForward(11000);
  await expect(dialog.getByText(c.expiredError, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: c.confirmSubmit, exact: true }),
  ).toBeDisabled();
  expect(state.decisions).toHaveLength(0);
});

test("a refreshed host command cannot reuse a review of the old scope", async ({
  page,
}) => {
  await page.clock.install();
  const { c, state } = await setup(page, "en", [approval(21, true)]);
  await page.goto("/approvals");
  await page.getByRole("button", { name: c.approve, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel(c.confirmInput, { exact: true }).fill("abababab");
  state.listError = true;
  await page.clock.fastForward(6000);
  await expect(dialog.getByText(c.stale, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: c.confirmSubmit, exact: true }),
  ).toBeDisabled();
  state.listError = false;
  state.records[0].scope = {
    ...scope,
    argsHash: "cd".repeat(32),
    preview: "Changed command",
  };
  await dialog.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(dialog.getByText(c.changedError, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: c.confirmSubmit, exact: true }),
  ).toBeDisabled();
  expect(state.decisions).toHaveLength(0);
  await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
  await page.getByRole("button", { name: c.approve, exact: true }).click();
  await expect(dialog.locator("pre")).toHaveText("Changed command");
});

test("an uncertain decision keeps the note and requires an explicit successful refresh", async ({
  page,
}) => {
  await page.clock.install();
  const { c, state } = await setup(page, "en");
  state.decisionError = true;
  await page.goto("/approvals");
  await page.getByRole("textbox").fill("Keep this note");
  const approve = page.getByRole("button", { name: c.approve, exact: true });
  await approve.click();
  await expect(page.getByText(c.unknownError, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("Keep this note");
  state.decisionError = false;
  await page.clock.fastForward(6000);
  await expect(approve).toBeDisabled();
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(
    page.getByRole("heading", { name: c.approvedSaved, exact: true }),
  ).toBeVisible();
  expect(state.decisions).toHaveLength(2);
  expect(state.decisions[1].note).toBe("Keep this note");
});

test("stale requests preserve notes and block decisions until the catalog recovers", async ({
  page,
}) => {
  const { c, state } = await setup(page, "en");
  await page.goto("/approvals");
  await page.getByRole("textbox").fill("Retained note");
  state.listError = true;
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(page.getByText(c.stale, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.approve, exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: c.reject, exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("textbox")).toHaveValue("Retained note");
  state.listError = false;
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.approve, exact: true }),
  ).toBeEnabled();
});

for (const stop of ["stopped", "safetyError"] as const)
  test(`${stop} blocks approval but permits rejection`, async ({ page }) => {
    const { c, state } = await setup(page, "en");
    state[stop] = true;
    await page.goto("/approvals");
    await expect(
      page.getByText(stop === "stopped" ? c.safetyStopped : c.safetyUnknown, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: c.approve, exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: c.reject, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: c.rejectedSaved, exact: true }),
    ).toBeVisible();
    expect(state.decisions).toEqual([{ decision: "rejected", locale: "en" }]);
  });

test("missing exact preview cannot be approved and older pages preserve drafts", async ({
  page,
}) => {
  const records = Array.from({ length: 20 }, (_, i) => approval(40 - i));
  records[0].scope = { ...scope, preview: "" };
  const { c, state } = await setup(page, "en", records);
  await page.goto("/approvals");
  const first = page.getByRole("article").first();
  await expect(
    first.getByRole("button", { name: c.approve, exact: true }),
  ).toBeDisabled();
  await first.getByRole("textbox").fill("Draft on first page");
  await page.getByRole("button", { name: c.older, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: c.emptyPage, exact: true }),
  ).toBeVisible();
  expect(state.queries.at(-1)!.get("beforeId")).toBe("21");
  expect(state.queries.at(-1)!.get("limit")).toBe("20");
  await page.getByRole("button", { name: c.newer, exact: true }).click();
  await expect(first.getByRole("textbox")).toHaveValue("Draft on first page");
});

test("a missing selected language chunk shows localized recovery", async ({
  page,
}) => {
  await setup(page, "de");
  await page.route("**/approval-de-*.js", (route) => route.abort());
  await page.goto("/approvals");
  await expect(page.getByRole("alert")).toContainText(
    "Die Sprachdatei für Freigaben konnte nicht geladen werden.",
  );
  await expect(page.getByRole("alert").getByRole("button")).toBeVisible();
});

test("an initial request failure is distinct from an empty inbox", async ({
  page,
}) => {
  const { c, state } = await setup(page, "en");
  state.listError = true;
  await page.goto("/approvals");
  await expect(page.getByText(c.loadError, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: c.emptyPending, exact: true }),
  ).toHaveCount(0);
  state.listError = false;
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.approve, exact: true }),
  ).toBeEnabled();
});

test("consumed permission history hides its preview and does not claim a successful action", async ({
  page,
}) => {
  const row = approval(21, true);
  row.status = "approved";
  row.consumedAt = new Date().toISOString();
  const { c } = await setup(page, "en", [row]);
  await page.goto("/approvals");
  await page.getByRole("tab", { name: c.approved, exact: true }).click();
  await expect(page.getByText(c.closedPreview, { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toContainText(c.consumedHelp);
  await expect(page.getByRole("article").locator("pre")).toHaveCount(0);
  await expect(page.getByRole("article").getByRole("button")).toHaveCount(0);
});
