import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_LOCALES, type WorkspaceLocale } from "../workspace-locale";
import { getToolCopy, toolMessage } from "./tool-localization";
import type { ToolMessageKey } from "./tool-copy";

test("every tool language has the full authored contract and exact placeholder multiplicity", () => {
  const original = getToolCopy("tr");
  const keys = Object.keys(original).sort() as ToolMessageKey[];
  const placeholders = (text: string) =>
    [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
      .map((match) => match[1])
      .sort();
  for (const locale of WORKSPACE_LOCALES) {
    const copy = getToolCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), keys, locale);
    assert.ok(Object.isFrozen(copy));
    for (const key of keys) {
      assert.ok(copy[key].trim(), `${locale}.${key} must be authored`);
      assert.deepEqual(
        placeholders(copy[key]),
        placeholders(original[key]),
        `${locale}.${key}`,
      );
    }
  }
});

test("tool templates preserve literal source names, whitespace, Unicode and replacement tokens", () => {
  const value = "  原文 $& {bytes}\nمتن\n  ";
  for (const locale of WORKSPACE_LOCALES) {
    const result = toolMessage(locale, "fileWritten", {
      name: value,
      path: value,
      bytes: 17,
    });
    assert.equal(result.split(value).length - 1, 2);
    assert.ok(result.includes("17"));
  }
});

test("invalid tool locale, message and missing substitution fail closed", () => {
  assert.throws(
    () => getToolCopy("invalid" as WorkspaceLocale),
    /Invalid tool execution locale/,
  );
  assert.throws(
    () => toolMessage("en", "toString" as ToolMessageKey),
    /Invalid tool message key/,
  );
  assert.throws(
    () => toolMessage("en", "fileWriteComplete", { path: "literal" }),
    /Missing tool parameter: bytes/,
  );
});
