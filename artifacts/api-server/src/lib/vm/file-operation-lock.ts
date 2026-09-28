import { sql } from "drizzle-orm";
import { databaseBackend, db, dbReady } from "@workspace/db";
import type { RuntimeTransaction } from "../orchestrator/runtime-emergency-stop";

export type FileEffectHook = (() => Promise<void>) & {
  revalidate?: (tx?: RuntimeTransaction) => Promise<void>;
};

const FILE_OPERATION_LOCK_CLASS = 0x41434f46;
const queues = new Map<number, Promise<void>>();

/** Cooperating filesystem writers share this lock, including API and worker.
 * Initial admission commits BEFORE entering it. Durable revalidation inside
 * the lock must use its transaction, never request another pool connection.
 * Filesystem effects are not rolled back if the database connection is lost.
 */
export async function withFileOperationLock<T>(
  agentId: number,
  action: (tx?: RuntimeTransaction) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(agentId) || agentId <= 0 || agentId > 2147483647)
    throw new Error("Invalid workspace identity");
  const previous = queues.get(agentId) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => pending);
  queues.set(agentId, tail);
  await previous.catch(() => undefined);
  try {
    if (databaseBackend !== "postgresql") return await action();
    await dbReady;
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${FILE_OPERATION_LOCK_CLASS}, ${agentId})`,
      );
      return action(tx);
    });
  } finally {
    release();
    if (queues.get(agentId) === tail) queues.delete(agentId);
  }
}
