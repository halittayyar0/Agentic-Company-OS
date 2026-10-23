import { expect, test } from "@playwright/test";
import { installStudioFixtures } from "./helpers/studio-fixtures";
import { loadConnectionCopy } from "../../artifacts/agentic-company-os/src/lib/connection-copy";
import { loadShellMessages } from "../../artifacts/agentic-company-os/src/lib/i18n";

for (const locale of [
  "en",
  "tr",
  "de",
  "ru",
  "zh-CN",
  "zh-TW",
  "ar",
] as const) {
  test(`${locale} local address waits for lazy preparation discovery and submits the entered value on a phone`, async ({
    page,
  }) => {
    const c = await loadConnectionCopy(locale);
    const s = await loadShellMessages(locale);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    const harness = await installStudioFixtures(page);
    let revision = 7;
    let savedAddress = "http://127.0.0.1:11434/v1";
    const writes: unknown[] = [];
    await page.route("**/api/settings/llm", (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        writes.push(body);
        revision++;
        savedAddress = body.ollamaBaseUrl + "/v1";
        return route.fulfill({ json: { ok: true, revision } });
      }
      return route.fulfill({
        json: {
          revision,
          openai: { configured: false },
          openrouter: { configured: false },
          ollama: {
            configured: true,
            baseUrl: savedAddress,
            cloudEnabled: false,
          },
          catalog: { providers: [], models: [] },
        },
      });
    });
    let releaseModule!: () => void;
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve;
    });
    let announceModule!: () => void;
    const moduleStarted = new Promise<void>((resolve) => {
      announceModule = resolve;
    });
    await page.route(
      "**/assets/local-model-preparation-slot-*.js",
      async (route) => {
        announceModule();
        await moduleGate;
        await route.continue();
      },
    );
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    let announceSnapshot!: () => void;
    const snapshotStarted = new Promise<void>((resolve) => {
      announceSnapshot = resolve;
    });
    await page.route("**/api/settings/ollama/preparations", async (route) => {
      announceSnapshot();
      await snapshotGate;
      await route.fulfill({
        json: {
          revision,
          recipe: {
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
          },
          availability: {
            server: "compatible",
            available: false,
            modelId: null,
            digest: null,
          },
          preparation: null,
        },
      });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: s.providerSetupAction, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: c.local, exact: true }).click();
    const address = dialog.getByRole("textbox", {
      name: c.endpoint,
      exact: true,
    });
    try {
      await moduleStarted;
      await expect(address).toHaveValue(savedAddress);
      await expect(address).toBeDisabled();
      releaseModule();
      await snapshotStarted;
      await expect(address).toBeDisabled();
      expect(writes).toEqual([]);
    } finally {
      releaseModule();
      releaseSnapshot();
    }
    await expect(address).toBeEnabled();
    await address.fill("http://127.0.0.1:49152");
    await expect(address).toHaveValue("http://127.0.0.1:49152");
    await dialog.getByRole("button", { name: c.save, exact: true }).click();
    await expect(
      dialog.getByRole("status", { name: c.save, exact: true }),
    ).toContainText(c.saved);
    await expect(address).toHaveValue("http://127.0.0.1:49152/v1");
    expect(writes).toEqual([
      {
        expectedRevision: 7,
        ollamaBaseUrl: "http://127.0.0.1:49152",
        ollamaCloudEnabled: false,
      },
    ]);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    expect(harness.requests).toEqual([]);
    expect([...harness.unexpected]).toEqual([]);
  });
}
