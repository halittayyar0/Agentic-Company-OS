import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** One durable host identity and transaction lock shared by API and workers. */
export const chatgptRegistrationLocksTable = pgTable(
  "chatgpt_registration_locks",
  {
    singletonId: integer("singleton_id").primaryKey().default(1),
    hostId: text("host_id").notNull().unique(),
    activeRegistrationId: uuid("active_registration_id"),
  },
  (table) => [
    check(
      "chatgpt_registration_lock_singleton_check",
      sql`${table.singletonId} = 1`,
    ),
    check(
      "chatgpt_registration_host_check",
      sql`${table.hostId} ~ '^urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'`,
    ),
  ],
);

/** Only authenticated ciphertext and keyed identity digests enter PostgreSQL. */
export const chatgptRegistrationsTable = pgTable(
  "chatgpt_registrations",
  {
    id: uuid("id").primaryKey(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    accountDigest: text("account_digest").notNull().unique(),
    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    authTag: text("auth_tag").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chatgpt_registration_revision_check",
      sql`${table.revision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "chatgpt_registration_digest_check",
      sql`${table.accountDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "chatgpt_registration_envelope_check",
      sql`octet_length(${table.ciphertext}) BETWEEN 1 AND 125000 AND octet_length(${table.nonce}) = 16 AND octet_length(${table.authTag}) = 22`,
    ),
  ],
);
