import {
  inspectRoute,
  inspectReadableLabel,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import {
  loadMeetingCopy,
  meetingText,
} from "../../artifacts/agentic-company-os/src/lib/meeting-copy";
import { expect, test, type Page, type Route } from "@playwright/test";
import { LOCALES } from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadExpertChatCopy } from "../../artifacts/agentic-company-os/src/lib/expert-chat-copy";
import { loadComputerCopy } from "../../artifacts/agentic-company-os/src/lib/computer-copy";
import { loadProjectStudioCopy } from "../../artifacts/agentic-company-os/src/lib/project-studio-copy";
import { loadMeetingTurnCopy } from "../../artifacts/agentic-company-os/src/lib/meeting-turn-copy";
import { setupMessages } from "../../artifacts/agentic-company-os/src/lib/i18n";

for (const locale of LOCALES) {
  test(`${locale} delivery is visible before opening the evidence tab`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript(
      (selected) => localStorage.setItem("acos.locale.v1", selected),
      locale,
    );
    const harness = await installProjectStudioMocks(page);
    const c = await loadProjectStudioCopy(locale);
    await page.route("**/api/tasks/101", (route) =>
      json(route, {
        ...project,
        status: "completed",
        progressPercent: 100,
        completedAt: NOW,
        resultSummary:
          "## Delivered report\n\n[Open report](https://example.com/report)\n\nChecks: three supplied notes reviewed.\n\n<script>window.injected = true</script>\n\n[Unsafe link](javascript:alert(1))",
      }),
    );
    await page.goto("/projects/101?keep=original#handoff");
    const delivery = page.locator("#project-delivery-summary");
    await expect(delivery).toBeVisible();
    await expect(
      delivery.getByRole("heading", { name: c.deliverySummary, exact: true }),
    ).toBeVisible();
    await expect(
      delivery.getByRole("link", { name: "Open report", exact: true }),
    ).toHaveAttribute("href", "https://example.com/report");
    await expect(delivery.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(delivery.locator("script")).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: c.workspace, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await delivery.getByRole("button").click();
    await expect(page).toHaveURL(/keep=original&view=evidence#handoff$/u);
    await expect(
      page.getByRole("tab", { name: c.evidence, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText("Delivered report", { exact: true }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(harness.messagePosts).toEqual([]);
    expect(harness.meetingCreatePosts).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
    if (locale === "en")
      await page.screenshot({
        path: info.outputPath("delivery-phone.png"),
        fullPage: true,
      });
  });
}

test("completed work without a summary does not invent a delivery", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page);
  const c = await loadProjectStudioCopy("en");
  await page.route("**/api/tasks/101", (route) =>
    json(route, { ...project, status: "completed", resultSummary: "  " }),
  );
  await page.goto("/projects/101");
  await expect(page.locator("#project-delivery-summary")).toContainText(
    c.noDelivery,
  );
});

test("recurring work identifies the saved cycle without claiming the responsibility is finished", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page);
  await page.route("**/api/tasks/101", (route) =>
    json(route, {
      ...project,
      status: "pending",
      autonomyMode: "continuous",
      cadenceSeconds: 3600,
      resultSummary: "Last cycle report: two source changes found.",
      lastCycleCompletedAt: NOW,
    }),
  );
  await page.goto("/projects/101");
  const delivery = page.locator("#project-delivery-summary");
  await expect(delivery).toContainText(
    "This is the latest saved cycle summary. The current status of the recurring responsibility is shown above.",
  );
  await expect(delivery).toContainText(
    "Last cycle report: two source changes found.",
  );
});

for (const locale of LOCALES) {
  test(
    locale +
      " manual meeting receipt survives reload and preserves a newer draft",
    async ({ page }, info) => {
      const c = await loadMeetingCopy(locale);
      await page.setViewportSize({
        width: locale === "ar" ? 320 : 390,
        height: 844,
      });
      await page.addInitScript(
        (selected) => localStorage.setItem("acos.locale.v1", selected),
        locale,
      );
      await installProjectStudioMocks(page, {
        initialMeeting: meetingDetail("in_progress"),
      });
      let input: Record<string, unknown> | null = null,
        posts = 0,
        reads = 0;
      await page.route(
        "**/api/projects/101/meetings/901/decisions",
        (route) => {
          posts++;
          input = route.request().postDataJSON();
          return route.abort("failed");
        },
      );
      await page.route("**/api/projects/101/meeting-commands/*", (route) => {
        reads++;
        return json(route, {
          ...input,
          requestId: input!.requestId,
          projectId: 101,
          meetingId: 901,
          kind: "decision",
          httpStatus: 201,
          createdAt: NOW,
          response: {
            requestId: input!.requestId,
            projectId: 101,
            meetingId: 901,
            kind: "decision",
            entityId: 702,
            ok: true,
          },
        });
      });
      await page.goto("/projects/101?view=meetings");
      const draft = page.getByRole("textbox", {
        name: c.decisionLabel,
        exact: true,
      });
      await draft.fill("Original 原文 العربية");
      await page
        .getByRole("button", { name: c.addDecision, exact: true })
        .click();
      await expect.poll(() => posts).toBe(1);
      await expect(
        page.getByRole("button", { name: c.commandCheck, exact: true }),
      ).toBeVisible();
      await draft.fill("Newer draft 原文");
      await page.reload();
      await expect(draft).toHaveValue("Newer draft 原文");
      await expect(
        page.getByRole("button", { name: c.addDecision, exact: true }),
      ).toBeDisabled();
      expect(reads).toBe(0);
      await page
        .getByRole("button", { name: c.commandCheck, exact: true })
        .click();
      await expect(
        page.getByText(c.commandSaved, { exact: true }),
      ).toBeVisible();
      expect(posts).toBe(1);
      expect(reads).toBe(1);
      await page
        .getByRole("button", { name: c.commandReview, exact: true })
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(
        dialog.getByRole("textbox", { name: c.commandSource, exact: true }),
      ).toHaveValue(/Original 原文 العربية/);
      await expect(
        dialog.getByRole("textbox", { name: c.commandSource, exact: true }),
      ).not.toHaveValue(/ownerAgentId|"content"/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await dialog.screenshot({
        path: info.outputPath("manual-command-review.png"),
      });
      await dialog
        .getByRole("button", { name: c.commandConfirm, exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(draft).toHaveValue("Newer draft 原文");
      await expect(
        page.getByRole("button", { name: c.addDecision, exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("heading", { name: c.title, exact: true }),
      ).toBeFocused();
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("acos.meeting-command.v1:101"),
        ),
      ).toBeNull();
    },
  );
}

test("missing creation receipt retries the saved identity, then clears only its matching draft", async ({
  page,
}) => {
  const c = await loadMeetingCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page);
  const inputs: Record<string, unknown>[] = [];
  let created = false;
  await page.route("**/api/projects/101/meetings", (route) => {
    if (route.request().method() === "GET")
      return json(
        route,
        created
          ? [{ meeting: meetingDetail("draft").meeting, participantCount: 3 }]
          : [],
      );
    const input = route.request().postDataJSON();
    inputs.push(input);
    if (inputs.length === 1) return route.abort("failed");
    created = true;
    return json(
      route,
      {
        requestId: input.requestId,
        projectId: 101,
        meetingId: 901,
        kind: "create",
        entityId: 901,
        ok: true,
      },
      201,
    );
  });
  await page.route("**/api/projects/101/meetings/901", (route) =>
    json(route, meetingDetail("draft")),
  );
  await page.route("**/api/projects/101/meeting-commands/*", (route) =>
    json(route, { error: "missing" }, 404),
  );
  await page.goto("/projects/101?view=meetings");
  await page.getByRole("button", { name: c.newMeeting, exact: true }).click();
  await page
    .getByRole("textbox", { name: c.titleLabel, exact: true })
    .fill("Saved title");
  await page.getByRole("button", { name: c.saveDraft, exact: true }).click();
  await expect.poll(() => inputs.length).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: c.commandCheck, exact: true }).click();
  await page.getByRole("button", { name: c.commandRetry, exact: true }).click();
  await expect.poll(() => inputs.length).toBe(2);
  expect(inputs[1]).toEqual(inputs[0]);
  await page
    .getByRole("button", { name: c.commandReview, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.commandConfirm, exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: c.titleLabel, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: c.start, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.meeting-command.v1:101"),
    ),
  ).toBeNull();
});

for (const locale of ["en", "de", "ar"] as const) {
  test(
    locale +
      " damaged manual command stays visible without a listed meeting and clears only after review",
    async ({ page }) => {
      const c = await loadMeetingCopy(locale);
      await page.setViewportSize({ width: 320, height: 740 });
      await page.addInitScript((selected) => {
        localStorage.setItem("acos.locale.v1", selected);
        sessionStorage.setItem(
          "acos.meeting-command.v1:101",
          "Original damaged recovery 原文",
        );
      }, locale);
      const harness = await installProjectStudioMocks(page);
      await page.goto("/projects/101?view=meetings");
      await expect(
        page.getByText(c.commandDamaged, { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: c.newMeeting, exact: true })
        .click();
      await page
        .getByRole("textbox", { name: c.titleLabel, exact: true })
        .fill("Keep this draft");
      await expect(
        page.getByRole("button", { name: c.saveDraft, exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: c.commandReview, exact: true })
        .click();
      const dialog = page.getByRole("alertdialog");
      for (const button of await dialog.getByRole("button").all())
        await expect
          .poll(async () => (await button.boundingBox())?.height ?? 0)
          .toBeGreaterThanOrEqual(44);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await expect(
        dialog.getByRole("textbox", { name: c.commandSource, exact: true }),
      ).toHaveValue("Original damaged recovery 原文");
      await dialog
        .getByRole("button", { name: c.commandKeep, exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: c.commandReview, exact: true }),
      ).toBeFocused();
      await page
        .getByRole("button", { name: c.commandReview, exact: true })
        .click();
      await dialog
        .getByRole("button", { name: c.commandClear, exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: c.titleLabel, exact: true }),
      ).toHaveValue("Keep this draft");
      await expect(
        page.getByRole("button", { name: c.saveDraft, exact: true }),
      ).toBeEnabled();
      expect(harness.meetingCreatePosts).toEqual([]);
    },
  );
}

const NOW = "2026-08-30T09:00:00.000Z";

test("a recorded manual rejection preserves input after review and never replays the command", async ({
  page,
}) => {
  const c = await loadMeetingCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  let input: Record<string, unknown> | null = null,
    posts = 0;
  await page.route("**/api/projects/101/meetings/901/complete", (route) => {
    posts++;
    input = route.request().postDataJSON();
    return json(route, { error: "Private domain error" }, 409);
  });
  await page.route("**/api/projects/101/meeting-commands/*", (route) =>
    json(route, {
      requestId: input!.requestId,
      projectId: 101,
      meetingId: 901,
      kind: "complete",
      httpStatus: 409,
      createdAt: NOW,
      response: {
        requestId: input!.requestId,
        projectId: 101,
        meetingId: 901,
        kind: "complete",
        entityId: null,
        ok: false,
        code: "MEETING_STATE_CHANGED",
        error: "Private domain error",
      },
    }),
  );
  await page.goto("/projects/101?view=meetings");
  const summary = page.getByRole("textbox", { name: c.summary, exact: true });
  await summary.fill("Preserved closure 原文");
  await page.getByRole("button", { name: c.complete, exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await page.getByRole("button", { name: c.commandCheck, exact: true }).click();
  await expect(
    page.getByText(c.commandRejected, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: c.commandReview, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.commandConfirm, exact: true })
    .click();
  await expect(summary).toHaveValue("Preserved closure 原文");
  await expect(
    page.getByRole("button", { name: c.complete, exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Private domain error")).toHaveCount(0);
  expect(posts).toBe(1);
  expect(harness.meetingStartPosts).toEqual([]);
});

test("manual recovery storage failure keeps the action draft and sends nothing", async ({
  page,
}) => {
  const c = await loadMeetingCopy("en");
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith("acos.meeting-command.")) throw Error("blocked");
      return set.call(this, k, v);
    };
  });
  const harness = await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  await page.goto("/projects/101?view=meetings");
  const draft = page.getByRole("textbox", { name: c.actionLabel, exact: true });
  await draft.fill("Keep action 原文");
  await page.getByRole("button", { name: c.addAction, exact: true }).click();
  await expect(
    draft.locator("xpath=ancestor::form").getByRole("alert"),
  ).toHaveText(c.saveError);
  expect(harness.meetingActionPosts).toEqual([]);
  await expect(draft).toHaveValue("Keep action 原文");
});
const PROJECT_TITLE = "Açık kaynak ürün stüdyosunu teslim et";
const PROJECT_DRAFT =
  "Bağlantı hatasında bu proje talimatını kaybetmeden koru.";

for (const locale of LOCALES) {
  test(
    locale +
      " project shell restores links and supports directional keyboard navigation",
    async ({ page }, info) => {
      const c = await loadProjectStudioCopy(locale);
      await page.setViewportSize({
        width: locale === "ar" ? 320 : 390,
        height: 844,
      });
      await page.emulateMedia({
        colorScheme: ["ar", "de", "zh-TW"].includes(locale) ? "light" : "dark",
      });
      await page.addInitScript(
        (selected) => localStorage.setItem("acos.locale.v1", selected),
        locale,
      );
      const harness = await installProjectStudioMocks(page);
      await page.goto("/projects/101?view=team&keep=1");
      const summary = page.getByRole("region", {
        name: c.runSummary,
        exact: true,
      });
      await expect(
        summary.getByText(c.completedWork, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("iz doğrulandı", { exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: c.stop, exact: true }).click();
      const confirmation = page.getByRole("alertdialog");
      await expect(
        confirmation.getByRole("button", { name: c.dismiss, exact: true }),
      ).toBeFocused();
      await expect
        .poll(
          async () =>
            (
              await confirmation
                .getByRole("button", { name: c.confirmStop, exact: true })
                .boundingBox()
            )?.height ?? 0,
        )
        .toBeGreaterThanOrEqual(44);
      await confirmation
        .getByRole("button", { name: c.dismiss, exact: true })
        .click();
      const tabs = page.getByRole("tablist", { name: c.tabs });
      const team = tabs.getByRole("tab", { name: c.teamTab, exact: true });
      const delivery = tabs.getByRole("tab", { name: c.evidence, exact: true });
      await expect(team).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("heading", { name: c.team, exact: true }),
      ).toBeVisible();
      await team.focus();
      await team.press(locale === "ar" ? "ArrowLeft" : "ArrowRight");
      await expect(delivery).toBeFocused();
      await expect(delivery).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL(/view=evidence&keep=1/);
      await expect(
        page.locator("#" + (await delivery.getAttribute("aria-controls"))),
      ).toHaveAttribute(
        "aria-labelledby",
        (await delivery.getAttribute("id")) as string,
      );
      await expect(
        page.getByRole("heading", { name: c.records, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Project Studio tarayıcı kabul testi çalıştırıldı", {
          exact: true,
        }),
      ).toBeVisible();
      await page.reload();
      await expect(delivery).toHaveAttribute("aria-selected", "true");
      await page.goBack();
      await expect(team).toHaveAttribute("aria-selected", "true");
      await page.goForward();
      await expect(delivery).toHaveAttribute("aria-selected", "true");
      await delivery.focus();
      await delivery.press("Home");
      const first = tabs.getByRole("tab", { name: c.workspace, exact: true });
      await expect(first).toBeFocused();
      await first.press("End");
      await expect(delivery).toBeFocused();
      expect((await delivery.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
      if (locale === "en" || locale === "ar") {
        await page.screenshot({
          path: info.outputPath("project-shell-" + locale + ".png"),
        });
        await page
          .getByRole("heading", { name: c.records, exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("project-evidence-" + locale + ".png"),
        });
      }
      expect([...harness.unexpected]).toEqual([]);
    },
  );
}

test("project stop retains uncertainty across reload and checks without replay", async ({
  page,
}, info) => {
  const c = await loadProjectStudioCopy("en");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page);
  let postCount = 0;
  let cancelled = false;
  let release: (() => void) | undefined;
  const waitForReply = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks/101/cancel", async (route) => {
    postCount++;
    await waitForReply;
    cancelled = true;
    return route.fulfill({
      status: 503,
      json: { error: "private-cancel-upstream" },
    });
  });
  await page.route("**/api/tasks/101", (route) =>
    route.fulfill({
      json: { ...project, status: cancelled ? "cancelled" : project.status },
    }),
  );
  await page.goto("/projects/101");
  await page.getByRole("button", { name: c.stop, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: c.dismiss, exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: c.confirmStop, exact: true })
    .click();
  await expect.poll(() => postCount).toBe(1);
  await expect(dialog).toBeVisible();
  const busy = dialog.getByRole("button", { name: c.stopping, exact: true });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.project-stop.v1:101"),
    ),
  ).not.toBeNull();
  release!();
  await expect(dialog.getByText(c.unknownStop, { exact: true })).toBeVisible();
  await expect(page.getByText("private-cancel-upstream")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(c.unknownStop, { exact: true })).toBeVisible();
  expect(postCount).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("project-stop-recovery-phone.png"),
  });
  await page.getByRole("button", { name: c.checkState, exact: true }).click();
  await expect(page.getByText(/^Server state: Cancelled/)).toBeVisible();
  expect(postCount).toBe(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.project-stop.v1:101"),
    ),
  ).toBeNull();
});

test("project stop storage failure dispatches nothing and keeps confirmation open", async ({
  page,
}) => {
  const c = await loadProjectStudioCopy("en");
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.project-stop"))
        throw new DOMException("Full", "QuotaExceededError");
      return write.call(this, key, value);
    };
  });
  const harness = await installProjectStudioMocks(page);
  let posts = 0;
  await page.route("**/api/tasks/101/cancel", (route) => {
    posts++;
    return route.fulfill({ json: { ...project, status: "cancelled" } });
  });
  await page.goto("/projects/101");
  await page.getByRole("button", { name: c.stop, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("button", { name: c.confirmStop, exact: true })
    .click();
  await expect(dialog.getByText(c.storageError, { exact: true })).toBeVisible();
  expect(posts).toBe(0);
  await dialog.getByRole("button", { name: c.dismiss, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.stop, exact: true }),
  ).toBeFocused();
  expect([...harness.unexpected]).toEqual([]);
});

test("refresh failures preserve the project, draft and activity records", async ({
  page,
}) => {
  const c = await loadProjectStudioCopy("en");
  const chat = await loadExpertChatCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page);
  let failed = false;
  await page.route("**/api/tasks/101", (route) =>
    route.fulfill({
      status: failed ? 503 : 200,
      json: failed ? { error: "private-refresh-error" } : project,
    }),
  );
  await page.route("**/api/tasks/101/activity?**", (route) =>
    route.fulfill({
      status: failed ? 503 : 200,
      json: failed ? { error: "private-refresh-error" } : projectActivity,
    }),
  );
  await page.goto("/projects/101?view=evidence");
  const composer = page.getByRole("textbox", { name: chat.instruction });
  await composer.fill("Unsent project draft 原文");
  failed = true;
  await expect(page.getByText(c.stale, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    PROJECT_TITLE,
  );
  await expect(composer).toHaveValue("Unsent project draft 原文");
  await expect(page.getByText(c.recordsError, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Project Studio tarayıcı kabul testi çalıştırıldı", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: chat.send, exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("private-refresh-error")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: c.checkState, exact: true }).click();
  await expect(page.getByText(c.stale, { exact: true })).toHaveCount(0);
  await expect(composer).toHaveValue("Unsent project draft 原文");
});

for (const locale of LOCALES) {
  test(`${locale} project chat preserves scoped recovery, native composition and phone controls`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.emulateMedia({
      colorScheme: locale === "ar" || locale === "de" ? "light" : "dark",
    });
    await page.addInitScript(
      (selected) => localStorage.setItem("acos.locale.v1", selected),
      locale,
    );
    const harness = await installProjectStudioMocks(page);
    if (locale === "en")
      await page.route("**/api/agents?**", (route) =>
        route.fulfill({
          json: [
            {
              ...owner,
              modelMode: "manual",
              modelId: "minimax/minimax-m3:free",
            },
            engineer,
            chiefExecutive,
          ],
        }),
      );
    const c = await loadExpertChatCopy(locale);
    const posts: Record<string, any>[] = [];
    let receipt: Record<string, any> | undefined;
    let hideReceipt = true;
    await page.route("**/api/agents/1/requests**", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          status: hideReceipt ? 503 : receipt ? 200 : 404,
          json: hideReceipt
            ? { error: "private-upstream-project-error" }
            : (receipt ?? { code: "AGENT_REQUEST_NOT_FOUND" }),
        });
      const input = route.request().postDataJSON();
      posts.push(input);
      const user = {
        id: 991,
        agentId: 1,
        taskId: 101,
        content: input.content,
        role: "user",
        modelId: null,
        createdAt: NOW,
      };
      receipt = {
        requestId: input.requestId,
        agentId: 1,
        taskId: 101,
        kind: "ask",
        deliveryState: "complete",
        outcome: "reply",
        replayed: true,
        createdTasks: [],
        createdAgents: [],
        userMessage: user,
        agentMessage: {
          ...user,
          id: 992,
          role: "agent",
          content: "Recorded project reply 原文",
        },
      };
      return route.fulfill({
        status: 503,
        json: { error: "private-upstream-project-error" },
      });
    });
    await page.goto("/projects/101");
    const chat = page.getByRole("region", {
      name: c.projectTitle,
      exact: true,
    });
    const composer = chat.getByRole("textbox", { name: c.instruction });
    const send = chat.getByRole("button", { name: c.send, exact: true });
    await expect(chat.getByRole("radio")).toHaveCount(0);
    await expect(chat.getByText(c.projectHelp, { exact: true })).toBeVisible();
    await send.click();
    await expect(chat.getByText(c.required, { exact: true })).toBeVisible();
    await expect(composer).toBeFocused();
    const content = "Project 原文 / مشروع / özgün";
    await composer.fill(content);
    await composer.press("Enter");
    await expect(composer).toHaveValue(content + "\n");
    await composer.dispatchEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
      keyCode: 229,
    });
    expect(posts).toHaveLength(0);
    await composer.press("Control+Enter");
    await expect(
      chat.getByText(c.unconfirmed, { exact: true }).first(),
    ).toBeVisible();
    await expect(composer).toHaveValue(content + "\n");
    await expect(composer).not.toBeEditable();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      taskId: 101,
      kind: "ask",
      locale,
      content: content + "\n",
      expectedConfig: owner.configVersion,
      ...(locale === "en"
        ? { modelMode: "manual", modelId: "minimax/minimax-m3:free" }
        : { modelMode: "auto" }),
    });
    const saved = await page.evaluate(() => ({
      project: sessionStorage.getItem("acos.expert-send.v1:1:project:101"),
      direct: sessionStorage.getItem("acos.expert-send.v1:1"),
    }));
    expect(JSON.parse(saved.project!).input).toEqual(posts[0]);
    expect(saved.direct).toBeNull();
    hideReceipt = false;
    await page.reload();
    await expect(chat.getByText(c.done, { exact: true })).toBeVisible();
    await expect(
      chat.getByText("Recorded project reply 原文", { exact: true }),
    ).toBeVisible();
    await expect(composer).toHaveValue("");
    expect(posts).toHaveLength(1);
    await expect(page.getByText("private-upstream-project-error")).toHaveCount(
      0,
    );
    expect(
      await composer.evaluate((node) =>
        parseFloat(getComputedStyle(node).fontSize),
      ),
    ).toBeGreaterThanOrEqual(16);
    expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.locator("html").getAttribute("dir")).toBe(
      locale === "ar" ? "rtl" : "ltr",
    );
    if (locale === "ar" || locale === "en") {
      if (locale === "en")
        await page.setViewportSize({ width: 1365, height: 950 });
      await chat.evaluate((node) => node.scrollIntoView({ block: "start" }));
      await page.screenshot({
        path: info.outputPath(`project-chat-${locale}-header.png`),
      });
      await composer.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`project-chat-${locale}-composer.png`),
      });
    }
    expect([...harness.unexpected]).toEqual([]);
  });
}

const owner = {
  id: 1,
  configVersion: "a".repeat(64),
  name: "Atlas",
  role: "Product Lead",
  department: "Ürün",
  parentAgentId: null,
  depth: 0,
  status: "working",
  currentTaskId: 101,
  currentAction: "Proje kanıtlarını doğruluyor",
  lastActiveAt: NOW,
  systemPrompt: "İş sonucunu doğrulanabilir bir teslimata dönüştür.",
  isCustomPrompt: false,
  templateKey: "ceo",
  modelMode: "auto",
  modelId: null,
  avatarColor: "#315bff",
  avatarVersion: null,
  permissions: {
    canCreateSubAgents: true,
    canDelegate: true,
    canSpend: false,
    canDelete: false,
    canPublish: false,
    canContactExternal: false,
    canBrowse: true,
    canUseTerminal: true,
    canUseSudo: false,
  },
  createdByAgentId: null,
  createdByUser: true,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const engineer = {
  ...owner,
  id: 2,
  name: "Rune",
  role: "Delivery Engineer",
  department: "Mühendislik",
  parentAgentId: 1,
  depth: 1,
  currentTaskId: 102,
  currentAction: "Mobil çalışma alanını test ediyor",
  templateKey: "engineer",
  avatarColor: "#138a63",
  createdByAgentId: 1,
  createdByUser: false,
};

const chiefExecutive = {
  ...owner,
  id: 3,
  name: "Mira",
  role: "CEO",
  department: "Yönetim",
  status: "idle",
  currentTaskId: null,
  currentAction: null,
  templateKey: "ceo",
  avatarColor: "#7c3aed",
};

const projectMembers = [
  {
    taskId: 101,
    agentId: owner.id,
    membershipRole: "coordinator",
    addedAt: NOW,
    agent: owner,
  },
  {
    taskId: 101,
    agentId: engineer.id,
    membershipRole: "member",
    addedAt: NOW,
    agent: engineer,
  },
  {
    taskId: 101,
    agentId: chiefExecutive.id,
    membershipRole: "member",
    addedAt: NOW,
    agent: chiefExecutive,
  },
];

const project = {
  id: 101,
  title: PROJECT_TITLE,
  brief:
    "Proje konuşmasını, çalışma alanını ve teslim kanıtlarını tek kalıcı bağlamda birleştir.",
  status: "in_progress",
  priority: "high",
  ownerAgentId: 1,
  assignedByAgentId: null,
  createdByUser: true,
  parentTaskId: null,
  progressPercent: 68,
  tokensUsed: 12640,
  estimatedCostUsd: "0.31",
  resultSummary: null,
  executionModelId: "openai/gpt-5-mini",
  lastModelId: "openai/gpt-5-mini",
  lastModelProvider: "openrouter",
  modelFallbackCount: 0,
  autonomyMode: "finite",
  cadenceSeconds: null,
  lastHeartbeatAt: NOW,
  recoveryCount: 0,
  cycleCount: 1,
  lastCycleCompletedAt: null,
  lastSteppedAt: NOW,
  stepAttempts: 2,
  consecutiveFailures: 0,
  nextAttemptAt: null,
  lastError: null,
  blockedReason: null,
  dueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
};

const subtask = {
  ...project,
  id: 102,
  title: "Mobil çalışma alanını doğrula",
  brief: "Dar ekranda çalışma alanını önce göster ve taşmayı engelle.",
  ownerAgentId: 2,
  assignedByAgentId: 1,
  createdByUser: false,
  parentTaskId: 101,
  progressPercent: 80,
  tokensUsed: 2140,
  estimatedCostUsd: "0.05",
  executionModelId: null,
  lastModelId: null,
  lastModelProvider: null,
};

const projectActivity = [
  {
    id: 1,
    agentId: 1,
    taskId: 101,
    type: "task_created",
    summary: "Proje kaydı oluşturuldu",
    detail: { status: "pending" },
    severity: "info",
    createdAt: "2026-08-30T08:00:00.000Z",
  },
  {
    id: 2,
    agentId: 1,
    taskId: 101,
    type: "task_delegated",
    summary: "Mobil doğrulama Rune'a devredildi",
    detail: { toAgentId: 2 },
    severity: "info",
    createdAt: "2026-08-30T08:10:00.000Z",
  },
  {
    id: 3,
    agentId: 2,
    taskId: 101,
    type: "vm_command",
    summary: "Project Studio tarayıcı kabul testi çalıştırıldı",
    detail: {
      actor: "agent",
      phase: "verify",
      surface: "terminal",
      tool: "playwright",
      status: "succeeded",
    },
    severity: "info",
    createdAt: NOW,
  },
];

const projectMessages = [
  {
    id: 31,
    agentId: 1,
    role: "user",
    content: "Yalnız bu projenin teslim risklerini sırala.",
    taskId: 101,
    modelId: null,
    createdAt: "2026-08-30T08:40:00.000Z",
  },
  {
    id: 32,
    agentId: 1,
    role: "agent",
    content:
      "Proje bağlamı doğrulandı; mobil taşma ve teslim kanıtı izleniyor.",
    taskId: 101,
    modelId: "openai/gpt-5-mini",
    createdAt: "2026-08-30T08:41:00.000Z",
  },
];

const directAgentMessages = [
  {
    id: 7,
    agentId: 1,
    role: "agent",
    content: "DOĞRUDAN AJAN SOHBETİ PROJEYE SIZDI",
    taskId: null,
    modelId: null,
    createdAt: NOW,
  },
];

const opsControl = {
  emergencyStopEnabled: false,
  reason: null,
  version: 1,
  updatedBy: "project-studio-spec",
  updatedAt: NOW,
  blockedScopes: [
    "agent_chat",
    "task_scheduler",
    "agent_tools",
    "approved_actions",
  ],
};

const modelCatalog = {
  providers: [{ id: "openrouter", label: "OpenRouter", available: true }],
  models: [
    {
      id: "openai/gpt-5-mini",
      label: "GPT-5 mini",
      tier: "balanced",
      provider: "openrouter",
      description: "Project Studio test fixture",
      supportsTools: true,
      isDefault: true,
    },
  ],
};

const vmStatus = {
  agentId: 1,
  workspaceId: "agent-1",
  lifecycle: "ready",
  isolation: "filesystem_sandbox",
  persistent: true,
  processExecutionEnabled: true,
  exists: true,
  cwd: ".",
  totalBytes: 4096,
  fileCount: 8,
  dirCount: 3,
};

const browserView = {
  available: false,
  pngBase64: null,
  url: null,
  title: null,
  visible: false,
  control: {
    owner: "agent",
    leaseId: null,
    leaseExpiresAt: null,
    agentActionInFlight: false,
  },
  width: 1280,
  height: 720,
  note: "Project Studio deterministic fixture",
};

const meetingBase = {
  id: 901,
  taskId: 101,
  title: "Sürüm karar toplantısı",
  agenda: "Kalan riskleri ve teslim sahibini netleştir.",
  status: "draft",
  scheduledFor: null,
  startedAt: null,
  endedAt: null,
  summary: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const meetingParticipants = [
  {
    meetingId: 901,
    agentId: 1,
    addedAt: NOW,
    name: "Atlas",
    role: "Product Lead",
    avatarColor: "#315bff",
    isActive: true,
  },
  {
    meetingId: 901,
    agentId: 2,
    addedAt: NOW,
    name: "Rune",
    role: "Delivery Engineer",
    avatarColor: "#138a63",
    isActive: true,
  },
  {
    meetingId: 901,
    agentId: 3,
    addedAt: NOW,
    name: "Mira",
    role: "CEO",
    avatarColor: "#7c3aed",
    isActive: true,
  },
];

function meetingDetail(status = "draft", participants = meetingParticipants) {
  const hasRecords = status === "in_progress" || status === "completed";

  return {
    meeting: {
      ...meetingBase,
      status,
      startedAt: hasRecords ? NOW : null,
      endedAt: status === "completed" ? NOW : null,
      summary:
        status === "completed"
          ? "Yayın engelleri kapatıldı ve teslim sahipleri netleştirildi."
          : null,
    },
    participants,
    transcript: hasRecords
      ? [
          {
            id: 801,
            meetingId: 901,
            speakerType: "agent",
            speakerAgentId: 2,
            content: "Mobil kabul testi geçti; yayın kararı için kanıt hazır.",
            replyToTranscriptId: null,
            occurredAt: NOW,
            createdAt: NOW,
            speakerName: "Rune",
            speakerRole: "Delivery Engineer",
            speakerAvatarColor: "#138a63",
          },
        ]
      : [],
    decisions: hasRecords
      ? [
          {
            id: 701,
            meetingId: 901,
            content: "Mobil kabul kanıtı teslim paketine eklenecek.",
            rationale: null,
            ownerAgentId: 1,
            createdAt: NOW,
            ownerName: "Atlas",
            ownerRole: "Product Lead",
          },
        ]
      : [],
    actionItems: hasRecords
      ? [
          {
            id: 601,
            meetingId: 901,
            title: "Teslim paketini güncelle",
            details: null,
            ownerAgentId: 2,
            status: "open",
            dueAt: null,
            completedAt: null,
            createdAt: NOW,
            updatedAt: NOW,
            ownerName: "Rune",
            ownerRole: "Delivery Engineer",
          },
        ]
      : [],
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function installProjectStudioMocks(
  page: Page,
  options: { initialMeeting?: ReturnType<typeof meetingDetail> } = {},
) {
  const unexpected = new Set<string>();
  const messageGetQueries: string[] = [];
  const messagePosts: unknown[] = [];
  const meetingCreatePosts: unknown[] = [];
  const meetingStartPosts: unknown[] = [];
  const meetingDecisionPosts: unknown[] = [];
  const meetingActionPosts: unknown[] = [];
  const meetingActionPatchPosts: unknown[] = [];
  const meetingCompletePosts: unknown[] = [];
  let currentMeeting: ReturnType<typeof meetingDetail> | null =
    options.initialMeeting ?? null;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/status") {
      return json(route, {
        enabled: false,
        authenticated: true,
        sessionExpiresAt: null,
      });
    }
    if (path === "/api/settings/locale" && method === "PUT") {
      return json(route, request.postDataJSON());
    }
    if (path === "/api/ops/control") return json(route, opsControl);
    if (path === "/api/healthz") return json(route, { status: "ok" });
    if (path === "/api/org/summary") {
      return json(route, {
        totalAgents: 3,
        activeAgents: 3,
        workingAgents: 2,
        tasksInProgress: 2,
        tasksAwaitingApproval: 0,
        tasksCompletedToday: 0,
        pendingApprovals: 0,
        tokensUsedToday: 14780,
        estimatedCostTodayUsd: 0.36,
        usageEventsToday: 2,
        costReportedEventsToday: 2,
      });
    }
    if (path === "/api/model-catalog") return json(route, modelCatalog);
    if (path === "/api/tasks/101/members") {
      return json(route, projectMembers);
    }
    if (path === "/api/tasks/101") return json(route, project);
    if (path === "/api/tasks/101/subtasks") return json(route, [subtask]);
    if (path === "/api/tasks/101/activity") {
      return json(route, projectActivity);
    }
    if (path === "/api/tasks/102/activity") {
      return json(route, [
        {
          ...projectActivity[2],
          id: 4,
          taskId: 102,
          summary: "Mobil kabul testi alt görevde doğrulandı",
        },
      ]);
    }
    if (path === "/api/projects/101/meetings" && method === "GET") {
      return json(
        route,
        currentMeeting
          ? [
              {
                meeting: currentMeeting.meeting,
                participantCount: currentMeeting.participants.length,
              },
            ]
          : [],
      );
    }
    if (path === "/api/projects/101/meetings" && method === "POST") {
      meetingCreatePosts.push(request.postDataJSON());
      currentMeeting = meetingDetail("draft");
      return json(
        route,
        {
          requestId: request.postDataJSON().requestId,
          projectId: 101,
          meetingId: 901,
          kind: "create",
          entityId: 901,
          ok: true,
        },
        201,
      );
    }
    if (path === "/api/projects/101/meetings/901/start" && method === "POST") {
      meetingStartPosts.push(request.postDataJSON());
      currentMeeting = meetingDetail("in_progress");
      return json(route, {
        ...currentMeeting,
        requestId: request.postDataJSON().requestId,
        execution: {
          requestedParticipantCount: 3,
          attemptedParticipantCount: 3,
          maxRespondersPerStart: 8,
          maxConcurrentMeetingStarts: 2,
          maxTokensPerResponse: 300,
        },
        agentTranscriptIds: [801],
        skippedParticipants: [],
      });
    }
    if (path === "/api/projects/101/meetings/901" && method === "GET") {
      return currentMeeting
        ? json(route, currentMeeting)
        : json(route, { error: "Meeting not found" }, 404);
    }
    if (
      path === "/api/projects/101/meetings/901/decisions" &&
      method === "POST"
    ) {
      const input = request.postDataJSON() as {
        content: string;
        ownerAgentId: number | null;
      };
      meetingDecisionPosts.push(input);
      const decision = {
        id: 702,
        meetingId: 901,
        content: input.content,
        rationale: null,
        ownerAgentId: input.ownerAgentId,
        createdAt: NOW,
        ownerName:
          meetingParticipants.find(
            (participant) => participant.agentId === input.ownerAgentId,
          )?.name ?? null,
        ownerRole: null,
      };
      if (currentMeeting) {
        currentMeeting = {
          ...currentMeeting,
          decisions: [...currentMeeting.decisions, decision],
        };
      }
      return json(
        route,
        {
          requestId: request.postDataJSON().requestId,
          projectId: 101,
          meetingId: 901,
          kind: "decision",
          entityId: decision.id,
          ok: true,
        },
        201,
      );
    }
    if (
      path === "/api/projects/101/meetings/901/action-items" &&
      method === "POST"
    ) {
      const input = request.postDataJSON() as {
        title: string;
        ownerAgentId: number | null;
      };
      meetingActionPosts.push(input);
      const action = {
        id: 602,
        meetingId: 901,
        title: input.title,
        details: null,
        ownerAgentId: input.ownerAgentId,
        status: "open",
        dueAt: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        ownerName:
          meetingParticipants.find(
            (participant) => participant.agentId === input.ownerAgentId,
          )?.name ?? null,
        ownerRole: null,
      };
      if (currentMeeting) {
        currentMeeting = {
          ...currentMeeting,
          actionItems: [...currentMeeting.actionItems, action],
        };
      }
      return json(
        route,
        {
          requestId: request.postDataJSON().requestId,
          projectId: 101,
          meetingId: 901,
          kind: "action",
          entityId: action.id,
          ok: true,
        },
        201,
      );
    }
    if (
      path === "/api/projects/101/meetings/901/action-items/601" &&
      method === "PATCH"
    ) {
      const input = request.postDataJSON() as { status: string };
      meetingActionPatchPosts.push(input);
      if (currentMeeting) {
        currentMeeting = {
          ...currentMeeting,
          actionItems: currentMeeting.actionItems.map((item) =>
            item.id === 601 ? { ...item, status: input.status } : item,
          ),
        };
      }
      return json(route, {
        requestId: request.postDataJSON().requestId,
        projectId: 101,
        meetingId: 901,
        kind: "action-update",
        entityId: 601,
        ok: true,
      });
    }
    if (
      path === "/api/projects/101/meetings/901/complete" &&
      method === "POST"
    ) {
      const input = request.postDataJSON() as { summary: string };
      meetingCompletePosts.push(input);
      if (currentMeeting) {
        currentMeeting = {
          ...currentMeeting,
          meeting: {
            ...currentMeeting.meeting,
            status: "completed",
            summary: input.summary,
            endedAt: NOW,
            updatedAt: NOW,
          },
        };
      }
      return json(route, {
        requestId: request.postDataJSON().requestId,
        projectId: 101,
        meetingId: 901,
        kind: "complete",
        entityId: 901,
        ok: true,
      });
    }
    if (path === "/api/agents") {
      return json(route, [owner, engineer, chiefExecutive]);
    }
    if (path === "/api/activity") {
      const agentId = url.searchParams.get("agentId");
      const taskId = url.searchParams.get("taskId");
      const beforeId = url.searchParams.get("beforeId");
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const scoped = projectActivity
        .filter(
          (event) =>
            (agentId === null || event.agentId === Number(agentId)) &&
            (taskId === null || event.taskId === Number(taskId)) &&
            (beforeId === null || event.id < Number(beforeId)),
        )
        .sort((a, b) => b.id - a.id);
      const records = scoped.slice(0, limit);
      return route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        headers:
          scoped.length > limit
            ? { "X-Next-Before-Id": String(records.at(-1)!.id) }
            : {},
        body: JSON.stringify(records),
      });
    }
    if (path === "/api/agents/1/vm/status") return json(route, vmStatus);
    if (path === "/api/agents/1/browser/view") {
      return json(route, browserView);
    }
    if (path === "/api/agents/1/messages" && method === "GET") {
      messageGetQueries.push(url.search);
      return json(
        route,
        url.searchParams.get("taskId") === "101"
          ? projectMessages
          : directAgentMessages,
      );
    }
    if (path === "/api/agents/1/requests" && method === "POST") {
      messagePosts.push(request.postDataJSON());
      return json(route, { error: "Project message fixture failure" }, 503);
    }
    if (path.startsWith("/api/agents/1/requests/") && method === "GET")
      return json(route, { code: "AGENT_REQUEST_NOT_FOUND" }, 404);

    unexpected.add(`${method} ${path}${url.search}`);
    return json(route, { error: "Unexpected Project Studio API request" }, 501);
  });

  return {
    unexpected,
    messageGetQueries,
    messagePosts,
    meetingCreatePosts,
    meetingStartPosts,
    meetingDecisionPosts,
    meetingActionPosts,
    meetingActionPatchPosts,
    meetingCompletePosts,
  };
}

test.describe("Project Studio", () => {
  test("keeps the project trace, workbench, team, delivery, and conversation in one scoped room", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 950 });
    const harness = await installProjectStudioMocks(page);

    await page.goto("/projects/101");

    await expect(
      page.getByRole("heading", { name: PROJECT_TITLE, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Kayıt özeti", exact: true }),
    ).toBeVisible();
    const recordedSummary = page.getByRole("region", {
      name: "Kayıt özeti",
      exact: true,
    });
    await expect(
      recordedSummary.getByText("Kayıtlı durum", { exact: true }),
    ).toBeVisible();
    await expect(
      recordedSummary.getByText("Sürüyor", { exact: true }),
    ).toBeVisible();
    await expect(
      recordedSummary.getByText("0 / 1", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("iz doğrulandı", { exact: true })).toHaveCount(
      0,
    );

    await expect(
      page.getByRole("heading", { name: "Proje konuşması", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Proje bağlamı doğrulandı; mobil taşma ve teslim kanıtı izleniyor.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("DOĞRUDAN AJAN SOHBETİ PROJEYE SIZDI"),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        harness.messageGetQueries.some(
          (query) => new URLSearchParams(query).get("taskId") === "101",
        ),
      )
      .toBe(true);

    const workbenchTabs = page.getByRole("tablist", {
      name: "Proje çalışma alanı görünümleri",
    });
    const workspaceTab = workbenchTabs.getByRole("tab", {
      name: "Çalışma alanı",
    });
    const planTab = workbenchTabs.getByRole("tab", { name: "Plan ve iz" });
    await expect(workspaceTab).toHaveAttribute("aria-selected", "true");
    await expect(workspaceTab).toHaveAttribute("tabindex", "0");
    await expect(planTab).toHaveAttribute("tabindex", "-1");

    await workspaceTab.focus();
    await workspaceTab.press("ArrowRight");
    await expect(planTab).toBeFocused();
    await expect(planTab).toHaveAttribute("aria-selected", "true");
    await expect(planTab).toHaveAttribute("tabindex", "0");
    await expect(workspaceTab).toHaveAttribute("tabindex", "-1");

    await expect(
      page.getByRole("heading", { name: "Faaliyet kayıtları" }),
    ).toBeVisible();

    await workbenchTabs.getByRole("tab", { name: "Ekip", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Proje ekibi" }),
    ).toBeVisible();
    const projectTeam = page.locator("#project-workbench-team");
    await expect(
      projectTeam.getByText("3 kişilik ekip", { exact: true }),
    ).toBeVisible();
    await expect(projectTeam.locator('a[href="/agents/1"]')).toContainText(
      "Atlas",
    );
    await expect(projectTeam.locator('a[href="/agents/2"]')).toContainText(
      "Rune",
    );
    await expect(projectTeam.locator('a[href="/agents/3"]')).toContainText(
      "Mira",
    );
    await expect(
      page.getByRole("heading", {
        name: "Mobil çalışma alanını doğrula",
        exact: true,
      }),
    ).toBeVisible();

    await workbenchTabs
      .getByRole("tab", { name: "Teslim", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Faaliyet kayıtları" }),
    ).toBeVisible();
    await expect(
      page.getByText("Project Studio tarayıcı kabul testi çalıştırıldı"),
    ).toBeVisible();

    await workbenchTabs
      .getByRole("tab", { name: "Toplantılar", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Proje toplantıları" }),
    ).toBeVisible();
    await expect(page.getByText("Henüz toplantı yok")).toBeVisible();

    await page.getByRole("button", { name: "Yeni toplantı" }).click();
    await page
      .getByRole("textbox", { name: "Toplantı başlığı" })
      .fill("Sürüm karar toplantısı");
    await page
      .getByRole("textbox", { name: /Gündem/ })
      .fill("Kalan riskleri ve teslim sahibini netleştir.");
    const participantPicker = page.getByRole("group", {
      name: "Katılımcılar",
    });
    await expect(
      participantPicker.getByRole("button", { name: /Atlas/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      participantPicker.getByRole("button", { name: /Rune/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      participantPicker.getByRole("button", { name: /Mira/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Seçilen katılımcı: 3")).toBeVisible();
    await page
      .getByRole("button", { name: "Taslağı kaydet", exact: true })
      .click();

    await expect.poll(() => harness.meetingCreatePosts.length).toBe(1);
    expect(harness.meetingStartPosts).toEqual([]);
    await page
      .getByRole("button", { name: "Toplantıyı başlat", exact: true })
      .click();
    await expect.poll(() => harness.meetingStartPosts.length).toBe(1);
    expect(harness.meetingCreatePosts).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: "Sürüm karar toplantısı",
        agenda: "Kalan riskleri ve teslim sahibini netleştir.",
        participantAgentIds: [1, 2, 3],
      },
    ]);
    expect(harness.meetingStartPosts).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        prompt: "Kalan riskleri ve teslim sahibini netleştir.",
        participantAgentIds: [1, 2, 3],
      },
    ]);
    await expect(
      page.getByText("Mobil kabul testi geçti; yayın kararı için kanıt hazır."),
    ).toBeVisible();
    await expect(
      page.getByText("Mobil kabul kanıtı teslim paketine eklenecek."),
    ).toBeVisible();
    await expect(page.getByText("Teslim paketini güncelle")).toBeVisible();

    const decisionOwner = page.getByRole("combobox", {
      name: "Karar sahibi",
    });
    const actionOwner = page.getByRole("combobox", {
      name: "Aksiyon sahibi",
    });
    await decisionOwner.click();
    await expect(page.getByRole("option")).toHaveText([
      "Sahip seçilmedi",
      "Atlas",
      "Rune",
      "Mira",
    ]);
    await page.keyboard.press("Escape");
    await actionOwner.click();
    await expect(page.getByRole("option")).toHaveText([
      "Sahip seçilmedi",
      "Atlas",
      "Rune",
      "Mira",
    ]);
    await page.keyboard.press("Escape");

    await page
      .getByRole("textbox", { name: "Karar" })
      .fill("Sürüm notu doğrulanmış kanıta bağlanacak.");
    await decisionOwner.click();
    await page.getByRole("option", { name: "Atlas", exact: true }).click();
    await page.getByRole("button", { name: "Karar ekle" }).click();
    await expect.poll(() => harness.meetingDecisionPosts.length).toBe(1);
    expect(harness.meetingDecisionPosts).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        content: "Sürüm notu doğrulanmış kanıta bağlanacak.",
        ownerAgentId: 1,
      },
    ]);

    await page
      .getByRole("textbox", { name: "Aksiyon" })
      .fill("Sürüm notunu yayıma hazırla");
    await actionOwner.click();
    await page.getByRole("option", { name: "Rune", exact: true }).click();
    await page.getByRole("button", { name: "Aksiyon ekle" }).click();
    await expect.poll(() => harness.meetingActionPosts.length).toBe(1);
    expect(harness.meetingActionPosts).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: "Sürüm notunu yayıma hazırla",
        ownerAgentId: 2,
      },
    ]);

    const meetingPrompt = page.getByRole("textbox", {
      name: "Toplantıya yaz",
    });
    await meetingPrompt.fill("Yayın öncesi son engel var mı?");
    await page.getByRole("button", { name: "Yeni turu başlat" }).click();
    await expect.poll(() => harness.meetingStartPosts.length).toBe(2);
    expect(harness.meetingStartPosts[1]).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      prompt: "Yayın öncesi son engel var mı?",
      participantAgentIds: [1, 2, 3],
    });
    await expect(meetingPrompt).toHaveValue("");

    const actionToggle = page.getByRole("button", {
      name: "Teslim paketini güncelle aksiyonunu tamamla",
    });
    await actionToggle.click();
    await expect.poll(() => harness.meetingActionPatchPosts.length).toBe(1);
    expect(harness.meetingActionPatchPosts).toEqual([
      { requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), status: "done" },
    ]);
    await expect(
      page.getByRole("button", {
        name: "Teslim paketini güncelle aksiyonunu yeniden aç",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    const closureSummary =
      "Yayın engelleri kapatıldı ve teslim sahipleri netleştirildi.";
    await page
      .getByRole("textbox", { name: "Kapanış özeti" })
      .fill(closureSummary);
    await page.getByRole("button", { name: "Toplantıyı tamamla" }).click();
    await expect.poll(() => harness.meetingCompletePosts.length).toBe(1);
    expect(harness.meetingCompletePosts).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        summary: closureSummary,
      },
    ]);
    await expect(
      page
        .getByRole("article", { name: "Sürüm karar toplantısı" })
        .locator(":scope > header")
        .getByText("Tamamlandı", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(closureSummary, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Kapanış özeti" }),
    ).toHaveCount(0);

    const composer = page.getByRole("textbox", {
      name: "Mesaj veya iş açıklaması",
    });
    await composer.fill(PROJECT_DRAFT);
    await page
      .getByRole("button", { name: "İsteği gönder", exact: true })
      .click();

    await expect.poll(() => harness.messagePosts.length).toBe(1);
    expect(harness.messagePosts).toMatchObject([
      {
        content: PROJECT_DRAFT,
        taskId: 101,
        modelMode: "auto",
        kind: "ask",
        locale: "tr",
        expectedConfig: "a".repeat(64),
      },
    ]);
    await expect(composer).toHaveValue(PROJECT_DRAFT);
    await expect(
      page.getByRole("alert").filter({ hasText: "Sonuç henüz doğrulanmadı" }),
    ).toBeVisible();
    await expect(page.getByText("Project message fixture failure")).toHaveCount(
      0,
    );

    expect([...harness.unexpected]).toEqual([]);
  });

  test("selects a newly created meeting after the refreshed list lands", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const harness = await installProjectStudioMocks(page);
    const withMeetingIdentity = (
      detail: ReturnType<typeof meetingDetail>,
      id: number,
      title: string,
    ) => ({
      ...detail,
      meeting: { ...detail.meeting, id, title },
      participants: detail.participants.map((participant) => ({
        ...participant,
        meetingId: id,
      })),
      transcript: detail.transcript.map((entry) => ({
        ...entry,
        meetingId: id,
      })),
      decisions: detail.decisions.map((decision) => ({
        ...decision,
        meetingId: id,
      })),
      actionItems: detail.actionItems.map((action) => ({
        ...action,
        meetingId: id,
      })),
    });
    const previousDetail = withMeetingIdentity(
      meetingDetail("completed"),
      900,
      "Önceki karar toplantısı",
    );
    let newDetail = withMeetingIdentity(
      meetingDetail("draft"),
      902,
      "Yeni teslim toplantısı",
    );
    let created = false;

    await page.route("**/api/projects/101/meetings**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();

      if (path === "/api/projects/101/meetings" && method === "GET") {
        return json(
          route,
          [previousDetail, ...(created ? [newDetail] : [])].map((detail) => ({
            meeting: detail.meeting,
            participantCount: detail.participants.length,
          })),
        );
      }
      if (path === "/api/projects/101/meetings/900" && method === "GET") {
        return json(route, previousDetail);
      }
      if (path === "/api/projects/101/meetings" && method === "POST") {
        const input = request.postDataJSON() as {
          title: string;
          agenda: string | null;
        };
        newDetail = {
          ...newDetail,
          meeting: {
            ...newDetail.meeting,
            title: input.title,
            agenda: input.agenda,
          },
        };
        created = true;
        return json(
          route,
          {
            requestId: request.postDataJSON().requestId,
            projectId: 101,
            meetingId: 902,
            kind: "create",
            entityId: 902,
            ok: true,
          },
          201,
        );
      }
      if (
        path === "/api/projects/101/meetings/902/start" &&
        method === "POST"
      ) {
        newDetail = {
          ...newDetail,
          meeting: {
            ...newDetail.meeting,
            status: "in_progress",
            startedAt: NOW,
          },
        };
        return json(route, {
          ...newDetail,
          requestId: request.postDataJSON().requestId,
          execution: {
            requestedParticipantCount: 3,
            attemptedParticipantCount: 3,
            maxRespondersPerStart: 8,
            maxConcurrentMeetingStarts: 2,
            maxTokensPerResponse: 300,
          },
          agentTranscriptIds: [],
          skippedParticipants: [],
        });
      }
      if (path === "/api/projects/101/meetings/902" && method === "GET") {
        return json(route, newDetail);
      }

      return json(route, { error: "Unexpected meeting race request" }, 501);
    });

    await page.goto("/projects/101");
    await page
      .getByRole("tablist", { name: "Proje çalışma alanı görünümleri" })
      .getByRole("tab", { name: "Toplantılar", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "Önceki karar toplantısı" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Yeni toplantı" }).click();
    await page
      .getByRole("textbox", { name: "Toplantı başlığı" })
      .fill("Yeni teslim toplantısı");
    await page
      .getByRole("button", { name: "Taslağı kaydet", exact: true })
      .click();

    await expect(
      page.getByRole("button", { name: "Yeni teslim toplantısı" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("article", { name: "Yeni teslim toplantısı" }),
    ).toBeVisible();
    expect([...harness.unexpected]).toEqual([]);
  });

  test("keeps owner assignment participant-scoped and explains an empty roster", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const harness = await installProjectStudioMocks(page, {
      initialMeeting: meetingDetail("in_progress", []),
    });

    await page.goto("/projects/101");
    await page
      .getByRole("tablist", { name: "Proje çalışma alanı görünümleri" })
      .getByRole("tab", { name: "Toplantılar", exact: true })
      .click();

    const decisionOwner = page.getByRole("combobox", {
      name: "Karar sahibi",
    });
    const actionOwner = page.getByRole("combobox", {
      name: "Aksiyon sahibi",
    });
    await expect(decisionOwner).toBeEnabled();
    await expect(actionOwner).toBeEnabled();
    await decisionOwner.click();
    await expect(page.getByRole("option")).toHaveText(["Sahip seçilmedi"]);
    await page.keyboard.press("Escape");
    await actionOwner.click();
    await expect(page.getByRole("option")).toHaveText(["Sahip seçilmedi"]);
    await page.keyboard.press("Escape");
    await expect(
      page.getByText(
        "Bu toplantıda katılımcı yok. Karar sahipsiz kaydedilebilir.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Bu toplantıda katılımcı yok. Aksiyon sahipsiz kaydedilebilir.",
      ),
    ).toBeVisible();

    await page
      .getByRole("textbox", { name: "Karar" })
      .fill("Katılımcı eklenene kadar kayıt sahipsiz tutulacak.");
    await page.getByRole("button", { name: "Karar ekle" }).click();
    await expect.poll(() => harness.meetingDecisionPosts.length).toBe(1);
    expect(harness.meetingDecisionPosts).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        content: "Katılımcı eklenene kadar kayıt sahipsiz tutulacak.",
        ownerAgentId: null,
      },
    ]);
    expect([...harness.unexpected]).toEqual([]);
  });

  test("puts the workbench before chat on mobile without horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const harness = await installProjectStudioMocks(page);

    await page.goto("/projects/101");
    await expect(
      page.getByRole("heading", { name: PROJECT_TITLE, exact: true }),
    ).toBeVisible();

    const workbench = page
      .getByRole("tablist", { name: "Proje çalışma alanı görünümleri" })
      .locator("xpath=ancestor::section[1]");
    const chat = page.locator(`section[aria-label="Proje konuşması"]`);
    await expect(workbench).toBeVisible();
    await expect(chat).toBeVisible();

    const positions = await Promise.all([
      workbench.boundingBox(),
      chat.boundingBox(),
    ]);
    expect(positions[0]).not.toBeNull();
    expect(positions[1]).not.toBeNull();
    expect(positions[0]!.y).toBeLessThan(positions[1]!.y);

    const documentWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(documentWidth.scroll).toBeLessThanOrEqual(documentWidth.client);

    await expect
      .poll(() =>
        harness.messageGetQueries.some(
          (query) => new URLSearchParams(query).get("taskId") === "101",
        ),
      )
      .toBe(true);
    expect([...harness.unexpected]).toEqual([]);
  });
});

test("an unconfirmed active stop requires a fresh check and another confirmation", async ({
  page,
}) => {
  const c = await loadProjectStudioCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page);
  let posts = 0;
  let current = project;
  await page.route("**/api/tasks/101", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/api/tasks/101/cancel", (route) => {
    posts++;
    if (posts === 1)
      return route.fulfill({ status: 503, json: { error: "lost" } });
    current = { ...project, status: "cancelled" };
    return route.fulfill({ json: current });
  });
  await page.goto("/projects/101");
  await page.getByRole("button", { name: c.stop, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("button", { name: c.confirmStop, exact: true })
    .click();
  await expect(dialog.getByText(c.unknownStop, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: c.dismiss, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.reviewStop, exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: c.checkState, exact: true }).click();
  await expect(
    page.getByText(c.activeAfterCheck, { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await page.getByRole("button", { name: c.reviewStop, exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: c.dismiss, exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: c.confirmStop, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(c.stopped, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  expect(posts).toBe(2);
});

test("delivery displays the newest bounded records and keeps recorded status", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page);
  await page.route("**/api/tasks/101", (route) =>
    route.fulfill({ json: { ...project, progressPercent: 100 } }),
  );
  await page.route("**/api/tasks/101/activity?**", (route) =>
    route.fulfill({
      json: Array.from({ length: 100 }, (_, i) => ({
        ...projectActivity[0],
        id: 9000 + i,
        summary: "Activity number " + (i + 1),
        createdAt: new Date(Date.parse(NOW) + i * 1000).toISOString(),
      })),
    }),
  );
  await page.goto("/projects/101?view=evidence");
  const summary = page.getByRole("region", {
    name: "Recorded summary",
    exact: true,
  });
  await expect(summary.getByText("In progress", { exact: true })).toBeVisible();
  const panel = page.locator("#project-workbench-evidence");
  await expect(
    panel.getByText("Activity number 100", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("Activity number 1", { exact: true }),
  ).toHaveCount(0);
  await expect(panel.locator("ol > li")).toHaveCount(80);
  await expect(panel.locator("ol > li").first()).toContainText(
    "Activity number 100",
  );
  await expect(panel.getByText(/Latest 80 activities/)).toBeVisible();
});

test("unavailable project evidence and child tasks remain distinct from empty snapshots", async ({
  page,
}) => {
  const c = await loadProjectStudioCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page);
  let failed = true;
  for (const resource of ["activity", "subtasks"])
    await page.route("**/api/tasks/101/" + resource + "?**", (route) =>
      route.fulfill({
        status: failed ? 503 : 200,
        json: failed ? { error: "private-project-context" } : [],
      }),
    );
  await page.goto("/projects/101?view=evidence");
  const summary = page.getByRole("region", { name: c.runSummary, exact: true });
  await expect(
    summary.getByText(c.recordsMissing, { exact: true }),
  ).toBeVisible();
  await expect(summary.getByText(c.unavailable, { exact: true })).toBeVisible();
  await expect(summary.getByText(/Latest 0 activities/)).toHaveCount(0);
  const panel = page.locator("#project-workbench-evidence");
  await expect(panel.getByText(c.noRecords, { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: c.teamTab, exact: true }).click();
  const taskList = page
    .locator("#project-workbench-team section")
    .filter({ has: page.getByRole("heading", { name: c.plan, exact: true }) });
  await expect(
    taskList.getByText(c.tasksMissing, { exact: false }),
  ).toBeVisible();
  await expect(taskList.getByText(c.noTasks, { exact: true })).toHaveCount(0);
  failed = false;
  await taskList.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(taskList.getByText(c.noTasks, { exact: true })).toBeVisible();
  await page.goto("/projects/101?view=evidence");
  await expect(panel.getByText(c.noRecords, { exact: true })).toBeVisible();
  await expect(summary.getByText(c.unavailable, { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("private-project-context")).toHaveCount(0);
});

const turnKey = "acos.meeting-turn.v1:101:901";
const savedTurn = {
  version: 1,
  projectId: 101,
  meetingId: 901,
  requestId: "11111111-1111-4111-8111-111111111111",
  input: {
    prompt: "Original 原文\nتعليمات — keep this exact input",
    participantAgentIds: [1, 2, 3],
  },
};
const turnOutcome = (requestId: string) => ({
  ...meetingDetail("in_progress"),
  requestId,
  execution: {
    requestedParticipantCount: 3,
    attemptedParticipantCount: 3,
    maxRespondersPerStart: 8,
    maxConcurrentMeetingStarts: 2,
    maxTokensPerResponse: 300,
  },
  agentTranscriptIds: [801],
  skippedParticipants: [],
});
function turnReceipt(requestId: string, state = "complete") {
  return {
    requestId,
    projectId: 101,
    meetingId: 901,
    state,
    httpStatus: state === "complete" ? 200 : null,
    response: state === "complete" ? turnOutcome(requestId) : null,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  };
}

for (const locale of LOCALES) {
  test(`${locale} model-turn inbox discovers unlisted meetings after reload without starting work`, async ({
    page,
  }, info) => {
    const c = await loadMeetingTurnCopy(locale);
    await page.setViewportSize({ width: 320, height: 850 });
    await page.addInitScript(
      ({ locale, intent, key }) => {
        localStorage.setItem("acos.locale.v1", locale);
        if (!sessionStorage.getItem("turn-inbox-seeded")) {
          sessionStorage.setItem(key, JSON.stringify(intent));
          sessionStorage.setItem("turn-inbox-seeded", "1");
        }
      },
      { locale, intent: savedTurn, key: turnKey },
    );
    await installProjectStudioMocks(page);
    await page.route("**/api/projects/101/meetings", (r) =>
      r.fulfill({ json: [] }),
    );
    let reads = 0,
      posts = 0;
    await page.route("**/api/projects/101/meetings/901/start", (r) => {
      posts++;
      return r.fulfill({ status: 501, json: {} });
    });
    await page.route(
      "**/api/projects/101/meetings/901/turn-requests/*",
      (r) => {
        reads++;
        const receipt = turnReceipt(savedTurn.requestId);
        receipt.response!.skippedParticipants = [
          { agentId: 3, reason: "model_error" },
        ] as any;
        return r.fulfill({ json: receipt });
      },
    );
    await page.goto("/projects/101?view=meetings");
    const panel = page.getByRole("region", { name: c.title, exact: true });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText(savedTurn.input.prompt, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(panel).toBeVisible();
    expect(reads).toBe(0);
    expect(posts).toBe(0);
    await panel.getByRole("button", { name: c.check, exact: true }).click();
    await expect(panel.getByText(c.recorded, { exact: true })).toBeVisible();
    await expect(
      panel.getByText(
        "Mobil kabul testi geçti; yayın kararı için kanıt hazır.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(panel.getByText("#3", { exact: true })).toBeVisible();
    await expect(
      panel.getByText(c.skip_model_error, { exact: false }),
    ).toBeVisible();
    if (locale === "en" || locale === "ar") {
      await panel.screenshot({
        path: info.outputPath(`unlisted-outcome-${locale}.png`),
      });
    }
    await panel.getByRole("button", { name: c.review, exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("button", { name: c.cancel, exact: true }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: c.continue, exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(posts).toBe(0);
    expect(reads).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("model-turn inbox retains damaged data when the meeting list is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    sessionStorage.setItem(
      "acos.meeting-turn.v1:101:broken",
      "Damaged 原文 data",
    );
    sessionStorage.setItem("acos.meeting-turn.v1:102:broken", "Other project");
  });
  await installProjectStudioMocks(page);
  await page.route("**/api/projects/101/meetings", (r) =>
    r.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/projects/101?view=meetings");
  const inbox = page.getByRole("region", {
    name: "Saved meeting turns",
    exact: true,
  });
  await expect(inbox).toBeVisible();
  await inbox
    .getByRole("button", { name: "Review damaged record", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.locator("pre")).toHaveText("Damaged 原文 data");
  const clear = dialog.getByRole("button", {
    name: "Clear reviewed local record",
    exact: true,
  });
  await expect(clear).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await clear.click();
  await expect(inbox).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.meeting-turn.v1:102:broken"),
    ),
  ).toBe("Other project");
});

test("model-turn inbox missing receipt permits reviewed local clearing without retrying a deleted meeting", async ({
  page,
}) => {
  const c = await loadMeetingTurnCopy("en"),
    meetingCopy = await loadMeetingCopy("en");
  await page.addInitScript(
    ({ key, intent }) => {
      localStorage.setItem("acos.locale.v1", "en");
      sessionStorage.setItem(key, JSON.stringify(intent));
    },
    { key: turnKey, intent: savedTurn },
  );
  await installProjectStudioMocks(page);
  await page.route("**/api/projects/101/meetings", (r) =>
    r.fulfill({ json: [] }),
  );
  await page.route("**/api/projects/101/meetings/901/turn-requests/*", (r) =>
    r.fulfill({ status: 404, json: {} }),
  );
  let posts = 0;
  await page.route("**/api/projects/101/meetings/901/start", (r) => {
    posts++;
    return r.fulfill({ status: 404, json: {} });
  });
  await page.goto("/projects/101?view=meetings");
  const panel = page.getByRole("region", { name: c.title, exact: true });
  await panel.getByRole("button", { name: c.check, exact: true }).click();
  await expect(panel.getByText(c.notRecorded, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: c.review, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: c.cancel, exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: c.continue, exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: meetingCopy.title, exact: true }),
  ).toBeFocused();
  expect(posts).toBe(0);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), turnKey),
  ).toBeNull();
});

test("model-turn inbox rejects stale damaged clearing and reports enumeration failure", async ({
  page,
}) => {
  const c = await loadMeetingTurnCopy("en");
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    sessionStorage.setItem(
      "acos.meeting-turn.v1:101:broken",
      "Original damaged data",
    );
  });
  await installProjectStudioMocks(page);
  await page.goto("/projects/101?view=meetings");
  const inbox = page.getByRole("region", { name: c.inboxTitle, exact: true });
  await inbox
    .getByRole("button", { name: c.reviewDamaged, exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("checkbox").check();
  await page.evaluate(() =>
    sessionStorage.setItem(
      "acos.meeting-turn.v1:101:broken",
      "Newer damaged data",
    ),
  );
  await dialog
    .getByRole("button", { name: c.clearDamaged, exact: true })
    .click();
  await expect(dialog.getByText(c.changed, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.meeting-turn.v1:101:broken"),
    ),
  ).toBe("Newer damaged data");
  await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
  await page.evaluate(() => {
    Storage.prototype.key = () => {
      throw new Error("Storage unavailable");
    };
  });
  await inbox
    .getByRole("button", { name: c.refreshInbox, exact: true })
    .click();
  await expect(
    inbox.getByText(c.storageReadError, { exact: true }),
  ).toBeVisible();
});

test("model-turn inbox paginates saved turns and continues a bounded key scan", async ({
  page,
}) => {
  const c = await loadMeetingTurnCopy("en");
  await page.addInitScript(
    ({ intent }) => {
      localStorage.setItem("acos.locale.v1", "en");
      for (let i = 0; i < 1010; i++)
        sessionStorage.setItem(`unrelated-inbox-${i}`, "x");
      for (let i = 901; i <= 921; i++)
        sessionStorage.setItem(
          `acos.meeting-turn.v1:101:${i}`,
          JSON.stringify({
            ...intent,
            requestId: crypto.randomUUID(),
            meetingId: i,
          }),
        );
    },
    { intent: savedTurn },
  );
  await installProjectStudioMocks(page);
  await page.goto("/projects/101?view=meetings");
  const inbox = page.getByRole("region", { name: c.inboxTitle, exact: true });
  await expect(
    inbox.getByText(c.scanIncomplete, { exact: true }),
  ).toBeVisible();
  await inbox.getByRole("button", { name: c.scanMore, exact: true }).click();
  await expect(
    inbox.getByRole("region", { name: c.title, exact: true }),
  ).toHaveCount(20);
  await inbox.getByRole("button", { name: c.next, exact: true }).click();
  await expect(
    inbox.getByRole("region", { name: c.title, exact: true }),
  ).toHaveCount(1);
  await expect(inbox.getByText("#921", { exact: true })).toBeVisible();
  await inbox.getByRole("button", { name: c.previous, exact: true }).click();
  await expect(
    inbox.getByRole("region", { name: c.title, exact: true }),
  ).toHaveCount(20);
});

test("model-turn inbox late success preserves replacement input with the same request UUID", async ({
  page,
}) => {
  const c = await loadMeetingTurnCopy("en"),
    meetingCopy = await loadMeetingCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  let release!: () => void, received!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    seen = new Promise<void>((r) => {
      received = r;
    });
  await page.route("**/api/projects/101/meetings/901/start", async (r) => {
    const input = r.request().postDataJSON();
    received();
    await gate;
    return r.fulfill({ json: turnOutcome(input.requestId) });
  });
  await page.goto("/projects/101?view=meetings");
  await page
    .getByRole("textbox", { name: meetingCopy.messageLabel, exact: true })
    .fill("Original in-flight question");
  await page
    .getByRole("button", { name: meetingCopy.nextTurn, exact: true })
    .click();
  await seen;
  await page.evaluate((key) => {
    const record = JSON.parse(sessionStorage.getItem(key)!);
    record.input.prompt = "Newer saved question";
    sessionStorage.setItem(key, JSON.stringify(record));
    window.dispatchEvent(new Event("acos:meeting-turn"));
  }, turnKey);
  release();
  await expect(page.getByText(c.requestFailed, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).input.prompt,
      turnKey,
    ),
  ).toBe("Newer saved question");
});

for (const locale of LOCALES) {
  test(
    locale +
      " meeting recovery survives reload and requires review without replay",
    async ({ page }, info) => {
      const c = await loadMeetingTurnCopy(locale);
      const meetingCopy = await loadMeetingCopy(locale);
      await page.setViewportSize({
        width: locale === "ar" ? 320 : 390,
        height: 844,
      });
      await page.emulateMedia({
        colorScheme: ["ar", "de", "zh-TW"].includes(locale) ? "light" : "dark",
      });
      await page.addInitScript(
        ({ locale, intent, key }) => {
          localStorage.setItem("acos.locale.v1", locale);
          if (!sessionStorage.getItem("meeting-test-seeded")) {
            sessionStorage.setItem(key, JSON.stringify(intent));
            sessionStorage.setItem("meeting-test-seeded", "1");
          }
        },
        { locale, intent: savedTurn, key: turnKey },
      );
      await installProjectStudioMocks(page, {
        initialMeeting: meetingDetail("in_progress"),
      });
      let posts = 0,
        reads = 0;
      await page.route("**/api/projects/101/meetings/901/start", (route) => {
        posts++;
        return route.fulfill({
          status: 501,
          json: { error: "Unexpected replay" },
        });
      });
      await page.route(
        "**/api/projects/101/meetings/901/turn-requests/*",
        (route) => {
          reads++;
          return route.fulfill({ json: turnReceipt(savedTurn.requestId) });
        },
      );
      await page.goto("/projects/101?view=meetings");
      const panel = page.getByRole("region", { name: c.title, exact: true });
      await expect(panel).toBeVisible();
      await expect(
        panel.getByText(savedTurn.input.prompt, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: meetingCopy.nextTurn, exact: true }),
      ).toBeDisabled();
      expect(posts).toBe(0);
      expect(reads).toBe(0);
      await page.reload();
      await expect(panel).toBeVisible();
      await panel.getByRole("button", { name: c.check, exact: true }).click();
      await expect(panel.getByText(c.recorded, { exact: true })).toBeVisible();
      expect(posts).toBe(0);
      expect(reads).toBe(1);
      await panel.getByRole("button", { name: c.review, exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(
        dialog.getByRole("button", { name: c.cancel, exact: true }),
      ).toBeFocused();
      await dialog.getByRole("button", { name: c.cancel, exact: true }).click();
      await expect(
        panel.getByRole("button", { name: c.review, exact: true }),
      ).toBeFocused();
      expect(
        await page.evaluate((key) => sessionStorage.getItem(key), turnKey),
      ).not.toBeNull();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const button of await panel.getByRole("button").all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (locale === "en" || locale === "ar") {
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("meeting-recovery-" + locale + ".png"),
        });
      }
      await panel.getByRole("button", { name: c.review, exact: true }).click();
      await dialog
        .getByRole("button", { name: c.continue, exact: true })
        .click();
      await expect(panel).toHaveCount(0);
      expect(
        await page.evaluate((key) => sessionStorage.getItem(key), turnKey),
      ).toBeNull();
      expect(posts).toBe(0);
    },
  );
}

test("meeting lost acknowledgement checks receipt and 404 retry keeps the same identity", async ({
  page,
}) => {
  const c = await loadMeetingTurnCopy("en");
  const meetingCopy = await loadMeetingCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  const posts: Record<string, unknown>[] = [];
  let exists = false;
  await page.route("**/api/projects/101/meetings/901/start", (route) => {
    const input = route.request().postDataJSON();
    posts.push(input);
    if (posts.length === 1)
      return route.fulfill({
        status: 503,
        json: { error: "private-upstream-secret" },
      });
    exists = true;
    return route.fulfill({ json: turnOutcome(input.requestId) });
  });
  await page.route(
    "**/api/projects/101/meetings/901/turn-requests/*",
    (route) =>
      route.fulfill(
        exists
          ? { json: turnReceipt(posts[0].requestId as string) }
          : { status: 404, json: { error: "No receipt" } },
      ),
  );
  await page.goto("/projects/101?view=meetings");
  await page
    .getByRole("textbox", { name: meetingCopy.messageLabel, exact: true })
    .fill("Keep my exact original question");
  await page
    .getByRole("button", { name: meetingCopy.nextTurn, exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(1);
  const panel = page.getByRole("region", { name: c.title, exact: true });
  await expect(panel).toBeVisible();
  await expect(page.getByText("private-upstream-secret")).toHaveCount(0);
  await page.reload();
  await expect(
    panel.getByText("Keep my exact original question", { exact: true }),
  ).toBeVisible();
  expect(posts.length).toBe(1);
  await panel.getByRole("button", { name: c.check, exact: true }).click();
  await expect(panel.getByText(c.notRecorded, { exact: true })).toBeVisible();
  expect(posts.length).toBe(1);
  await panel.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(panel.getByText(c.recorded, { exact: true })).toBeVisible();
  expect(posts.length).toBe(2);
  expect(posts[1]).toEqual(posts[0]);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), turnKey),
  ).not.toBeNull();
});

test("meeting receipt states cannot invent success or start an accepted turn again", async ({
  page,
}) => {
  const c = await loadMeetingTurnCopy("en");
  await page.addInitScript(
    ({ intent, key }) => {
      localStorage.setItem("acos.locale.v1", "en");
      sessionStorage.setItem(key, JSON.stringify(intent));
    },
    { intent: savedTurn, key: turnKey },
  );
  await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  let state = "running",
    mismatch = false,
    httpStatus = 200,
    posts = 0;
  await page.route("**/api/projects/101/meetings/901/start", (route) => {
    posts++;
    return route.fulfill({ status: 501, json: {} });
  });
  await page.route(
    "**/api/projects/101/meetings/901/turn-requests/*",
    (route) => {
      const receipt = turnReceipt(
        mismatch ? "22222222-2222-4222-8222-222222222222" : savedTurn.requestId,
        state,
      );
      if (state === "complete") {
        receipt.httpStatus = httpStatus;
        if (httpStatus >= 400) receipt.response!.agentTranscriptIds = [];
      }
      return route.fulfill({ json: receipt });
    },
  );
  await page.goto("/projects/101?view=meetings");
  const panel = page.getByRole("region", { name: c.title, exact: true });
  const check = () =>
    panel.getByRole("button", { name: c.check, exact: true }).click();
  await check();
  await expect(panel.getByText(c.running, { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: c.review, exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: c.retry, exact: true }),
  ).toHaveCount(0);
  state = "complete";
  mismatch = true;
  await check();
  await expect(panel.getByText(c.loadError, { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: c.review, exact: true }),
  ).toHaveCount(0);
  state = "unconfirmed";
  mismatch = false;
  await check();
  await expect(panel.getByText(c.unconfirmed, { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: c.retry, exact: true }),
  ).toHaveCount(0);
  state = "complete";
  httpStatus = 503;
  await check();
  await expect(
    panel.getByText(c.recordedFailure, { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText((await loadMeetingCopy("en")).noContribution, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByText("Mobil kabul testi geçti; yayın kararı için kanıt hazır.", {
      exact: true,
    }),
  ).toHaveCount(0);
  mismatch = true;
  await check();
  await expect(panel.getByText(c.loadError, { exact: true })).toBeVisible();
  await expect(panel.getByText(c.recordedFailure, { exact: true })).toHaveCount(
    0,
  );
  expect(posts).toBe(0);
});

test("meeting storage failure dispatches nothing and preserves the composer", async ({
  page,
}) => {
  const c = await loadMeetingTurnCopy("en");
  const meetingCopy = await loadMeetingCopy("en");
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.meeting-turn"))
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const harness = await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  await page.goto("/projects/101?view=meetings");
  const composer = page.getByRole("textbox", {
    name: meetingCopy.messageLabel,
    exact: true,
  });
  await composer.fill("Do not lose this draft");
  await page
    .getByRole("button", { name: meetingCopy.nextTurn, exact: true })
    .click();
  await expect(page.getByText(c.storage, { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Do not lose this draft");
  expect(harness.meetingStartPosts).toEqual([]);
});

test("late meeting replies only clear the submitted meeting draft", async ({
  page,
}) => {
  await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  const first = meetingDetail("in_progress");
  const second = {
    ...meetingDetail("in_progress", []),
    meeting: { ...first.meeting, id: 902, title: "Second meeting" },
    transcript: [],
    decisions: [],
    actionItems: [],
  };
  let release!: () => void,
    posts = 0;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/projects/101/meetings", (route) =>
    route.fulfill({
      json: [first, second].map((detail) => ({
        meeting: detail.meeting,
        participantCount: detail.participants.length,
      })),
    }),
  );
  await page.route("**/api/projects/101/meetings/902", (route) =>
    route.fulfill({ json: second }),
  );
  await page.route("**/api/projects/101/meetings/901/start", async (route) => {
    posts++;
    await held;
    return route.fulfill({
      json: turnOutcome(route.request().postDataJSON().requestId),
    });
  });
  await page.goto("/projects/101?view=meetings");
  const draft = page.getByRole("textbox", {
    name: "Toplantıya yaz",
    exact: true,
  });
  await draft.fill("First meeting dispatched draft");
  await page
    .getByRole("button", { name: "Yeni turu başlat", exact: true })
    .click();
  await expect.poll(() => posts).toBe(1);
  await page.getByRole("button", { name: /Second meeting/ }).click();
  await expect(draft).toHaveValue("");
  await draft.fill("Second meeting unsent draft");
  release();
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), turnKey))
    .toBeNull();
  await expect(draft).toHaveValue("Second meeting unsent draft");
  await page.getByRole("button", { name: /Sürüm karar toplantısı/ }).click();
  await expect(draft).toHaveValue("");
  await page.getByRole("button", { name: /Second meeting/ }).click();
  await expect(draft).toHaveValue("Second meeting unsent draft");
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Second meeting/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(draft).toHaveValue("Second meeting unsent draft");
  expect(posts).toBe(1);
});

for (const locale of LOCALES) {
  test(
    locale +
      " meeting forms validate and preserve every unsent field across reload",
    async ({ page }, info) => {
      const c = await loadMeetingCopy(locale);
      const studio = await loadProjectStudioCopy(locale);
      const initialMeeting = meetingDetail("in_progress");
      const longOwner = "LongOwnerName".repeat(10);
      initialMeeting.decisions[0].ownerName = longOwner;
      await page.setViewportSize({
        width: locale === "ar" ? 320 : 390,
        height: 844,
      });
      await page.emulateMedia({
        colorScheme: ["ar", "de", "zh-TW"].includes(locale) ? "light" : "dark",
      });
      await page.addInitScript(
        (selected) => localStorage.setItem("acos.locale.v1", selected),
        locale,
      );
      const harness = await installProjectStudioMocks(page, { initialMeeting });
      await page.goto("/projects/101?view=meetings");
      const section = page.getByRole("region", { name: c.title, exact: true });
      const ownerRecord = section.getByText(
        meetingText(c.owner, { name: longOwner }),
        { exact: true },
      );
      await expect(ownerRecord).toBeVisible();
      expect(
        await ownerRecord.evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1,
        ),
      ).toBe(true);
      const decision = section.getByRole("textbox", {
        name: c.decisionLabel,
        exact: true,
      });
      await section
        .getByRole("button", { name: c.addDecision, exact: true })
        .click();
      await expect(decision).toBeFocused();
      await expect(decision).toHaveAttribute("aria-invalid", "true");
      await expect(decision).toHaveAccessibleDescription(c.required);
      expect(harness.meetingDecisionPosts).toEqual([]);
      const fields = [
        c.messageLabel,
        c.decisionLabel,
        c.actionLabel,
        c.summary,
      ];
      const original = "原文 — العربية — русский\n  exact draft  ";
      for (const [index, label] of fields.entries())
        await section
          .getByRole("textbox", { name: label, exact: true })
          .fill(original + index);
      const owners = [c.decisionLabel, c.actionLabel];
      for (const label of owners) {
        await section
          .getByRole("combobox", {
            name: meetingText(c.ownerLabel, { label }),
            exact: true,
          })
          .click();
        await page.getByRole("option", { name: "Rune", exact: true }).click();
      }
      // Composition/Enter are editing, not an implicit model request.
      const message = section.getByRole("textbox", {
        name: c.messageLabel,
        exact: true,
      });
      await message.focus();
      await message.dispatchEvent("compositionstart");
      await message.press("Enter");
      await message.dispatchEvent("compositionend", { data: "文" });
      await message.fill(original + 0);
      expect(harness.meetingStartPosts).toEqual([]);
      await section
        .getByRole("button", { name: c.newMeeting, exact: true })
        .click();
      await section
        .getByRole("button", { name: c.saveDraft, exact: true })
        .click();
      const title = section.getByRole("textbox", {
        name: c.titleLabel,
        exact: true,
      });
      await expect(title).toBeFocused();
      await expect(title).toHaveAccessibleDescription(c.required);
      await title.fill("Title 原文 العربية");
      await section
        .getByRole("textbox", { name: new RegExp(c.agendaLabel) })
        .fill(original);
      const picker = section.getByRole("group", {
        name: c.participants,
        exact: true,
      });
      await picker.getByRole("button", { name: /Atlas/ }).click();
      await expect(
        picker.getByRole("button", { name: /Atlas/ }),
      ).toHaveAttribute("aria-pressed", "false");
      await page
        .getByRole("tab", { name: studio.teamTab, exact: true })
        .click();
      await page
        .getByRole("tab", { name: studio.meetings, exact: true })
        .click();
      await page.reload();
      await expect(title).toHaveValue("Title 原文 العربية");
      await expect(
        section.getByRole("textbox", { name: new RegExp(c.agendaLabel) }),
      ).toHaveValue(original);
      await expect(
        picker.getByRole("button", { name: /Atlas/ }),
      ).toHaveAttribute("aria-pressed", "false");
      for (const [index, label] of fields.entries())
        await expect(
          section.getByRole("textbox", { name: label, exact: true }),
        ).toHaveValue(original + index);
      for (const label of owners)
        await expect(
          section.getByRole("combobox", {
            name: meetingText(c.ownerLabel, { label }),
            exact: true,
          }),
        ).toHaveText("Rune");
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr",
      );
      expect(
        await section.evaluate((root) => {
          const errors: string[] = [];
          for (const el of root.querySelectorAll(
            "[aria-describedby], [aria-labelledby]",
          ))
            for (const attr of ["aria-describedby", "aria-labelledby"])
              for (const id of el.getAttribute(attr)?.split(/\s+/) ?? [])
                if (id && !document.getElementById(id)) errors.push(id);
          return errors;
        }),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const button of await section.getByRole("button").all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (locale === "en" || locale === "ar") {
        await title.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("meeting-form-" + locale + ".png"),
        });
        await decision.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("meeting-record-" + locale + ".png"),
        });
      }
      expect(harness.meetingCreatePosts).toEqual([]);
      expect(harness.meetingDecisionPosts).toEqual([]);
      expect(harness.meetingActionPosts).toEqual([]);
      expect(harness.meetingCompletePosts).toEqual([]);
      expect([...harness.unexpected]).toEqual([]);
      await section
        .getByRole("button", { name: c.addDecision, exact: true })
        .click();
      await expect.poll(() => harness.meetingDecisionPosts.length).toBe(1);
      expect(harness.meetingDecisionPosts[0]).toEqual({
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        content: (original + 1).trim(),
        ownerAgentId: 2,
      });
      await expect(decision).toHaveValue("");
      await expect(message).toHaveValue(original + 0);
    },
  );
}

test("meeting corrupted drafts require review and never erase a pending turn", async ({
  page,
}) => {
  const c = await loadMeetingCopy("en");
  const key = "acos.meeting-drafts.v1:101";
  await page.addInitScript(
    ({ key, turnKey, intent }) => {
      localStorage.setItem("acos.locale.v1", "en");
      sessionStorage.setItem(key, "broken original");
      sessionStorage.setItem(turnKey, JSON.stringify(intent));
    },
    { key, turnKey, intent: savedTurn },
  );
  const harness = await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  await page.goto("/projects/101?view=meetings");
  const section = page.getByRole("region", { name: c.title, exact: true });
  await expect(
    section.getByText(c.damagedDraft, { exact: true }),
  ).toBeVisible();
  const draft = section.getByRole("textbox", {
    name: c.decisionLabel,
    exact: true,
  });
  await draft.fill("Keep my text until I explicitly clear it");
  await expect(
    section.getByRole("button", { name: c.addDecision, exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBe(
    "broken original",
  );
  await section
    .getByRole("button", { name: c.resetDrafts, exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: c.keepDrafts, exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: c.keepDrafts, exact: true }).click();
  await expect(draft).toHaveValue("Keep my text until I explicitly clear it");
  await expect(
    section.getByRole("button", { name: c.resetDrafts, exact: true }),
  ).toBeFocused();
  await section
    .getByRole("button", { name: c.resetDrafts, exact: true })
    .click();
  await dialog
    .getByRole("button", { name: c.resetConfirm, exact: true })
    .click();
  await expect(section.getByText(c.damagedDraft, { exact: true })).toHaveCount(
    0,
  );
  await expect(draft).toHaveValue("");
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!),
      turnKey,
    ),
  ).toEqual(savedTurn);
  expect(harness.meetingStartPosts).toEqual([]);
  expect(harness.meetingDecisionPosts).toEqual([]);
});

test("meeting failed draft storage retains editable text and blocks writes until storage recovers", async ({
  page,
}) => {
  const c = await loadMeetingCopy("en");
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    const original = Storage.prototype.setItem;
    (window as typeof window & { blockDrafts: boolean }).blockDrafts = true;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith("acos.meeting-drafts.") &&
        (window as typeof window & { blockDrafts: boolean }).blockDrafts
      )
        throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const harness = await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  await page.goto("/projects/101?view=meetings");
  const section = page.getByRole("region", { name: c.title, exact: true });
  const draft = section.getByRole("textbox", {
    name: c.decisionLabel,
    exact: true,
  });
  await draft.fill("Exact local input");
  await expect(section.getByText(c.draftError, { exact: true })).toBeVisible();
  await expect(draft).toHaveValue("Exact local input");
  await expect(
    section.getByRole("button", { name: c.addDecision, exact: true }),
  ).toBeDisabled();
  expect(harness.meetingDecisionPosts).toEqual([]);
  await page.evaluate(() => {
    (window as typeof window & { blockDrafts: boolean }).blockDrafts = false;
  });
  await draft.fill("Exact local input recovered");
  await expect(section.getByText(c.draftError, { exact: true })).toHaveCount(0);
  await expect(
    section.getByRole("button", { name: c.addDecision, exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("acos.meeting-drafts.v1:101")!)
          .drafts[901].decisionDraft,
    ),
  ).toBe("Exact local input recovered");
});

test("meeting failed refresh keeps last records and unsent text until a read-only retry", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const c = await loadMeetingCopy("en");
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const harness = await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  let failed = false;
  await page.route("**/api/projects/101/meetings/901", (route) =>
    failed ? json(route, { error: "private failure" }, 503) : route.fallback(),
  );
  await page.goto("/projects/101?view=meetings");
  const section = page.getByRole("region", { name: c.title, exact: true });
  const draft = section.getByRole("textbox", {
    name: c.decisionLabel,
    exact: true,
  });
  await draft.fill("Keep this draft while offline");
  failed = true;
  await expect(section.getByText(c.staleDetail, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(draft).toHaveValue("Keep this draft while offline");
  await expect(
    section.getByRole("button", { name: c.addDecision, exact: true }),
  ).toBeDisabled();
  await expect(
    section.getByText("Mobil kabul kanıtı teslim paketine eklenecek.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(section.getByText(/Europe\/Istanbul/).first()).toBeVisible();
  await expect(page.getByText("private failure")).toHaveCount(0);
  failed = false;
  await section.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(section.getByText(c.staleDetail, { exact: true })).toHaveCount(
    0,
  );
  await expect(draft).toHaveValue("Keep this draft while offline");
  await expect(
    section.getByRole("button", { name: c.addDecision, exact: true }),
  ).toBeEnabled();
  expect(harness.meetingDecisionPosts).toEqual([]);
});

for (const pack of ["meetings-de", "meeting-turn-de"]) {
  test(`meeting missing ${pack} pack offers localized reload without creating requests`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("acos.locale.v1", "de"),
    );
    const harness = await installProjectStudioMocks(page, {
      initialMeeting: meetingDetail("in_progress"),
    });
    const pattern = `**/assets/${pack}-*.js`;
    await page.route(pattern, (route) => route.abort());
    await page.goto("/projects/101?view=meetings");
    await expect(
      page.getByText(setupMessages.de.languageFileError, { exact: true }),
    ).toBeVisible();
    const reload = page.getByRole("button", {
      name: setupMessages.de.checkAgain,
      exact: true,
    });
    await expect(reload).toBeVisible();
    expect(harness.meetingCreatePosts).toEqual([]);
    await page.unroute(pattern);
    await reload.click();
    const c = await loadMeetingCopy("de");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    expect(harness.meetingStartPosts).toEqual([]);
  });
}

test("meeting unavailable owner is explicit and failed writes preserve the selected owner and draft", async ({
  page,
}) => {
  const c = await loadMeetingCopy("en");
  await page.addInitScript(() => {
    localStorage.setItem("acos.locale.v1", "en");
    sessionStorage.setItem(
      "acos.meeting-drafts.v1:101",
      JSON.stringify({
        version: 1,
        projectId: 101,
        selectedMeetingId: 901,
        createOpen: false,
        title: "",
        agenda: "",
        participantIds: null,
        drafts: {
          901: {
            transcriptDraft: "",
            decisionDraft: "Unchanged decision",
            decisionOwnerId: 999,
            actionDraft: "",
            actionOwnerId: null,
            completionSummary: "",
          },
        },
      }),
    );
  });
  await installProjectStudioMocks(page, {
    initialMeeting: meetingDetail("in_progress"),
  });
  let posts = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/projects/101/meetings/901/decisions",
    async (route) => {
      posts++;
      expect(route.request().postDataJSON()).toEqual({
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        content: "Unchanged decision",
        ownerAgentId: 2,
      });
      await held;
      return json(route, { error: "private rejected write" }, 503);
    },
  );
  await page.goto("/projects/101?view=meetings");
  const section = page.getByRole("region", { name: c.title, exact: true });
  const owner = section.getByRole("combobox", {
    name: meetingText(c.ownerLabel, { label: c.decisionLabel }),
    exact: true,
  });
  const send = section.getByRole("button", {
    name: c.addDecision,
    exact: true,
  });
  const draft = section.getByRole("textbox", {
    name: c.decisionLabel,
    exact: true,
  });
  await expect(owner).toHaveText("Expert #999");
  await send.click();
  await expect(owner).toBeFocused();
  await expect(owner).toHaveAccessibleDescription(c.rosterChanged);
  expect(posts).toBe(0);
  await owner.click();
  await page.getByRole("option", { name: "Rune", exact: true }).click();
  await send.click();
  await expect.poll(() => posts).toBe(1);
  const form = draft.locator("xpath=ancestor::form");
  await expect(form).toHaveAttribute("aria-busy", "true");
  await form.evaluate((el) =>
    el.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(posts).toBe(1);
  release();
  await expect(form).toHaveAttribute("aria-busy", "false");
  await expect(
    form.getByRole("alert").filter({ hasText: c.saveError }),
  ).toBeVisible();
  await expect(draft).toHaveValue("Unchanged decision");
  await expect(owner).toHaveText("Rune");
  await expect(page.getByText("private rejected write")).toHaveCount(0);
});

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: project studio views`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const errors = await prepareRouteAudit(page, variant);
    const harness = await installProjectStudioMocks(page);
    const c = await loadProjectStudioCopy(locale);
    const computer = await loadComputerCopy(locale);
    const meeting = await loadMeetingCopy(locale);
    await page.goto("/projects/101");
    await expect(
      page.getByRole("heading", { name: project.title, exact: true }),
    ).toBeVisible();
    const tabs = page.getByRole("tablist", { name: c.tabs });
    for (const [key, label] of [
      ["workspace", c.workspace],
      ["plan", c.planTab],
      ["team", c.teamTab],
      ["deliveries", c.evidence],
      ["meetings", c.meetings],
    ]) {
      await tabs.getByRole("tab", { name: label, exact: true }).click();
      await expect(
        tabs.getByRole("tab", { name: label, exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      if (key === "workspace") {
        const activity = page.getByRole("complementary", {
          name: computer.activity,
          exact: true,
        });
        await expect(
          activity.getByText(projectActivity[1].summary, { exact: true }),
        ).toBeVisible();
        await expect(
          activity.getByText(projectActivity[0].summary, { exact: true }),
        ).toBeVisible();
        await expect(activity.locator("ol > li")).toHaveCount(2);
        await expect(
          activity.getByText(projectActivity[2].summary, { exact: true }),
        ).toHaveCount(0);
        await expect(activity.getByText(computer.activityError)).toHaveCount(0);
      } else if (key === "plan" || key === "deliveries") {
        // Task-wide history must still include the other expert's source event.
        await expect(
          page.getByText(projectActivity[2].summary, { exact: true }),
        ).toBeVisible();
      } else if (key === "team") {
        await expect(
          page.getByRole("heading", { name: subtask.title, exact: true }),
        ).toBeVisible();
      } else if (key === "meetings") {
        await expect(
          page.getByRole("heading", { name: meeting.title, exact: true }),
        ).toBeVisible();
      }
      await inspectRoute(page, info, `project-${key}`, variant);
      if (variant.largeText && key === "meetings")
        await inspectReadableLabel(
          page.getByRole("button", { name: meeting.newMeeting, exact: true }),
          meeting.newMeeting,
        );
    }
    expect(harness.messagePosts).toEqual([]);
    expect(harness.meetingCreatePosts).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
