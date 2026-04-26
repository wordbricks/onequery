ALTER TABLE "query_action_events" ADD COLUMN "payload_bytes" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "source_api_action_events" ADD COLUMN "payload_bytes" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_commands" ADD COLUMN "command_payload_bytes" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_effect_dispatches" ADD COLUMN "payload_bytes" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "query_action_events" DROP COLUMN "payload_json";--> statement-breakpoint
ALTER TABLE "source_api_action_events" DROP COLUMN "payload_json";--> statement-breakpoint
ALTER TABLE "workflow_commands" DROP COLUMN "command_payload_json";--> statement-breakpoint
ALTER TABLE "workflow_effect_dispatches" DROP COLUMN "payload_json";