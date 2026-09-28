import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Independent of live messages so purging history cannot make an old request
// dispatch another model round. Back up receipts together with the workspace.
export const companyMessageRequestsTable = pgTable(
  "company_message_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "company_message_requests_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "company_message_requests_response_check",
      sql`jsonb_typeof(${table.response}) = 'object' AND coalesce(${table.response}->>'deliveryState' IN ('complete', 'unconfirmed'), false)`,
    ),
  ],
);
