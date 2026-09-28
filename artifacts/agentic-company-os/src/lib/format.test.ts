import assert from "node:assert/strict";
import test from "node:test";
import { TASK_STATUS_META, taskStatusLabel, timeFromNow } from "./format";
import { LOCALES } from "./i18n";

const now = new Date("2026-08-29T09:00:00.000Z");

test("timeFromNow formats a scheduled wake without past-tense wording", () => {
  assert.equal(timeFromNow("2026-08-29T09:15:00.000Z", now), "15dk sonra");
  assert.equal(timeFromNow("2026-08-29T12:00:00.000Z", now), "3sa sonra");
  assert.equal(timeFromNow("2026-08-31T09:00:00.000Z", now), "2g sonra");
});

test("timeFromNow treats due and invalid values as ready now", () => {
  assert.equal(timeFromNow("2026-08-29T08:59:00.000Z", now), "şimdi");
  assert.equal(timeFromNow("not-a-date", now), "şimdi");
});

test("project status labels follow the selected language", () => {
  for (const locale of LOCALES) {
    assert.ok(taskStatusLabel("awaiting_approval", locale).trim(), locale);
  }
  assert.equal(
    taskStatusLabel("awaiting_approval", "tr"),
    TASK_STATUS_META.awaiting_approval.label,
  );
  assert.equal(taskStatusLabel("awaiting_approval", "en"), "Awaiting approval");
  assert.equal(taskStatusLabel("awaiting_approval", "ar"), "بانتظار الموافقة");
});
