import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { getCapabilityCatalog } from "../../artifacts/api-server/src/lib/capabilities/catalog";
import type { Page } from "@playwright/test";
import { loadExtensionEditorCopy } from "../../artifacts/agentic-company-os/src/lib/extension-editor-copy";
import { loadNewProjectCopy } from "../../artifacts/agentic-company-os/src/lib/new-project-copy";
import { loadReusableWorkCopy } from "../../artifacts/agentic-company-os/src/lib/reusable-work-copy";
import {
  LOCALES,
  type Locale,
} from "../../artifacts/agentic-company-os/src/lib/i18n";

type Row = {
  id: string;
  revision: number;
  enabled: boolean;
  manifest: Record<string, unknown>;
};
async function savedProjectFixture(
  page: Page,
  locale: Locale = "en",
  patch: Record<string, unknown> = {},
) {
  await page.addInitScript(
    (value) => localStorage.setItem("acos.locale.v1", value),
    locale,
  );
  const fixture = await installStudioFixtures(page);
  await page.route("**/api/skills?*", (route) =>
    route.fulfill({ json: getCapabilityCatalog(locale) }),
  );
  const rows: Row[] = [],
    writes: unknown[] = [];
  await page.route("**/api/skills/extensions", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: rows });
    const body = route.request().postDataJSON();
    writes.push(body);
    const old = rows.find((row) => row.id === body.manifest.id);
    if (body.expectedRevision !== (old?.revision ?? 0))
      return route.fulfill({
        status: 409,
        json: { code: "CAPABILITY_REVISION_CONFLICT" },
      });
    const row = {
      id: body.manifest.id,
      manifest: body.manifest,
      revision: body.expectedRevision + 1,
      enabled: body.enabled,
    };
    if (old) Object.assign(old, row);
    else rows.push(row);
    return route.fulfill({ json: row });
  });
  const project = {
    id: 101,
    title: "  Saved source brief — 分析  ",
    brief: " First source line\n\n第二行 😀  ",
    status: "completed",
    priority: "normal",
    ownerAgentId: 1,
    assignedByAgentId: null,
    createdByUser: true,
    parentTaskId: null,
    progressPercent: 100,
    tokensUsed: 12640,
    estimatedCostUsd: "0.31",
    resultSummary: "Old delivery must not become new instructions",
    executionModelId: "old-provider/model",
    lastModelId: "old-provider/model",
    lastModelProvider: "old-provider",
    modelFallbackCount: 0,
    autonomyMode: "continuous",
    cadenceSeconds: 3600,
    lastHeartbeatAt: null,
    recoveryCount: 0,
    cycleCount: 1,
    lastCycleCompletedAt: null,
    lastSteppedAt: null,
    stepAttempts: 2,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    lastError: null,
    blockedReason: null,
    dueAt: null,
    createdAt: "2026-10-09T05:00:00.000Z",
    updatedAt: "2026-10-09T06:00:00.000Z",
    completedAt: "2026-10-09T06:00:00.000Z",
    ...patch,
  };
  await page.route("**/api/tasks/101", (route) =>
    route.fulfill({ json: project }),
  );
  await page.route(
    /\/api\/tasks\/101\/(subtasks|activity|members)(?:\?|$)/u,
    (route) => route.fulfill({ json: [] }),
  );
  await page.goto("/projects/101");
  await expect(
    page.getByRole("heading", { name: project.title.trim(), exact: true }),
  ).toBeVisible();
  return { fixture, project, rows, writes };
}

test("a saved root project prepares only its exact brief for fresh work without starting a task", async ({
  page,
}) => {
  const f = await savedProjectFixture(page);
  const copy = await loadNewProjectCopy("en");
  const reuse = page.getByRole("button", {
    name: "Use brief again",
    exact: true,
  });
  await expect(reuse).toBeVisible();
  await reuse.click();
  await expect(page).toHaveURL(/\/projects\/new$/u);
  await expect(
    page.getByRole("textbox", { name: copy.projectName, exact: true }),
  ).toHaveValue(f.project.title);
  await expect(
    page.getByRole("textbox", { name: copy.brief, exact: true }),
  ).toHaveValue(f.project.brief);
  expect(f.fixture.requests).toHaveLength(0);
});

test("a saved root brief becomes a reviewed disabled personal guide and prepares fresh text only", async ({
  page,
}) => {
  const f = await savedProjectFixture(page),
    c = (
      await import("../../artifacts/agentic-company-os/src/lib/customization-copy/customization-en")
    ).default,
    reuse = await loadReusableWorkCopy("en"),
    editor = await loadExtensionEditorCopy("en"),
    fresh = await loadNewProjectCopy("en");
  const prepare = page.getByRole("button", {
    name: reuse.prepareGuide,
    exact: true,
  });
  await expect(prepare).toBeVisible();
  await prepare.click();
  await expect(page).toHaveURL(/\/skills$/u);
  const panel = page.getByRole("region", { name: c.extensions[0] });
  await expect(panel.getByLabel(c.extensions[8], { exact: true })).toHaveValue(
    f.project.brief,
  );
  await expect(
    panel.getByRole("checkbox", { name: editor.availability, exact: true }),
  ).not.toBeChecked();
  expect(f.writes).toHaveLength(0);
  expect(f.fixture.requests).toHaveLength(0);
  const draft = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("acos.extension-editor.v1")!),
  );
  expect(draft.manifest.id).toMatch(/^user-[a-f0-9-]+$/u);
  await panel
    .getByRole("button", { name: c.extensions[11], exact: true })
    .click();
  await expect.poll(() => f.rows.length).toBe(1);
  expect(f.rows[0].id).toBe(draft.manifest.id);
  expect(f.rows[0].enabled).toBe(false);
  expect(f.writes).toHaveLength(1);
  await panel
    .getByRole("button", { name: reuse.prepareProject, exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/new$/u);
  await expect(
    page.getByRole("textbox", { name: fresh.brief, exact: true }),
  ).toHaveValue(f.project.brief);
  await expect(
    page.getByText(reuse.runtimeHelp, { exact: true }),
  ).toBeVisible();
  expect(f.rows[0].enabled).toBe(false);
  expect(f.writes).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

for (const use of [false, true])
  test(`an incoming prepared guide ${use ? "replaces" : "keeps"} an earlier editor only after a retained choice`, async ({
    page,
  }) => {
    const old = await editorFixture(page),
      f = await savedProjectFixture(page),
      c = await loadReusableWorkCopy("en");
    await page
      .getByRole("button", { name: c.prepareGuide, exact: true })
      .click();
    await expect(
      old.region.getByText(old.recovery.incomingHelp, { exact: true }),
    ).toBeVisible();
    await expect(
      old.region.getByLabel(old.copy.extensions[3], { exact: true }),
    ).toHaveValue("Recoverable guide");
    const seed = await page.evaluate(() => history.state.acosGuideDraft);
    await page.reload();
    expect(
      await page.evaluate(() => history.state.acosGuideDraft.manifest.id),
    ).toBe(seed.manifest.id);
    await old.region
      .getByRole("button", {
        name: use ? old.recovery.use : old.recovery.keep,
        exact: true,
      })
      .click();
    await expect(
      old.region.getByLabel(old.copy.extensions[3], { exact: true }),
    ).toHaveValue(use ? f.project.title : "Recoverable guide");
    expect(
      await page.evaluate(() => history.state.acosGuideDraft),
    ).toBeUndefined();
    await page.reload();
    await expect(
      old.region.getByLabel(old.copy.extensions[3], { exact: true }),
    ).toHaveValue(use ? f.project.title : "Recoverable guide");
    expect(f.writes).toHaveLength(0);
    expect(f.fixture.requests).toHaveLength(0);
  });

test("review correction: cancelling the old editor still permits explicit Use of the retained incoming guide", async ({
  page,
}) => {
  const old = await editorFixture(page),
    f = await savedProjectFixture(page),
    c = await loadReusableWorkCopy("en");
  await page.getByRole("button", { name: c.prepareGuide, exact: true }).click();
  await expect(
    old.region.getByText(old.recovery.incomingHelp, { exact: true }),
  ).toBeVisible();
  const seed = await page.evaluate(() => history.state.acosGuideDraft);
  await old.region
    .getByRole("button", { name: old.copy.extensions[12], exact: true })
    .click();
  await old.region
    .getByRole("button", { name: old.recovery.use, exact: true })
    .click();
  await expect(
    old.region.getByLabel(old.copy.extensions[2], { exact: true }),
  ).toHaveValue(seed.manifest.id);
  await expect(
    old.region.getByLabel(old.copy.extensions[8], { exact: true }),
  ).toHaveValue(f.project.brief);
  expect(
    await page.evaluate(() => history.state.acosGuideDraft),
  ).toBeUndefined();
  await page.reload();
  await expect(
    old.region.getByLabel(old.copy.extensions[2], { exact: true }),
  ).toHaveValue(seed.manifest.id);
  expect(f.writes).toHaveLength(0);
  expect(f.fixture.requests).toHaveLength(0);
});

test("review correction: a confirmed rejected save permits explicit Continue after reload while preserving later text and ID", async ({
  page,
}) => {
  const f = await editorFixture(page),
    writes: unknown[] = [];
  await page.route("**/api/skills/extensions", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    writes.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { code: "CAPABILITY_INVALID" } });
  });
  const id = await f.region
    .getByLabel(f.copy.extensions[2], { exact: true })
    .inputValue();
  await f.region
    .getByRole("button", { name: f.copy.extensions[11], exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  await f.region
    .getByLabel(f.copy.extensions[3], { exact: true })
    .fill("Later editable title");
  await page.reload();
  await f.region
    .getByRole("button", { name: f.recovery.continue, exact: true })
    .click();
  await expect(
    f.region.getByLabel(f.copy.extensions[2], { exact: true }),
  ).toHaveValue(id);
  await expect(
    f.region.getByLabel(f.copy.extensions[3], { exact: true }),
  ).toHaveValue("Later editable title");
  await expect(
    f.region.getByRole("button", { name: f.copy.extensions[11], exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.extension-save.v1")),
  ).toBeNull();
  expect(writes).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

for (const locale of LOCALES)
  test(`${locale} rejected save recovery preserves phone text and performs no automatic retry`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    const f = await editorFixture(page, locale),
      writes: unknown[] = [];
    await page.route("**/api/skills/extensions", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: [] });
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        status: 400,
        json: { code: "CAPABILITY_INVALID" },
      });
    });
    const id = await f.region
      .getByLabel(f.copy.extensions[2], { exact: true })
      .inputValue();
    await f.region
      .getByRole("button", { name: f.copy.extensions[11], exact: true })
      .click();
    await expect(f.region.getByRole("status")).toContainText(
      f.recovery.rejected,
    );
    await f.region
      .getByRole("button", { name: f.recovery.check, exact: true })
      .click();
    await expect(f.region.getByRole("status")).toContainText(
      f.recovery.rejected,
    );
    await expect(
      f.region.getByRole("button", { name: f.recovery.retry, exact: true }),
    ).toHaveCount(0);
    const proceed = f.region.getByRole("button", {
      name: f.recovery.continue,
      exact: true,
    });
    expect((await proceed.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await proceed.click();
    await expect(
      f.region.getByLabel(f.copy.extensions[2], { exact: true }),
    ).toHaveValue(id);
    await expect(
      f.region.getByLabel(f.copy.extensions[8], { exact: true }),
    ).toHaveValue(" First line\n第二行 😀  ");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(writes).toHaveLength(1);
    expect(f.fixture.requests).toHaveLength(0);
  });

for (const fault of ["retain-rejection", "clear-pending", "retain-editor"])
  test(`${fault} refusal preserves rejected save and later text for explicit recovery`, async ({
    page,
  }) => {
    const f = await editorFixture(page),
      writes: unknown[] = [];
    await page.route("**/api/skills/extensions", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: [] });
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        status: 400,
        json: { code: "CAPABILITY_INVALID" },
      });
    });
    await page.evaluate(
      (value) => {
        const set = Storage.prototype.setItem,
          remove = Storage.prototype.removeItem;
        Storage.prototype.setItem = function (key, text) {
          if (
            (value === "retain-rejection" &&
              key === "acos.extension-save.v1" &&
              JSON.parse(text).rejected) ||
            (value === "retain-editor" && key === "acos.extension-editor.v1")
          )
            return;
          set.call(this, key, text);
        };
        Storage.prototype.removeItem = function (key) {
          if (value === "clear-pending" && key === "acos.extension-save.v1")
            return;
          remove.call(this, key);
        };
      },
      fault === "retain-editor" ? "later" : fault,
    );
    await f.region
      .getByRole("button", { name: f.copy.extensions[11], exact: true })
      .click();
    await expect(f.region.getByRole("status")).toContainText(
      f.recovery.rejected,
    );
    if (fault === "retain-editor")
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key !== "acos.extension-editor.v1") set.call(this, key, value);
        };
      });
    await f.region
      .getByLabel(f.copy.extensions[3], { exact: true })
      .fill("Later retained text");
    await f.region
      .getByRole("button", { name: f.recovery.check, exact: true })
      .click();
    await expect(f.region.getByRole("status")).toContainText(
      f.recovery.rejected,
    );
    await f.region
      .getByRole("button", { name: f.recovery.continue, exact: true })
      .click();
    await expect(
      f.region.getByLabel(f.copy.extensions[3], { exact: true }),
    ).toHaveValue("Later retained text");
    if (fault !== "retain-rejection") {
      await expect(
        f.region.getByRole("button", {
          name: f.copy.extensions[11],
          exact: true,
        }),
      ).toBeDisabled();
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem("acos.extension-save.v1"),
        ),
      ).not.toBeNull();
    }
    expect(writes).toHaveLength(1);
  });

test("cancelling the editor permits explicit Keep without retaining a stranded incoming guide", async ({
  page,
}) => {
  const old = await editorFixture(page),
    f = await savedProjectFixture(page),
    copy = await loadReusableWorkCopy("en");
  await page
    .getByRole("button", { name: copy.prepareGuide, exact: true })
    .click();
  await expect(
    old.region.getByText(old.recovery.incomingHelp, { exact: true }),
  ).toBeVisible();
  await old.region
    .getByRole("button", { name: old.copy.extensions[12], exact: true })
    .click();
  await old.region
    .getByRole("button", { name: old.recovery.keep, exact: true })
    .click();
  expect(
    await page.evaluate(() => history.state.acosGuideDraft),
  ).toBeUndefined();
  await expect(
    old.region.getByRole("button", {
      name: old.copy.extensions[1],
      exact: true,
    }),
  ).toBeEnabled();
  expect(f.writes).toHaveLength(0);
  expect(f.fixture.requests).toHaveLength(0);
});

test("after Cancel, refused Use persistence retains the incoming identity until a later explicit choice", async ({
  page,
}) => {
  const old = await editorFixture(page),
    f = await savedProjectFixture(page),
    copy = await loadReusableWorkCopy("en");
  await page
    .getByRole("button", { name: copy.prepareGuide, exact: true })
    .click();
  await expect(
    old.region.getByText(old.recovery.incomingHelp, { exact: true }),
  ).toBeVisible();
  const seed = await page.evaluate(() => history.state.acosGuideDraft);
  await old.region
    .getByRole("button", { name: old.copy.extensions[12], exact: true })
    .click();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    (
      window as unknown as { restoreGuideStorage: () => void }
    ).restoreGuideStorage = () => {
      Storage.prototype.setItem = set;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key !== "acos.extension-editor.v1") set.call(this, key, value);
    };
  });
  await old.region
    .getByRole("button", { name: old.recovery.use, exact: true })
    .click();
  await expect(
    old.region.getByLabel(old.copy.extensions[2], { exact: true }),
  ).toHaveValue(seed.manifest.id);
  expect(await page.evaluate(() => history.state.acosGuideDraft)).toEqual(seed);
  await expect(
    old.region.getByRole("button", {
      name: old.copy.extensions[11],
      exact: true,
    }),
  ).toBeDisabled();
  expect(f.writes).toHaveLength(0);
  await page.evaluate(() =>
    (
      window as unknown as { restoreGuideStorage: () => void }
    ).restoreGuideStorage(),
  );
  await old.region
    .getByRole("button", { name: old.recovery.use, exact: true })
    .click();
  expect(
    await page.evaluate(() => history.state.acosGuideDraft),
  ).toBeUndefined();
  await expect(
    old.region.getByLabel(old.copy.extensions[2], { exact: true }),
  ).toHaveValue(seed.manifest.id);
  expect(f.writes).toHaveLength(0);
  expect(f.fixture.requests).toHaveLength(0);
});

test("an earlier uncertain save keeps its ID while the incoming guide waits", async ({
  page,
}) => {
  const old = await editorFixture(page);
  await old.region
    .getByRole("button", { name: old.copy.extensions[11], exact: true })
    .click();
  await expect(old.region.getByRole("status")).toContainText(
    old.recovery.uncertain,
  );
  const f = await savedProjectFixture(page),
    c = await loadReusableWorkCopy("en");
  f.rows.push(structuredClone(old.rows[0]));
  await page.getByRole("button", { name: c.prepareGuide, exact: true }).click();
  await expect(
    old.region.getByText(c.waitingGuide, { exact: true }),
  ).toBeVisible();
  const seed = await page.evaluate(() => history.state.acosGuideDraft);
  const pending = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("acos.extension-save.v1")!),
  );
  expect(pending.manifest.id).toBe(old.rows[0].id);
  expect(seed.manifest.id).not.toBe(pending.manifest.id);
  await old.region
    .getByRole("button", { name: old.recovery.check, exact: true })
    .click();
  await expect(
    old.region.getByRole("status").filter({ hasText: old.recovery.matching }),
  ).toBeVisible();
  await old.region
    .getByRole("button", { name: old.recovery.continue, exact: true })
    .click();
  await expect(
    old.region.getByLabel(old.copy.extensions[2], { exact: true }),
  ).toHaveValue(seed.manifest.id);
  await expect(
    old.region.getByLabel(old.copy.extensions[8], { exact: true }),
  ).toHaveValue(f.project.brief);
  expect(f.writes).toHaveLength(0);
  expect(old.writes).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

for (const fault of ["storage", "history"])
  test(`${fault} refusal keeps the same prepared guide and prevents dispatch`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      if (value === "history") history.replaceState = () => {};
      else {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, data) {
          if (key === "acos.extension-editor.v1") return;
          return set.call(this, key, data);
        };
      }
    }, fault);
    const f = await savedProjectFixture(page),
      reuse = await loadReusableWorkCopy("en"),
      recovery = await loadExtensionEditorCopy("en"),
      c = (
        await import("../../artifacts/agentic-company-os/src/lib/customization-copy/customization-en")
      ).default;
    await page
      .getByRole("button", { name: reuse.prepareGuide, exact: true })
      .click();
    const panel = page.getByRole("region", { name: c.extensions[0] });
    await expect(
      panel.getByLabel(c.extensions[8], { exact: true }),
    ).toHaveValue(f.project.brief);
    const id = await page.evaluate(
      () => history.state.acosGuideDraft.manifest.id,
    );
    await expect(
      panel.getByRole("button", { name: c.extensions[11], exact: true }),
    ).toBeDisabled();
    await panel
      .getByRole("button", { name: recovery.use, exact: true })
      .click();
    await expect(
      panel.getByText(reuse.choiceError, { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => history.state.acosGuideDraft.manifest.id),
    ).toBe(id);
    expect(f.writes).toHaveLength(0);
    expect(f.fixture.requests).toHaveLength(0);
  });

test("child tasks offer no saved-root brief preparation", async ({ page }) => {
  const f = await savedProjectFixture(page, "en", { parentTaskId: 55 }),
    reuse = await loadReusableWorkCopy("en");
  await expect(
    page.getByRole("button", { name: reuse.useBrief, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: reuse.prepareGuide, exact: true }),
  ).toHaveCount(0);
  expect(f.fixture.requests).toHaveLength(0);
});

test("source read failure prevents preparing retained stale project text", async ({
  page,
}) => {
  const f = await savedProjectFixture(page),
    c = await loadReusableWorkCopy("en");
  await page.route("**/api/tasks/101", (route) =>
    route.fulfill({ status: 500, json: { error: "controlled read failure" } }),
  );
  const button = page.getByRole("button", { name: c.useBrief, exact: true });
  await expect(button).toBeDisabled({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: c.prepareGuide, exact: true }),
  ).toBeDisabled();
  expect(f.fixture.requests).toHaveLength(0);
  expect(f.writes).toHaveLength(0);
});

test("a prepared source snapshot stays exact after the source changes and an overlong title needs deliberate correction", async ({
  page,
}) => {
  const f = await savedProjectFixture(page, "en", {
      title: "x".repeat(300),
      brief: '"'.repeat(8000),
    }),
    c = (
      await import("../../artifacts/agentic-company-os/src/lib/customization-copy/customization-en")
    ).default,
    reuse = await loadReusableWorkCopy("en"),
    editor = await loadExtensionEditorCopy("en");
  await page
    .getByRole("button", { name: reuse.prepareGuide, exact: true })
    .click();
  const panel = page.getByRole("region", { name: c.extensions[0] });
  f.project.title = "Changed title";
  f.project.brief = "Changed source";
  await expect(panel.getByLabel(c.extensions[3], { exact: true })).toHaveValue(
    "x".repeat(300),
  );
  await expect(panel.getByLabel(c.extensions[8], { exact: true })).toHaveValue(
    '"'.repeat(8000),
  );
  await panel
    .getByRole("button", { name: c.extensions[11], exact: true })
    .click();
  await expect(
    panel.getByText(editor.validation, { exact: true }),
  ).toBeVisible();
  await panel
    .getByLabel(c.extensions[3], { exact: true })
    .fill("x".repeat(120));
  await panel
    .getByRole("button", { name: c.extensions[11], exact: true })
    .click();
  await expect(
    panel.getByText(editor.validation, { exact: true }),
  ).toBeVisible();
  expect(f.writes).toHaveLength(0);
  await panel
    .getByLabel(c.extensions[8], { exact: true })
    .fill("Reviewed source instructions");
  await panel
    .getByRole("button", { name: c.extensions[11], exact: true })
    .click();
  await expect.poll(() => f.rows.length).toBe(1);
  expect(f.rows[0].manifest.title).toBe("x".repeat(120));
  expect(f.rows[0].enabled).toBe(false);
  expect(f.fixture.requests).toHaveLength(0);
});

for (const locale of LOCALES)
  for (const mode of ["light", "dark"] as const)
    test(`${locale} ${mode} source guide journey preserves text and deliberate phone controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("acos.color-mode.v2", value),
        mode,
      );
      const f = await savedProjectFixture(page, locale),
        reuse = await loadReusableWorkCopy(locale),
        editor = await loadExtensionEditorCopy(locale),
        c = (
          await import(
            `../../artifacts/agentic-company-os/src/lib/customization-copy/customization-${locale}.ts`
          )
        ).default,
        fresh = await loadNewProjectCopy(locale);
      if (locale === "ar")
        await page.addStyleTag({ content: "html {font-size:200%}" });
      const prepare = page.getByRole("button", {
        name: reuse.prepareGuide,
        exact: true,
      });
      await prepare.focus();
      await expect(prepare).toBeFocused();
      await page.keyboard.press("Enter");
      const panel = page.getByRole("region", { name: c.extensions[0] });
      await expect(
        panel.getByLabel(c.extensions[3], { exact: true }),
      ).toBeFocused();
      await expect(
        panel.getByLabel(c.extensions[8], { exact: true }),
      ).toHaveValue(f.project.brief);
      await expect(
        panel.getByRole("checkbox", { name: editor.availability, exact: true }),
      ).not.toBeChecked();
      await panel
        .getByRole("button", { name: c.extensions[11], exact: true })
        .click();
      await expect.poll(() => f.rows.length).toBe(1);
      const use = panel.getByRole("button", {
        name: reuse.prepareProject,
        exact: true,
      });
      const box = await use.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`source-guide-${locale}-${mode}.png`),
        fullPage: true,
      });
      await use.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("textbox", { name: fresh.brief, exact: true }),
      ).toHaveValue(f.project.brief);
      await expect(
        page.getByText(reuse.runtimeHelp, { exact: true }),
      ).toBeVisible();
      expect(f.rows[0].enabled).toBe(false);
      expect(f.writes).toHaveLength(1);
      expect(f.fixture.requests).toHaveLength(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
async function editorFixture(page: Page, locale: Locale = "en") {
  await page.addInitScript(
    (language) => localStorage.setItem("acos.locale.v1", language),
    locale,
  );
  const fixture = await installStudioFixtures(page),
    copy = (
      await import(
        `../../artifacts/agentic-company-os/src/lib/customization-copy/customization-${locale}.ts`
      )
    ).default,
    recovery = await loadExtensionEditorCopy(locale);
  const rows: Row[] = [],
    writes: unknown[] = [];
  let loseResponse = true,
    reads = 0;
  await page.route("**/api/skills?*", (route) =>
    route.fulfill({ json: getCapabilityCatalog(locale) }),
  );
  await page.route("**/api/skills/extensions", async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      return route.fulfill({ json: rows });
    }
    const body = route.request().postDataJSON();
    writes.push(body);
    const old = rows.find((row) => row.id === body.manifest.id);
    if (body.expectedRevision !== (old?.revision ?? 0))
      return route.fulfill({
        status: 409,
        json: { code: "CAPABILITY_REVISION_CONFLICT" },
      });
    const row = {
      id: body.manifest.id,
      revision: body.expectedRevision + 1,
      enabled: body.enabled,
      manifest: body.manifest,
    };
    if (old) Object.assign(old, row);
    else rows.push(row);
    if (loseResponse) return route.abort("failed");
    return route.fulfill({ json: row });
  });
  await page.goto("/skills");
  const region = page.getByRole("region", { name: copy.extensions[0] });
  await region
    .getByRole("button", { name: copy.extensions[1], exact: true })
    .click();
  await region
    .getByLabel(copy.extensions[3], { exact: true })
    .fill("Recoverable guide");
  await region
    .getByLabel(copy.extensions[4], { exact: true })
    .fill("Source notes only");
  await region
    .getByLabel(copy.extensions[8], { exact: true })
    .fill(" First line\n第二行 😀  ");
  return {
    fixture,
    rows,
    writes,
    copy,
    recovery,
    region,
    getReads: () => reads,
    keepResponse: () => {
      loseResponse = false;
    },
  };
}

test("an uncertain submission keeps its editor identity and blocks guide replacement", async ({
  page,
}) => {
  const f = await editorFixture(page);
  await f.region
    .getByRole("button", { name: f.copy.extensions[11], exact: true })
    .click();
  await expect(f.region.getByRole("status")).toContainText(
    f.recovery.uncertain,
  );
  await expect(
    f.region.getByRole("button", { name: f.copy.extensions[1], exact: true }),
  ).toBeDisabled();
  await expect(
    f.region.getByLabel(f.copy.extensions[17], { exact: true }),
  ).toBeDisabled();
  await f.region
    .getByLabel(f.copy.extensions[3], { exact: true })
    .fill("Later editable title");
  const saved = await page.evaluate(() => ({
    pending: JSON.parse(sessionStorage.getItem("acos.extension-save.v1")!),
    draft: JSON.parse(sessionStorage.getItem("acos.extension-editor.v1")!),
  }));
  expect(saved.pending.manifest.id).toBe(saved.draft.manifest.id);
  expect(saved.pending.manifest.title).toBe("Recoverable guide");
  expect(saved.draft.manifest.title).toBe("Later editable title");
  expect(f.writes).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

test("changed stored availability is visible before explicit revision review", async ({
  page,
}) => {
  const f = await editorFixture(page);
  await f.region
    .getByRole("button", { name: f.copy.extensions[11], exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  f.rows[0].enabled = false;
  await f.region
    .getByRole("button", { name: f.recovery.check, exact: true })
    .click();
  await expect(f.region.getByRole("status")).toContainText(f.recovery.changed);
  const storedAvailability = f.region.getByRole("checkbox", {
    name: "Available in stored version",
    exact: true,
  });
  await expect(storedAvailability).not.toBeChecked();
  await expect(storedAvailability).toBeDisabled();
  await expect(
    f.region.getByRole("checkbox", {
      name: f.recovery.availability,
      exact: true,
    }),
  ).toBeChecked();
  expect(f.writes).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

for (const code of ["CAPABILITY_INVALID", "CAPABILITY_REVISION_CONFLICT"])
  test(`${code} keeps the submitted identity until an explicit read`, async ({
    page,
  }) => {
    const f = await editorFixture(page);
    const submissions: {
      manifest: Record<string, unknown>;
      expectedRevision: number;
      enabled: boolean;
    }[] = [];
    await page.route("**/api/skills/extensions", async (route) => {
      if (route.request().method() === "GET") return route.fallback();
      const body = route.request().postDataJSON();
      submissions.push(body);
      if (code === "CAPABILITY_REVISION_CONFLICT") {
        f.rows.push({
          id: body.manifest.id,
          manifest: { ...body.manifest, title: "Existing stored guide" },
          revision: 2,
          enabled: false,
        });
      }
      return route.fulfill({
        status: code === "CAPABILITY_INVALID" ? 400 : 409,
        json: { code },
      });
    });
    await f.region
      .getByRole("button", { name: f.copy.extensions[11], exact: true })
      .click();
    await expect(f.region.getByRole("status")).toContainText(
      code === "CAPABILITY_INVALID"
        ? f.recovery.rejected
        : f.recovery.uncertain,
    );
    const pending = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("acos.extension-save.v1")!),
    );
    expect(pending.manifest).toEqual(submissions[0].manifest);
    await f.region
      .getByRole("button", { name: f.recovery.check, exact: true })
      .click();
    await expect(f.region.getByRole("status")).toContainText(
      code === "CAPABILITY_INVALID" ? f.recovery.rejected : f.recovery.changed,
    );
    expect(submissions).toHaveLength(1);
    expect(f.fixture.requests).toHaveLength(0);
  });

test("a failed editor language download cannot reload an unretained draft or send a save", async ({
  page,
}) => {
  await page.route("**/assets/editor-en-*.js", (route) =>
    route.abort("failed"),
  );
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "acos.extension-editor.v1") return;
      return set.call(this, key, value);
    };
  });
  const f = await editorFixture(page);
  await expect(
    f.region.getByRole("button", { name: "Check again", exact: true }),
  ).toBeVisible();
  await expect(
    f.region.getByRole("button", { name: f.copy.extensions[11], exact: true }),
  ).toBeDisabled();
  const marker = await page.evaluate(() => {
    const value = crypto.randomUUID();
    (
      window as unknown as { editorRecoveryMarker: string }
    ).editorRecoveryMarker = value;
    return value;
  });
  await f.region
    .getByRole("button", { name: "Check again", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { editorRecoveryMarker: string })
          .editorRecoveryMarker,
    ),
  ).toBe(marker);
  await expect(
    f.region.getByLabel(f.copy.extensions[8], { exact: true }),
  ).toHaveValue(" First line\n第二行 😀  ");
  expect(f.writes).toHaveLength(0);
  expect(f.fixture.requests).toHaveLength(0);
});

test("overlong editable text stays exact and cannot be silently shortened into a save", async ({
  page,
}) => {
  const f = await editorFixture(page);
  const value = "X".repeat(121);
  await f.region.getByLabel(f.copy.extensions[3], { exact: true }).fill(value);
  await expect(
    f.region.getByLabel(f.copy.extensions[3], { exact: true }),
  ).toHaveValue(value);
  await f.region
    .getByRole("button", { name: f.copy.extensions[11], exact: true })
    .click();
  await expect(f.region.getByRole("alert")).toContainText(
    f.recovery.validation,
  );
  await page.reload();
  await expect(
    f.region.getByLabel(f.copy.extensions[3], { exact: true }),
  ).toHaveValue(value);
  expect(f.writes).toHaveLength(0);
  expect(f.fixture.requests).toHaveLength(0);
});

test("a Unicode guide import within server character limits remains exact", async ({
  page,
}) => {
  const f = await editorFixture(page);
  const manifest = {
    schemaVersion: 1,
    id: "user-unicode-guide",
    kind: "skill",
    title: "中文指南",
    description: "Source only",
    instructions: "中".repeat(6000),
  };
  const buffer = Buffer.from(JSON.stringify(manifest), "utf8");
  expect(buffer.byteLength).toBeGreaterThan(16000);
  await f.region
    .getByLabel(f.copy.extensions[17], { exact: true })
    .setInputFiles({
      name: "unicode-guide.json",
      mimeType: "application/json",
      buffer,
    });
  await expect(
    f.region.getByText(f.recovery.incomingHelp, { exact: true }),
  ).toBeVisible();
  await f.region
    .getByRole("button", { name: f.recovery.use, exact: true })
    .click();
  await expect(
    f.region.getByLabel(f.copy.extensions[8], { exact: true }),
  ).toHaveValue(manifest.instructions);
  await page.reload();
  await expect(
    f.region.getByLabel(f.copy.extensions[8], { exact: true }),
  ).toHaveValue(manifest.instructions);
  expect(f.writes).toHaveLength(0);
  expect(f.fixture.requests).toHaveLength(0);
});

for (const kind of ["tool", "program"] as const)
  test(`${kind} imports require an explicit draft choice and preserve unfinished input`, async ({
    page,
  }) => {
    const f = await editorFixture(page);
    const manifest = {
      schemaVersion: 1,
      id: `user-imported-${kind}`,
      kind,
      title: "Imported capability",
      description: "Review first",
      ...(kind === "tool"
        ? { tool: "calculate", defaults: { operation: "add" } }
        : {
            code: "return { total: input.units * input.price };",
            permissions: ["terminal"],
          }),
    };
    const file = {
      name: "capability.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest), "utf8"),
    };
    await f.region
      .getByLabel(f.copy.extensions[17], { exact: true })
      .setInputFiles(file);
    await f.region
      .getByRole("button", { name: f.recovery.keep, exact: true })
      .click();
    await expect(
      f.region.getByLabel(f.copy.extensions[8], { exact: true }),
    ).toHaveValue(" First line\n第二行 😀  ");
    await f.region
      .getByLabel(f.copy.extensions[17], { exact: true })
      .setInputFiles(file);
    await f.region
      .getByRole("button", { name: f.recovery.use, exact: true })
      .click();
    const field = f.region.getByLabel(
      kind === "tool" ? f.copy.extensions[10] : f.copy.program[1],
      { exact: true },
    );
    const unfinished = kind === "tool" ? '{"operation":' : "x".repeat(8001);
    await field.fill(unfinished);
    await expect(field).toHaveValue(unfinished);
    await f.region
      .getByRole("button", { name: f.copy.extensions[11], exact: true })
      .click();
    await expect(f.region.getByRole("alert")).toContainText(
      f.recovery.validation,
    );
    await page.reload();
    await expect(field).toHaveValue(unfinished);
    expect(f.writes).toHaveLength(0);
    expect(f.fixture.requests).toHaveLength(0);
  });

test("a committed save with a lost response retains its exact ID and submission through reload without another PUT", async ({
  page,
}) => {
  const f = await editorFixture(page),
    title = f.region.getByLabel(f.copy.extensions[3], { exact: true });
  await f.region
    .getByRole("button", { name: f.copy.extensions[11], exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("acos.extension-save.v1")),
    )
    .not.toBeNull();
  const saved = await page.evaluate(() =>
    sessionStorage.getItem("acos.extension-save.v1"),
  );
  await title.fill("Later editable text");
  await page.reload();
  await expect(title).toHaveValue("Later editable text");
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.extension-save.v1")),
  ).toBe(saved);
  expect(f.writes).toHaveLength(1);
  const reads = f.getReads();
  await f.region
    .getByRole("button", { name: f.recovery.check, exact: true })
    .click();
  await expect.poll(() => f.getReads()).toBe(reads + 1);
  await expect(f.region.getByRole("status")).toContainText(f.recovery.matching);
  await f.region
    .getByRole("button", { name: f.recovery.continue, exact: true })
    .click();
  await expect(title).toHaveValue("Later editable text");
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.extension-save.v1")),
  ).toBeNull();
  const draft = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("acos.extension-editor.v1")!),
  );
  expect(draft.manifest.id).toBe(f.rows[0].id);
  expect(draft.revision).toBe(1);
  expect(f.rows).toHaveLength(1);
  expect(f.writes).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

test("a missing saved version permits only an explicit identical retry despite later edits", async ({
  page,
}) => {
  const f = await editorFixture(page);
  await f.region
    .getByRole("button", { name: f.copy.extensions[11], exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  f.rows.splice(0);
  await f.region
    .getByLabel(f.copy.extensions[3], { exact: true })
    .fill("Later draft");
  await f.region
    .getByRole("button", { name: f.recovery.check, exact: true })
    .click();
  await expect(f.region.getByRole("status")).toContainText(f.recovery.missing);
  expect(f.writes).toHaveLength(1);
  f.keepResponse();
  await f.region
    .getByRole("button", { name: f.recovery.retry, exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1]).toEqual(f.writes[0]);
  await expect(
    f.region.getByLabel(f.copy.extensions[3], { exact: true }),
  ).toHaveValue("Later draft");
  expect(f.rows).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

test("changed stored contents require an explicit review and preserve later edits with the observed revision", async ({
  page,
}) => {
  const f = await editorFixture(page);
  await f.region
    .getByRole("button", { name: f.copy.extensions[11], exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  f.rows[0].revision = 2;
  f.rows[0].manifest = { ...f.rows[0].manifest, title: "Other saved change" };
  await f.region
    .getByLabel(f.copy.extensions[3], { exact: true })
    .fill("Keep my later draft");
  await f.region
    .getByRole("button", { name: f.recovery.check, exact: true })
    .click();
  await expect(f.region.getByRole("status")).toContainText(f.recovery.changed);
  await expect(f.region.locator("pre")).toContainText("Other saved change");
  expect(f.writes).toHaveLength(1);
  await f.region
    .getByRole("button", { name: f.recovery.reviewCurrent, exact: true })
    .click();
  await expect(
    f.region.getByLabel(f.copy.extensions[3], { exact: true }),
  ).toHaveValue("Keep my later draft");
  const draft = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("acos.extension-editor.v1")!),
  );
  expect(draft.revision).toBe(2);
  expect(f.writes).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

for (const locale of LOCALES)
  for (const mode of ["light", "dark"] as const)
    test(`${locale} ${mode} phone guide recovery retains exact text and uses readable deliberate actions`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("acos.color-mode.v2", value),
        mode,
      );
      const f = await editorFixture(page, locale);
      const id = await f.region
        .getByLabel(f.copy.extensions[2], { exact: true })
        .inputValue();
      await f.region
        .getByRole("button", { name: f.copy.extensions[11], exact: true })
        .click();
      await expect.poll(() => f.writes.length).toBe(1);
      await f.region
        .getByLabel(f.copy.extensions[8], { exact: true })
        .fill(" Later text\nثاني行 😀  ");
      await page.reload();
      if (locale === "ar")
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "32px";
        });
      await expect(
        f.region.getByLabel(f.copy.extensions[8], { exact: true }),
      ).toHaveValue(" Later text\nثاني行 😀  ");
      await expect(
        f.region.getByLabel(f.copy.extensions[2], { exact: true }),
      ).toHaveValue(id);
      await expect(
        f.region.getByLabel(f.copy.extensions[2], { exact: true }),
      ).toHaveAttribute("readonly", "");
      const button = f.region.getByRole("button", {
        name: f.recovery.check,
        exact: true,
      });
      await button.focus();
      await expect(button).toBeFocused();
      const layout = await button.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width,
        fits: element.scrollHeight <= element.clientHeight + 1,
      }));
      expect(layout.height).toBeGreaterThanOrEqual(44);
      expect(layout.width).toBeGreaterThanOrEqual(44);
      expect(layout.fits).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`guide-recovery-${locale}-${mode}.png`),
        fullPage: true,
      });
      await button.click();
      await expect(f.region.getByRole("status")).toContainText(
        f.recovery.matching,
      );
      await f.region
        .getByRole("button", { name: f.recovery.continue, exact: true })
        .click();
      await expect(
        f.region.getByLabel(f.copy.extensions[8], { exact: true }),
      ).toHaveValue(" Later text\nثاني行 😀  ");
      expect(f.writes).toHaveLength(1);
      expect(f.fixture.requests).toHaveLength(0);
    });

for (const mode of [
  "denied",
  "corrupt-draft",
  "corrupt-pending",
  "refused",
] as const)
  test(`${mode} recovery storage retains editable input but cannot send a save`, async ({
    page,
  }) => {
    await page.addInitScript((fault) => {
      if (fault === "corrupt-draft")
        sessionStorage.setItem("acos.extension-editor.v1", "not JSON");
      if (fault === "corrupt-pending")
        sessionStorage.setItem("acos.extension-save.v1", "not JSON");
      const set = Storage.prototype.setItem,
        get = Storage.prototype.getItem;
      Storage.prototype.setItem = function (key, value) {
        if (
          key.startsWith("acos.extension-") &&
          (fault === "denied" || fault === "refused")
        ) {
          if (fault === "denied") throw Error("owned storage denial");
          return;
        }
        return set.call(this, key, value);
      };
      Storage.prototype.getItem = function (key) {
        if (key.startsWith("acos.extension-") && fault === "denied")
          throw Error("owned storage denial");
        return get.call(this, key);
      };
    }, mode);
    const f = await editorFixture(page);
    await expect(f.region.getByRole("alert")).toContainText(
      f.recovery.storageError,
    );
    await f.region
      .getByRole("button", { name: f.copy.extensions[11], exact: true })
      .click();
    await expect(f.region.getByRole("alert")).toContainText(
      f.recovery.storageError,
    );
    await expect(
      f.region.getByLabel(f.copy.extensions[8], { exact: true }),
    ).toHaveValue(" First line\n第二行 😀  ");
    await page.locator('a[href="/settings"]').last().click();
    await expect(page.locator("select#settings-language")).toBeVisible();
    await page.locator('a[href="/skills"]').last().click();
    await expect(
      f.region.getByLabel(f.copy.extensions[8], { exact: true }),
    ).toHaveValue(" First line\n第二行 😀  ");
    expect(f.writes).toHaveLength(0);
    expect(f.rows).toHaveLength(0);
    expect(f.fixture.requests).toHaveLength(0);
  });

test("a malformed explicit saved-content read retains the pending submission and cannot offer retry", async ({
  page,
}) => {
  const f = await editorFixture(page);
  await f.region
    .getByRole("button", { name: f.copy.extensions[11], exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("acos.extension-save.v1"),
  );
  await page.route("**/api/skills/extensions", (route) =>
    route.fulfill({ json: [{ id: f.rows[0].id, revision: "wrong" }] }),
  );
  await f.region
    .getByRole("button", { name: f.recovery.check, exact: true })
    .click();
  await expect(f.region.getByRole("status")).toContainText(f.recovery.invalid);
  await expect(
    f.region.getByRole("button", { name: f.recovery.retry, exact: true }),
  ).toHaveCount(0);
  await expect(
    f.region.getByRole("button", { name: f.copy.extensions[11], exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("acos.extension-save.v1")),
  ).toBe(stored);
  expect(f.writes).toHaveLength(1);
  expect(f.fixture.requests).toHaveLength(0);
});

test("a late successful PUT after leaving Skills cannot clear recovery or later editable text", async ({
  page,
}) => {
  const f = await editorFixture(page);
  let release!: () => void,
    seen = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/skills/extensions", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    f.writes.push(body);
    const saved = {
      id: body.manifest.id,
      revision: body.expectedRevision + 1,
      enabled: body.enabled,
      manifest: body.manifest,
    };
    f.rows.push(saved);
    seen = true;
    await gate;
    return route.fulfill({ json: saved });
  });
  try {
    await f.region
      .getByRole("button", { name: f.copy.extensions[11], exact: true })
      .click();
    await expect.poll(() => seen).toBe(true);
    await f.region
      .getByLabel(f.copy.extensions[3], { exact: true })
      .fill("Later text survives leaving");
    await page.locator('a[href="/settings"]').last().click();
    await expect(page.locator("select#settings-language")).toBeVisible();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/skills/extensions") &&
        r.request().method() === "PUT",
    );
    release();
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("acos.extension-save.v1"),
      ),
    ).not.toBeNull();
    await expect(page).toHaveURL(/\/settings$/);
    await page.locator('a[href="/skills"]').last().click();
    await expect(
      f.region.getByLabel(f.copy.extensions[3], { exact: true }),
    ).toHaveValue("Later text survives leaving");
    await expect(
      f.region.getByRole("button", { name: f.recovery.check, exact: true }),
    ).toBeVisible();
    expect(f.writes).toHaveLength(1);
    expect(f.fixture.requests).toHaveLength(0);
  } finally {
    release();
  }
});

test("saving a tool-pack choice and returning to Skills preserves an unrelated unfinished guide", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  const fixture = await installStudioFixtures(page);
  let packWrites = 0,
    guideWrites = 0;
  let packs = {
    enabledPacks: ["data", "documents", "web", "code", "planning"],
    revision: 1,
  };
  await page.route("**/api/skills?*", (route) =>
    route.fulfill({ json: getCapabilityCatalog("en") }),
  );
  await page.route("**/api/skills/packs", (route) => {
    if (route.request().method() === "PUT") {
      packWrites++;
      const body = route.request().postDataJSON();
      packs = { enabledPacks: body.enabledPacks, revision: packs.revision + 1 };
    }
    return route.fulfill({ json: packs });
  });
  await page.route("**/api/skills/extensions", (route) => {
    if (route.request().method() !== "GET") guideWrites++;
    return route.fulfill({ json: [] });
  });
  await page.goto("/skills");
  const region = page.getByRole("region", {
    name: "Personal skills and tools",
  });
  await region.getByRole("button", { name: "Create new", exact: true }).click();
  await region.getByLabel("Title", { exact: true }).fill("Unfinished guide");
  await region
    .getByLabel("Description", { exact: true })
    .fill("Keep my source notes");
  await region
    .getByLabel("Instructions", { exact: true })
    .fill(" First line\n第二行 😀  ");
  await region.locator('fieldset input[type="checkbox"]').first().uncheck();
  await region
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect.poll(() => packWrites).toBe(1);
  await expect(region.getByLabel("Title", { exact: true })).toHaveValue(
    "Unfinished guide",
  );
  await page.locator('a[href="/settings"]').last().click();
  await expect(page.locator("select#settings-language")).toBeVisible();
  await page.locator('a[href="/skills"]').last().click();
  await expect(region.getByLabel("Title", { exact: true })).toHaveValue(
    "Unfinished guide",
  );
  await test.info().attach("restored-editor-labels.json", {
    body: JSON.stringify(
      await region.locator("label").evaluateAll((labels) =>
        labels
          .filter((label) => label.querySelector("textarea"))
          .map((label) => ({
            text: label.textContent,
            value: label.querySelector("textarea")?.value,
            ariaLabel: label
              .querySelector("textarea")
              ?.getAttribute("aria-label"),
          })),
      ),
    ),
    contentType: "application/json",
  });
  await expect(region.getByLabel("Instructions", { exact: true })).toHaveValue(
    " First line\n第二行 😀  ",
  );
  await page.reload();
  await expect(region.getByLabel("Title", { exact: true })).toHaveValue(
    "Unfinished guide",
  );
  expect(guideWrites).toBe(0);
  expect(fixture.requests).toHaveLength(0);
});
