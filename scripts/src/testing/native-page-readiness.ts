import { expect, type Locator } from "@playwright/test";

// A navigation can finish before authentication and the first route resolve.
// Give this boundary the normal browser-action budget; later checks keep their
// own deadlines and a page that never becomes usable must still fail.
export const NATIVE_PAGE_READINESS_TIMEOUT_MS = 30_000;

export async function waitForNativePageReady(control: Locator): Promise<void> {
  await expect(control).toBeVisible({
    timeout: NATIVE_PAGE_READINESS_TIMEOUT_MS,
  });
}
