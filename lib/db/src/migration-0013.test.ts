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

test("0013 backfills only active agents into the canonical company room", async () => {
  const client = new PGlite();
  try {
    const migrationFiles = (
      await readdir(new URL("./generated-sql/", import.meta.url))
    )
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort((left, right) => left.localeCompare(right, "en"));
    const migration0013 = migrationFiles.find((name) =>
      name.startsWith("0013_"),
    );
    assert.ok(migration0013);

    for (const fileName of migrationFiles.filter(
      (name) => name.localeCompare(migration0013, "en") < 0,
    )) {
      await applyMigration(client, fileName);
    }

    const agents = await client.query<{ id: number; is_active: boolean }>(`
      INSERT INTO agents (name, role, system_prompt, created_by_user, is_active)
      VALUES
        ('Active room member', 'Test', 'Test only', true, true),
        ('Inactive room member', 'Test', 'Test only', true, false)
      RETURNING id, is_active
    `);

    await applyMigration(client, migration0013);

    const members = await client.query<{ agent_id: number }>(`
      SELECT member.agent_id
      FROM company_channel_members AS member
      INNER JOIN company_channels AS channel_row ON channel_row.id = member.channel_id
      WHERE channel_row.key = 'company'
      ORDER BY member.agent_id
    `);
    assert.deepEqual(members.rows, [{ agent_id: agents.rows[0]!.id }]);

    const channel = await client.query<{ id: number }>(
      "SELECT id FROM company_channels WHERE key = 'company'",
    );
    await client.query(
      `
        INSERT INTO company_messages
          (channel_id, sender_type, sender_agent_id, content, source)
        VALUES
          ($1, 'agent', $2, 'Natural room reply', 'room_reply'),
          ($1, 'agent', $2, 'Legacy meeting row', 'meeting')
      `,
      [channel.rows[0]!.id, agents.rows[0]!.id],
    );
    const sources = await client.query<{ source: string }>(
      "SELECT source FROM company_messages ORDER BY id",
    );
    assert.deepEqual(sources.rows, [
      { source: "room_reply" },
      { source: "meeting" },
    ]);
  } finally {
    await client.close();
  }
});
