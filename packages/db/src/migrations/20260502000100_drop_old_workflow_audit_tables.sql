-- Comment: this is a custom data migration because the journal migration cannot
-- be generated from the target Drizzle schema alone.
--
-- Drop legacy workflow/audit history instead of backfilling it. The old runtime
-- command payloads are not part of the new composite journal contract, so
-- preserving them would create decode/replay compatibility risk.
DELETE FROM "audit_feed_entries";--> statement-breakpoint
DELETE FROM "query_actions";--> statement-breakpoint
DELETE FROM "source_api_actions";--> statement-breakpoint
DELETE FROM "audit_projection_checkpoints"
WHERE "projection_name" IN ('audit_feed', 'audit_feed_entries');--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_effect_dispatches" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "query_action_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_api_action_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_commands" CASCADE;
