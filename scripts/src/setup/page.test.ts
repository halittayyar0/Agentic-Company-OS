import assert from "node:assert/strict";
import test from "node:test";
import { renderSetupPage } from "./page";

test("setup document offers both destinations and every locale without external assets", () => {
  const html = renderSetupPage("nonce-test");
  for (const locale of ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"])
    assert.ok(html.includes(`value="${locale}"`));
  assert.ok(html.includes('value="native"'));
  assert.ok(html.includes('value="container"'));
  assert.ok(html.includes('nonce="nonce-test"'));
  assert.ok(html.includes('type="password"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/u);
  assert.throws(() => renderSetupPage('" onload="bad'), /nonce/u);
});
