import assert from "node:assert/strict";
import test from "node:test";
import {
  OperationsRuntimeInstanceState,
  OperationsRuntimeInstanceRole,
  OperationsTaskAttemptState,
  OperationsReceiptState,
  OperationsInvocationState,
  OperationsExecutionKind,
  OperationsSideEffectClass,
  TaskStatus,
} from "../../../../lib/api-client-react/src/generated/api.schemas";
import type { OperationsRoomTruth } from "./operations-view-model";

test("translated truth preserves disconnected and demo priority over live transport", async () => {
  const truth: OperationsRoomTruth = {
    live: false,
    healthyWorkerCount: 2,
    backendState: "live",
    transportState: "disconnected",
    transportAgeMs: 28000,
    durableDataAgeMs: 120000,
    reasons: [],
  };
  for (const locale of locales) {
    const p = operationsPresentation(await loadOperationsCopy(locale), locale);
    assert.equal(
      p.truthLabel(truth),
      p.t("disconnected", { age: p.t("ago", { duration: p.duration(28000) }) }),
    );
    assert.equal(
      p.truthLabel({
        ...truth,
        backendState: "local_demo",
        transportState: "live",
      }),
      p.copy.demoTruth,
    );
    assert.equal(
      p.truthLabel({
        ...truth,
        backendState: "emergency_stopped",
        transportState: "live",
      }),
      p.copy.emergencyTruth,
    );
  }
});
import { loadOperationsCopy, operationsPresentation } from "./operations-copy";

const locales = ["tr", "en", "de", "ru", "zh-CN", "zh-TW", "ar"] as const;
test("every canonical Operations API state has a human label in each language", async () => {
  const states = [
    OperationsRuntimeInstanceState,
    OperationsRuntimeInstanceRole,
    OperationsTaskAttemptState,
    OperationsReceiptState,
    OperationsInvocationState,
    OperationsExecutionKind,
    OperationsSideEffectClass,
    TaskStatus,
  ].flatMap(Object.values);
  for (const locale of locales) {
    const pack = await loadOperationsCopy(locale);
    for (const state of states)
      assert.ok(Object.hasOwn(pack, `state_${state}`), `${locale}: ${state}`);
  }
});
test("operations packs have matching keys and interpolation fields", async () => {
  const packs = await Promise.all(locales.map(loadOperationsCopy));
  const base = packs[0]!;
  const fields = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const pack of packs) {
    assert.deepEqual(Object.keys(pack).sort(), Object.keys(base).sort());
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      assert.ok(pack[key].trim(), key);
      assert.deepEqual(fields(pack[key]), fields(base[key]), key);
    }
  }
  assert.notEqual(packs[4]!.fleetTitle, packs[5]!.fleetTitle);
});
test("operations presentation preserves source identifiers and explicit timezone", async () => {
  for (const locale of locales) {
    const p = operationsPresentation(await loadOperationsCopy(locale), locale);
    assert.match(p.time("2026-09-01T12:00:00Z"), /Europe\/Istanbul/);
    assert.match(p.state("new_unrecognized_state"), /new_unrecognized_state/);
    assert.equal(p.t("projectId", { id: "SRC-123" }).includes("SRC-123"), true);
    assert.equal(p.time("invalid"), p.copy.unknownTime);
  }
});
