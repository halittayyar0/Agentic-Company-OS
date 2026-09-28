import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const viteCli = "./artifacts/agentic-company-os/node_modules/vite/bin/vite.js";
const viteConfig = "./artifacts/agentic-company-os/vite.config.ts";

export default defineConfig({
  testDir: "./tests/ui",
  outputDir: "./test-results/ui-release-smoke",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Tests own isolated browser contexts; files remain internally serial.
  // The complete 903-case run takes about 23 minutes with two workers.
  workers: 2,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Existing flow tests represent an operator who finished first-run setup.
    // language-setup.spec.ts clears this state to exercise the actual chooser.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${port}`,
          localStorage: [{ name: "acos.locale.v1", value: "tr" }],
        },
      ],
    },
    colorScheme: "dark",
    locale: "tr-TR",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `${JSON.stringify(process.execPath)} ${viteCli} preview --config ${viteConfig}`,
    env: {
      PORT: String(port),
      PREVIEW_HOST: "127.0.0.1",
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
