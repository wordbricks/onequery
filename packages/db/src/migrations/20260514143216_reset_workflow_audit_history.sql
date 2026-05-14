-- Comment: this internal workflow/audit history uses protobuf payload bytes.
-- The provider catalog migration intentionally changed those durable payload
-- shapes, so replaying old rows with the new codecs would create decode risk.
-- These tables back internal test tooling only, so reset the history instead
-- of carrying compatibility shims for the old payload contract.
DELETE FROM "pending_workflow_effects"
WHERE "family" IN ('query_action', 'source_api_action');--> statement-breakpoint

DELETE FROM "audit_feed_entries"
WHERE "family" IN ('query_action', 'source_api_action');--> statement-breakpoint

DELETE FROM "query_actions";--> statement-breakpoint
DELETE FROM "source_api_actions";--> statement-breakpoint

DELETE FROM "audit_projection_checkpoints"
WHERE "projection_name" IN ('audit_feed', 'audit_feed_entries')
  AND "family" IN ('query_action', 'source_api_action');--> statement-breakpoint

DELETE FROM "workflow_journal"
WHERE "family" IN ('query_action', 'source_api_action');
