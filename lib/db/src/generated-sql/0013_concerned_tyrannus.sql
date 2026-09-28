CREATE TABLE "company_channel_members" (
	"channel_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_channel_members_pk" PRIMARY KEY("channel_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "company_channel_members" ADD CONSTRAINT "company_channel_members_channel_id_company_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."company_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_channel_members" ADD CONSTRAINT "company_channel_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_channel_members_agent_idx" ON "company_channel_members" USING btree ("agent_id");--> statement-breakpoint
INSERT INTO "company_channel_members" ("channel_id", "agent_id")
SELECT channel_row."id", agent_row."id"
FROM "company_channels" AS channel_row
CROSS JOIN "agents" AS agent_row
WHERE channel_row."key" = 'company' AND agent_row."is_active" = true
ON CONFLICT ("channel_id", "agent_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "company_messages" DROP CONSTRAINT "company_messages_source_check";--> statement-breakpoint
ALTER TABLE "company_messages" DROP CONSTRAINT "company_messages_sender_identity_check";--> statement-breakpoint
ALTER TABLE "company_messages" ADD CONSTRAINT "company_messages_source_check" CHECK ("company_messages"."source" in ('operator', 'meeting', 'room_reply', 'agent_tool'));--> statement-breakpoint
ALTER TABLE "company_messages" ADD CONSTRAINT "company_messages_sender_identity_check" CHECK (("company_messages"."sender_type" = 'founder' and "company_messages"."sender_agent_id" is null and "company_messages"."source" = 'operator') or ("company_messages"."sender_type" = 'agent' and "company_messages"."sender_agent_id" is not null and "company_messages"."source" in ('meeting', 'room_reply', 'agent_tool')));
