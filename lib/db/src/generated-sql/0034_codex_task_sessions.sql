CREATE TABLE "codex_task_sessions" (
	"task_id" integer PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"revision" bigint NOT NULL,
	"state" text NOT NULL,
	"owner_token" uuid,
	"attempt_id" text NOT NULL,
	"lease_owner" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"registration_id" text NOT NULL,
	"registration_revision" bigint NOT NULL,
	"admission_version" integer NOT NULL,
	"host_id" text NOT NULL,
	"cwd" text NOT NULL,
	"storage_directory" text NOT NULL,
	"home" text NOT NULL,
	"model" text NOT NULL,
	"executable_digest" text NOT NULL,
	"thread_id" text,
	"last_turn_id" text,
	"prompt_tokens" bigint,
	"completion_tokens" bigint,
	"total_tokens" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codex_task_sessions_state" CHECK ("codex_task_sessions"."state" IN ('running','ready','uncertain') AND (("codex_task_sessions"."state" = 'running' AND "codex_task_sessions"."owner_token" IS NOT NULL) OR ("codex_task_sessions"."state" <> 'running' AND "codex_task_sessions"."owner_token" IS NULL))),
	CONSTRAINT "codex_task_sessions_revision" CHECK ("codex_task_sessions"."revision" BETWEEN 1 AND 9007199254740991 AND "codex_task_sessions"."registration_revision" BETWEEN 1 AND 9007199254740991 AND "codex_task_sessions"."policy_revision" > 0 AND "codex_task_sessions"."admission_version" >= 0),
	CONSTRAINT "codex_task_sessions_identifiers" CHECK ("codex_task_sessions"."attempt_id" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_task_sessions"."lease_owner" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_task_sessions"."registration_id" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND octet_length("codex_task_sessions"."host_id") BETWEEN 1 AND 512 AND octet_length("codex_task_sessions"."model") BETWEEN 1 AND 160 AND "codex_task_sessions"."executable_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "codex_task_sessions_paths" CHECK (octet_length("codex_task_sessions"."cwd") BETWEEN 1 AND 4096 AND octet_length("codex_task_sessions"."storage_directory") BETWEEN 1 AND 4096 AND octet_length("codex_task_sessions"."home") BETWEEN 1 AND 4096),
	CONSTRAINT "codex_task_sessions_checkpoint" CHECK ((("codex_task_sessions"."thread_id" IS NULL AND "codex_task_sessions"."last_turn_id" IS NULL AND "codex_task_sessions"."prompt_tokens" IS NULL AND "codex_task_sessions"."completion_tokens" IS NULL AND "codex_task_sessions"."total_tokens" IS NULL) OR ("codex_task_sessions"."thread_id" IS NOT NULL AND "codex_task_sessions"."last_turn_id" IS NOT NULL AND "codex_task_sessions"."thread_id" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_task_sessions"."last_turn_id" ~ '^[a-zA-Z0-9_:-]{1,160}$'))),
	CONSTRAINT "codex_task_sessions_usage" CHECK ((("codex_task_sessions"."prompt_tokens" IS NULL AND "codex_task_sessions"."completion_tokens" IS NULL AND "codex_task_sessions"."total_tokens" IS NULL) OR ("codex_task_sessions"."prompt_tokens" IS NOT NULL AND "codex_task_sessions"."completion_tokens" IS NOT NULL AND "codex_task_sessions"."total_tokens" IS NOT NULL AND "codex_task_sessions"."prompt_tokens" BETWEEN 0 AND 9007199254740991 AND "codex_task_sessions"."completion_tokens" BETWEEN 0 AND 9007199254740991 AND "codex_task_sessions"."total_tokens" BETWEEN 0 AND 9007199254740991 AND "codex_task_sessions"."total_tokens" >= "codex_task_sessions"."prompt_tokens" AND "codex_task_sessions"."total_tokens" >= "codex_task_sessions"."completion_tokens")))
);
--> statement-breakpoint
ALTER TABLE "codex_task_sessions" ADD CONSTRAINT "codex_task_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_task_sessions" ADD CONSTRAINT "codex_task_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;