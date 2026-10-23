import { expect, test, type Page } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadConnectionCopy } from "../../artifacts/agentic-company-os/src/lib/connection-copy";
import { readFile } from "node:fs/promises";
test.describe.configure({ mode: "parallel" });

const languages = [
  [
    "en",
    "Connect a model",
    "Get a local model",
    "Download model",
    "Stop download",
    "Checking the downloaded model",
    "Return to my job",
  ],
  [
    "tr",
    "Model bağla",
    "Yerel model edin",
    "Modeli indir",
    "İndirmeyi durdur",
    "İndirilen model kontrol ediliyor",
    "İşime dön",
  ],
  [
    "de",
    "Modell verbinden",
    "Ein lokales Modell einrichten",
    "Modell herunterladen",
    "Download stoppen",
    "Das heruntergeladene Modell wird geprüft",
    "Zurück zu meiner Aufgabe",
  ],
  [
    "ru",
    "Подключить",
    "Установить локальную модель",
    "Скачать модель",
    "Остановить загрузку",
    "Проверяем загруженную модель",
    "Вернуться к моей задаче",
  ],
  [
    "zh-CN",
    "连接模型",
    "获取本地模型",
    "下载模型",
    "停止下载",
    "正在检查已下载的模型",
    "返回我的任务",
  ],
  [
    "zh-TW",
    "連接模型",
    "取得本機模型",
    "下載模型",
    "停止下載",
    "正在檢查已下載的模型",
    "返回我的工作",
  ],
  [
    "ar",
    "اربط نموذجًا",
    "إعداد نموذج محلي",
    "تنزيل النموذج",
    "إيقاف التنزيل",
    "جارٍ فحص النموذج الذي تم تنزيله",
    "العودة إلى مهمتي",
  ],
] as const;

const recipe = {
  id: "qwen35-2b",
  model: "qwen3.5:2b-q4_K_M",
  minimumRuntimeVersion: "0.40.3",
  estimatedBytes: 1945782446,
  guides: {
    download: "https://ollama.com/download",
    windows: "https://docs.ollama.com/windows",
    macos: "https://docs.ollama.com/macos",
    linux: "https://docs.ollama.com/linux",
  },
};

async function fixture(
  page: Page,
  options: {
    loseAck?: boolean;
    deliverStart?: boolean;
    historicalReady?: boolean;
    staleCatalog?: boolean;
    existingModel?: boolean;
    server?: string;
  } = {},
) {
  const harness = await installStudioFixtures(page);
  let revision = 7;
  let providerRevision = 7;
  let failureCode: "CONFIG_CHANGED" | null = null;
  let phase:
    "requested" | "downloading" | "verifying" | "ready" | "interrupted" =
    options.historicalReady ? "ready" : "requested";
  let requestId: string | null = options.historicalReady
    ? "11111111-1111-4111-8111-111111111111"
    : null;
  const starts: unknown[] = [];
  const stops: string[] = [];
  const model = {
    id: options.existingModel
      ? "ollama:existing-local:latest"
      : "ollama:qwen3.5:2b-q4_K_M",
    provider: "ollama",
    label: options.existingModel ? "Existing local model" : "qwen3.5:2b-q4_K_M",
    description: "Local test model",
    tier: "economy",
    supportsTools: true,
    executionLocation: "local",
    runtimeCompatibility: "compatible",
    isDefault: false,
  };
  await page.route("**/api/model-catalog", (route) =>
    route.fulfill({
      json: {
        providers: [{ id: "ollama", label: "Ollama", available: true }],
        models: phase === "ready" && !options.historicalReady ? [model] : [],
      },
    }),
  );
  let reads = 0;
  const receipt = () =>
    requestId
      ? {
          requestId,
          modelId: "qwen35-2b",
          providerRevision,
          state: phase,
          phase:
            phase === "ready"
              ? "downloaded"
              : phase === "verifying"
                ? "checking"
                : "downloading",
          observedCompletedBytes: 100,
          observedTotalBytes: 200,
          progressReset: false,
          failureCode:
            failureCode ?? (phase === "interrupted" ? "INTERRUPTED" : null),
          resultModelId: phase === "ready" ? "ollama:qwen3.5:2b-q4_K_M" : null,
          resultDigest: phase === "ready" ? `sha256:${"a".repeat(64)}` : null,
          createdAt: "2026-10-23T00:00:00.000Z",
          updatedAt: "2026-10-23T00:00:00.000Z",
          finishedAt:
            phase === "ready" || phase === "interrupted"
              ? "2026-10-23T00:00:00.000Z"
              : null,
        }
      : null;
  await page.route("**/api/settings/llm", (route) =>
    route.fulfill({
      json: {
        revision,
        storage: "database",
        openai: { configured: false },
        openrouter: { configured: false },
        ollama: {
          configured: true,
          reachable: true,
          baseUrl: "http://127.0.0.1:11434",
          localEnforcementSupported: true,
          cloudEnabled: false,
        },
        catalog: {
          providers: [{ id: "ollama", available: true }],
          models: options.staleCatalog || options.existingModel ? [model] : [],
        },
      },
    }),
  );
  await page.route("**/api/settings/ollama/preparations**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST" && !path.endsWith("/stop")) {
      const body = route.request().postDataJSON();
      starts.push(body);
      if (options.deliverStart !== false) {
        requestId = body.requestId;
        providerRevision = body.expectedRevision;
        failureCode = null;
        phase = "downloading";
      }
      if (options.loseAck) return route.abort("failed");
      return route.fulfill({ status: 202, json: receipt() });
    }
    if (path.endsWith("/stop")) {
      requestId = path.split("/").at(-2)!;
      stops.push(requestId);
      phase = "interrupted";
      return route.fulfill({ json: receipt() });
    }
    reads++;
    if (path.endsWith("/preparations"))
      return route.fulfill({
        json: {
          revision,
          recipe,
          availability: {
            server: options.server ?? "compatible",
            available: phase === "ready" && !options.historicalReady,
            modelId: phase === "ready" ? "ollama:qwen3.5:2b-q4_K_M" : null,
            digest: phase === "ready" ? `sha256:${"a".repeat(64)}` : null,
          },
          preparation: receipt(),
        },
      });
    return receipt()
      ? route.fulfill({ json: receipt() })
      : route.fulfill({ status: 404, json: { code: "PREPARATION_NOT_FOUND" } });
  });
  return {
    harness,
    starts,
    stops,
    get reads() {
      return reads;
    },
    set phase(value: typeof phase) {
      phase = value;
    },
    set revision(value: number) {
      revision = value;
    },
    set failureCode(value: typeof failureCode) {
      failureCode = value;
    },
  };
}

for (const [
  locale,
  connect,
  title,
  download,
  stop,
  checking,
  returnToJob,
] of languages) {
  test(`${locale} obtains a model on a phone and returns to the preserved draft without starting work`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({
      colorScheme: locale === "ar" ? "light" : "dark",
      reducedMotion: "reduce",
    });
    await page.addInitScript((selected) => {
      localStorage.setItem("acos.locale.v1", selected);
      localStorage.setItem(
        "acos.color-mode.v2",
        selected === "ar" ? "light" : "dark",
      );
    }, locale);
    const state = await fixture(page);
    const preparationPacks: string[] = [];
    page.on("request", (request) => {
      const name = new URL(request.url()).pathname.split("/").pop()!;
      if (/^preparation-(tr|en|de|ru|zh-CN|zh-TW|ar)-/.test(name))
        preparationPacks.push(name);
    });
    const c = await loadConnectionCopy(locale);
    await page.goto("/");
    const draft = page.locator("#project-outcome");
    await draft.fill("Summarize these meeting notes and list the next steps.");
    expect(state.reads).toBe(0);
    expect(preparationPacks).toEqual([]);
    await page.getByRole("button", { name: connect, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: c.local, exact: true }).click();
    await testInfo.attach("connection-before-preparation", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await expect(
      dialog.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const setup = dialog.getByRole("region", { name: title, exact: true });
    expect(preparationPacks).toHaveLength(1);
    expect(preparationPacks[0]).toMatch(new RegExp(`^preparation-${locale}-`));
    await expect(
      dialog.getByText("qwen3.5:2b-q4_K_M", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: download, exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: stop, exact: true }),
    ).toBeVisible();
    expect(state.starts).toHaveLength(1);
    expect(state.starts[0]).toEqual({
      requestId: expect.any(String),
      expectedRevision: 7,
      modelId: "qwen35-2b",
    });
    state.phase = "verifying";
    await expect(dialog.getByText(checking, { exact: true })).toBeVisible();
    state.phase = "ready";
    await expect(
      setup.getByRole("button", { name: returnToJob, exact: true }),
    ).toBeVisible();
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "32px"),
    );
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    expect(
      await dialog.evaluate((node) => getComputedStyle(node).direction),
    ).toBe(locale === "ar" ? "rtl" : "ltr");
    await setup
      .getByRole("button", { name: returnToJob, exact: true })
      .scrollIntoViewIfNeeded();
    await testInfo.attach("prepared-phone-200-percent", {
      body: await page.screenshot({
        path: testInfo.outputPath("prepared-phone-200-percent.png"),
      }),
      contentType: "image/png",
    });
    await setup.getByRole("button", { name: returnToJob, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(draft).toHaveValue(
      "Summarize these meeting notes and list the next steps.",
    );
    await expect(draft).toBeFocused();
    expect(state.starts).toHaveLength(1);
    expect(state.harness.requests).toEqual([]);
    expect([...state.harness.unexpected]).toEqual([]);
  });
}

async function openLocal(page: Page) {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "en"));
  await page.goto("/");
  await page
    .locator("#project-outcome")
    .fill("Keep my original task draft intact.");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  return dialog;
}

for (const delivered of [true, false]) {
  test(`lost acknowledgement with delivery=${delivered} reconciles by reads and never permits a second hidden start`, async ({
    page,
  }) => {
    const state = await fixture(page, {
      loseAck: true,
      deliverStart: delivered,
    });
    let dialog = await openLocal(page);
    await dialog
      .getByRole("button", { name: "Download model", exact: true })
      .click();
    if (delivered) {
      await expect(
        dialog.getByText("Downloading model files", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText(/download acknowledgement is unavailable/),
      ).toHaveCount(0);
    } else {
      await expect(
        dialog.getByText(/download acknowledgement is unavailable/),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Download model", exact: true }),
      ).toBeDisabled();
    }
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Connect a model", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Local model", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Stop download", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Stop download", exact: true })
      .click();
    await expect(dialog.getByText(/Download interrupted\./)).toBeVisible();
    expect(state.starts).toHaveLength(1);
    await dialog
      .getByRole("button", { name: "Download model", exact: true })
      .click();
    await expect.poll(() => state.starts.length).toBe(2);
    expect((state.starts[0] as { requestId: string }).requestId).not.toBe(
      (state.starts[1] as { requestId: string }).requestId,
    );
    await dialog
      .getByRole("button", { name: "Stop download", exact: true })
      .click();
    await expect(dialog.getByText(/Download interrupted\./)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#project-outcome")).toHaveValue(
      "Keep my original task draft intact.",
    );
    expect(state.harness.requests).toEqual([]);
  });
}

test("active download locks saved connection changes and reopens the same receipt", async ({
  page,
}) => {
  const state = await fixture(page);
  let dialog = await openLocal(page);
  await dialog
    .getByRole("button", { name: "Download model", exact: true })
    .dblclick({ delay: 180 });
  expect(state.stops).toEqual([]);
  await expect(
    dialog.getByRole("textbox", { name: "Ollama address", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("checkbox")).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Save connection", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  await expect(
    dialog.getByText("Downloading model files", { exact: true }),
  ).toBeVisible();
  expect(state.starts).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "Stop download", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Ollama address", exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByText(/Partial files may remain/)).toBeVisible();
});

for (const server of ["unreachable", "update_required"]) {
  test(`${server} server explains setup on the actual server without a download`, async ({
    page,
  }) => {
    const state = await fixture(page, { server });
    const dialog = await openLocal(page);
    await expect(
      dialog.getByRole("button", { name: "Download model", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByText(
        server === "unreachable"
          ? /Ollama is not reachable/
          : /needs Ollama 0\.40\.3/,
      ),
    ).toBeVisible();
    for (const [name, path] of [
      ["Windows", "windows"],
      ["macOS", "macos"],
      ["Linux", "linux"],
    ]) {
      await expect(
        dialog.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", `https://docs.ollama.com/${path}`);
    }
    await expect(
      dialog.getByText(/operating system of the computer or server/),
    ).toBeVisible();
    expect(state.starts).toEqual([]);
  });
}

test("unsaved address cannot download and an old Ready receipt cannot restore a missing model", async ({
  page,
}) => {
  const state = await fixture(page, { historicalReady: true });
  const dialog = await openLocal(page);
  await expect(
    dialog
      .getByRole("region", { name: "Get a local model", exact: true })
      .getByRole("button", { name: "Return to my job", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Download model", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("textbox", { name: "Ollama address", exact: true })
    .fill("http://10.0.0.5:11434");
  await expect(
    dialog.getByRole("button", { name: "Download model", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("Save and check the server address before downloading.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.starts).toEqual([]);
});

test("a stale compatible catalog cannot override a currently unreachable server", async ({
  page,
}) => {
  const state = await fixture(page, {
    staleCatalog: true,
    server: "unreachable",
  });
  const dialog = await openLocal(page);
  const setup = dialog.getByRole("region", {
    name: "Get a local model",
    exact: true,
  });
  await expect(
    setup.getByRole("button", { name: "Return to my job", exact: true }),
  ).toHaveCount(0);
  await expect(setup.getByText(/Ollama is not reachable/)).toBeVisible();
  expect(state.starts).toEqual([]);
});

test("an externally changed connection requires checking the current revision before explicit retry", async ({
  page,
}) => {
  const state = await fixture(page);
  const dialog = await openLocal(page);
  const download = dialog.getByRole("button", {
    name: "Download model",
    exact: true,
  });
  await download.click();
  await expect(
    dialog.getByRole("button", { name: "Stop download", exact: true }),
  ).toBeVisible();
  state.revision = 8;
  state.phase = "interrupted";
  state.failureCode = "CONFIG_CHANGED";
  await expect(
    dialog.getByText(
      "The saved connection changed. Check the current server before downloading again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(download).toBeDisabled();
  expect(state.starts).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "Check download", exact: true })
    .click();
  await expect(download).toBeEnabled();
  await download.click();
  await expect.poll(() => state.starts.length).toBe(2);
  expect(
    (state.starts[1] as { expectedRevision: number }).expectedRevision,
  ).toBe(8);
  await dialog
    .getByRole("button", { name: "Stop download", exact: true })
    .click();
  expect(state.harness.requests).toEqual([]);
});

test("an already usable local model keeps the established connection return without offering another starter download", async ({
  page,
}) => {
  const state = await fixture(page, { existingModel: true });
  const dialog = await openLocal(page);
  await expect(
    dialog.getByText("Existing local model", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("region", { name: "Get a local model", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Return to my job", exact: true }),
  ).toBeVisible();
  expect(state.starts).toEqual([]);
  expect(state.harness.requests).toEqual([]);
});

test("a download completed after reopening still returns the original job with refreshed model availability", async ({
  page,
}) => {
  const state = await fixture(page);
  let dialog = await openLocal(page);
  await dialog
    .getByRole("button", { name: "Download model", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Stop download", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Connect a model", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Local model", exact: true })
    .click();
  const setup = dialog.getByRole("region", {
    name: "Get a local model",
    exact: true,
  });
  await expect(
    setup.getByText("Downloading model files", { exact: true }),
  ).toBeVisible();
  state.phase = "ready";
  await expect(
    setup.getByRole("button", { name: "Return to my job", exact: true }),
  ).toBeVisible();
  await setup
    .getByRole("button", { name: "Return to my job", exact: true })
    .click();
  await expect(page.locator("#project-outcome")).toBeFocused();
  await expect(page.locator("#project-outcome")).toHaveValue(
    "Keep my original task draft intact.",
  );
  expect(state.starts).toHaveLength(1);
  expect(state.harness.requests).toEqual([]);
});

for (const failed of ["module", "language"]) {
  test(`${failed} download failure preserves the connection and original draft`, async ({
    page,
  }) => {
    const manifest = JSON.parse(
      await readFile(
        "artifacts/agentic-company-os/dist/bundle-budget-manifest.json",
        "utf8",
      ),
    );
    const source = `artifacts/agentic-company-os/src/${failed === "module" ? "components/studio/local-model-preparation-slot.tsx" : "lib/local-model-preparation-copy/preparation-en.ts"}`;
    const chunk = manifest.chunks.find((entry: { modules: string[] }) =>
      entry.modules.includes(source),
    );
    expect(chunk).toBeTruthy();
    await page.route(`**/${chunk.fileName}`, (route) => route.abort("failed"));
    const state = await fixture(page);
    const dialog = await openLocal(page);
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Ollama address", exact: true }),
    ).toHaveValue("http://127.0.0.1:11434");
    await expect(
      dialog.getByRole("button", { name: "Download model", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("#project-outcome")).toHaveValue(
      "Keep my original task draft intact.",
    );
    expect(state.starts).toEqual([]);
    expect(state.reads).toBe(0);
    await page
      .getByRole("button", { name: "Connect a model", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Local model", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Reload page", exact: true }),
    ).toBeVisible();
    await page.unroute(`**/${chunk.fileName}`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reload page", exact: true })
      .click();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("#project-outcome")).toHaveValue(
      "Keep my original task draft intact.",
    );
    await page
      .getByRole("button", { name: "Connect a model", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Local model", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Download model", exact: true }),
    ).toBeEnabled();
    expect(state.starts).toEqual([]);
  });
}

test("desktop keyboard controls keep one dialog scroller and restore the task trigger", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const state = await fixture(page);
  const dialog = await openLocal(page);
  const download = dialog.getByRole("button", {
    name: "Download model",
    exact: true,
  });
  await expect(download).toBeEnabled();
  const bounds = await download.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await expect(
    dialog
      .getByRole("region", { name: "Get a local model", exact: true })
      .getByText("Existing jobs waiting for this model may continue.", {
        exact: true,
      }),
  ).toBeVisible();
  await testInfo.attach("local-setup-desktop", {
    body: await page.screenshot({
      path: testInfo.outputPath("local-setup-desktop.png"),
    }),
    contentType: "image/png",
  });
  const scrollers = await dialog.evaluate(
    (root) =>
      [root, ...root.querySelectorAll("*")].filter((node) => {
        const element = node as HTMLElement;
        return (
          element.scrollHeight > element.clientHeight + 1 &&
          /auto|scroll/.test(getComputedStyle(element).overflowY)
        );
      }).length,
  );
  expect(scrollers).toBe(1);
  await download.focus();
  await page.keyboard.press("Enter");
  const stop = dialog.getByRole("button", {
    name: "Stop download",
    exact: true,
  });
  await expect(stop).toBeEnabled();
  await stop.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText(/Download interrupted\./)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Connect a model", exact: true }),
  ).toBeFocused();
  await expect(page.locator("#project-outcome")).toHaveValue(
    "Keep my original task draft intact.",
  );
  expect(state.starts).toHaveLength(1);
  expect(state.harness.requests).toEqual([]);
});
