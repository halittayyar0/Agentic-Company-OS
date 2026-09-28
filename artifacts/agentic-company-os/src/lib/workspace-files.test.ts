import assert from "node:assert/strict";
import test from "node:test";
import { applyFileTextEdit } from "./workspace-files";

test("textarea edits retain untouched mixed newlines and BOM instead of rewriting every line", () => {
  const original = "\ufeffAlpha\r\nBeta\nGamma\rDelta 原文";
  assert.equal(
    applyFileTextEdit(original, "\ufeffAlpha\nBeta\nGamma\nDelta 原文"),
    original,
  );
  assert.equal(
    applyFileTextEdit(original, "\ufeffAlpha\nChanged\nGamma\nDelta 原文"),
    "\ufeffAlpha\r\nChanged\nGamma\rDelta 原文",
  );
  assert.equal(
    applyFileTextEdit(original, "\ufeffAlpha\nBeta\nGamma\nDelta جديد"),
    "\ufeffAlpha\r\nBeta\nGamma\rDelta جديد",
  );
});
test("new lines follow the source style while deletion and Unicode edits remain exact", () => {
  assert.equal(applyFileTextEdit("A\r\nB", "A\nNew\nB"), "A\r\nNew\r\nB");
  assert.equal(applyFileTextEdit("A\r\nB", "AB"), "AB");
  assert.equal(applyFileTextEdit("A\r\nB", ""), "");
  assert.equal(applyFileTextEdit("", "原文\nمتن"), "原文\nمتن");
  assert.equal(applyFileTextEdit("😀\r\nB", "😃\nB"), "😃\r\nB");
});
