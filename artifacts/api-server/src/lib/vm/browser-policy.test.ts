import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeBrowserUrl } from "./browser";

test("browser policy rejects non-web schemes and credential-bearing URLs", async () => {
  await assert.rejects(
    () => assertSafeBrowserUrl("file:///etc/passwd"),
    /http ve https/,
  );
  await assert.rejects(
    () => assertSafeBrowserUrl("https://user:secret@example.com/"),
    /kullanici adi veya parola/,
  );
});

test("browser policy blocks local and private network literals", async () => {
  for (const url of [
    "http://localhost/",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fec0::1]/",
    "http://[2002:7f00:1::]/",
  ]) {
    await assert.rejects(() => assertSafeBrowserUrl(url));
  }
});

test("browser policy permits a public HTTPS IP", async () => {
  const parsed = await assertSafeBrowserUrl("https://8.8.8.8/");
  assert.equal(parsed.protocol, "https:");
});
