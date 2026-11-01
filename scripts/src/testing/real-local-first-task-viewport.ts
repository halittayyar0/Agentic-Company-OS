import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";

/** A visible saved result, not the same number in the original task brief. */
export async function captureRealTaskDelivery(
  page: Page,
  width: number,
  timeoutMs = 15000,
) {
  assert.ok([320, 1024].includes(width));
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000,
  );
  await page.setViewportSize({ width, height: 844 });
  // Exercise the same saved-result discovery used by a person on the actual
  // native application. The English first-task fixture owns this language.
  const jump = page.getByRole("link", {
    name: "View saved delivery",
    exact: true,
  });
  await expect(jump).toBeVisible({ timeout: timeoutMs });
  await jump.focus({ timeout: timeoutMs });
  await jump.press("Enter", { timeout: timeoutMs });
  await expect(page.locator("#project-delivery-heading")).toBeFocused({
    timeout: timeoutMs,
  });
  const delivery = page.locator("#project-delivery-summary");
  const result = delivery.getByText(/\b73\b/u).first();
  await expect(result).toBeVisible({ timeout: timeoutMs });
  // Desktop uses an internal scroll container. fullPage does not scroll it.
  await result.scrollIntoViewIfNeeded({ timeout: timeoutMs });
  await expect(result).toBeInViewport({ ratio: 1, timeout: timeoutMs });
  const overflow = await page.evaluate<boolean>(
    "document.documentElement.scrollWidth > window.innerWidth",
  );
  assert.equal(overflow, false, "completed_task_horizontal_overflow");
  return {
    image: await page.screenshot({ fullPage: false }),
    overflow,
    deliveryVisible: true as const,
  };
}
