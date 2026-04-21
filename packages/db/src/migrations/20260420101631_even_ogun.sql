DROP TABLE "cli_query_actions" CASCADE;--> statement-breakpoint
DROP TABLE "cli_query_action_events" CASCADE;--> statement-breakpoint
ALTER TABLE "query_action_events" DROP CONSTRAINT "query_action_events_action_id_query_actions_id_fk";
--> statement-breakpoint
ALTER TABLE "source_api_action_events" DROP CONSTRAINT "source_api_action_events_action_id_source_api_actions_id_fk";
