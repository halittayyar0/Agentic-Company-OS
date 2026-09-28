import assert from "node:assert/strict";
import test from "node:test";
import {
  directionForLocale,
  LANGUAGE_OPTIONS,
  LOCALES,
  loadShellMessages,
  setupMessages,
  previewUiMessages,
} from "./i18n";

test("every supported locale has the same non-empty shell messages", async () => {
  assert.deepEqual(
    LANGUAGE_OPTIONS.map(({ code }) => code),
    [...LOCALES],
  );
  const reference = Object.keys(await loadShellMessages("tr")).sort();
  const turkish = await loadShellMessages("tr");
  for (const key of Object.keys(previewUiMessages) as Array<
    keyof typeof previewUiMessages
  >) {
    assert.equal(previewUiMessages[key], turkish[key], `standalone ${key}`);
  }
  for (const locale of LOCALES) {
    const messages = await loadShellMessages(locale);
    assert.deepEqual(Object.keys(messages).sort(), reference, locale);
    for (const [key, value] of Object.entries(messages)) {
      assert.ok(value.trim(), `${locale}.${key}`);
    }
    assert.ok(setupMessages[locale].languageFileError);
    assert.deepEqual(
      messages.historyWindow.match(/\{\w+\}/g)?.sort(),
      ["{count}", "{limit}", "{page}"],
      `${locale} history interpolation`,
    );
    assert.equal(directionForLocale(locale), locale === "ar" ? "rtl" : "ltr");
  }
});
