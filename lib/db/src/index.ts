import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePostgres } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import { attachPostgresPoolErrorHandler } from "./postgres-pool-errors";
import * as schema from "./schema";

/**
 * Production uses durable PostgreSQL and applies the checked-in migration
 * chain before the API starts listening. Development without DATABASE_URL
 * uses process-lifetime PGlite and the exact same migration chain.
 */

const { Pool } = pg;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_LOCK_CLASS = 1_095_714_119;
const MIGRATION_LOCK_INSTANCE = 1;

type Db = NodePgDatabase<typeof schema>;

let postgresPool: pg.Pool | null = null;
let embeddedClient: import("@electric-sql/pglite").PGlite | null = null;
let databaseClosed = false;
let databaseClosePromise: Promise<void> | null = null;

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function migrationsFolder(): string {
  const configured = process.env.DATABASE_MIGRATIONS_DIR;
  if (configured && !path.isAbsolute(configured)) {
    throw new Error("DATABASE_MIGRATIONS_DIR must be an absolute path.");
  }
  const candidates = [
    configured,
    path.join(moduleDirectory, "db-migrations"),
    path.join(moduleDirectory, "generated-sql"),
    path.resolve(process.cwd(), "lib", "db", "src", "generated-sql"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "meta", "_journal.json")) &&
      fs.readdirSync(candidate).some((name) => name.endsWith(".sql"))
    ) {
      return candidate;
    }
  }
  throw new Error(
    "Checked-in database migrations were not found. Set DATABASE_MIGRATIONS_DIR to their absolute directory.",
  );
}

function createPostgresPool(connectionString: string): pg.Pool {
  const pool = new Pool({
    connectionString,
    max: integerEnvironment("DATABASE_POOL_MAX", 10, 1, 100),
    connectionTimeoutMillis: integerEnvironment(
      "DATABASE_CONNECT_TIMEOUT_MS",
      10_000,
      1_000,
      120_000,
    ),
    idleTimeoutMillis: integerEnvironment(
      "DATABASE_IDLE_TIMEOUT_MS",
      30_000,
      1_000,
      10 * 60_000,
    ),
    statement_timeout: integerEnvironment(
      "DATABASE_STATEMENT_TIMEOUT_MS",
      60_000,
      1_000,
      30 * 60_000,
    ),
    application_name: "agentic-company-os",
  });
  attachPostgresPoolErrorHandler(pool);
  return pool;
}

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production" && !databaseUrl) {
  throw new Error(
    "DATABASE_URL is required in production; embedded PGlite is development-only.",
  );
}

if (databaseUrl) postgresPool = createPostgresPool(databaseUrl);

// PGlite is attached in-place after its dynamic import. Every caller must await
// dbReady; the API startup and tests do so before issuing a query.
export const db: Db = postgresPool
  ? drizzle(postgresPool, { schema })
  : drizzle({} as pg.Pool, { schema });

async function migratePostgres(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  let migrationLockHeld = false;
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      MIGRATION_LOCK_CLASS,
      MIGRATION_LOCK_INSTANCE,
    ]);
    migrationLockHeld = true;
    const existing = await client.query<{
      app_table: string | null;
      migration_table: string | null;
    }>(
      "SELECT to_regclass('public.agents')::text AS app_table, to_regclass('drizzle.__drizzle_migrations')::text AS migration_table",
    );
    if (existing.rows[0]?.app_table && !existing.rows[0]?.migration_table) {
      throw new Error(
        "Existing schema has no Drizzle migration journal. Refusing an unsafe automatic baseline; follow the documented legacy-database upgrade procedure.",
      );
    }
    await migrateNodePostgres(drizzle(client, { schema }), {
      migrationsFolder: migrationsFolder(),
    });
  } finally {
    try {
      if (migrationLockHeld) {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [
          MIGRATION_LOCK_CLASS,
          MIGRATION_LOCK_INSTANCE,
        ]);
      }
    } finally {
      client.release();
    }
  }
}

async function initializeDatabase(): Promise<void> {
  if (postgresPool) {
    await migratePostgres(postgresPool);
    return;
  }
  console.warn(
    "[db] DATABASE_URL is absent; using process-lifetime PGlite for local development only.",
  );
  const { PGlite } = await import("@electric-sql/pglite");
  embeddedClient = new PGlite();
  const embeddedDb = drizzlePglite(embeddedClient, { schema });
  await migratePglite(embeddedDb, { migrationsFolder: migrationsFolder() });
  Object.assign(db, embeddedDb as unknown as Db);
}

/** Resolves only after connectivity and all checked-in migrations succeed. */
export const dbReady: Promise<void> = initializeDatabase();

export async function checkDatabaseReady(): Promise<boolean> {
  if (databaseClosed) return false;
  try {
    await dbReady;
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export function closeDatabase(): Promise<void> {
  if (databaseClosePromise) return databaseClosePromise;
  databaseClosed = true;
  databaseClosePromise = (async () => {
    // Initialization creates the embedded client asynchronously and may still
    // be migrating it. Join that work before releasing either backend, even
    // when initialization fails. Concurrent callers join the same shutdown.
    await dbReady.catch(() => undefined);
    await Promise.all([
      postgresPool?.end() ?? Promise.resolve(),
      embeddedClient?.close() ?? Promise.resolve(),
    ]);
  })();
  return databaseClosePromise;
}

export const databaseBackend = databaseUrl ? "postgresql" : "pglite";

export * from "./schema";
