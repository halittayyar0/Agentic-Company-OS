import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const localModelPreparationStates = [
  "requested",
  "downloading",
  "verifying",
  "stopping",
  "ready",
  "interrupted",
  "failed",
] as const;
export type LocalModelPreparationState =
  (typeof localModelPreparationStates)[number];
export const localModelPreparationFailureCodes = [
  "INTERRUPTED",
  "CONFIG_CHANGED",
  "SERVER_UNAVAILABLE",
  "RUNTIME_UPDATE_REQUIRED",
  "MODEL_UNVERIFIED",
  "DISPATCH_FAILED",
  "DEADLINE_EXCEEDED",
  "INVALID_PROGRESS",
  "FRAME_TOO_LARGE",
  "TOO_MANY_LAYERS",
  "MODEL_TOO_LARGE",
  "UPSTREAM_ERROR",
  "INCOMPLETE_PROGRESS",
  "STREAM_FAILED",
] as const;
export type LocalModelPreparationFailureCode =
  (typeof localModelPreparationFailureCodes)[number];

// Operator receipts survive backup/restart; no prompts, provider URLs or raw errors.
export const localModelPreparationsTable = pgTable(
  "local_model_preparations",
  {
    requestId: uuid("request_id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    modelId: text("model_id").$type<"qwen35-2b">().notNull(),
    providerRevision: bigint("provider_revision", { mode: "number" }).notNull(),
    state: text("state").$type<LocalModelPreparationState>().notNull(),
    phase: text("phase")
      .$type<"preparing" | "downloading" | "checking" | "downloaded">()
      .notNull()
      .default("preparing"),
    observedCompletedBytes: bigint("observed_completed_bytes", {
      mode: "number",
    })
      .notNull()
      .default(0),
    observedTotalBytes: bigint("observed_total_bytes", { mode: "number" })
      .notNull()
      .default(0),
    progressReset: boolean("progress_reset").notNull().default(false),
    ownerRuntimeId: text("owner_runtime_id").notNull(),
    ownerEpoch: uuid("owner_epoch").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    failureCode: text("failure_code").$type<LocalModelPreparationFailureCode>(),
    resultModelId: text("result_model_id"),
    resultDigest: text("result_digest"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("local_model_preparations_one_active")
      .on(sql`(1)`)
      .where(
        sql`${t.state} in ('requested','downloading','verifying','stopping')`,
      ),
    index("local_model_preparations_created_idx").on(t.createdAt),
    check(
      "local_model_preparations_hash_check",
      sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "local_model_preparations_recipe_check",
      sql`${t.modelId} = 'qwen35-2b' and ${t.providerRevision} between 0 and 9007199254740991`,
    ),
    check(
      "local_model_preparations_state_check",
      sql`${t.state} in ('requested','downloading','verifying','stopping','ready','interrupted','failed') and ${t.phase} in ('preparing','downloading','checking','downloaded')`,
    ),
    check(
      "local_model_preparations_bytes_check",
      sql`${t.observedCompletedBytes} >= 0 and ${t.observedTotalBytes} between ${t.observedCompletedBytes} and 3221225472`,
    ),
    check(
      "local_model_preparations_owner_check",
      sql`octet_length(${t.ownerRuntimeId}) between 1 and 256`,
    ),
    check(
      "local_model_preparations_outcome_check",
      sql`coalesce(
    (${t.state} in ('requested','downloading','verifying','stopping') and ${t.failureCode} is null and ${t.finishedAt} is null and ${t.resultModelId} is null and ${t.resultDigest} is null)
    or (${t.state} = 'ready' and ${t.failureCode} is null and ${t.finishedAt} is not null and ${t.resultModelId} = 'ollama:qwen3.5:2b-q4_K_M' and ${t.resultDigest} ~ '^sha256:[a-f0-9]{64}$')
    or (${t.state} in ('failed','interrupted') and ${t.failureCode} in ('INTERRUPTED','CONFIG_CHANGED','SERVER_UNAVAILABLE','RUNTIME_UPDATE_REQUIRED','MODEL_UNVERIFIED','DISPATCH_FAILED','DEADLINE_EXCEEDED','INVALID_PROGRESS','FRAME_TOO_LARGE','TOO_MANY_LAYERS','MODEL_TOO_LARGE','UPSTREAM_ERROR','INCOMPLETE_PROGRESS','STREAM_FAILED') and ${t.finishedAt} is not null and ${t.resultModelId} is null and ${t.resultDigest} is null), false)`,
    ),
  ],
);
