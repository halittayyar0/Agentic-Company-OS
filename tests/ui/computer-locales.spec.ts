import {
  inspectRoute,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import { loadOperatorCopy } from "../../artifacts/agentic-company-os/src/lib/operator-copy";
import { operatorReceipt } from "./helpers/operator-receipts";
import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import {
  LOCALES,
  setupMessages,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
import { loadComputerCopy } from "../../artifacts/agentic-company-os/src/lib/computer-copy";
import { loadExpertDetailCopy } from "../../artifacts/agentic-company-os/src/lib/expert-detail-copy";
import {
  getTerminalCopy,
  terminalMessage,
} from "../../artifacts/api-server/src/lib/vm/terminal-localization";

const source = "Original 原文 / özgün çıktı / المخرجات";
async function setup(page: Page, locale: Locale = "en") {
  const harness = await installStudioFixtures(page);
  await page.addInitScript((selected) => {
    if (!sessionStorage.getItem("computer-fixture-locale")) {
      localStorage.setItem("acos.locale.v1", selected);
      sessionStorage.setItem("computer-fixture-locale", "1");
    }
  }, locale);
  const state = {
    agent: {
      ...structuredClone(studioAgents[1]),
      permissions: {
        ...studioAgents[1].permissions,
        canBrowse: false,
        canUseTerminal: true,
      },
    },
    writes: [] as {
      command: string;
      as: string;
      requestId: string;
      locale?: Locale;
    }[],
    receipts: new Map<string, ReturnType<typeof operatorReceipt>>(),
    reads: 0,
    fail: false,
    invalid: false,
    statusError: false,
    activityError: false,
    hold: null as Promise<void> | null,
    output: source,
    events: [
      {
        id: 91,
        agentId: 2,
        taskId: null,
        type: "vm_command",
        summary: source,
        severity: "info",
        createdAt: "2026-09-27T08:00:00Z",
        detail: { actor: "agent", surface: "terminal", status: "running" },
      },
    ],
  };
  await page.route("**/api/agents/2", (route) =>
    route.fulfill({ json: state.agent }),
  );
  await page.route("**/api/agents/2/messages**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/activity**", (route) =>
    route.fulfill({
      status: state.activityError ? 503 : 200,
      json: state.activityError
        ? { error: "private-error-sentinel" }
        : state.events,
    }),
  );
  await page.route("**/api/agents/2/vm/status", (route) =>
    route.fulfill({
      status: state.statusError ? 503 : 200,
      json: state.statusError
        ? { error: "private-error-sentinel" }
        : {
            agentId: 2,
            workspaceId: "agent-2",
            lifecycle: "ready",
            isolation: "filesystem_sandbox",
            persistent: true,
            processExecutionEnabled: false,
            exists: true,
            cwd: "/",
            totalBytes: 12345,
            fileCount: 1,
            dirCount: 0,
          },
    }),
  );
  await page.route("**/api/agents/2/vm/files-list", (route) =>
    route.fulfill({ json: { path: "", entries: [], total: 0 } }),
  );
  await page.route("**/api/agents/2/operator-requests/*", (route) => {
    state.reads++;
    const saved = state.receipts.get(route.request().url().split("/").at(-1)!);
    return route.fulfill({
      status: saved ? 200 : 404,
      json: saved ?? { error: "not_found" },
    });
  });
  await page.route("**/api/agents/2/vm/exec", async (route) => {
    const body = route.request().postDataJSON();
    state.writes.push(body);
    const result = {
      ok: true,
      exitCode: 0,
      stdout: state.output,
      stderr: "",
      note: null,
      cwd: "/",
      durationMs: 12,
    };
    const receipt = operatorReceipt(
      body.requestId,
      body.as === "founder" ? "terminal_host" : "terminal_sandbox",
      result,
    );
    state.receipts.set(body.requestId, receipt);
    if (state.hold) await state.hold;
    await route.fulfill({
      status: state.fail ? 503 : 200,
      json: state.fail
        ? { error: "private-error-sentinel" }
        : state.invalid
          ? { ok: true }
          : { receipt, result },
    });
  });
  const c = await loadComputerCopy(locale);
  const profile = await loadExpertDetailCopy(locale);
  const rc = await loadOperatorCopy(locale);
  async function open() {
    await page
      .getByRole("tab", { name: profile.computer, exact: true })
      .click();
  }
  const frame = page.getByRole("region", {
    name: c.agentLabel.replace("{name}", state.agent.name),
    exact: true,
  });
  const terminal = frame.getByRole("region", { name: c.terminal, exact: true });
  return { ...harness, state, c, rc, profile, open, frame, terminal };
}

for (const locale of ["en", "ar"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} localized Terminal help fits a phone and keeps literal command names`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 320, height: 950 });
      await page.emulateMedia({ colorScheme: theme });
      const h = await setup(page, locale);
      const copy = getTerminalCopy(locale);
      h.state.output = [
        copy.helpBuiltins,
        "  cd, ls/dir, cat/type, echo, mkdir, touch/write, rm/del, pwd, whoami, date, help",
        terminalMessage(locale, "helpProcessesDisabled", {
          commands: "node, npm, npx, pnpm, python, python3, git",
        }),
        copy.helpDeleteReview,
        "",
      ].join("\n");
      await page.goto("/agents/2");
      await h.open();
      await h.terminal
        .getByRole("button", { name: "help", exact: true })
        .click();
      expect(h.state.writes).toHaveLength(0);
      await h.terminal
        .getByRole("button", { name: h.c.run, exact: true })
        .click();
      const output = h.terminal.getByRole("log");
      await expect(output).toContainText(copy.helpBuiltins);
      await expect(output).toContainText("ALLOW_AGENT_PROCESS_EXEC=true");
      expect(h.state.writes[0]).toMatchObject({ command: "help", locale });
      const overflow = await h.terminal.evaluate(
        (node) => node.scrollWidth - node.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await output.focus();
      await expect(output).toBeFocused();
      await h.terminal.screenshot({
        path: info.outputPath(`terminal-localized-${locale}-${theme}.png`),
      });
    });
  }
}

for (const locale of LOCALES)
  test(`${locale} computer and terminal use readable controls, exact source and explicit keyboard submission`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: locale === "en" ? 1365 : locale === "ar" ? 320 : 390,
      height: 950,
    });
    await page.emulateMedia({
      colorScheme: locale === "ar" ? "light" : "dark",
    });
    const h = await setup(page, locale);
    await page.goto("/agents/2");
    await h.open();
    await expect(
      h.frame.getByRole("heading", { name: h.c.title }),
    ).toBeVisible();
    await expect(
      h.frame.getByText(h.c.activityHelp, { exact: true }),
    ).toBeVisible();
    await expect(h.frame.getByText(source, { exact: true })).toBeVisible();
    const terminalTab = h.frame.getByRole("tab", {
      name: h.c.terminal,
      exact: true,
    });
    await terminalTab.focus();
    await terminalTab.press(locale === "ar" ? "ArrowLeft" : "ArrowRight");
    await expect(
      h.frame.getByRole("tab", { name: h.c.files, exact: true }),
    ).toBeFocused();
    await expect(terminalTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(terminalTab).toBeFocused();
    const input = h.terminal.getByRole("textbox", {
      name: h.c.command,
      exact: true,
    });
    expect(
      await input.evaluate(
        (element: HTMLTextAreaElement) => element.form?.noValidate,
      ),
    ).toBe(true);
    await input.press("Control+Enter");
    await expect(
      h.terminal.getByText(h.c.commandRequired, { exact: true }),
    ).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill("  write 原文.txt متن");
    await input.press("Enter");
    await expect(input).toHaveValue("  write 原文.txt متن\n");
    await input.evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(h.state.writes).toHaveLength(0);
    await input.press("Control+Enter");
    await expect.poll(() => h.state.writes.length).toBe(1);
    expect(h.state.writes[0]).toMatchObject({
      command: "  write 原文.txt متن\n",
      as: "sandbox",
      locale,
    });
    await expect(h.terminal.getByText(source, { exact: true })).toBeVisible();
    await expect(input).toHaveValue("");
    await h.terminal
      .getByRole("radio", { name: h.c.host, exact: true })
      .check();
    await expect(
      h.terminal.getByText(h.c.hostHelp, { exact: true }),
    ).toBeVisible();
    await input.fill("host draft 原文");
    await h.terminal
      .getByRole("radio", { name: h.c.workspace, exact: true })
      .check();
    await expect(input).toHaveValue("");
    await input.fill("workspace draft متن");
    await page.reload();
    await h.open();
    await expect(input).toHaveValue("workspace draft متن");
    await expect(
      h.terminal.getByRole("radio", { name: h.c.workspace, exact: true }),
    ).toBeChecked();
    await h.terminal
      .getByRole("radio", { name: h.c.host, exact: true })
      .check();
    await expect(input).toHaveValue("host draft 原文");
    expect(h.state.writes).toHaveLength(1);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    const metrics = await h.terminal.evaluate((node) => ({
      font: parseFloat(
        getComputedStyle(node.querySelector("textarea")!).fontSize,
      ),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      targets: Array.from(node.querySelectorAll("button"))
        .filter((button) => button.getBoundingClientRect().height > 0)
        .every((button) => button.getBoundingClientRect().height >= 43),
    }));
    expect(metrics.font).toBeGreaterThanOrEqual(16);
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    expect(metrics.targets).toBe(true);
    if (locale === "ar" || locale === "en")
      await page.screenshot({
        path: info.outputPath(`computer-${locale}.png`),
        fullPage: true,
      });
    expect([...h.unexpected]).toEqual([]);
  });

test("unknown and invalid command replies survive reload and require review without resending", async ({
  page,
}) => {
  const h = await setup(page);
  h.state.fail = true;
  await page.goto("/agents/2");
  await h.open();
  const input = h.terminal.getByRole("textbox", {
    name: h.c.command,
    exact: true,
  });
  await input.fill("touch important.txt");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect(
    h.terminal.getByRole("region", { name: h.c.unconfirmed }),
  ).toBeVisible();
  await page.reload();
  await h.open();
  await expect(input).toHaveValue("touch important.txt");
  await expect(
    h.terminal.getByRole("button", { name: h.c.run, exact: true }),
  ).toBeDisabled();
  await h.terminal
    .getByRole("button", { name: h.rc.review, exact: true })
    .click();
  await expect(
    page.getByRole("alertdialog").getByRole("button", { name: h.rc.cancel }),
  ).toBeFocused();
  await expect(
    page.getByRole("alertdialog").getByRole("button", { name: h.rc.finish }),
  ).toBeDisabled();
  expect(h.state.writes).toHaveLength(1);
  await page
    .getByRole("alertdialog")
    .getByRole("checkbox", { name: h.rc.reviewCheck })
    .check();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: h.rc.finish })
    .click();
  expect(h.state.writes).toHaveLength(1);
  h.state.fail = false;
  h.state.invalid = true;
  await input.fill("pwd");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect(
    h.terminal.getByRole("region", { name: h.c.unconfirmed }),
  ).toBeVisible();
  expect(h.state.writes).toHaveLength(2);
  await expect(page.getByText("private-error-sentinel")).toHaveCount(0);
});

test("late responses preserve the next draft across profile tabs and never take focus", async ({
  page,
}) => {
  const h = await setup(page);
  let release!: () => void;
  h.state.hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto("/agents/2");
  await h.open();
  const input = h.terminal.getByRole("textbox", {
    name: h.c.command,
    exact: true,
  });
  await input.fill("ls");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect.poll(() => h.state.writes.length).toBe(1);
  await input.fill("next command 原文");
  await page.getByRole("tab", { name: h.profile.chat, exact: true }).click();
  release();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!).record
            .status,
      ),
    )
    .toBe("returned");
  await expect(
    page.getByRole("tab", { name: h.profile.chat, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await h.open();
  await expect(input).toHaveValue("next command 原文");
  await expect(h.terminal.getByText(source, { exact: true })).toBeVisible();
  expect(h.state.writes).toHaveLength(1);
});

test("blocked local storage cannot dispatch and damaged records need explicit review", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/agents/2");
  await h.open();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.terminal.")) throw Error("quota");
      return original.call(this, key, value);
    };
  });
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("touch secret.txt");
  await expect(
    h.terminal.getByText(h.c.storageError, { exact: true }),
  ).toBeVisible();
  await expect(
    h.terminal.getByRole("button", { name: h.c.run, exact: true }),
  ).toBeDisabled();
  expect(h.state.writes).toHaveLength(0);
  await page.reload();
  await page.evaluate(() =>
    sessionStorage.setItem("acos.terminal.v1:2", "{damaged"),
  );
  await h.open();
  await expect(
    h.terminal.getByText(h.c.damaged, { exact: true }),
  ).toBeVisible();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("kept while reviewing");
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.terminal.v1:2")),
  ).toBe("{damaged");
  await h.terminal
    .getByRole("button", { name: h.rc.review, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("checkbox", { name: h.rc.reviewCheck })
    .check();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: h.rc.finish })
    .click();
  await expect(
    h.terminal.getByRole("textbox", { name: h.c.command, exact: true }),
  ).toHaveValue("kept while reviewing");
  expect(h.state.writes).toHaveLength(0);
});

test("array-shaped Terminal status opens damaged-record review instead of stranding input", async ({
  page,
}) => {
  const h = await setup(page, "ar");
  await page.setViewportSize({ width: 320, height: 950 });
  await page.goto("/agents/2");
  const raw = JSON.stringify({
    agentId: 2,
    drafts: { sandbox: "original draft", founder: "" },
    record: {
      id: "8bad5292-0f54-4e84-95e6-c0e5306bc86f",
      agentId: 2,
      command: "touch must-not-repeat.txt",
      mode: "sandbox",
      startedAt: "2026-09-27T00:00:00.000Z",
      status: ["unknown"],
    },
  });
  await page.evaluate(
    (value) => sessionStorage.setItem("acos.terminal.v1:2", value),
    raw,
  );
  await h.open();
  await expect(
    h.terminal.getByText(h.c.damaged, { exact: true }),
  ).toBeVisible();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("reviewed draft");
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.terminal.v1:2")),
  ).toBe(raw);
  await h.terminal
    .getByRole("button", { name: h.rc.review, exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("checkbox", { name: h.rc.reviewCheck })
    .check();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: h.rc.finish })
    .click();
  await expect(
    h.terminal.getByRole("textbox", { name: h.c.command, exact: true }),
  ).toHaveValue("reviewed draft");
  await expect(
    h.terminal.getByRole("button", { name: h.c.run, exact: true }),
  ).toBeEnabled();
  expect(h.state.writes).toHaveLength(0);
});

test("stale activity remains source evidence while an unverified directory blocks commands", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/agents/2");
  await h.open();
  await expect(h.frame.getByText(source, { exact: true })).toBeVisible();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("pwd");
  h.state.activityError = true;
  h.state.statusError = true;
  await h.frame
    .getByRole("button", { name: h.c.refresh, exact: true })
    .first()
    .click();
  await expect(
    h.frame.getByText(h.c.activityStale, { exact: true }),
  ).toBeVisible();
  await expect(h.frame.getByText(source, { exact: true })).toBeVisible();
  await expect(
    h.terminal.getByRole("button", { name: h.c.run, exact: true }),
  ).toBeDisabled();
  h.state.activityError = false;
  h.state.statusError = false;
  await h.frame
    .getByRole("button", { name: h.c.refresh, exact: true })
    .first()
    .click();
  await expect(
    h.terminal.getByRole("button", { name: h.c.run, exact: true }),
  ).toBeEnabled();
  expect(h.state.writes).toHaveLength(0);
});

test("oversized commands stay intact and failed clipboard writes have visible feedback", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/agents/2");
  await h.open();
  const input = h.terminal.getByRole("textbox", {
    name: h.c.command,
    exact: true,
  });
  await input.fill("x".repeat(32769));
  await expect(
    h.terminal.getByText(h.c.tooLong, { exact: true }),
  ).toBeVisible();
  await expect(
    h.terminal.getByRole("button", { name: h.c.run, exact: true }),
  ).toBeDisabled();
  await page.reload();
  await h.open();
  await expect(input).toHaveValue("x".repeat(32769));
  await input.fill("ls");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect(h.terminal.getByText(source, { exact: true })).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error("denied");
        },
      },
    }),
  );
  await h.terminal.getByRole("button", { name: h.c.copy, exact: true }).click();
  await expect(
    h.terminal.getByText(h.c.copyError, { exact: true }),
  ).toBeVisible();
});

test("missing selected computer copy offers localized recovery before opening tools", async ({
  page,
}) => {
  const h = await setup(page, "de");
  await page.route("**/assets/computer-de-*.js", (route) => route.abort());
  await page.goto("/agents/2");
  await h.open();
  await expect(
    page.getByText(setupMessages.de.languageFileError, { exact: true }),
  ).toBeVisible();
  await expect(h.terminal).toHaveCount(0);
  expect(h.state.writes).toHaveLength(0);
});

test("host authority is explicit and frozen while the command is pending", async ({
  page,
}) => {
  const h = await setup(page);
  let release!: () => void;
  h.state.hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto("/agents/2");
  await h.open();
  const host = h.terminal.getByRole("radio", { name: h.c.host, exact: true });
  await expect(host).not.toBeChecked();
  await host.check();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("  echo exact host 原文  ");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect.poll(() => h.state.writes.length).toBe(1);
  expect(h.state.writes[0]).toMatchObject({
    command: "  echo exact host 原文  ",
    as: "founder",
  });
  await expect(
    h.terminal.getByRole("radio", { name: h.c.workspace, exact: true }),
  ).toBeDisabled();
  release();
  await expect(h.terminal.getByText(source, { exact: true })).toBeVisible();
});

test("terminal permission and unavailable safety status block dispatch but retain drafts", async ({
  page,
}) => {
  const h = await setup(page);
  h.state.agent.permissions.canUseTerminal = false;
  await page.goto("/agents/2");
  await h.open();
  await h.frame.getByRole("tab", { name: h.c.terminal, exact: true }).click();
  const input = h.terminal.getByRole("textbox", {
    name: h.c.command,
    exact: true,
  });
  await input.fill("kept source 原文");
  await expect(
    h.terminal.getByText(h.c.disabled, { exact: true }),
  ).toBeVisible();
  await expect(
    h.terminal.getByRole("button", { name: h.c.run, exact: true }),
  ).toBeDisabled();
  h.state.agent.permissions.canUseTerminal = true;
  await page.route("**/api/ops/control", (route) =>
    route.fulfill({ status: 503, json: { error: "private-error-sentinel" } }),
  );
  await page.reload();
  await h.open();
  await expect(input).toHaveValue("kept source 原文");
  await expect(
    h.terminal.getByText(h.c.blocked, { exact: true }),
  ).toBeVisible();
  await expect(
    h.terminal.getByRole("button", { name: h.c.run, exact: true }),
  ).toBeDisabled();
  expect(h.state.writes).toHaveLength(0);
});

test("following ignores historical records and does not interrupt typing", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/agents/2");
  await h.open();
  const tab = h.frame.getByRole("tab", { name: h.c.terminal, exact: true });
  await h.frame
    .getByRole("checkbox", { name: h.c.follow, exact: true })
    .check();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("draft while following");
  h.state.events = [
    {
      ...h.state.events[0],
      id: 92,
      detail: { actor: "agent", surface: "files", status: "running" },
    },
  ];
  // Keyboard-triggered refresh retains the input focus while the new record arrives.
  await h.frame
    .getByRole("button", { name: h.c.refresh, exact: true })
    .first()
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(
    h.frame.getByText("vm_command · agent · files · running", { exact: true }),
  ).toBeVisible();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  h.state.events = [{ ...h.state.events[0], id: 93 }];
  await h.frame
    .getByRole("button", { name: h.c.refresh, exact: true })
    .first()
    .click();
  await expect(
    h.frame.getByRole("tab", { name: h.c.files, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await tab.click();
  await h.frame
    .getByRole("checkbox", { name: h.c.follow, exact: true })
    .check();
  h.state.events = [
    { ...h.state.events[0], id: 92, summary: "Older historical source" },
  ];
  await h.frame
    .getByRole("button", { name: h.c.refresh, exact: true })
    .first()
    .click();
  await expect(
    h.frame.getByText("Older historical source", { exact: true }),
  ).toBeVisible();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  expect(h.state.writes).toHaveLength(0);
});

test("older computer pages preserve terminal drafts and never drive live following", async ({
  page,
}) => {
  await page.clock.install();
  const h = await setup(page);
  await page.goto("/agents/2");
  await h.open();
  const terminalTab = h.frame.getByRole("tab", {
    name: h.c.terminal,
    exact: true,
  });
  await expect(h.frame.getByText(source, { exact: true })).toBeVisible();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("keep this draft 原文");
  await h.frame
    .getByRole("checkbox", { name: h.c.follow, exact: true })
    .check();
  let latest = 100;
  await page.route("**/api/activity**", (route) => {
    const older = new URL(route.request().url()).searchParams.has("beforeId");
    return route.fulfill({
      json: [
        {
          ...h.state.events[0],
          id: older ? 95 : latest,
          summary: older ? "Older computer record" : "Latest computer record",
          detail: {
            actor: !older && latest === 100 ? "operator" : "agent",
            surface: "files",
            status: "running",
          },
        },
      ],
      headers: older ? {} : { "X-Next-Before-Id": String(latest) },
    });
  });
  await h.frame
    .locator(":scope > header")
    .getByRole("button", { name: h.c.refresh, exact: true })
    .click();
  await expect(
    h.frame.getByText("Latest computer record", { exact: true }),
  ).toBeVisible();
  await expect(terminalTab).toHaveAttribute("aria-selected", "true");
  const nav = h.frame.getByRole("navigation", { name: "Record pages" });
  await nav.getByRole("button", { name: "Older records", exact: true }).click();
  await expect(
    h.frame.getByText("Older computer record", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(16000);
  await expect(
    h.frame.getByText("Older computer record", { exact: true }),
  ).toBeVisible();
  await expect(terminalTab).toHaveAttribute("aria-selected", "true");
  await expect(
    h.terminal.getByRole("textbox", { name: h.c.command, exact: true }),
  ).toHaveValue("keep this draft 原文");
  latest = 101;
  await nav
    .getByRole("button", { name: "Latest records", exact: true })
    .click();
  await expect(
    h.frame.getByRole("tab", { name: h.c.files, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(h.state.writes).toHaveLength(0);
});

test("terminal exact server query recovers a lost reply without resending or erasing a newer draft", async ({
  page,
}) => {
  const h = await setup(page);
  h.state.fail = true;
  await page.goto("/agents/2");
  await h.open();
  const input = h.terminal.getByRole("textbox", {
    name: h.c.command,
    exact: true,
  });
  await input.fill("  echo original  ");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect(
    h.terminal.getByRole("heading", { name: h.c.unconfirmed }),
  ).toBeVisible();
  await input.fill("newer draft");
  await page.reload();
  await h.open();
  await h.terminal
    .getByRole("button", { name: "Check server record", exact: true })
    .click();
  await expect(
    h.terminal.getByRole("log").getByText(source, { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("newer draft");
  expect(h.state.reads).toBe(1);
  expect(h.state.writes).toHaveLength(1);
});

test("terminal recovery retains the submitted language after switching the interface and reloading", async ({
  page,
}) => {
  const h = await setup(page, "en");
  h.state.fail = true;
  await page.goto("/agents/2");
  await h.open();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("echo unchanged");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect(
    h.terminal.getByRole("heading", { name: h.c.unconfirmed }),
  ).toBeVisible();
  expect(h.state.writes[0].locale).toBe("en");
  const original = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!).record,
  );
  expect(original).toMatchObject({
    protocolVersion: 2,
    locale: "en",
    status: "unknown",
  });
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await page.reload();
  const profileAr = await loadExpertDetailCopy("ar");
  const copyAr = await loadComputerCopy("ar");
  const recoveryAr = await loadOperatorCopy("ar");
  await page
    .getByRole("tab", { name: profileAr.computer, exact: true })
    .click();
  const terminalAr = page.getByRole("region", {
    name: copyAr.terminal,
    exact: true,
  });
  await terminalAr
    .getByRole("button", { name: recoveryAr.check, exact: true })
    .click();
  await expect(
    terminalAr.getByRole("log").getByText(source, { exact: true }),
  ).toBeVisible();
  const recovered = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!).record,
  );
  expect(recovered).toMatchObject({
    id: original.id,
    protocolVersion: 2,
    locale: "en",
    command: original.command,
    status: "returned",
  });
  expect(h.state.writes).toHaveLength(1);
  expect(h.state.reads).toBe(1);
});

test("a late Terminal reply cannot overwrite a changed same-ID execution locale", async ({
  page,
}) => {
  const h = await setup(page, "en");
  let release!: () => void;
  h.state.hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto("/agents/2");
  await h.open();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("echo original");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect.poll(() => h.state.writes.length).toBe(1);
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!);
    saved.record.locale = "de";
    saved.record.status = "unknown";
    sessionStorage.setItem("acos.terminal.v1:2", JSON.stringify(saved));
  });
  release();
  await expect(
    h.terminal.getByRole("heading", { name: h.c.unconfirmed }),
  ).toBeVisible();
  await expect(
    h.terminal.getByRole("log").getByText(source, { exact: true }),
  ).toHaveCount(0);
  const retained = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!).record,
  );
  expect(retained).toMatchObject({ locale: "de", status: "unknown" });
  expect(retained.result).toBeUndefined();
  expect(h.state.writes).toHaveLength(1);
});

for (const locale of LOCALES)
  test(`${locale} completed request with unavailable output stays completed through review and cancellation`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: locale === "en" ? 1280 : 320,
      height: 950,
    });
    await page.emulateMedia({
      colorScheme: locale === "ar" ? "light" : "dark",
    });
    const h = await setup(page, locale);
    h.state.fail = true;
    await page.goto("/agents/2");
    await h.open();
    const input = h.terminal.getByRole("textbox", {
      name: h.c.command,
      exact: true,
    });
    await input.fill("echo already executed");
    await h.terminal
      .getByRole("button", { name: h.c.run, exact: true })
      .click();
    await expect(
      h.terminal.getByRole("heading", { name: h.c.unconfirmed }),
    ).toBeVisible();
    const id = h.state.writes[0].requestId;
    const saved = h.state.receipts.get(id)!;
    h.state.receipts.set(id, {
      ...saved,
      resultAvailability: "unavailable",
      result: null,
    });
    const check = h.terminal.getByRole("button", {
      name: h.rc.check,
      exact: true,
    });
    await check.click();
    await expect(
      h.terminal.getByText(h.rc.complete, { exact: true }),
    ).toBeVisible();
    await expect(
      h.terminal.getByText(h.rc.unavailable, { exact: true }),
    ).toBeVisible();
    await expect(
      h.terminal.getByRole("heading", { name: h.c.unconfirmed, exact: true }),
    ).toHaveCount(0);
    const review = h.terminal.getByRole("button", {
      name: h.rc.review,
      exact: true,
    });
    await review.click();
    const dialog = page.getByRole("alertdialog");
    const cancel = dialog.getByRole("button", {
      name: h.rc.cancel,
      exact: true,
    });
    await expect(cancel).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: h.rc.finish }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.evaluate(async (el) => {
      await Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    if (locale === "ar" || locale === "en")
      await page.screenshot({
        path: info.outputPath(`operator-review-${locale}.png`),
        fullPage: true,
      });
    await cancel.press("Enter");
    await expect(review).toBeFocused();
    await expect(input).toHaveValue("echo already executed");
    expect(h.state.reads).toBe(1);
    expect(h.state.writes).toHaveLength(1);
    await review.click();
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: h.rc.finish }).click();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("echo already executed");
    expect(h.state.writes).toHaveLength(1);
  });

test("version 1 Terminal recovery still reads its original receipt without adding locale or dispatching", async ({
  page,
}) => {
  const h = await setup(page, "en");
  await page.goto("/agents/2");
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const result = {
    ok: true,
    exitCode: 0,
    stdout: "Eski Türkçe kayıt · 原文",
    stderr: "",
    note: null,
    cwd: "/",
    durationMs: 4,
  };
  h.state.receipts.set(id, operatorReceipt(id, "terminal_sandbox", result));
  await page.evaluate((requestId) => {
    sessionStorage.setItem(
      "acos.terminal.v1:2",
      JSON.stringify({
        agentId: 2,
        drafts: { sandbox: "next draft", founder: "" },
        record: {
          protocolVersion: 1,
          id: requestId,
          agentId: 2,
          command: "echo original",
          mode: "sandbox",
          startedAt: "2026-09-27T10:00:00.000Z",
          status: "unknown",
        },
      }),
    );
  }, id);
  await h.open();
  await h.terminal
    .getByRole("button", { name: h.rc.check, exact: true })
    .click();
  await expect(h.terminal.getByRole("log")).toContainText(result.stdout);
  await expect(
    h.terminal.getByRole("textbox", { name: h.c.command, exact: true }),
  ).toHaveValue("next draft");
  const retained = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!).record,
  );
  expect(retained).toMatchObject({
    protocolVersion: 1,
    id,
    status: "returned",
    result,
  });
  expect(retained.locale).toBeUndefined();
  expect(h.state.reads).toBe(1);
  expect(h.state.writes).toHaveLength(0);
});

test("legacy terminal records cannot be queried and clearing a changed record is rejected", async ({
  page,
}) => {
  const h = await setup(page);
  await page.goto("/agents/2");
  const legacy = {
    agentId: 2,
    drafts: { sandbox: "draft", founder: "" },
    record: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agentId: 2,
      command: "legacy source",
      mode: "sandbox",
      startedAt: "2026-09-27T10:00:00.000Z",
      status: "unknown",
    },
  };
  await page.evaluate(
    (value) =>
      sessionStorage.setItem("acos.terminal.v1:2", JSON.stringify(value)),
    legacy,
  );
  await h.open();
  await expect(
    h.terminal.getByText(h.rc.legacy, { exact: true }),
  ).toBeVisible();
  await expect(
    h.terminal.getByRole("button", { name: h.rc.check }),
  ).toHaveCount(0);
  await h.terminal
    .getByRole("button", { name: h.rc.review, exact: true })
    .click();
  const changed = {
    ...legacy,
    record: { ...legacy.record, command: "newer same-ID source" },
  };
  await page.evaluate(
    (value) =>
      sessionStorage.setItem("acos.terminal.v1:2", JSON.stringify(value)),
    changed,
  );
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: h.rc.finish }).click();
  await expect(dialog.getByText(h.rc.changed, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!).record
          .command,
    ),
  ).toBe(changed.record.command);
  expect(h.state.writes).toHaveLength(0);
  expect(h.state.reads).toBe(0);
});

test("a late terminal reply cannot replace changed same-ID intent or import its output", async ({
  page,
}) => {
  const h = await setup(page);
  let release!: () => void;
  h.state.hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto("/agents/2");
  await h.open();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("original");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect.poll(() => h.state.writes.length).toBe(1);
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!);
    saved.record.command = "newer source";
    saved.record.status = "unknown";
    saved.drafts.sandbox = "newer draft";
    sessionStorage.setItem("acos.terminal.v1:2", JSON.stringify(saved));
  });
  release();
  await expect(
    h.terminal.getByRole("heading", { name: h.c.unconfirmed }),
  ).toBeVisible();
  await expect(
    h.terminal.getByRole("textbox", { name: h.c.command, exact: true }),
  ).toHaveValue("newer draft");
  await expect(
    h.terminal.getByRole("log").getByText(source, { exact: true }),
  ).toHaveCount(0);
  await expect(
    h.terminal.getByText(h.rc.complete, { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!).record
          .command,
    ),
  ).toBe("newer source");
});

test("missing or cross-request terminal receipts remain unconfirmed and never import output", async ({
  page,
}) => {
  const h = await setup(page);
  h.state.fail = true;
  await page.goto("/agents/2");
  await h.open();
  await h.terminal
    .getByRole("textbox", { name: h.c.command, exact: true })
    .fill("once");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect(
    h.terminal.getByRole("heading", { name: h.c.unconfirmed }),
  ).toBeVisible();
  const id = h.state.writes[0].requestId,
    saved = h.state.receipts.get(id)!;
  h.state.receipts.delete(id);
  const check = h.terminal.getByRole("button", {
    name: h.rc.check,
    exact: true,
  });
  await check.click();
  await expect(
    h.terminal.getByText(h.rc.missing, { exact: true }),
  ).toBeVisible();
  h.state.receipts.set(id, {
    ...saved,
    requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  await check.click();
  await expect(h.terminal.getByText(h.rc.error, { exact: true })).toBeVisible();
  await expect(
    h.terminal.getByRole("log").getByText(source, { exact: true }),
  ).toHaveCount(0);
  expect(h.state.writes).toHaveLength(1);
});

test("review regression: terminal local save retry cannot overwrite a newer saved command", async ({
  page,
}) => {
  const h = await setup(page);
  h.state.fail = true;
  await page.goto("/agents/2");
  await h.open();
  const input = h.terminal.getByRole("textbox", {
    name: h.c.command,
    exact: true,
  });
  await input.fill("original command");
  await h.terminal.getByRole("button", { name: h.c.run, exact: true }).click();
  await expect(
    h.terminal.getByRole("heading", { name: h.c.unconfirmed }),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).failTerminalStorage = true;
    Storage.prototype.setItem = function (key, value) {
      if (key === "acos.terminal.v1:2" && (window as any).failTerminalStorage)
        throw Error("blocked");
      return original.call(this, key, value);
    };
  });
  await input.fill("unsaved local draft");
  await expect(
    h.terminal.getByText(h.c.storageError, { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).failTerminalStorage = false;
    const newer = JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!);
    newer.record.id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    newer.record.command = "newer accepted command";
    sessionStorage.setItem("acos.terminal.v1:2", JSON.stringify(newer));
  });
  await h.terminal
    .getByRole("button", { name: h.c.storageRetry, exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("acos.terminal.v1:2")!).record
          .command,
    ),
  ).toBe("newer accepted command");
  await expect(input).toHaveValue("unsaved local draft");
  expect(h.state.writes).toHaveLength(1);
});

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: computer and terminal`, async ({
    page,
  }, info) => {
    const errors = await prepareRouteAudit(page, variant);
    const h = await setup(page, locale);
    await page.goto("/agents/2");
    await h.open();
    await expect(
      h.frame.getByRole("heading", { name: h.c.title }),
    ).toBeVisible();
    await expect(h.frame.getByText(source, { exact: true })).toBeVisible();
    await inspectRoute(page, info, "computer-terminal", variant);
    expect(h.state.writes).toEqual([]);
    expect([...h.unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
