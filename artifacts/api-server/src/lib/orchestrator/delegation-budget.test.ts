import assert from "node:assert/strict";
import test from "node:test";
import { agentsTable, db, dbReady, tasksTable } from "@workspace/db";
import {
  assertDelegationBudget,
  assertAgentCreationBudget,
} from "./delegation-budget";

test("recursive and concurrent delegation share one family capacity", async () => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Budget", role: "Test", systemPrompt: "Test" })
    .returning();
  const create = async (parentTaskId: number | null) =>
    (
      await db
        .insert(tasksTable)
        .values({
          ownerAgentId: agent.id,
          title: "Task",
          brief: "Test",
          parentTaskId,
        })
        .returning()
    )[0]!;
  const root = await create(null);
  const child = await create(root.id);
  await create(child.id);
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      db.transaction(async (tx) => {
        await assertDelegationBudget(tx, child.id);
        await tx.insert(tasksTable).values({
          ownerAgentId: agent.id,
          title: "Child",
          brief: "Test",
          parentTaskId: child.id,
        });
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 2);
});

test("missing or cyclic ancestry fails closed", async () => {
  await assert.rejects(
    db.transaction((tx) => assertDelegationBudget(tx, 2147483647)),
  );
});

test("automatic hiring cannot create an unbounded idle workforce", async () => {
  const [owner] = await db
    .insert(agentsTable)
    .values({ name: "Owner", role: "Test", systemPrompt: "Test" })
    .returning();
  await db.insert(agentsTable).values(
    Array.from({ length: 4 }, () => ({
      name: "Existing specialist",
      role: "Test",
      systemPrompt: "Test",
      parentAgentId: owner.id,
      createdByUser: false,
    })),
  );
  await assert.rejects(
    db.transaction((tx) => assertAgentCreationBudget(tx, owner.id)),
  );
});
