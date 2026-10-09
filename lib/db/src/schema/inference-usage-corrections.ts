import {
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { inferenceResponseEvidenceTable } from "./inference-response-evidence";
import { usageEventsTable } from "./usage-events";
/** Immutable authorization linking one original receipt to verified evidence. */
export const inferenceUsageCorrectionsTable = pgTable(
  "inference_usage_corrections",
  {
    attemptId: uuid("attempt_id")
      .primaryKey()
      .references(() => inferenceResponseEvidenceTable.attemptId, {
        onDelete: "restrict",
      }),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => usageEventsTable.id, { onDelete: "restrict" }),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("inference_usage_corrections_receipt_unique").on(
      table.receiptId,
    ),
  ],
);
