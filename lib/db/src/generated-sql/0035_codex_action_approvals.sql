CREATE TABLE "codex_action_approvals" (
	"approval_id" integer PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"session_revision" bigint NOT NULL,
	"session_owner_token" uuid NOT NULL,
	"attempt_id" text NOT NULL,
	"lease_owner" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"registration_id" text NOT NULL,
	"registration_revision" bigint NOT NULL,
	"admission_version" integer NOT NULL,
	"thread_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"item_id" text NOT NULL,
	"request_key" text NOT NULL,
	"action_started_at_ms" bigint NOT NULL,
	"action_revision" integer NOT NULL,
	"action_digest" text NOT NULL,
	"effect_type" text NOT NULL,
	"state" text NOT NULL,
	"decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	"native_status" text,
	"native_exit_code" integer,
	"native_completed_at_ms" bigint,
	CONSTRAINT "codex_action_approvals_bounds" CHECK ("codex_action_approvals"."session_revision" BETWEEN 1 AND 9007199254740991 AND "codex_action_approvals"."registration_revision" BETWEEN 1 AND 9007199254740991 AND "codex_action_approvals"."policy_revision" > 0 AND "codex_action_approvals"."admission_version" >= 0 AND "codex_action_approvals"."action_revision" > 0 AND "codex_action_approvals"."action_started_at_ms" BETWEEN 0 AND 9007199254740991 AND "codex_action_approvals"."expires_at" > "codex_action_approvals"."created_at"),
	CONSTRAINT "codex_action_approvals_scope" CHECK ("codex_action_approvals"."attempt_id" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_action_approvals"."lease_owner" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_action_approvals"."registration_id" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_action_approvals"."thread_id" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_action_approvals"."turn_id" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_action_approvals"."item_id" ~ '^[a-zA-Z0-9_:-]{1,160}$' AND "codex_action_approvals"."request_key" ~ '^(string:[a-zA-Z0-9_:-]{1,160}|number:[0-9]{1,16})$' AND "codex_action_approvals"."action_digest" ~ '^[a-f0-9]{64}$' AND "codex_action_approvals"."effect_type" IN ('commandExecution','fileChange')),
	CONSTRAINT "codex_action_approvals_invalidation" CHECK ((("codex_action_approvals"."invalidated_at" IS NULL AND "codex_action_approvals"."invalidation_reason" IS NULL AND "codex_action_approvals"."state" NOT IN ('invalidated','uncertain')) OR ("codex_action_approvals"."invalidated_at" IS NOT NULL AND "codex_action_approvals"."invalidation_reason" IS NOT NULL AND "codex_action_approvals"."invalidation_reason" ~ '^[a-z_]{1,80}$' AND "codex_action_approvals"."state" IN ('invalidated','uncertain')))),
	CONSTRAINT "codex_action_approvals_consumption" CHECK ((("codex_action_approvals"."state" IN ('awaiting','invalidated') AND "codex_action_approvals"."consumed_at" IS NULL AND "codex_action_approvals"."decision" IS NULL) OR ("codex_action_approvals"."state" IN ('consumed','receipted','uncertain') AND "codex_action_approvals"."consumed_at" IS NOT NULL AND "codex_action_approvals"."decision" IS NOT NULL AND "codex_action_approvals"."decision" IN ('accept','decline','cancel')))),
	CONSTRAINT "codex_action_approvals_receipt" CHECK ((("codex_action_approvals"."state" <> 'receipted' AND "codex_action_approvals"."native_status" IS NULL AND "codex_action_approvals"."native_exit_code" IS NULL AND "codex_action_approvals"."native_completed_at_ms" IS NULL) OR ("codex_action_approvals"."state" = 'receipted' AND "codex_action_approvals"."native_status" IS NOT NULL AND "codex_action_approvals"."native_status" IN ('completed','failed','declined') AND "codex_action_approvals"."native_completed_at_ms" IS NOT NULL AND "codex_action_approvals"."native_completed_at_ms" BETWEEN "codex_action_approvals"."action_started_at_ms" AND 9007199254740991 AND (("codex_action_approvals"."effect_type" = 'fileChange' AND "codex_action_approvals"."native_exit_code" IS NULL) OR ("codex_action_approvals"."effect_type" = 'commandExecution' AND ("codex_action_approvals"."native_status" <> 'completed' OR ("codex_action_approvals"."native_exit_code" IS NOT NULL AND "codex_action_approvals"."native_exit_code" = 0)))) AND ("codex_action_approvals"."decision" = 'accept' OR "codex_action_approvals"."native_status" <> 'completed'))))
);
--> statement-breakpoint
ALTER TABLE "codex_action_approvals" ADD CONSTRAINT "codex_action_approvals_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_action_approvals" ADD CONSTRAINT "codex_action_approvals_task_id_codex_task_sessions_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."codex_task_sessions"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_action_approvals" ADD CONSTRAINT "codex_action_approvals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "codex_action_approvals_live_task" ON "codex_action_approvals" USING btree ("task_id") WHERE "codex_action_approvals"."state" IN ('awaiting','consumed');--> statement-breakpoint
CREATE UNIQUE INDEX "codex_action_approvals_native_request" ON "codex_action_approvals" USING btree ("session_owner_token","thread_id","turn_id","request_key");--> statement-breakpoint
CREATE INDEX "codex_action_approvals_task_created" ON "codex_action_approvals" USING btree ("task_id","created_at");