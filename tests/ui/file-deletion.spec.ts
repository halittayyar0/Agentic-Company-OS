import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";
import { loadFileCopy } from "../../artifacts/agentic-company-os/src/lib/file-copy";
import { loadComputerCopy } from "../../artifacts/agentic-company-os/src/lib/computer-copy";
import { loadExpertDetailCopy } from "../../artifacts/agentic-company-os/src/lib/expert-detail-copy";
import {
  LOCALES,
  setupMessages,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";

const targetPath = "Original 原文 المجلد";
async function fixture(page: Page, locale: Locale = "en") {
  const harness = await installStudioFixtures(page);
  await page.addInitScript(
    (selected) => localStorage.setItem("acos.locale.v1", selected),
    locale,
  );
  const state = {
    version: "a".repeat(64),
    exists: true,
    previewError: "",
    invalidPreview: false,
    invalidReply: false,
    loseResponse: false,
    writes: [] as Record<string, string>[],
    inspections: 0,
    hold: null as Promise<void> | null,
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
        totalBytes: 14,
        fileCount: 2,
        dirCount: 1,
      },
    }),
  );
  await page.route("**/api/agents/2/vm/files-list", (route) =>
    route.fulfill({
      json: {
        path: "",
        total: state.exists ? 1 : 0,
        entries: state.exists
          ? [
              {
                path: targetPath,
                name: targetPath,
                type: "directory",
                sizeBytes: 0,
                updatedAt: "2026-09-27T08:00:00Z",
              },
            ]
          : [],
      },
    }),
  );
  await page.route("**/api/agents/2/vm/file-delete-preview", (route) => {
    state.inspections++;
    return route.fulfill({
      status: state.previewError ? 422 : !state.exists ? 404 : 200,
      json: state.previewError
        ? { code: state.previewError, error: "private-error-sentinel" }
        : !state.exists
          ? { code: "VM_DELETE_MISSING" }
          : {
              path: targetPath,
              version: state.version,
              entryCount: state.invalidPreview ? 7 : 3,
              totalBytes: 14,
              entries: [
                { path: targetPath, type: "directory", sizeBytes: 0 },
                {
                  path: `${targetPath}/source 原文.txt`,
                  type: "file",
                  sizeBytes: 12,
                },
                { path: `${targetPath}/image.bin`, type: "file", sizeBytes: 2 },
              ],
            },
    });
  });
  await page.route("**/api/agents/2/vm/file-delete", async (route) => {
    const request = route.request().postDataJSON();
    state.writes.push(request);
    if (state.hold) await state.hold;
    if (request.expectedVersion !== state.version)
      return route.fulfill({
        status: 409,
        json: { code: "VM_DELETE_CHANGED" },
      });
    state.exists = false;
    return route.fulfill({
      status: state.loseResponse ? 503 : 200,
      json: state.loseResponse
        ? { error: "private-error-sentinel" }
        : { path: targetPath, deleted: !state.invalidReply },
    });
  });
  const c = await loadFileCopy(locale);
  const computer = await loadComputerCopy(locale);
  const expert = await loadExpertDetailCopy(locale);
  async function openFiles() {
    await page.getByRole("tab", { name: expert.computer, exact: true }).click();
    await page.getByRole("tab", { name: computer.files, exact: true }).click();
  }
  async function openReview() {
    await page
      .getByRole("button", { name: `${c.remove}: ${targetPath}`, exact: true })
      .click();
  }
  await page.goto("/agents/2");
  await openFiles();
  const dialog = page.getByRole("dialog", { name: c.title, exact: true });
  async function inspect() {
    await dialog.getByRole("button", { name: c.inspect, exact: true }).click();
    await expect(
      dialog
        .getByRole("list", { name: c.scope, exact: true })
        .getByRole("listitem"),
    ).toHaveCount(3);
  }
  async function clearWarning() {
    await dialog
      .getByRole("checkbox", { name: c.clearConfirm, exact: true })
      .check();
    await dialog.getByRole("button", { name: c.clear, exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  return {
    state,
    c,
    dialog,
    openFiles,
    openReview,
    inspect,
    clearWarning,
    harness,
  };
}

for (const locale of LOCALES)
  test(`${locale} deletion requires complete scope and explicit confirmation`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: locale === "en" ? 1365 : locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.emulateMedia({
      colorScheme: locale === "ar" ? "light" : "dark",
    });
    const h = await fixture(page, locale);
    const trigger = page.getByRole("button", {
      name: `${h.c.remove}: ${targetPath}`,
      exact: true,
    });
    const bounds = await trigger.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    await h.openReview();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await h.openReview();
    const submit = h.dialog.getByRole("button", {
      name: h.c.submit,
      exact: true,
    });
    await expect(submit).toBeDisabled();
    expect(h.state.writes).toHaveLength(0);
    await h.inspect();
    await expect(h.dialog).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );
    await expect(
      h.dialog.getByText(`${targetPath}/source 原文.txt`, { exact: true }),
    ).toBeVisible();
    await expect(submit).toBeDisabled();
    await h.dialog
      .getByRole("checkbox", { name: h.c.confirm, exact: true })
      .focus();
    await page.keyboard.press("Space");
    await expect(submit).toBeEnabled();
    expect(
      await h.dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (locale === "ar" || locale === "en") {
      await page.screenshot({ path: info.outputPath(`delete-${locale}.png`) });
      await h.dialog.evaluate((element) => {
        element.scrollTop = 0;
      });
      await h.dialog.screenshot({
        path: info.outputPath(`delete-${locale}-top.png`),
      });
      await h.dialog
        .getByRole("button", { name: h.c.cancel, exact: true })
        .scrollIntoViewIfNeeded();
      await h.dialog.screenshot({
        path: info.outputPath(`delete-${locale}-actions.png`),
      });
    }
    await submit.click();
    await expect(h.dialog).not.toBeVisible();
    await expect(page.getByText(h.c.success, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: h.c.refreshFiles, exact: true }),
    ).toBeFocused();
    expect(h.state.writes).toEqual([
      { path: targetPath, expectedVersion: "a".repeat(64) },
    ]);
    expect([...h.harness.unexpected]).toEqual([]);
  });

test("changed scope needs fresh inspection after an explicit local recovery review", async ({
  page,
}) => {
  const h = await fixture(page);
  await h.openReview();
  await h.inspect();
  h.state.version = "b".repeat(64);
  await h.dialog.getByRole("checkbox", { name: h.c.confirm }).check();
  await h.dialog.getByRole("button", { name: h.c.submit, exact: true }).click();
  await expect(
    h.dialog.getByText(h.c.unknownHelp, { exact: true }),
  ).toBeVisible();
  expect(h.state.exists).toBe(true);
  await h.inspect();
  expect(h.state.writes).toHaveLength(1);
  await h.clearWarning();
  await h.openReview();
  await expect(
    h.dialog.getByRole("button", { name: h.c.submit, exact: true }),
  ).toBeDisabled();
  await h.inspect();
  await h.dialog.getByRole("checkbox", { name: h.c.confirm }).check();
  await h.dialog.getByRole("button", { name: h.c.submit, exact: true }).click();
  await expect(page.getByText(h.c.success, { exact: true })).toBeVisible();
  expect(h.state.writes[1].expectedVersion).toBe("b".repeat(64));
});

for (const malformed of [false, true])
  test(`${malformed ? "malformed" : "lost"} deletion response survives reload without resend and can inspect a missing target`, async ({
    page,
  }) => {
    const h = await fixture(page);
    h.state.loseResponse = !malformed;
    h.state.invalidReply = malformed;
    await h.openReview();
    await h.inspect();
    await h.dialog.getByRole("checkbox", { name: h.c.confirm }).check();
    await h.dialog
      .getByRole("button", { name: h.c.submit, exact: true })
      .click();
    await expect(
      h.dialog.getByText(h.c.unknownHelp, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await h.openFiles();
    await page.getByRole("button", { name: h.c.recover, exact: true }).click();
    await h.dialog
      .getByRole("button", { name: h.c.inspect, exact: true })
      .click();
    await expect(
      h.dialog.getByText(h.c.missing, { exact: true }),
    ).toBeVisible();
    expect(h.state.writes).toHaveLength(1);
    await h.clearWarning();
    await page.reload();
    await h.openFiles();
    await expect(
      page.getByRole("button", { name: h.c.recover, exact: true }),
    ).toHaveCount(0);
    expect(h.state.writes).toHaveLength(1);
    expect(await page.locator("body").textContent()).not.toContain(
      "private-error-sentinel",
    );
  });

test("unreviewable or inconsistent deletion scopes never enable confirmation", async ({
  page,
}) => {
  const h = await fixture(page);
  h.state.previewError = "VM_DELETE_NOT_REVIEWABLE";
  await h.openReview();
  await h.dialog
    .getByRole("button", { name: h.c.inspect, exact: true })
    .click();
  await expect(h.dialog.getByText(h.c.limited, { exact: true })).toBeVisible();
  await expect(
    h.dialog.getByRole("button", { name: h.c.submit, exact: true }),
  ).toBeDisabled();
  h.state.previewError = "";
  h.state.invalidPreview = true;
  await h.dialog
    .getByRole("button", { name: h.c.inspect, exact: true })
    .click();
  await expect(h.dialog.getByText(h.c.error, { exact: true })).toBeVisible();
  await expect(
    h.dialog.getByRole("checkbox", { name: h.c.confirm }),
  ).toHaveCount(0);
  expect(h.state.writes).toHaveLength(0);
});

test("blocked local storage prevents deletion; damaged recovery requires explicit clearing", async ({
  page,
}) => {
  const h = await fixture(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.file-deletion")) throw Error("quota");
      original.call(this, key, value);
    };
  });
  await h.openReview();
  await h.inspect();
  await h.dialog.getByRole("checkbox", { name: h.c.confirm }).check();
  await h.dialog.getByRole("button", { name: h.c.submit, exact: true }).click();
  await expect(
    h.dialog.getByText(h.c.storageError, { exact: true }),
  ).toBeVisible();
  expect(h.state.writes).toHaveLength(0);
  await page.reload();
  await page.evaluate(() =>
    sessionStorage.setItem("acos.file-deletion.v1:2", "{"),
  );
  await h.openFiles();
  await page.getByRole("button", { name: h.c.recover, exact: true }).click();
  await expect(h.dialog.getByText(h.c.damaged, { exact: true })).toBeVisible();
  await expect(
    h.dialog.getByRole("button", { name: h.c.clear, exact: true }),
  ).toBeDisabled();
  await h.clearWarning();
  expect(h.state.writes).toHaveLength(0);
});

test("missing selected file language pack keeps destructive actions unavailable", async ({
  page,
}) => {
  await page.route("**/assets/files-de-*.js", (route) => route.abort());
  const h = await fixture(page, "de");
  await expect(
    page.getByText(setupMessages.de.languageFileError, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `${h.c.remove}: ${targetPath}`,
      exact: true,
    }),
  ).toHaveCount(0);
  expect(h.state.writes).toHaveLength(0);
});
