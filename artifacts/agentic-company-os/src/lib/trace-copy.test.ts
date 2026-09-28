import assert from "node:assert/strict";
import test from "node:test";
import { LOCALES } from "./i18n";
import { loadTraceCopy } from "./trace-copy";
test("all trace locales have matching fields and interpolation contracts", async () => {
  const base = await loadTraceCopy("en");
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]).sort();
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
      if (key === "fields") continue;
      assert.ok(copy[key].trim(), locale + "." + key);
      assert.deepEqual(
        placeholders(copy[key]),
        placeholders(base[key]),
        locale + "." + key,
      );
    }
    for (const value of Object.values(copy.fields))
      assert.ok(value.trim(), locale);
  }
  assert.notDeepEqual(
    await loadTraceCopy("zh-CN"),
    await loadTraceCopy("zh-TW"),
  );
});
