UPDATE "workflow_commands"
SET "command_type" = 'record_source_query_interface_missing'
WHERE "family" = 'query_action'
	AND "command_type" = 'record_source_not_queryable';
--> statement-breakpoint
UPDATE "query_action_events"
SET "event_type" = 'source_query_interface_missing'
WHERE "event_type" = 'source_not_queryable';
--> statement-breakpoint
UPDATE "query_actions"
SET "failure_code" = 'source_query_interface_missing'
WHERE "failure_code" = 'source_not_queryable';
--> statement-breakpoint
UPDATE "audit_feed_entries"
SET
	"failure_code" = CASE
		WHEN "failure_code" = 'source_not_queryable'
			THEN 'source_query_interface_missing'
		ELSE "failure_code"
	END,
	"last_event_type" = CASE
		WHEN "last_event_type" = 'source_not_queryable'
			THEN 'source_query_interface_missing'
		ELSE "last_event_type"
	END,
	"search_document" = replace(
		"search_document",
		'source_not_queryable',
		'source_query_interface_missing'
	)
WHERE "family" = 'query_action'
	AND (
		"failure_code" = 'source_not_queryable'
		OR "last_event_type" = 'source_not_queryable'
		OR "search_document" LIKE '%source_not_queryable%'
	);
