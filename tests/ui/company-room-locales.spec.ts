import {
  inspectRoute,
  inspectReadableLabel,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import { expect, test, type Page } from "@playwright/test";
import type { CompanyMessage } from "@workspace/api-client-react";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadCompanyRoomCopy } from "../../artifacts/agentic-company-os/src/lib/company-room-copy";
import { loadAgentDirectoryCopy } from "../../artifacts/agentic-company-os/src/lib/agent-directory-copy";

function message(
  id: number,
  content = "Original conversation 原文",
): CompanyMessage {
  return {
    id,
    channelId: 1,
    senderType: "founder",
    senderAgentId: null,
    senderName: null,
    senderRole: null,
    senderAvatarColor: null,
    content,
    source: "operator",
    taskId: null,
    replyToMessageId: null,
    modelId: null,
    createdAt: "2026-09-27T00:00:00Z",
  };
}
async function setup(page: Page, locale: Locale) {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const harness = await installStudioFixtures(page);
  const agents = studioAgents.slice(0, 3).map((agent, index) => ({
    ...agent,
    name: ["Atlas", "Alice", "Research 原文"][index],
  }));
  const member = (id: number) => {
    const agent = agents.find((agent) => agent.id === id)!;
    return { ...agent, agentId: id, channelId: 1, joinedAt: agent.createdAt };
  };
  const state = {
    agents,
    members: [member(1), member(2)],
    messages: [message(1)],
    memberError: false,
    messageError: false,
    stopped: false,
    sendError: false,
    unconfirmed: false,
    holdReply: null as Promise<void> | null,
    holdMembership: null as Promise<void> | null,
    sends: [] as Record<string, any>[],
    toggles: [] as string[],
    queries: [] as string[],
    receipts: new Map<string, Record<string, any>>(),
  };
  await page.route("**/api/agents?*", (route) =>
    route.fulfill({ json: state.agents }),
  );
  await page.route("**/api/ops/control", (route) =>
    route.fulfill({
      json: {
        emergencyStopEnabled: state.stopped,
        reason: null,
        version: 1,
        updatedBy: "fixture",
        updatedAt: new Date().toISOString(),
        blockedScopes: [],
      },
    }),
  );
  await page.route("**/api/company-chat/members**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        status: state.memberError ? 503 : 200,
        json: state.memberError ? { error: "Unavailable" } : state.members,
      });
    if (route.request().method() === "POST") {
      const id = route.request().postDataJSON().agentId;
      state.toggles.push("join:" + id);
      state.members.push(member(id));
      if (state.holdMembership) await state.holdMembership;
      return route.fulfill({ status: 201, json: member(id) });
    }
    const id = Number(
      new URL(route.request().url()).pathname.split("/").at(-1),
    );
    state.toggles.push("leave:" + id);
    state.members = state.members.filter((item) => item.agentId !== id);
    if (state.holdMembership) await state.holdMembership;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/api/company-chat/messages*", async (route) => {
    if (route.request().method() === "GET") {
      const query = new URL(route.request().url()).searchParams;
      state.queries.push(query.toString());
      const rows = state.messages
        .filter(
          (row) =>
            !query.has("beforeId") || row.id < Number(query.get("beforeId")),
        )
        .sort((a, b) => b.id - a.id)
        .slice(0, Number(query.get("limit")))
        .reverse();
      return route.fulfill({
        status: state.messageError ? 503 : 200,
        json: state.messageError ? { error: "Unavailable" } : rows,
      });
    }
    const body = route.request().postDataJSON();
    state.sends.push(body);
    let receipt = state.receipts.get(body.requestId);
    if (!receipt) {
      const founder = message(
        Math.max(0, ...state.messages.map((row) => row.id)) + 1,
        body.content,
      );
      state.messages.push(founder);
      receipt = {
        founderMessage: founder,
        agentMessages: [],
        skippedParticipants: [{ agentId: 1, reason: "busy" }],
        routing: {},
        deliveryState: state.unconfirmed ? "unconfirmed" : "complete",
        replayed: false,
      };
      state.receipts.set(body.requestId, receipt);
    }
    if (state.holdReply) await state.holdReply;
    if (state.sendError)
      return route.fulfill({
        status: 503,
        json: { error: "Response lost after persistence" },
      });
    return route.fulfill({ status: 201, json: receipt });
  });
  return { ...harness, state, c: await loadCompanyRoomCopy(locale) };
}

for (const locale of LOCALES)
  test(`${locale} room selects exact recipients, records a send and preserves source text on a phone`, async ({
    page,
  }) => {
    const { state, c, unexpected } = await setup(page, locale);
    if (locale === "tr") {
      state.agents[1].name = "İpek";
      state.members[1].name = "İpek";
    }
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    if (locale === "ar")
      await page.addInitScript(() =>
        localStorage.setItem("acos.color-mode.v2", "light"),
      );
    const packs: string[] = [];
    page.on("request", (request) => {
      const file = new URL(request.url()).pathname.split("/").at(-1)!;
      if (/^room-.+\.js$/.test(file)) packs.push(file);
    });
    await page.goto("/company-chat");
    await expect(
      page.getByRole("heading", { name: c.title, level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    await expect(
      page.getByText("Original conversation 原文", { exact: true }),
    ).toBeVisible();
    const input = page.getByRole("textbox", { name: c.compose, exact: true });
    if (locale === "tr") {
      await input.fill("@ip");
      await expect(page.getByRole("option", { name: /^İpek/ })).toBeVisible();
    }
    await input.fill("@");
    await expect(
      page.getByRole("listbox", { name: c.mentionMembers, exact: true }),
    ).toBeVisible();
    await input.press("Enter");
    await expect(input).toHaveValue("@Atlas ");
    await input.press("End");
    await input.pressSequentially("Original draft");
    const send = page.getByRole("button", { name: c.send, exact: true });
    expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (locale === "en") await input.press("Control+Enter");
    else await send.click();
    await expect(
      page.getByRole("heading", { name: new RegExp(c.stored) }),
    ).toBeVisible();
    expect(state.sends).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        locale,
        content: "@Atlas Original draft",
        mentionedAgentIds: [1],
      },
    ]);
    await expect(input).toBeDisabled();
    await page.getByText(c.skipped, { exact: true }).click();
    await expect(page.getByText(new RegExp(c.busy))).toBeVisible();
    await page.getByRole("button", { name: c.newSend, exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    if (locale === "ar" || locale === "en")
      await page.screenshot({
        path: `test-results/room-${locale}-phone.png`,
        fullPage: true,
        animations: "disabled",
      });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatch(new RegExp(`^room-${locale}-`));
    expect([...unexpected]).toEqual([]);
  });

test("an unknown send recovers the same identity after reload without a second message", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  state.sendError = true;
  await page.goto("/company-chat");
  await page
    .getByRole("textbox", { name: c.compose })
    .fill("Persist this once");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(page.getByText(c.unknown, { exact: true })).toBeVisible();
  const identity = state.sends[0].requestId;
  await page.reload();
  await expect(page.getByRole("textbox", { name: c.compose })).toHaveValue(
    "Persist this once",
  );
  await expect(page.getByRole("textbox", { name: c.compose })).toBeDisabled();
  state.sendError = false;
  state.stopped = true;
  await page.getByRole("button", { name: c.recover, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(c.stored) }),
  ).toBeVisible();
  expect(state.sends.map((item) => item.requestId)).toEqual([
    identity,
    identity,
  ]);
  expect(
    state.messages.filter((row) => row.content === "Persist this once"),
  ).toHaveLength(1);
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.room-send.v1")),
  ).toBeNull();
});

test("an unconfirmed round records the message without claiming all replies finished", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  state.unconfirmed = true;
  await page.goto("/company-chat");
  await page
    .getByRole("textbox", { name: c.compose })
    .fill("Recoverable conversation");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(page.getByText(c.unconfirmed, { exact: true })).toBeVisible();
  await expect(page.getByText(c.storedHelp, { exact: true })).toHaveCount(0);
});

test("membership changes require a fresh roster and inactive experts cannot join", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  state.agents[2].isActive = false;
  await page.goto("/company-chat");
  const roster = page.getByRole("complementary", {
    name: c.memberRegion,
    exact: true,
  });
  await expect(
    roster.getByRole("button", {
      name: c.join + ": Research 原文",
      exact: true,
    }),
  ).toBeDisabled();
  await roster
    .getByRole("button", { name: c.leave + ": Atlas", exact: true })
    .click();
  await expect(
    roster.getByRole("button", { name: c.join + ": Atlas", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  state.memberError = true;
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(page.getByText(c.rosterStale, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: c.compose })).toBeDisabled();
  state.memberError = false;
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await roster
    .getByRole("button", { name: c.join + ": Atlas", exact: true })
    .click();
  expect(state.toggles).toEqual(["leave:1", "join:1"]);
});

test("a pending membership change cannot overlap a new room send", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  let release!: () => void;
  state.holdMembership = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto("/company-chat");
  const input = page.getByRole("textbox", { name: c.compose });
  await input.fill("Review recipients before sending");
  try {
    await page
      .getByRole("button", { name: c.leave + ": Atlas", exact: true })
      .click();
    await expect.poll(() => state.toggles.length).toBe(1);
    await expect(input).toBeDisabled();
    await expect(
      page.getByRole("button", { name: c.send, exact: true }),
    ).toBeDisabled();
    expect(state.sends).toHaveLength(0);
    release();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue("Review recipients before sending");
    await expect(
      page.getByRole("button", { name: c.join + ": Atlas", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  } finally {
    release();
  }
});

test("a selected mention keeps its reviewed identity after a rename and can be removed", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  await page.goto("/company-chat");
  const input = page.getByRole("textbox", { name: c.compose });
  await input.fill("@");
  await input.press("Enter");
  state.members[0].name = "Renamed expert";
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(page.getByText(c.invalidMention, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: c.send, exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: c.removeMention + ": Atlas", exact: true })
    .click();
  await expect(input).toHaveValue(" ");
  expect(state.sends).toHaveLength(0);
});

test("a blocked recovery-storage write cannot dispatch a message", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "acos.room-send.v1")
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/company-chat");
  await page.getByRole("textbox", { name: c.compose }).fill("Keep my draft");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(page.getByText(c.storageError, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: c.compose })).toHaveValue(
    "Keep my draft",
  );
  expect(state.sends).toHaveLength(0);
});

test("room history loads older messages without losing latest messages", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  state.messages = Array.from({ length: 55 }, (_, index) =>
    message(index + 1, "Message " + (index + 1)),
  );
  await page.goto("/company-chat");
  await expect(
    page.getByRole("log").getByText("Message 55", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: c.older, exact: true }).click();
  await expect(
    page.getByRole("log").getByText("Message 1", { exact: true }),
  ).toBeAttached();
  await expect(page.getByRole("log").getByRole("article")).toHaveCount(55);
  expect(
    state.queries.some(
      (query) => new URLSearchParams(query).get("beforeId") === "6",
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: c.older, exact: true }),
  ).toHaveCount(0);
});

test("initial and stale message failures preserve drafts and block new sends", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  state.messageError = true;
  await page.goto("/company-chat");
  await expect(page.getByText(c.messagesError, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: c.empty, exact: true }),
  ).toHaveCount(0);
  state.messageError = false;
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await page.getByRole("textbox", { name: c.compose }).fill("Retained draft");
  state.messageError = true;
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(page.getByText(c.messagesStale, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: c.compose })).toHaveValue(
    "Retained draft",
  );
  await expect(
    page.getByRole("button", { name: c.send, exact: true }),
  ).toBeDisabled();
});

test("the shared skip link is concealed at rest and exposes a keyboard route to main content", async ({
  page,
}) => {
  await setup(page, "en");
  await page.goto("/company-chat");
  const skip = page.getByRole("link", {
    name: "Skip to main content",
    exact: true,
  });
  // The shell intentionally focuses main after navigation. Traverse backward
  // from that established position rather than assuming focus starts at body.
  await expect(page.locator("#main-content")).toBeFocused();
  expect(
    await skip.evaluate((element) => getComputedStyle(element).clipPath),
  ).toBe("inset(50%)");
  for (let step = 0; step < 25; step++) {
    await page.keyboard.press("Shift+Tab");
    if (await skip.evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("Chinese IME confirmation does not choose a mention or send a message", async ({
  page,
}) => {
  const { state, c } = await setup(page, "zh-CN");
  await page.goto("/company-chat");
  const input = page.getByRole("textbox", { name: c.compose });
  await input.fill("@");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
    ctrlKey: true,
  });
  await expect(input).toHaveValue("@");
  expect(state.sends).toHaveLength(0);
});

test("a response arriving after navigation leaves its recovery identity for the next visit", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  const directory = await loadAgentDirectoryCopy("en");
  let release!: () => void;
  state.holdReply = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto("/company-chat");
  await page
    .getByRole("textbox", { name: c.compose })
    .fill("Late response 原文");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect.poll(() => state.sends.length).toBe(1);
  const requestId = state.sends[0].requestId;
  try {
    await page
      .getByRole("navigation", { name: "Main menu" })
      .getByRole("link", { name: "Experts", exact: true })
      .click();
    await expect(page).toHaveURL(/\/agents$/);
    // A lazy route may update the address before the old room unmounts.
    // Release the reply only after the destination actually rendered.
    await expect(
      page.getByRole("heading", {
        name: directory.title,
        level: 1,
        exact: true,
      }),
    ).toBeVisible();
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/company-chat/messages") &&
        response.request().method() === "POST",
    );
    release();
    await response;
    expect(
      await page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("acos.room-send.v1")!).requestId,
      ),
    ).toBe(requestId);
    await page
      .getByRole("navigation", { name: "Main menu" })
      .getByRole("link", { name: c.title, exact: true })
      .click();
    await page.getByRole("button", { name: c.recover, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(c.stored) }),
    ).toBeVisible();
    expect(state.sends.map((item) => item.requestId)).toEqual([
      requestId,
      requestId,
    ]);
    expect(
      state.messages.filter((row) => row.content === "Late response 原文"),
    ).toHaveLength(1);
  } finally {
    release();
  }
});

test("held destination chunk preserves a late room receipt recovery identity", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  const directory = await loadAgentDirectoryCopy("en");
  let releaseReply!: () => void, releaseChunk!: () => void;
  state.holdReply = new Promise<void>((r) => (releaseReply = r));
  const chunkGate = new Promise<void>((r) => (releaseChunk = r));
  let chunkRequests = 0;
  await page.route("**/assets/list-*.js", async (route) => {
    chunkRequests++;
    await chunkGate;
    await route.continue();
  });
  try {
    await page.goto("/company-chat");
    await page
      .getByRole("textbox", { name: c.compose })
      .fill("Late receipt while destination is loading 原文");
    await page.getByRole("button", { name: c.send, exact: true }).click();
    await expect.poll(() => state.sends.length).toBe(1);
    const requestId = state.sends[0].requestId;
    await page
      .getByRole("navigation", { name: "Main menu" })
      .getByRole("link", { name: "Experts", exact: true })
      .click();
    await expect(page).toHaveURL(/\/agents$/);
    await expect.poll(() => chunkRequests).toBe(1);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/company-chat/messages") &&
        r.request().method() === "POST",
    );
    const refreshed = page.waitForResponse(
      (r) =>
        r.url().includes("/api/company-chat/messages?") &&
        r.request().method() === "GET",
    );
    releaseReply();
    await response;
    await refreshed;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(() => {
        const raw = sessionStorage.getItem("acos.room-send.v1");
        return raw ? JSON.parse(raw).requestId : null;
      }),
    ).toBe(requestId);
    releaseChunk();
    await expect(
      page.getByRole("heading", {
        name: directory.title,
        level: 1,
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main menu" })
      .getByRole("link", { name: c.title, exact: true })
      .click();
    await page.getByRole("button", { name: c.recover, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(c.stored) }),
    ).toBeVisible();
    expect(state.sends.map((x) => x.requestId)).toEqual([requestId, requestId]);
    expect(
      state.messages.filter(
        (x) => x.content === "Late receipt while destination is loading 原文",
      ),
    ).toHaveLength(1);
  } finally {
    releaseReply();
    releaseChunk();
  }
});

test("new arrivals leave the reading position until the operator requests latest messages", async ({
  page,
}) => {
  const { state, c } = await setup(page, "en");
  state.messages = Array.from({ length: 40 }, (_, index) =>
    message(index + 1, "Message " + (index + 1)),
  );
  await page.goto("/company-chat");
  const log = page.getByRole("log");
  await expect(log.getByRole("article")).toHaveCount(40);
  await log.evaluate((element) => {
    element.scrollTop = 100;
    element.dispatchEvent(new Event("scroll"));
  });
  state.messages.push(message(41, "New arrival"));
  await page.getByRole("button", { name: c.retry, exact: true }).click();
  await expect(log.getByText("New arrival", { exact: true })).toBeAttached();
  expect(await log.evaluate((element) => element.scrollTop)).toBe(100);
  await page.getByRole("button", { name: c.newMessages, exact: true }).click();
  await expect
    .poll(() =>
      log.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(2);
  await expect(
    page.getByRole("button", { name: c.newMessages, exact: true }),
  ).toHaveCount(0);
});

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: company room and membership`, async ({
    page,
  }, info) => {
    const { state, c, unexpected } = await setup(page, locale);
    const errors = await prepareRouteAudit(page, variant);
    await page.goto("/company-chat");
    await expect(
      page.getByRole("heading", { name: c.title, level: 1, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: c.compose, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Original conversation 原文", { exact: true }),
    ).toBeVisible();
    await inspectRoute(page, info, "company-room", variant);
    if (variant.largeText)
      await inspectReadableLabel(
        page.getByText("Original conversation 原文", { exact: true }),
        "conversation",
        1,
      );
    expect(state.sends).toEqual([]);
    expect(state.toggles).toEqual([]);
    expect([...unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
