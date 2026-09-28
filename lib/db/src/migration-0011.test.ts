import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

async function applyMigration(client: PGlite, fileName: string): Promise<void> {
  const migration = await readFile(
    new URL(`./generated-sql/${fileName}`, import.meta.url),
    "utf8",
  );
  await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
}

test("0011 backfills continuous responsibilities from their manual owner pin", async () => {
  const client = new PGlite();
  try {
    const migrationFiles = (
      await readdir(new URL("./generated-sql/", import.meta.url))
    )
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort((left, right) => left.localeCompare(right, "en"));
    const migration0011 = migrationFiles.find((name) =>
      name.startsWith("0011_"),
    );
    assert.ok(migration0011);

    for (const fileName of migrationFiles.filter(
      (name) => name.localeCompare(migration0011, "en") < 0,
    )) {
      await applyMigration(client, fileName);
    }

    const agents = await client.query<{ id: number }>(`
      INSERT INTO agents (name, role, system_prompt, model_mode, model_id, created_by_user)
      VALUES
        ('Manual upgrade owner', 'Test', 'Test only', 'manual', 'minimax/minimax-m3:free', true),
        ('Automatic upgrade owner', 'Test', 'Test only', 'auto', NULL, true)
      RETURNING id
    `);
    const manualOwnerId = agents.rows[0]!.id;
    const automaticOwnerId = agents.rows[1]!.id;
    await client.query(
      `
        INSERT INTO tasks (title, brief, owner_agent_id, autonomy_mode, cadence_seconds, created_by_user)
        VALUES
          ('Continuous manual', 'Backfill me', $1, 'continuous', 60, true),
          ('Finite manual', 'Do not pin legacy finite work', $1, 'finite', NULL, true),
          ('Continuous automatic', 'Automatic remains unpinned', $2, 'continuous', 60, true)
      `,
      [manualOwnerId, automaticOwnerId],
    );

    await applyMigration(client, migration0011);

    const tasks = await client.query<{
      title: string;
      execution_model_id: string | null;
    }>("SELECT title, execution_model_id FROM tasks ORDER BY id");
    assert.deepEqual(tasks.rows, [
      {
        title: "Continuous manual",
        execution_model_id: "minimax/minimax-m3:free",
      },
      { title: "Finite manual", execution_model_id: null },
      { title: "Continuous automatic", execution_model_id: null },
    ]);
  } finally {
    await client.close();
  }
});
