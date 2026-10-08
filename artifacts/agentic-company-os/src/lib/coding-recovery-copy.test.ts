import assert from "node:assert/strict";
import test from "node:test";
import { loadCodingRecoveryCopy } from "./coding-recovery-copy";
import { LOCALES } from "./i18n";

test("every selected recovery language supplies the full decision and receipt vocabulary", async () => {
  const english = await loadCodingRecoveryCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadCodingRecoveryCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort());
    assert.deepEqual(
      Object.keys(copy.reasons).sort(),
      Object.keys(english.reasons).sort(),
    );
    for (const value of [
      ...Object.values(copy).filter((v) => typeof v === "string"),
      ...Object.values(copy.reasons),
    ])
      assert.equal(typeof value === "string" && value.trim().length > 0, true);
  }
  assert.notDeepEqual(
    await loadCodingRecoveryCopy("zh-CN"),
    await loadCodingRecoveryCopy("zh-TW"),
  );
});
