import assert from "node:assert/strict";
import test from "node:test";

delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
const { db, dbReady, closeDatabase, agentsTable, companyChannelMembersTable } =
  await import("@workspace/db");
const { seedDefaultOrg } = await import("./seed");

test("synthetic seeding keeps a fixed ten-agent cohort when the public catalog grows", async (t) => {
  await dbReady;
  t.after(closeDatabase);
  await seedDefaultOrg("en", { syntheticAgentCount: 10 });
  const first = await db.select().from(agentsTable);
  assert.equal(first.length, 10);
  const root = first.find((agent) => agent.isRootCeo);
  assert.ok(root?.permissions.canDelegate);
  assert.equal(root.parentAgentId, null);
  assert.equal(
    first.filter((agent) => agent.parentAgentId === root.id).length,
    9,
  );
  assert.ok(first.every((agent) => agent.isActive));
  assert.equal((await db.select().from(companyChannelMembersTable)).length, 10);

  await seedDefaultOrg("en", { syntheticAgentCount: 10 });
  assert.deepEqual(
    (await db.select().from(agentsTable)).map((a) => a.id),
    first.map((a) => a.id),
  );
  await assert.rejects(
    seedDefaultOrg("en", { syntheticAgentCount: 11 }),
    /existing synthetic roster/i,
  );
  for (const count of [0, 1, 1.5, NaN, 999]) {
    await assert.rejects(
      seedDefaultOrg("en", { syntheticAgentCount: count }),
      /synthetic agent count/i,
    );
  }
  assert.equal((await db.select().from(agentsTable)).length, 10);
});
