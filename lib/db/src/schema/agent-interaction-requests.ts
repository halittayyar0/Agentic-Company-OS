import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// No foreign key: deleting a conversation must never permit its send identity
// to dispatch another turn. Receipts are backed up with the workspace.
export const agentInteractionRequestsTable = pgTable(
  "agent_interaction_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_interaction_requests_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
    check("agent_interaction_requests_agent_check", sql`${table.agentId} > 0`),
    check(
      "agent_interaction_requests_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "agent_interaction_requests_response_check",
      sql`jsonb_typeof(${table.response}) = 'object' AND coalesce(${table.response}->>'deliveryState' IN ('complete','unconfirmed','rejected'), false)`,
    ),
  ],
);
