import {
  inspectRoute,
  inspectReadableLabel,
  prepareRouteAudit,
  routeAuditMatrix,
} from "./helpers/route-audit";
import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import { loadFileCopy } from "../../artifacts/agentic-company-os/src/lib/file-copy";
import { loadComputerCopy } from "../../artifacts/agentic-company-os/src/lib/computer-copy";
import { loadExpertDetailCopy } from "../../artifacts/agentic-company-os/src/lib/expert-detail-copy";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const original = "\ufeffOriginal 原文\r\nمتن\nMixed\rEnd";

async function fixture(page: Page, locale: Locale = "en") {
  const harness = await installStudioFixtures(page);
  await page.addInitScript(
    (selected) => localStorage.setItem("acos.locale.v1", selected),
    locale,
  );
  const c = await loadFileCopy(locale);
  const computer = await loadComputerCopy(locale);
  const expert = await loadExpertDetailCopy(locale);
  const state = {
    files: new Map([
      ["source.txt", original],
      ["other.txt", "Other"],
    ]),
    writes: [] as { path: string; content: string; expectedVersion: string }[],
    hold: null as Promise<void> | null,
    lost: false,
    listError: false,
    partial: false,
    readError: false,
  };
  await page.route("**/api/agents/2", (route) =>
    route.fulfill({
      json: {
        ...studioAgents[1],
        permissions: { ...studioAgents[1].permissions, canBrowse: false },
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
        totalBytes: 400,
        fileCount: 2,
        dirCount: 0,
      },
    }),
  );
  await page.route("**/api/agents/2/vm/files-list", (route) =>
    route.fulfill({
      status: state.listError ? 503 : 200,
      json: {
        path: "",
        total: state.files.size,
        truncated: state.partial,
        skipped: 0,
        entries: [...state.files].map(([path, content]) => ({
          path,
          name: path,
          type: "file",
          sizeBytes: Buffer.byteLength(content),
          updatedAt: "2026-09-27T08:00:00Z",
        })),
      },
    }),
  );
  await page.route("**/api/agents/2/vm/file-read", (route) => {
    const { path } = route.request().postDataJSON();
    const content = state.files.get(path);
    return route.fulfill({
      status: state.readError ? 503 : content === undefined ? 404 : 200,
      json: state.readError
        ? { error: "private-sentinel" }
        : content === undefined
          ? { code: "VM_FILE_MISSING" }
          : {
              path,
              content,
              sizeBytes: Buffer.byteLength(content),
              version: hash(content),
              editable: true,
              truncated: false,
            },
    });
  });
  await page.route("**/api/agents/2/vm/file-write", async (route) => {
    const request = route.request().postDataJSON();
    state.writes.push(request);
    if (state.hold) await state.hold;
    const current = state.files.get(request.path);
    if (
      request.expectedVersion !==
      (current === undefined ? "missing" : hash(current))
    )
      return route.fulfill({ status: 409, json: { code: "VM_FILE_CHANGED" } });
    state.files.set(request.path, request.content);
    return route.fulfill({
      status: state.lost ? 503 : 200,
      json: state.lost
        ? { error: "private-sentinel" }
        : {
            path: request.path,
            sizeBytes: Buffer.byteLength(request.content),
            version: hash(request.content),
          },
    });
  });
  async function openFiles() {
    await page.getByRole("tab", { name: expert.computer, exact: true }).click();
    await page.getByRole("tab", { name: computer.files, exact: true }).click();
  }
  async function openFile(path = "source.txt", draft = false) {
    await page
      .getByRole("button", {
        name: `${draft ? c.resumeDraft : c.openFile}: ${path}`,
        exact: true,
      })
      .click();
    return page.getByRole("textbox", {
      name: c.contentLabel.replace("{name}", path),
      exact: true,
    });
  }
  async function close() {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: c.close, exact: true })
      .first()
      .click();
  }
  await page.goto("/agents/2");
  await openFiles();
  return { c, state, harness, openFiles, openFile, close, computer, expert };
}

for (const locale of LOCALES)
  test(`${locale} files support keyboard validation, exact text and phone layout`, async ({
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
    await expect(
      page.getByRole("heading", { name: h.c.filesTitle }),
    ).toBeVisible();
    await page.getByRole("button", { name: h.c.newFile, exact: true }).click();
    const createDialog = page.getByRole("dialog", {
      name: h.c.newFile,
      exact: true,
    });
    const path = createDialog.getByRole("textbox", { name: h.c.pathLabel });
    await expect(createDialog.locator("form")).toHaveAttribute(
      "novalidate",
      "",
    );
    await path.fill("../escape.txt");
    await createDialog
      .getByRole("button", { name: h.c.create, exact: true })
      .click();
    await expect(path).toBeFocused();
    await expect(
      createDialog.getByText(h.c.pathInvalid, { exact: true }),
    ).toBeVisible();
    await path.fill("新規.txt");
    await page.keyboard.press("Enter");
    await expect(
      createDialog.getByText(h.c.fileCreated, { exact: true }),
    ).toBeVisible();
    expect(h.state.writes[0]).toEqual({
      path: "新規.txt",
      content: "",
      expectedVersion: "missing",
    });
    await h.close();
    await expect(
      page.getByRole("button", { name: h.c.newFile, exact: true }),
    ).toBeFocused();
    const editor = await h.openFile();
    await expect(editor).toHaveValue(original.replace(/\r\n?/g, "\n"));
    await editor.fill(
      original.replace(/\r\n?/g, "\n").replace("Original", "Changed"),
    );
    const dialog = page.getByRole("dialog", {
      name: "source.txt",
      exact: true,
    });
    expect(await editor.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      "16px",
    );
    await expect(editor).toHaveAttribute("dir", "auto");
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const save = dialog.getByRole("button", { name: h.c.save, exact: true });
    await expect
      .poll(async () => (await save.boundingBox())!.height)
      .toBeGreaterThanOrEqual(44);
    if (locale === "en" || locale === "ar")
      await page.screenshot({ path: info.outputPath(`files-${locale}.png`) });
    await save.click();
    await expect(dialog.getByText(h.c.saved, { exact: true })).toBeVisible();
    expect(h.state.writes[1]).toEqual({
      path: "source.txt",
      content: original.replace("Original", "Changed"),
      expectedVersion: hash(original),
    });
    await h.close();
    await expect(
      page.getByRole("button", {
        name: `${h.c.openFile}: source.txt`,
        exact: true,
      }),
    ).toBeFocused();
    expect([...h.harness.unexpected]).toEqual([]);
  });

test("multiple drafts survive tab navigation and reload, and require fresh review", async ({
  page,
}) => {
  const h = await fixture(page);
  let editor = await h.openFile();
  await editor.fill("First draft");
  await h.close();
  editor = await h.openFile("other.txt");
  await editor.fill("Second draft");
  await h.close();
  await page
    .getByRole("tab", { name: h.computer.terminal, exact: true })
    .click();
  await h.openFiles();
  await expect(
    page.getByRole("region", { name: h.c.draftsTitle }).getByRole("listitem"),
  ).toHaveCount(2);
  await page.reload();
  await h.openFiles();
  editor = await h.openFile("source.txt", true);
  await expect(editor).toHaveValue("First draft");
  await expect(
    page.getByRole("button", { name: h.c.save, exact: true }),
  ).toBeDisabled();
  h.state.files.set("source.txt", "Changed elsewhere");
  await page.getByRole("button", { name: h.c.compare, exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: h.c.comparisonLabel }),
  ).toHaveValue("Changed elsewhere");
  await page
    .getByRole("checkbox", { name: h.c.reviewCheck, exact: true })
    .check();
  await page.getByRole("button", { name: h.c.reviewDone, exact: true }).click();
  expect(h.state.writes).toHaveLength(0);
  await page.getByRole("button", { name: h.c.save, exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText(h.c.saved, { exact: true }),
  ).toBeVisible();
  expect(h.state.writes[0].expectedVersion).toBe(hash("Changed elsewhere"));
  await h.close();
  editor = await h.openFile("other.txt", true);
  await expect(editor).toHaveValue("Second draft");
});

test("late edit and create receipts retain newer typing across route remounts", async ({
  page,
}) => {
  const h = await fixture(page);
  let release!: () => void;
  h.state.hold = new Promise((resolve) => {
    release = resolve;
  });
  let editor = await h.openFile();
  await editor.fill("Submitted");
  await page.getByRole("button", { name: h.c.save, exact: true }).click();
  await expect.poll(() => h.state.writes.length).toBe(1);
  await editor.fill("Typed after sending");
  await h.close();
  await page.evaluate(() => {
    history.pushState({}, "", "/agents");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("region", { name: h.c.filesTitle }),
  ).not.toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/agents/2");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await h.openFiles();
  editor = await h.openFile("source.txt", true);
  await expect(editor).toHaveValue("Typed after sending");
  release();
  await expect(
    page.getByRole("button", { name: h.c.save, exact: true }),
  ).toBeEnabled();
  await expect(editor).toHaveValue("Typed after sending");
  await page.getByRole("button", { name: h.c.save, exact: true }).click();
  await expect.poll(() => h.state.writes.length).toBe(2);
  expect(h.state.writes[1].expectedVersion).toBe(hash("Submitted"));
  await expect(
    page.getByRole("button", { name: h.c.save, exact: true }),
  ).toBeDisabled();
  await h.close();
  h.state.hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: h.c.newFile, exact: true }).click();
  const path = page.getByRole("textbox", { name: h.c.pathLabel });
  await path.fill("first.txt");
  await page.getByRole("button", { name: h.c.create, exact: true }).click();
  await expect.poll(() => h.state.writes.length).toBe(3);
  await path.fill("next.txt");
  release();
  await expect(
    page.getByRole("dialog").getByText(h.c.fileCreated, { exact: true }),
  ).toBeVisible();
  await expect(path).toHaveValue("next.txt");
});

test("unknown creation survives reload without resending and missing-file review only clears locally", async ({
  page,
}) => {
  const h = await fixture(page);
  h.state.lost = true;
  await page.getByRole("button", { name: h.c.newFile, exact: true }).click();
  await page
    .getByRole("textbox", { name: h.c.pathLabel })
    .fill("uncertain.txt");
  await page.getByRole("button", { name: h.c.create, exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText(h.c.writeUnknownHelp, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await h.openFiles();
  h.state.files.delete("uncertain.txt");
  await page
    .getByRole("button", { name: h.c.reviewRequest, exact: true })
    .click();
  const region = page.getByRole("region", { name: h.c.reviewTitle });
  await region.getByRole("button", { name: h.c.compare, exact: true }).click();
  await expect(
    region.getByText(h.c.missingFile, { exact: true }),
  ).toBeVisible();
  await region
    .getByRole("checkbox", { name: h.c.clearConfirm, exact: true })
    .check();
  await region.getByRole("button", { name: h.c.clear, exact: true }).click();
  await expect(region).not.toBeVisible();
  expect(h.state.writes).toHaveLength(1);
  await expect(page.getByText("private-sentinel")).toHaveCount(0);
});

test("failed tab storage retains drafts in memory across SPA routes and blocks writes", async ({
  page,
}) => {
  const h = await fixture(page);
  await page.evaluate(() => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.file-editor.")) throw new Error("quota");
      return originalSet.call(this, key, value);
    };
  });
  let editor = await h.openFile();
  await editor.fill("Keep despite quota");
  await expect(
    page.getByRole("dialog").getByText(h.c.fileStorageError, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: h.c.save, exact: true }),
  ).toBeDisabled();
  await h.close();
  // pushState + popstate triggers the router without reloading the JS runtime.
  await page.evaluate(() => {
    history.pushState({}, "", "/agents");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("region", { name: h.c.filesTitle }),
  ).not.toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/agents/2");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await h.openFiles();
  editor = await h.openFile("source.txt", true);
  await expect(editor).toHaveValue("Keep despite quota");
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  expect(h.state.writes).toHaveLength(0);
});

test("partial and stale listings keep their uncertainty visible", async ({
  page,
}) => {
  const h = await fixture(page);
  h.state.partial = true;
  await page.getByRole("button", { name: h.c.refreshFiles }).click();
  await expect(page.getByText(h.c.partialList, { exact: true })).toBeVisible();
  h.state.listError = true;
  await page.getByRole("button", { name: h.c.refreshFiles }).click();
  await expect(page.getByText(h.c.listStale, { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", {
      name: `${h.c.openFile}: source.txt`,
      exact: true,
    }),
  ).toBeVisible();
  h.state.listError = false;
  h.state.files.clear();
  await page.getByRole("button", { name: h.c.refreshFiles }).click();
  await expect(
    page.getByRole("button", {
      name: `${h.c.openFile}: source.txt`,
      exact: true,
    }),
  ).not.toBeVisible();
  await expect(page.getByText(h.c.emptyList, { exact: true })).toHaveCount(0);
  h.state.partial = false;
  await page.getByRole("button", { name: h.c.refreshFiles }).click();
  await expect(page.getByText(h.c.emptyList, { exact: true })).toBeVisible();
});

test("oversized UTF-8 draft stays intact and invalid submission focuses its inline error", async ({
  page,
}) => {
  const h = await fixture(page);
  const editor = await h.openFile();
  const large = "原".repeat(50000);
  await editor.fill(large);
  await page.getByRole("button", { name: h.c.save, exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("dialog").getByText(h.c.contentInvalid, { exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue(large);
  expect(h.state.writes).toHaveLength(0);
  await h.close();
  await page.reload();
  await h.openFiles();
  await expect(await h.openFile("source.txt", true)).toHaveValue(large);
});

test("corrupt saved state requires explicit clearing and never sends a hidden write", async ({
  page,
}) => {
  const h = await fixture(page);
  await page.evaluate(() =>
    sessionStorage.setItem("acos.file-editor.v1:2", "{broken"),
  );
  await page.reload();
  await h.openFiles();
  await expect(page.getByText(h.c.fileDamaged, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: h.c.fileReset, exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: h.c.fileResetCheck, exact: true })
    .check();
  await page.getByRole("button", { name: h.c.fileReset, exact: true }).click();
  await expect(
    page.getByText(h.c.fileDamaged, { exact: true }),
  ).not.toBeVisible();
  expect(h.state.writes).toHaveLength(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("acos.file-editor.v1:2")!),
    ),
  ).toEqual({ agentId: 2, drafts: [], newPath: "", request: null });
});

for (const variant of routeAuditMatrix) {
  const { locale, theme, screen } = variant;
  test(`workspace audit ${locale} ${theme} ${screen}${variant.largeText ? " large text" : ""}: file list and editor`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const errors = await prepareRouteAudit(page, variant);
    const h = await fixture(page, locale);
    await expect(
      page.getByRole("heading", { name: h.c.filesTitle }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `${h.c.openFile}: source.txt`,
        exact: true,
      }),
    ).toBeVisible();
    await inspectRoute(page, info, "file-list", variant);
    if (variant.largeText)
      await inspectReadableLabel(
        page.getByRole("button", { name: h.c.root, exact: true }),
        h.c.root.split(/\s+/u).sort((a, b) => b.length - a.length)[0],
        2,
      );
    const input = await h.openFile();
    await expect(input).toBeVisible();
    await inspectRoute(
      page,
      info,
      "file-editor",
      variant,
      page.getByRole("dialog"),
    );
    expect(h.state.writes).toEqual([]);
    expect([...h.harness.unexpected]).toEqual([]);
    expect(errors).toEqual([]);
  });
}
