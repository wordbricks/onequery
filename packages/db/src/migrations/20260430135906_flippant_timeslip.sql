ALTER TABLE "workflow_journal" ADD COLUMN "actor_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_journal" ADD COLUMN "caused_by_event_id" text;--> statement-breakpoint
ALTER TABLE "workflow_journal" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "workflow_journal" ADD COLUMN "surface" text;