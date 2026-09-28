import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures, studioAgents } from "./helpers/studio-fixtures";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function fixture(page: Page) {
  const harness = await installStudioFixtures(page);
  const state = {
    content: "Original 原文\r\nمتن",
    editable: true,
    truncated: false,
    writes: [] as Record<string, string>[],
    loseResponse: false,
    readError: false,
    invalidReceipt: false,
  };
  await page.route("**/api/agents/2", (route) =>
    route.fulfill({ json: studioAgents[1] }),
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
        fileCount: 1,
        dirCount: 0,
      },
    }),
  );
  await page.route("**/api/agents/2/browser/view", (route) =>
    route.fulfill({
      json: {
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
        height: 800,
      },
    }),
  );
  await page.route("**/api/agents/2/vm/files-list", (route) =>
    route.fulfill({
      json: {
        path: "",
        total: 1,
        entries: [
          {
            name: "source.txt",
            path: "source.txt",
            type: "file",
            sizeBytes: Buffer.byteLength(state.content),
            updatedAt: "2026-09-27T08:00:00Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/agents/2/vm/file-read", (route) =>
    route.fulfill({
      status: state.readError ? 503 : 200,
      json: state.readError
        ? { error: "private-upstream-sentinel" }
        : {
            path: "source.txt",
            content: state.content,
            sizeBytes: Buffer.byteLength(state.content),
            version: hash(state.content),
            editable: state.editable,
            truncated: state.truncated,
          },
    }),
  );
  await page.route("**/api/agents/2/vm/file-write", (route) => {
    const request = route.request().postDataJSON();
    state.writes.push(request);
    if (request.expectedVersion !== hash(state.content))
      return route.fulfill({ status: 409, json: { code: "VM_FILE_CHANGED" } });
    state.content = request.content;
    return route.fulfill({
      status: state.loseResponse ? 503 : 200,
      json: state.loseResponse
        ? { error: "private-upstream-sentinel" }
        : {
            path: request.path,
            sizeBytes: Buffer.byteLength(request.content),
            version: state.invalidReceipt
              ? "a".repeat(64)
              : hash(request.content),
          },
    });
  });
  await page.goto("/agents/2?tab=computer");
  await page.getByRole("tab", { name: /Çalışma dosyaları/ }).click();
  return { state, harness };
}

test("complete reviewed files save exact source content and a new-file request is missing-only", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await page
    .getByRole("button", { name: /source.txt/ })
    .first()
    .click();
  const editor = page.getByRole("textbox", {
    name: "source.txt içeriği",
    exact: true,
  });
  await expect(editor).toHaveValue(state.content.replace(/\r\n/g, "\n"));
  const originalVersion = hash(state.content);
  await editor.fill("Saved 原文\nمتن");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(editor).toHaveValue("Saved 原文\nمتن");
  await expect(
    page.getByRole("button", { name: "Kaydet", exact: true }),
  ).toBeDisabled();
  expect(state.writes[0]).toEqual({
    path: "source.txt",
    content: "Saved 原文\r\nمتن",
    expectedVersion: originalVersion,
  });
  await page.getByRole("button", { name: "Kapat", exact: true }).last().click();
  await page.getByRole("button", { name: /Yeni dosya/ }).click();
  await page
    .getByRole("textbox", { name: "Göreli dosya yolu" })
    .fill("source.txt");
  await page.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]).toEqual({
    path: "source.txt",
    content: "",
    expectedVersion: "missing",
  });
  expect(state.content).toBe("Saved 原文\r\nمتن");
});

for (const truncated of [true, false]) {
  test(`${truncated ? "truncated" : "binary"} previews cannot be edited or saved`, async ({
    page,
  }) => {
    const { state } = await fixture(page);
    state.editable = false;
    state.truncated = truncated;
    await page
      .getByRole("button", { name: /source.txt/ })
      .first()
      .click();
    await expect(
      page.getByRole("textbox", { name: "source.txt içeriği", exact: true }),
    ).not.toBeEditable();
    await expect(
      page.getByRole("button", { name: "Kaydet", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText(/Bu yalnızca önizlemedir/)).toBeVisible();
    expect(state.writes).toHaveLength(0);
  });
}

test("stale edits require a fresh comparison without losing the draft or sending during review", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state } = await fixture(page);
  await page
    .getByRole("button", { name: /source.txt/ })
    .first()
    .click();
  const editor = page.getByRole("textbox", {
    name: "source.txt içeriği",
    exact: true,
  });
  await editor.fill("My draft 原文");
  state.content = "Newer server content";
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Dosya sürümünü incele" }),
  ).toBeVisible();
  await expect(editor).toHaveValue("My draft 原文");
  await expect(
    page.getByRole("button", { name: "Kaydet", exact: true }),
  ).toBeDisabled();
  state.readError = true;
  await page
    .getByRole("button", { name: "Güncel dosyayı karşılaştır" })
    .click();
  await expect(page.getByText(/Güncel dosya okunamadı/)).toBeVisible();
  await expect(editor).toHaveValue("My draft 原文");
  state.readError = false;
  await page
    .getByRole("button", { name: "Güncel dosyayı karşılaştır" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Sunucudaki güncel içerik" }),
  ).toHaveValue("Newer server content");
  await expect(
    page.getByRole("button", { name: "İncelemeyi tamamla" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.screenshot({
    path: info.outputPath("file-review-phone.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "İncelemeyi tamamla" }).click();
  expect(state.writes).toHaveLength(1);
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]!.expectedVersion).toBe(hash("Newer server content"));
  await expect(editor).toHaveValue("My draft 原文");
  await expect(page.getByText("private-upstream-sentinel")).toHaveCount(0);
});

test("lost or inconsistent write replies recover by comparing current bytes without a second write", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.loseResponse = true;
  await page
    .getByRole("button", { name: /source.txt/ })
    .first()
    .click();
  const editor = page.getByRole("textbox", {
    name: "source.txt içeriği",
    exact: true,
  });
  await editor.fill("Actually saved");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page
    .getByRole("button", { name: "Güncel dosyayı karşılaştır" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Sunucudaki güncel içerik" }),
  ).toHaveValue("Actually saved");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "İncelemeyi tamamla" }).click();
  await expect(
    page.getByRole("button", { name: "Kaydet", exact: true }),
  ).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  state.loseResponse = false;
  state.invalidReceipt = true;
  await editor.fill("Another draft");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Dosya sürümünü incele" }),
  ).toBeVisible();
  await expect(editor).toHaveValue("Another draft");
});
