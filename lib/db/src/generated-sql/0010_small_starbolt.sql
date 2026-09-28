CREATE TABLE "company_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"sender_type" text NOT NULL,
	"sender_agent_id" integer,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"task_id" integer,
	"reply_to_message_id" integer,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_messages_sender_type_check" CHECK ("company_messages"."sender_type" in ('founder', 'agent')),
	CONSTRAINT "company_messages_source_check" CHECK ("company_messages"."source" in ('operator', 'meeting', 'agent_tool')),
	CONSTRAINT "company_messages_sender_identity_check" CHECK (("company_messages"."sender_type" = 'founder' and "company_messages"."sender_agent_id" is null and "company_messages"."source" = 'operator') or ("company_messages"."sender_type" = 'agent' and "company_messages"."sender_agent_id" is not null and "company_messages"."source" in ('meeting', 'agent_tool'))),
	CONSTRAINT "company_messages_content_check" CHECK (char_length(btrim("company_messages"."content")) between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "company_messages" ADD CONSTRAINT "company_messages_channel_id_company_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."company_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_messages" ADD CONSTRAINT "company_messages_sender_agent_id_agents_id_fk" FOREIGN KEY ("sender_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_messages" ADD CONSTRAINT "company_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_messages" ADD CONSTRAINT "company_messages_reply_to_message_id_company_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."company_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_channels_key_idx" ON "company_channels" USING btree ("key");--> statement-breakpoint
CREATE INDEX "company_messages_channel_created_idx" ON "company_messages" USING btree ("channel_id","created_at","id");--> statement-breakpoint
CREATE INDEX "company_messages_sender_created_idx" ON "company_messages" USING btree ("sender_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "company_messages_task_idx" ON "company_messages" USING btree ("task_id");--> statement-breakpoint
INSERT INTO "company_channels" ("key", "name") VALUES ('company', 'Ortak Şirket Chat')
ON CONFLICT ("key") DO NOTHING;
