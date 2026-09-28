import assert from "node:assert/strict";
import test from "node:test";
import { calculateReparentDepths } from "./agents";

const hierarchy = [
  { id: 1, parentAgentId: null, depth: 0 },
  { id: 2, parentAgentId: 1, depth: 1 },
  { id: 3, parentAgentId: 2, depth: 2 },
  { id: 4, parentAgentId: 1, depth: 1 },
];

test("reparent recalculates the moved subtree depth", () => {
  const result = calculateReparentDepths(hierarchy, 2, 4);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.fromEntries(result.depths), { 2: 2, 3: 3 });
});

test("reparent rejects self references and descendant cycles", () => {
  const self = calculateReparentDepths(hierarchy, 2, 2);
  assert.equal(self.ok, false);

  const descendant = calculateReparentDepths(hierarchy, 2, 3);
  assert.equal(descendant.ok, false);
  if (!descendant.ok) assert.match(descendant.error, /cycle/i);
});

test("reparent can promote a subtree to the root", () => {
  const result = calculateReparentDepths(hierarchy, 2, null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.fromEntries(result.depths), { 2: 0, 3: 1 });
});
