import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { captureRealTaskDelivery } from "./real-local-first-task-viewport";

test("genuine first-task capture requires the actual delivery result inside the visible viewport", async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.AGENT_BROWSER_CHANNEL ?? "chrome",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 844 },
    });
    await page.setContent(`
      <style>html,body{margin:0;height:100%;overflow:hidden}main{height:844px;overflow:auto}section{padding:24px}p{margin:0}</style>
      <main><h1>Brief: report the result 73</h1><div style="height:1600px"></div>
        <section id="project-delivery-summary" aria-label="Delivery summary"><p>Calculated 58.5 + 14.5 = 73 using the calculator.</p></section>
        <div style="height:1200px"></div></main>`);
    const delivery = page.locator("#project-delivery-summary");
    assert.ok((await delivery.boundingBox())!.y > 844);
    const capture = await captureRealTaskDelivery(page, 1024, 1000);
    assert.equal(capture.deliveryVisible, true);
    assert.equal(capture.overflow, false);
    assert.equal(capture.image.readUInt32BE(16), 1024);
    assert.equal(capture.image.readUInt32BE(20), 844);
    const bounds = (await delivery.getByText(/73/u).boundingBox())!;
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);

    // The original broad body assertion passes both of these invalid pages.
    for (const html of [
      "<h1>Brief: report the result 73</h1>",
      '<h1>Brief: report the result 73</h1><section id="project-delivery-summary">No saved result.</section>',
    ]) {
      await page.setContent(html);
      assert.ok((await page.locator("body").innerText()).includes("73"));
      await assert.rejects(captureRealTaskDelivery(page, 320, 250));
    }
  } finally {
    await browser.close();
  }
});
