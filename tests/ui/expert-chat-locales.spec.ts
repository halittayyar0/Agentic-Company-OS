import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import {
  LOCALES,
  setupMessages,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadExpertChatCopy } from "../../artifacts/agentic-company-os/src/lib/expert-chat-copy";
import { loadExpertDetailCopy } from "../../artifacts/agentic-company-os/src/lib/expert-detail-copy";

const original = "Original 原文 — تعليمات / özgün metin";
function message(id: number, content = `${original} ${id}`, role = "agent") {
  return {
    id,
    agentId: 2,
    taskId: null,
    content,
    role,
    modelId: role === "agent" ? "recorded:model" : null,
    createdAt: "2026-09-27T08:00:00Z",
  };
}
async function setup(page: Page, locale: Locale = "en") {
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("expert-chat-fixture-initialized")) {
      localStorage.setItem("acos.locale.v1", value);
      sessionStorage.setItem("expert-chat-fixture-initialized", "true");
    }
  }, locale);
  const harness = await installStudioFixtures(page);
  const state = {
    agent: { ...structuredClone(studioAgents[1]), name: "Atlas 原文" },
    messages: [
      message(1, original, "user"),
      message(
        2,
        "Source reply\n\n```txt\noriginal_code = 1\n```\n\n[Blocked](javascript:alert%281%29)",
      ),
    ],
    posts: [] as Record<string, any>[],
    receipts: new Map<string, any>(),
    effects: 0,
    postError: false,
    noRecord: false,
    readError: false,
    unconfirmed: false,
    historyError: false,
    olderError: false,
    stopped: false,
    beforeResponse: undefined as Promise<void> | undefined,
  };
  await page.route("**/api/agents/2", (route) =>
    route.fulfill({ json: state.agent }),
  );
  await page.route("**/api/ops/control", (route) =>
    route.fulfill({
      json: {
        emergencyStopEnabled: state.stopped,
        reason: null,
        version: 1,
        updatedBy: "test",
        updatedAt: "2026-09-27T08:00:00Z",
        blockedScopes: state.stopped
          ? ["agent_chat", "task_scheduler", "agent_tools", "approved_actions"]
          : [],
      },
    }),
  );
  await page.route("**/api/agents/2/messages**", (route) => {
    const url = new URL(route.request().url());
    const before = Number(url.searchParams.get("beforeId") ?? Infinity);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (state.historyError || (state.olderError && Number.isFinite(before)))
      return route.fulfill({
        status: 503,
        json: { error: "private-server-sentinel" },
      });
    const candidates = state.messages
      .filter((row) => row.id < before)
      .sort((a, b) => b.id - a.id);
    const rows = candidates.slice(0, limit).reverse();
    return route.fulfill({
      json: rows,
      headers:
        candidates.length > limit
          ? { "X-Next-Before-Id": String(rows[0]!.id) }
          : {},
    });
  });
  await page.route("**/api/activity**", (route) =>
    route.fulfill({
      json: [
        {
          id: 1,
          agentId: 2,
          taskId: null,
          type: "note",
          summary: "Original event — yesterday 原文",
          detail: null,
          severity: "info",
          createdAt: "2026-09-26T08:00:00Z",
        },
      ],
    }),
  );
  await page.route("**/api/agents/2/requests**", async (route) => {
    if (route.request().method() === "GET") {
      if (state.readError)
        return route.fulfill({
          status: 503,
          json: { error: "private-server-sentinel" },
        });
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      const receipt = state.receipts.get(id);
      return route.fulfill({
        status: receipt ? 200 : 404,
        json: receipt
          ? { ...receipt, replayed: true }
          : { code: "AGENT_REQUEST_NOT_FOUND" },
      });
    }
    const body = route.request().postDataJSON();
    state.posts.push(body);
    if (state.noRecord)
      return route.fulfill({
        status: 503,
        json: { error: "private-server-sentinel" },
      });
    if (!state.receipts.has(body.requestId)) {
      let receipt: Record<string, any> = {
        requestId: body.requestId,
        agentId: 2,
        kind: body.kind,
        replayed: false,
        deliveryState: "complete",
        createdTasks: [],
        createdAgents: [],
      };
      if (body.expectedConfig !== state.agent.configVersion) {
        receipt = {
          ...receipt,
          deliveryState: "rejected",
          outcome: "rejected",
          failureCode: "AGENT_CONFIG_CHANGED",
        };
      } else {
        state.effects++;
        if (body.kind === "ask") {
          const user = message(
            Math.max(...state.messages.map((row) => row.id), 0) + 1,
            body.content,
            "user",
          );
          const reply = message(user.id + 1, "Recorded result 原文");
          state.messages.push(user);
          if (!state.unconfirmed) state.messages.push(reply);
          receipt = {
            ...receipt,
            outcome: state.unconfirmed ? "unconfirmed" : "reply",
            deliveryState: state.unconfirmed ? "unconfirmed" : "complete",
            userMessage: user,
            ...(state.unconfirmed
              ? {}
              : {
                  agentMessage: reply,
                  usedModel: reply.modelId,
                  usedProvider: "ollama",
                }),
          };
        } else {
          const task = {
            id: 100 + state.effects,
            ownerAgentId: 2,
            brief: body.content,
            title: body.content.slice(0, 88),
            status: "pending",
            autonomyMode: body.kind === "continuous" ? "continuous" : "finite",
            cadenceSeconds: body.kind === "continuous" ? 3600 : null,
          };
          receipt = {
            ...receipt,
            outcome: "queued",
            task,
            createdTasks: [task],
          };
        }
      }
      state.receipts.set(body.requestId, receipt);
    }
    await state.beforeResponse;
    return route.fulfill({
      status: state.postError ? 503 : 200,
      json: state.postError
        ? { error: "private-server-sentinel" }
        : state.receipts.get(body.requestId),
    });
  });
  return {
    state,
    harness,
    c: await loadExpertChatCopy(locale),
    detail: await loadExpertDetailCopy(locale),
  };
}

for (const locale of LOCALES) {
  test(`${locale} expert chat sends each work mode, preserves source and fits a phone`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.emulateMedia({
      colorScheme: locale === "ar" || locale === "de" ? "light" : "dark",
    });
    const { state, harness, c } = await setup(page, locale);
    await page.goto("/agents/2?tab=chat");
    await expect(
      page.getByRole("heading", { name: c.title, exact: true }),
    ).toBeVisible();
    const composer = page.getByRole("textbox", {
      name: c.instruction,
      exact: true,
    });
    await page.getByRole("radio", { name: c.ask, exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("radio", { name: c.delegate, exact: true }),
    ).toBeChecked();
    await page.getByRole("radio", { name: c.ask, exact: true }).check();
    await composer.fill(original);
    await composer.press("Enter");
    await expect(composer).toHaveValue(original + "\n");
    await composer.dispatchEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
      keyCode: 229,
    });
    expect(state.posts).toHaveLength(0);
    await composer.press("Control+Enter");
    await expect(page.getByText(c.done, { exact: true })).toBeVisible();
    await expect(composer).toHaveValue("");
    expect(state.posts[0]).toMatchObject({
      kind: "ask",
      locale,
      content: original + "\n",
      expectedConfig: "a".repeat(64),
    });
    await expect(page.getByText(c.activityHelp, { exact: true })).toBeVisible();
    await expect(
      page.getByText("Original event — yesterday 原文", { exact: true }),
    ).toBeVisible();
    const sourceMessage = page.locator('[data-message-id="2"]');
    await expect(
      sourceMessage.getByText("recorded:model", { exact: true }),
    ).toBeVisible();
    await expect(
      sourceMessage.locator(`[title="${c.unsafeLink}"]`),
    ).toBeVisible();
    expect(await sourceMessage.getByRole("link").count()).toBe(0);
    for (const kind of ["delegate", "continuous"] as const) {
      await page.getByRole("radio", { name: c[kind], exact: true }).check();
      await composer.fill(`${original}\n${kind}`);
      await page.getByRole("button", { name: c.send, exact: true }).click();
      await expect(page.getByText(c.queued, { exact: true })).toBeVisible();
      await expect(composer).toHaveValue("");
      await expect(page.getByRole("link", { name: c.project })).toHaveAttribute(
        "href",
        `/projects/${100 + state.effects}`,
      );
    }
    expect(state.posts.map((value) => value.kind)).toEqual([
      "ask",
      "delegate",
      "continuous",
    ]);
    expect(new Set(state.posts.map((value) => value.requestId)).size).toBe(3);
    await page
      .getByRole("region", { name: c.receipt })
      .locator("summary")
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(await page.locator("html").getAttribute("dir")).toBe(
      locale === "ar" ? "rtl" : "ltr",
    );
    if (locale === "ar")
      await page.screenshot({
        path: info.outputPath("chat-ar-phone.png"),
        fullPage: true,
      });
    if (locale === "en") {
      await page.setViewportSize({ width: 1365, height: 1000 });
      await expect
        .poll(
          async () =>
            (await page.getByRole("complementary").first().boundingBox())?.x,
        )
        .toBe(0);
      await page.screenshot({
        path: info.outputPath("chat-en-desktop.png"),
        fullPage: true,
      });
      await composer.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath("chat-en-composer.png"),
        fullPage: true,
      });
    }
    expect([...harness.unexpected]).toEqual([]);
  });
}

test("a lost response recovers by GET after reload under stop and archive without dispatch", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  state.postError = true;
  state.readError = true;
  await page.goto("/agents/2?tab=chat");
  await page
    .getByRole("textbox", { name: c.instruction })
    .fill("Recover this once 原文");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(
    page.getByText(c.unconfirmed, { exact: true }).first(),
  ).toBeVisible();
  const first = structuredClone(state.posts[0]);
  state.readError = false;
  state.stopped = true;
  state.agent.isActive = false;
  await page.reload();
  await expect(page.getByText(c.done, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.send, exact: true }),
  ).toBeDisabled();
  expect(state.posts).toEqual([first]);
  expect(state.effects).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("acos.expert-send.v1:2")),
    )
    .toBeNull();
  await expect(page.getByText("private-server-sentinel")).toHaveCount(0);
});

test("a request missing on the server recovers the original identity and language", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  state.noRecord = true;
  await page.goto("/agents/2?tab=chat");
  await page
    .getByRole("textbox", { name: c.instruction })
    .fill("Original send");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.recover, exact: true }),
  ).toBeVisible();
  const first = structuredClone(state.posts[0]);
  state.noRecord = false;
  await page.evaluate(() => localStorage.setItem("acos.locale.v1", "zh-TW"));
  await page.reload();
  const changed = await loadExpertChatCopy("zh-TW");
  await page
    .getByRole("button", { name: changed.recover, exact: true })
    .click();
  await expect(page.getByText(changed.done, { exact: true })).toBeVisible();
  expect(first?.locale).toBe("en");
  expect(state.posts).toEqual([first, first]);
  expect(state.effects).toBe(1);
});

test("unknown work requires explicit review and clearing it does not cancel server work", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  state.unconfirmed = true;
  await page.goto("/agents/2?tab=chat");
  const composer = page.getByRole("textbox", { name: c.instruction });
  await composer.fill("Unconfirmed work");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.review, exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: c.check, exact: true }).click();
  expect(state.posts).toHaveLength(1);
  await page.getByRole("button", { name: c.review, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: c.cancel, exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: c.continue, exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: c.continue, exact: true }).click();
  await expect(composer).toBeEditable();
  await expect(composer).toHaveValue("Unconfirmed work");
  expect(state.receipts.get(state.posts[0]!.requestId).deliveryState).toBe(
    "unconfirmed",
  );
  expect(state.effects).toBe(1);
});

test("drafts survive reload and failed storage prevents dispatch", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  await page.goto("/agents/2?tab=chat");
  await page.getByRole("radio", { name: c.continuous, exact: true }).check();
  await page.getByRole("textbox", { name: c.instruction }).fill(original);
  await page.reload();
  await expect(
    page.getByRole("radio", { name: c.continuous, exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("textbox", { name: c.instruction })).toHaveValue(
    original,
  );
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.expert-send"))
        throw new Error("Test storage failure");
      return set.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(page.getByText(c.storageError, { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(0);
});

test("a rejected stale configuration preserves text without starting work", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  await page.goto("/agents/2?tab=chat");
  const composer = page.getByRole("textbox", { name: c.instruction });
  await composer.fill(original);
  state.agent.configVersion = "b".repeat(64);
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(page.getByText(c.rejected, { exact: true })).toBeVisible();
  await expect(page.getByText(c.configChanged, { exact: true })).toBeVisible();
  await expect(composer).toHaveValue(original);
  await expect(composer).toBeEditable();
  expect(state.effects).toBe(0);
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]!.expectedConfig).toBe("a".repeat(64));
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("acos.expert-send.v1:2")),
    )
    .toBeNull();
});

test("a damaged pending identity requires review and cannot silently send a new request", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  await page.goto("/agents/2?tab=chat");
  await page.getByRole("textbox", { name: c.instruction }).fill(original);
  await page.evaluate(() =>
    sessionStorage.setItem("acos.expert-send.v1:2", "{broken"),
  );
  await page.reload();
  const composer = page.getByRole("textbox", { name: c.instruction });
  await expect(composer).toHaveValue(original);
  await expect(composer).not.toBeEditable();
  await expect(
    page.getByRole("button", { name: c.send, exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: c.review, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: c.continue, exact: true }).click();
  await expect(composer).toHaveValue(original);
  await expect(composer).toBeEditable();
  expect(state.posts).toHaveLength(0);
});

test("leaving the conversation during validation preserves the draft without dispatch", async ({
  page,
}) => {
  const { state, c, detail } = await setup(page);
  await page.goto("/agents/2?tab=chat");
  const composer = page.getByRole("textbox", { name: c.instruction });
  await composer.fill("Keep this unsent draft");
  const settings = page.getByRole("tab", {
    name: detail.settings,
    exact: true,
  });
  const settingsId = await settings.getAttribute("id");
  expect(settingsId).toBeTruthy();
  await composer.evaluate((node, targetId) => {
    (node as HTMLTextAreaElement).form!.requestSubmit();
    document
      .getElementById(targetId!)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
  }, settingsId);
  await expect(settings).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: detail.chat, exact: true }).click();
  await expect(composer).toHaveValue("Keep this unsent draft");
  expect(state.posts).toHaveLength(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.expert-send.v1:2")),
  ).toBeNull();
  await composer.press("Control+Enter");
  await expect(page.getByText(c.done, { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test("late responses in a hidden profile tab keep the send identity until the result is shown", async ({
  page,
}) => {
  const { state, c, detail } = await setup(page);
  let release!: () => void;
  state.beforeResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto("/agents/2?tab=chat");
  await page.getByRole("textbox", { name: c.instruction }).fill("Late reply");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  await page.getByRole("tab", { name: detail.settings, exact: true }).click();
  const response = page.waitForResponse(
    (value) =>
      value.request().method() === "POST" && value.url().endsWith("/requests"),
  );
  release();
  await response;
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.expert-send.v1:2")),
  ).not.toBeNull();
  await page.getByRole("tab", { name: detail.chat, exact: true }).click();
  await expect(page.getByText(c.done, { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("acos.expert-send.v1:2")),
    )
    .toBeNull();
});

test("history stays bounded and new messages do not move a reader", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  state.messages = Array.from({ length: 520 }, (_, index) =>
    message(index + 1),
  );
  await page.goto("/agents/2?tab=chat");
  const history = page.getByRole("region", { name: c.history });
  await expect(history.locator("article")).toHaveCount(50);
  await history.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  state.messages.push(message(521, "New arrival"));
  await expect(page.getByRole("button", { name: c.newMessages })).toBeVisible({
    timeout: 12000,
  });
  expect(await history.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(history.getByText("New arrival", { exact: true })).toHaveCount(
    0,
  );
  for (let pages = 2; pages <= 10; pages++) {
    if (pages === 2) {
      state.olderError = true;
      await page.getByRole("button", { name: c.older, exact: true }).click();
      await expect(page.getByText(c.olderError, { exact: true })).toBeVisible();
      await expect(history.locator("article")).toHaveCount(50);
      state.olderError = false;
    }
    await page.getByRole("button", { name: c.older, exact: true }).click();
    await expect(history.locator("article")).toHaveCount(pages * 50);
  }
  await expect(page.getByText(c.windowLimit, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.older, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: c.newMessages }).click();
  await expect(history.locator("article")).toHaveCount(50);
  await expect(history.getByText("New arrival", { exact: true })).toBeVisible();
});

test("history failures preserve loaded content and clipboard failures are visible", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  state.historyError = true;
  await page.goto("/agents/2?tab=chat");
  await expect(page.getByText(c.historyError, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.send, exact: true }),
  ).toBeDisabled();
  state.historyError = false;
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  const history = page.getByRole("region", { name: c.history });
  await expect(history.locator("article")).toHaveCount(2);
  state.historyError = true;
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  await expect(page.getByText(c.historyStale, { exact: true })).toBeVisible();
  await expect(history.locator("article")).toHaveCount(2);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Test permission failure");
        },
      },
    }),
  );
  await history
    .getByRole("button", { name: c.copy, exact: true })
    .first()
    .click();
  await expect(page.getByText(c.copyError, { exact: true })).toBeVisible();
});

test("oversized work and missing language assets stay recoverable", async ({
  page,
}) => {
  const { state, c } = await setup(page);
  await page.goto("/agents/2?tab=chat");
  await page.getByRole("radio", { name: c.delegate, exact: true }).check();
  await page
    .getByRole("textbox", { name: c.instruction })
    .fill("x".repeat(8001));
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(page.getByText(c.tooLong, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: c.instruction }),
  ).toBeFocused();
  expect(state.posts).toHaveLength(0);
  await page.route("**/assets/chat-en-*.js", (route) => route.abort());
  await page.reload();
  await expect(
    page.getByText(setupMessages.en.languageFileError, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: c.instruction })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.expert-draft.v1:2")),
  ).toContain("x".repeat(8001));
});
