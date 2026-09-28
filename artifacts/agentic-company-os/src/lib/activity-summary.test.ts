import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LOCALES, loadShellMessages } from "./i18n";
import {
  activityOperationsEventKind,
  knownOperationsEventKind,
  operationsEventMessageKeys,
} from "./activity-summary";

test("every canonical server Operations event has a shared label in all seven shell packs", async () => {
  const source = await readFile(
    new URL(
      "../../../api-server/src/lib/operations/operations-events.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const declared = source.match(
    /export const operationsEventKinds = \[([\s\S]*?)\] as const/,
  );
  assert.ok(declared);
  const serverKinds = [...declared[1].matchAll(/"([a-z_]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    Object.keys(operationsEventMessageKeys).sort(),
    serverKinds.sort(),
  );
  const english = await loadShellMessages("en");
  for (const locale of LOCALES) {
    const copy = await loadShellMessages(locale);
    for (const [kind, key] of Object.entries(operationsEventMessageKeys)) {
      assert.ok(copy[key]?.trim(), `${locale}: ${kind}`);
      assert.notEqual(copy[key], kind);
      if (locale !== "en") assert.notEqual(copy[key], english[key]);
    }
  }
});

test("only recognized version-one system events acquire a display label", () => {
  for (const kind of Object.keys(operationsEventMessageKeys)) {
    const detail = Object.freeze({ schemaVersion: 1, kind });
    assert.equal(
      activityOperationsEventKind({ type: "operations_changed", detail }),
      kind,
    );
    assert.equal(activityOperationsEventKind({ type: "note", detail }), null);
    assert.equal(activityOperationsEventKind({ type: "error", detail }), null);
    assert.equal(
      activityOperationsEventKind({
        type: "operations_changed",
        detail: { ...detail, schemaVersion: 2 },
      }),
      null,
    );
  }
  for (const kind of [
    "__proto__",
    "constructor",
    "toString",
    "future_event",
    null,
    {},
    3,
  ]) {
    assert.equal(knownOperationsEventKind(kind), null);
    assert.equal(
      activityOperationsEventKind({
        type: "operations_changed",
        detail: { schemaVersion: 1, kind },
      }),
      null,
    );
  }
  for (const detail of [
    null,
    [],
    "runtime_registered",
    {},
    { kind: "runtime_registered" },
  ]) {
    assert.equal(
      activityOperationsEventKind({ type: "operations_changed", detail }),
      null,
    );
  }
});
