CREATE TABLE "provider_runtime_config_acks" (
	"runtime_instance_id" text PRIMARY KEY NOT NULL,
	"runtime_started_at" timestamp with time zone NOT NULL,
	"attempted_revision" bigint NOT NULL,
	"applied_revision" bigint DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"sanitized_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_runtime_config_acks_state_check" CHECK ("provider_runtime_config_acks"."state" in ('applied', 'failed')),
	CONSTRAINT "provider_runtime_config_acks_revision_check" CHECK ("provider_runtime_config_acks"."attempted_revision" >= 1 and "provider_runtime_config_acks"."applied_revision" >= 0 and "provider_runtime_config_acks"."applied_revision" <= "provider_runtime_config_acks"."attempted_revision"),
	CONSTRAINT "provider_runtime_config_acks_error_check" CHECK ((
        ("provider_runtime_config_acks"."state" = 'applied' and "provider_runtime_config_acks"."applied_revision" = "provider_runtime_config_acks"."attempted_revision" and "provider_runtime_config_acks"."sanitized_error" is null)
        or ("provider_runtime_config_acks"."state" = 'failed' and "provider_runtime_config_acks"."sanitized_error" is not null and octet_length("provider_runtime_config_acks"."sanitized_error") between 1 and 1024)
      ))
);
--> statement-breakpoint
CREATE TABLE "provider_runtime_config" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" bigint NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"auth_tag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_runtime_config_singleton_check" CHECK ("provider_runtime_config"."singleton_id" = 1),
	CONSTRAINT "provider_runtime_config_revision_check" CHECK ("provider_runtime_config"."revision" >= 1),
	CONSTRAINT "provider_runtime_config_envelope_check" CHECK (octet_length("provider_runtime_config"."ciphertext") between 1 and 4096
        and octet_length("provider_runtime_config"."nonce") between 16 and 64
        and octet_length("provider_runtime_config"."auth_tag") between 16 and 64)
);
--> statement-breakpoint
CREATE TABLE "runtime_browser_sessions" (
	"agent_id" integer PRIMARY KEY NOT NULL,
	"runtime_instance_id" text NOT NULL,
	"runtime_started_at" timestamp with time zone NOT NULL,
	"browser_session_id" text NOT NULL,
	"browser_session_epoch" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_browser_sessions_epoch_check" CHECK ("runtime_browser_sessions"."browser_session_epoch" > 0),
	CONSTRAINT "runtime_browser_sessions_bounded_text_check" CHECK (octet_length("runtime_browser_sessions"."browser_session_id") between 1 and 256)
);
--> statement-breakpoint
CREATE TABLE "runtime_control_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_runtime_instance_id" text NOT NULL,
	"target_runtime_started_at" timestamp with time zone NOT NULL,
	"agent_id" integer NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"payload_digest" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_digest" text,
	"failure_kind" text,
	"sanitized_error" text,
	CONSTRAINT "runtime_control_commands_kind_check" CHECK ("runtime_control_commands"."kind" in ('browser_control_state', 'browser_take_over', 'browser_heartbeat', 'browser_release', 'browser_view', 'browser_navigate', 'browser_input', 'browser_close')),
	CONSTRAINT "runtime_control_commands_state_check" CHECK ("runtime_control_commands"."state" in ('queued', 'dispatched', 'succeeded', 'failed', 'unknown', 'expired')),
	CONSTRAINT "runtime_control_commands_timestamps_check" CHECK ((
        ("runtime_control_commands"."state" = 'queued' and "runtime_control_commands"."dispatched_at" is null and "runtime_control_commands"."finished_at" is null)
        or ("runtime_control_commands"."state" = 'dispatched' and "runtime_control_commands"."dispatched_at" is not null and "runtime_control_commands"."finished_at" is null)
        or ("runtime_control_commands"."state" in ('succeeded', 'failed', 'unknown', 'expired') and "runtime_control_commands"."finished_at" is not null)
      )),
	CONSTRAINT "runtime_control_commands_expiry_check" CHECK ("runtime_control_commands"."expires_at" > "runtime_control_commands"."requested_at"),
	CONSTRAINT "runtime_control_commands_bounded_text_check" CHECK (octet_length("runtime_control_commands"."payload_digest") between 32 and 256
        and ("runtime_control_commands"."result_digest" is null or octet_length("runtime_control_commands"."result_digest") between 32 and 256)
        and ("runtime_control_commands"."failure_kind" is null or octet_length("runtime_control_commands"."failure_kind") between 1 and 128)
        and ("runtime_control_commands"."sanitized_error" is null or octet_length("runtime_control_commands"."sanitized_error") between 1 and 1024))
);
--> statement-breakpoint
ALTER TABLE "provider_runtime_config_acks" ADD CONSTRAINT "provider_runtime_config_acks_runtime_instance_id_runtime_instances_id_fk" FOREIGN KEY ("runtime_instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_browser_sessions" ADD CONSTRAINT "runtime_browser_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_browser_sessions" ADD CONSTRAINT "runtime_browser_sessions_runtime_instance_id_runtime_instances_id_fk" FOREIGN KEY ("runtime_instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_control_commands" ADD CONSTRAINT "runtime_control_commands_target_runtime_instance_id_runtime_instances_id_fk" FOREIGN KEY ("target_runtime_instance_id") REFERENCES "public"."runtime_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_control_commands" ADD CONSTRAINT "runtime_control_commands_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_runtime_config_acks_revision_idx" ON "provider_runtime_config_acks" USING btree ("attempted_revision","state");--> statement-breakpoint
CREATE INDEX "runtime_browser_sessions_runtime_idx" ON "runtime_browser_sessions" USING btree ("runtime_instance_id");--> statement-breakpoint
CREATE INDEX "runtime_browser_sessions_observed_idx" ON "runtime_browser_sessions" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "runtime_control_commands_target_state_idx" ON "runtime_control_commands" USING btree ("target_runtime_instance_id","state","requested_at");--> statement-breakpoint
CREATE INDEX "runtime_control_commands_agent_idx" ON "runtime_control_commands" USING btree ("agent_id","requested_at");
