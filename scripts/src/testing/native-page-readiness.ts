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

// Prepared content can arrive in a lazy section after the URL has changed.
// Separate section readiness from the exact-content check that follows it.
export async function expectNativePageValue(
  control: Locator,
  value: string,
): Promise<void> {
  await waitForNativePageReady(control);
  await expect(control).toHaveValue(value);
}
