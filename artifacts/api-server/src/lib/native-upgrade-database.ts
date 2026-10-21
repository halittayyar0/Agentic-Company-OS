export interface UpgradeDatabaseClient {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface UpgradeDataSnapshot {
  tables: { name: string; columns: string[]; rows: number; sha256: string }[];
  sequences: { name: string; lastValue: string; called: boolean }[];
}
const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function capture(
  client: UpgradeDatabaseClient,
  reference?: UpgradeDataSnapshot,
): Promise<UpgradeDataSnapshot> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL DateStyle TO 'ISO, YMD'");
    const names =
      reference?.tables.map((table) => table.name) ??
      (
        await client.query(
          "SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE \"C\"",
        )
      ).rows.map((row) => String(row.name));
    if (!names.length || names.length > 4096)
      throw new Error("native_upgrade_data_missing");
    const tables: UpgradeDataSnapshot["tables"] = [];
    for (const name of names) {
      const columns =
        reference?.tables.find((table) => table.name === name)?.columns ??
        (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
            [name],
          )
        ).rows.map((row) => String(row.column_name));
      if (!columns.length || columns.length > 1600)
        throw new Error("native_upgrade_data_missing");
      // Fixed-size cursor batches keep large installations out of Node's heap.
      // Project only the old columns after migration so additive schema is allowed.
      await client.query(
        `DECLARE acos_upgrade_rows NO SCROLL CURSOR FOR SELECT encoded FROM (SELECT row_to_json(ROW(${columns.map(quoted).join(",")}))::text AS encoded FROM public.${quoted(name)}) acos_upgrade_row ORDER BY encoded COLLATE "C"`,
      );
      const hash = createHash("sha256");
      let rows = 0;
      while (true) {
        const batch = await client.query(
          "FETCH FORWARD 200 FROM acos_upgrade_rows",
        );
        if (!batch.rows.length) break;
        for (const row of batch.rows) {
          if (typeof row.encoded !== "string")
            throw new Error("native_upgrade_data_invalid");
          hash.update(`${Buffer.byteLength(row.encoded)}:`).update(row.encoded);
          if (!Number.isSafeInteger(++rows))
            throw new Error("native_upgrade_data_bounds");
        }
      }
      await client.query("CLOSE acos_upgrade_rows");
      tables.push({ name, columns, rows, sha256: hash.digest("hex") });
    }
    const sequenceNames =
      reference?.sequences.map((sequence) => sequence.name) ??
      (
        await client.query(
          "SELECT sequencename AS name FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename COLLATE \"C\"",
        )
      ).rows.map((row) => String(row.name));
    if (sequenceNames.length > 4096)
      throw new Error("native_upgrade_data_bounds");
    const sequences: UpgradeDataSnapshot["sequences"] = [];
    for (const name of sequenceNames) {
      const row = (
        await client.query(
          `SELECT last_value::text AS value, is_called AS called FROM public.${quoted(name)}`,
        )
      ).rows[0];
      if (
        !row ||
        typeof row.value !== "string" ||
        typeof row.called !== "boolean"
      )
        throw new Error("native_upgrade_data_invalid");
      sequences.push({ name, lastValue: row.value, called: row.called });
    }
    await client.query("COMMIT");
    return { tables, sequences };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function captureNativeUpgradeData(
  client: UpgradeDatabaseClient,
): Promise<UpgradeDataSnapshot> {
  return capture(client);
}

/** Database-only staging operation. Caller has verified this connection belongs
 * to its private staged cluster. No API, agents, scheduler or provider imports.
 */
export async function verifyNativeUpgradeMigration(input: {
  client: UpgradeDatabaseClient;
  migrate: () => Promise<unknown>;
}): Promise<
  UpgradeDataSnapshot & {
    paused: true;
    previouslyPaused: boolean;
    runtimeVersion: number;
    writeAndSequenceProbe: true;
  }
> {
  const { client } = input;
  const before = await capture(client);
  await input.migrate();
  try {
    if (
      JSON.stringify(await capture(client, before)) !== JSON.stringify(before)
    )
      throw new Error("changed data");
  } catch {
    throw new Error("native_upgrade_data_changed");
  }
  await client.query("BEGIN");
  try {
    const rows = (
      await client.query(
        "SELECT emergency_stop_enabled, version FROM public.runtime_controls WHERE id=1 FOR UPDATE",
      )
    ).rows;
    const current = rows[0];
    if (
      rows.length !== 1 ||
      typeof current?.emergency_stop_enabled !== "boolean" ||
      !Number.isSafeInteger(current.version) ||
      Number(current.version) < 1
    )
      throw new Error("native_upgrade_control_missing");
    await client.query(
      "CREATE TEMP TABLE acos_native_upgrade_probe(id bigint GENERATED ALWAYS AS IDENTITY, value text) ON COMMIT DROP",
    );
    const probe = await client.query(
      "INSERT INTO acos_native_upgrade_probe(value) VALUES ('upgrade Ω العربية 中文'), ('sequence') RETURNING id::text AS id",
    );
    if (
      probe.rows.length !== 2 ||
      probe.rows[0]?.id !== "1" ||
      probe.rows[1]?.id !== "2"
    )
      throw new Error("native_upgrade_write_probe");
    const previouslyPaused = current.emergency_stop_enabled;
    let runtimeVersion = Number(current.version);
    if (!previouslyPaused) {
      const changed = await client.query(
        "UPDATE public.runtime_controls SET emergency_stop_enabled=true, emergency_stop_reason=$1, version=version+1, updated_by='native-upgrade', updated_at=clock_timestamp() WHERE id=1 RETURNING version",
        [
          "Native upgrade completed. Review your installation before resuming work.",
        ],
      );
      runtimeVersion = Number(changed.rows[0]?.version);
      if (!Number.isSafeInteger(runtimeVersion) || runtimeVersion < 1)
        throw new Error("native_upgrade_control_missing");
    }
    await client.query("COMMIT");
    return {
      ...before,
      paused: true,
      previouslyPaused,
      runtimeVersion,
      writeAndSequenceProbe: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
import { createHash } from "node:crypto";
