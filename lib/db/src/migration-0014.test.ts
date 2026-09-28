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

test("0014 backfills root-project teams and enforces coordinator and root invariants", async () => {
  const client = new PGlite();
  try {
    const migrationFiles = (
      await readdir(new URL("./generated-sql/", import.meta.url))
    )
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort((left, right) => left.localeCompare(right, "en"));
    const migration0014 = migrationFiles.find((name) =>
      name.startsWith("0014_"),
    );
    assert.ok(migration0014);

    for (const fileName of migrationFiles.filter(
      (name) => name.localeCompare(migration0014, "en") < 0,
    )) {
      await applyMigration(client, fileName);
    }

    const agents = await client.query<{ id: number; is_active: boolean }>(`
      INSERT INTO agents
        (name, role, system_prompt, created_by_user, is_active, is_root_ceo)
      VALUES
        ('Active owner', 'Coordinator', 'Test only', true, true, false),
        ('Active teammate', 'Specialist', 'Test only', true, true, true),
        ('Inactive legacy owner', 'Coordinator', 'Test only', true, false, false),
        ('Inactive outsider', 'Archived', 'Test only', true, false, false)
      RETURNING id, is_active
    `);
    const [activeOwner, activeTeammate, inactiveOwner, inactiveOutsider] =
      agents.rows;
    assert.ok(
      activeOwner && activeTeammate && inactiveOwner && inactiveOutsider,
    );

    const projects = await client.query<{ id: number; owner_agent_id: number }>(
      `
        INSERT INTO tasks (title, brief, owner_agent_id, created_by_user)
        VALUES
          ('Active-owned root', 'Backfill every active agent.', $1, true),
          ('Inactive-owned root', 'Retain the legacy coordinator.', $2, true)
        RETURNING id, owner_agent_id
      `,
      [activeOwner.id, inactiveOwner.id],
    );
    const [activeRoot, inactiveRoot] = projects.rows;
    assert.ok(activeRoot && inactiveRoot);
    const child = await client.query<{ id: number }>(
      `
        INSERT INTO tasks
          (title, brief, owner_agent_id, parent_task_id, created_by_user)
        VALUES ('Child work', 'Never a project roster.', $1, $2, true)
        RETURNING id
      `,
      [activeOwner.id, activeRoot.id],
    );
    assert.ok(child.rows[0]);

    await applyMigration(client, migration0014);

    const memberships = await client.query<{
      task_id: number;
      agent_id: number;
      member_role: string;
    }>(`
      SELECT task_id, agent_id, member_role
      FROM project_members
      ORDER BY task_id, agent_id
    `);
    assert.deepEqual(
      memberships.rows.filter((member) => member.task_id === activeRoot.id),
      [
        {
          task_id: activeRoot.id,
          agent_id: activeOwner.id,
          member_role: "coordinator",
        },
        {
          task_id: activeRoot.id,
          agent_id: activeTeammate.id,
          member_role: "member",
        },
      ],
    );
    assert.deepEqual(
      memberships.rows.filter((member) => member.task_id === inactiveRoot.id),
      [
        {
          task_id: inactiveRoot.id,
          agent_id: activeOwner.id,
          member_role: "member",
        },
        {
          task_id: inactiveRoot.id,
          agent_id: activeTeammate.id,
          member_role: "coordinator",
        },
      ],
    );
    assert.ok(
      !memberships.rows.some((member) =>
        [inactiveOwner.id, inactiveOutsider.id].includes(member.agent_id),
      ),
    );
    assert.ok(
      !memberships.rows.some((member) => member.task_id === child.rows[0]!.id),
    );

    await assert.rejects(
      client.query(
        `
          UPDATE project_members
          SET member_role = 'coordinator'
          WHERE task_id = $1 AND agent_id = $2
        `,
        [activeRoot.id, activeTeammate.id],
      ),
      /project_members_one_coordinator_idx|unique/i,
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO project_members (task_id, agent_id, member_role)
          VALUES ($1, $2, 'member')
        `,
        [child.rows[0]!.id, inactiveOutsider.id],
      ),
      /root project/i,
    );
    await assert.rejects(
      client.query("UPDATE tasks SET parent_task_id = $1 WHERE id = $2", [
        activeRoot.id,
        inactiveRoot.id,
      ]),
      /cannot become a child/i,
    );
  } finally {
    await client.close();
  }
});
