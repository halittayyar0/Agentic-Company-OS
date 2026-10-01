import assert from "node:assert/strict";
import test from "node:test";
import { LOCALES } from "./i18n";
import { loadTraceCopy } from "./trace-copy";
test("all trace locales have matching fields and interpolation contracts", async () => {
  const base = await loadTraceCopy("en");
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]).sort();
  const compare = (expected: unknown, actual: unknown, location: string) => {
    if (typeof expected === "string") {
      assert.equal(typeof actual, "string", location);
      assert.ok((actual as string).trim(), location);
      assert.deepEqual(
        placeholders(actual as string),
        placeholders(expected),
        location,
      );
      return;
    }
    assert.ok(actual && typeof actual === "object", location);
    const a = actual as Record<string, unknown>,
      e = expected as Record<string, unknown>;
    assert.deepEqual(Object.keys(a).sort(), Object.keys(e).sort(), location);
    for (const key of Object.keys(e))
      compare(e[key], a[key], location + "." + key);
  };
  for (const locale of LOCALES) {
    const copy = await loadTraceCopy(locale);
    assert.deepEqual(
      Object.keys(copy).sort(),
      Object.keys(base).sort(),
      locale,
    );
    assert.deepEqual(
      Object.keys(copy.fields).sort(),
      Object.keys(base.fields).sort(),
      locale,
    );
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      compare(base[key], copy[key], locale + "." + key);
    }
    for (const value of Object.values(copy.fields))
      assert.ok(value.trim(), locale);
  }
  assert.notDeepEqual(
    await loadTraceCopy("zh-CN"),
    await loadTraceCopy("zh-TW"),
  );
});
