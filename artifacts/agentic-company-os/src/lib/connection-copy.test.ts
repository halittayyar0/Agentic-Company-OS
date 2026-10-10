import assert from "node:assert/strict";
import test from "node:test";
import { LOCALES } from "./i18n";
import { loadConnectionCopy } from "./connection-copy";

test("seven authored connection packs explain server-bound consent, usage and unverified locality", async () => {
  const reference = await loadConnectionCopy("en");
  for (const locale of LOCALES) {
    const copy = await loadConnectionCopy(locale);
    assert.deepEqual(
      Object.keys(copy).sort(),
      Object.keys(reference).sort(),
      locale,
    );
    for (const [key, value] of Object.entries(copy))
      assert.ok(value.trim(), `${locale}.${key}`);
    assert.ok(copy.localRequirement.includes("0.18.0"), locale);
    for (const key of [
      "allowCloud",
      "localLocation",
      "cloudLocation",
      "unknownLocation",
      "cloudUsage",
      "cloudOn",
      "cloudOff",
    ] as const) {
      if (locale !== "en")
        assert.notEqual(copy[key], reference[key], `${locale}.${key}`);
    }
    assert.notEqual(copy.localLocation, copy.cloudLocation, locale);
    assert.notEqual(copy.cloudLocation, copy.unknownLocation, locale);
  }
});
