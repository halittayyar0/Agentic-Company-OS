import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { attachPostgresPoolErrorHandler } from "./postgres-pool-errors";

test("idle PostgreSQL client errors are handled without logging connection secrets", () => {
  const pool = new EventEmitter();
  const records: unknown[] = [];
  attachPostgresPoolErrorHandler(pool, (record) => records.push(record));

  assert.doesNotThrow(() => {
    pool.emit(
      "error",
      Object.assign(
        new Error(
          "connection to postgresql://agentic:must-not-leak@127.0.0.1/db failed",
        ),
        { code: "57P01" },
      ),
    );
  });
  assert.deepEqual(records, [
    {
      event: "postgres_idle_connection_error",
      code: "57P01",
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(records),
    /must-not-leak|postgresql:\/\//iu,
  );
});

test("PostgreSQL pool error codes are bounded to a safe diagnostic token", () => {
  const pool = new EventEmitter();
  const records: unknown[] = [];
  attachPostgresPoolErrorHandler(pool, (record) => records.push(record));

  pool.emit(
    "error",
    Object.assign(new Error("sensitive"), { code: "x".repeat(200) }),
  );

  assert.deepEqual(records, [
    {
      event: "postgres_idle_connection_error",
      code: "UNKNOWN",
    },
  ]);
});

test("checked-out PostgreSQL clients retain a non-throwing error listener", () => {
  const pool = new EventEmitter();
  const client = new EventEmitter();
  attachPostgresPoolErrorHandler(pool);

  pool.emit("connect", client);

  assert.doesNotThrow(() => {
    client.emit(
      "error",
      Object.assign(new Error("active query connection dropped"), {
        code: "57P01",
      }),
    );
  });
});
