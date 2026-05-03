-- Comment: this is a custom data migration because the journal migration cannot
-- be generated from the target Drizzle schema alone.
WITH legacy_query_journal_entries AS (
	SELECT
		"workflow_commands"."id" AS "id",
		"workflow_commands"."id" AS "commit_id",
		'command' AS "entry_kind",
		"workflow_commands"."family" AS "family",
		"workflow_commands"."organization_id" AS "organization_id",
		COALESCE("workflow_commands"."action_id", "workflow_commands"."id") AS "stream_id",
		"workflow_commands"."created_at" AS "occurred_at",
		"workflow_commands"."actor_snapshot_json" AS "actor_snapshot_json",
		"workflow_commands"."caused_by_event_id" AS "caused_by_event_id",
		"workflow_commands"."command_invocation_id" AS "command_invocation_id",
		NULL::text AS "event_id",
		NULL::text AS "event_type",
		NULL::text AS "effect_id",
		NULL::text AS "effect_type",
		"workflow_commands"."command_payload_bytes" AS "payload_bytes",
		"workflow_commands"."command_type" AS "payload_type",
		"workflow_commands"."request_id" AS "request_id",
		"workflow_commands"."surface" AS "surface",
		COALESCE(MIN("query_action_events"."sequence"), 1)::numeric AS "sort_sequence",
		0 AS "sort_kind"
	FROM "workflow_commands"
	LEFT JOIN "query_action_events"
		ON "query_action_events"."command_id" = "workflow_commands"."id"
	WHERE "workflow_commands"."family" = 'query_action'
	GROUP BY "workflow_commands"."id"
	UNION ALL
	SELECT
		"query_action_events"."id" AS "id",
		"query_action_events"."command_id" AS "commit_id",
		'event' AS "entry_kind",
		'query_action' AS "family",
		"workflow_commands"."organization_id" AS "organization_id",
		"query_action_events"."action_id" AS "stream_id",
		"query_action_events"."occurred_at" AS "occurred_at",
		NULL::jsonb AS "actor_snapshot_json",
		NULL::text AS "caused_by_event_id",
		NULL::text AS "command_invocation_id",
		"query_action_events"."id" AS "event_id",
		"query_action_events"."event_type" AS "event_type",
		NULL::text AS "effect_id",
		NULL::text AS "effect_type",
		"query_action_events"."payload_bytes" AS "payload_bytes",
		"query_action_events"."event_type" AS "payload_type",
		NULL::text AS "request_id",
		NULL::text AS "surface",
		"query_action_events"."sequence"::numeric AS "sort_sequence",
		1 AS "sort_kind"
	FROM "query_action_events"
	INNER JOIN "workflow_commands"
		ON "workflow_commands"."id" = "query_action_events"."command_id"
	WHERE "workflow_commands"."family" = 'query_action'
	UNION ALL
	SELECT
		"workflow_commands"."id" || ':decision_rejected' AS "id",
		"workflow_commands"."id" AS "commit_id",
		'checkpoint' AS "entry_kind",
		"workflow_commands"."family" AS "family",
		"workflow_commands"."organization_id" AS "organization_id",
		COALESCE("workflow_commands"."action_id", "workflow_commands"."id") AS "stream_id",
		"workflow_commands"."created_at" AS "occurred_at",
		NULL::jsonb AS "actor_snapshot_json",
		NULL::text AS "caused_by_event_id",
		NULL::text AS "command_invocation_id",
		NULL::text AS "event_id",
		NULL::text AS "event_type",
		NULL::text AS "effect_id",
		NULL::text AS "effect_type",
		convert_to(jsonb_build_object(
			'actionId', "workflow_commands"."action_id",
			'rejectCode', "workflow_commands"."reject_code",
			'rejectDetail', "workflow_commands"."reject_detail"
		)::text, 'UTF8') AS "payload_bytes",
		'decision_rejected' AS "payload_type",
		NULL::text AS "request_id",
		NULL::text AS "surface",
		2::numeric AS "sort_sequence",
		1 AS "sort_kind"
	FROM "workflow_commands"
	WHERE "workflow_commands"."family" = 'query_action'
		AND "workflow_commands"."decision_kind" = 'rejected'
),
numbered_query_journal_entries AS (
	SELECT
		legacy_query_journal_entries.*,
		row_number() OVER (
			PARTITION BY "family", "stream_id"
			ORDER BY "sort_sequence", "sort_kind", "occurred_at", "id"
		)::integer AS "stream_position"
	FROM legacy_query_journal_entries
)
INSERT INTO "workflow_journal" (
	"id",
	"commit_id",
	"entry_kind",
	"family",
	"organization_id",
	"stream_id",
	"stream_position",
	"occurred_at",
	"actor_snapshot_json",
	"caused_by_event_id",
	"command_invocation_id",
	"event_id",
	"event_type",
	"effect_id",
	"effect_type",
	"payload_bytes",
	"payload_type",
	"request_id",
	"surface"
)
SELECT
	"id",
	"commit_id",
	"entry_kind",
	"family",
	"organization_id",
	"stream_id",
	"stream_position",
	"occurred_at",
	"actor_snapshot_json",
	"caused_by_event_id",
	"command_invocation_id",
	"event_id",
	"event_type",
	"effect_id",
	"effect_type",
	"payload_bytes",
	"payload_type",
	"request_id",
	"surface"
FROM numbered_query_journal_entries
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
WITH legacy_source_api_journal_entries AS (
	SELECT
		"workflow_commands"."id" AS "id",
		"workflow_commands"."id" AS "commit_id",
		'command' AS "entry_kind",
		"workflow_commands"."family" AS "family",
		"workflow_commands"."organization_id" AS "organization_id",
		COALESCE("workflow_commands"."action_id", "workflow_commands"."id") AS "stream_id",
		"workflow_commands"."created_at" AS "occurred_at",
		"workflow_commands"."actor_snapshot_json" AS "actor_snapshot_json",
		"workflow_commands"."caused_by_event_id" AS "caused_by_event_id",
		"workflow_commands"."command_invocation_id" AS "command_invocation_id",
		NULL::text AS "event_id",
		NULL::text AS "event_type",
		NULL::text AS "effect_id",
		NULL::text AS "effect_type",
		"workflow_commands"."command_payload_bytes" AS "payload_bytes",
		"workflow_commands"."command_type" AS "payload_type",
		"workflow_commands"."request_id" AS "request_id",
		"workflow_commands"."surface" AS "surface",
		COALESCE(MIN("source_api_action_events"."sequence"), 1)::numeric AS "sort_sequence",
		0 AS "sort_kind"
	FROM "workflow_commands"
	LEFT JOIN "source_api_action_events"
		ON "source_api_action_events"."command_id" = "workflow_commands"."id"
	WHERE "workflow_commands"."family" = 'source_api_action'
	GROUP BY "workflow_commands"."id"
	UNION ALL
	SELECT
		"source_api_action_events"."id" AS "id",
		"source_api_action_events"."command_id" AS "commit_id",
		'event' AS "entry_kind",
		'source_api_action' AS "family",
		"workflow_commands"."organization_id" AS "organization_id",
		"source_api_action_events"."action_id" AS "stream_id",
		"source_api_action_events"."occurred_at" AS "occurred_at",
		NULL::jsonb AS "actor_snapshot_json",
		NULL::text AS "caused_by_event_id",
		NULL::text AS "command_invocation_id",
		"source_api_action_events"."id" AS "event_id",
		"source_api_action_events"."event_type" AS "event_type",
		NULL::text AS "effect_id",
		NULL::text AS "effect_type",
		"source_api_action_events"."payload_bytes" AS "payload_bytes",
		"source_api_action_events"."event_type" AS "payload_type",
		NULL::text AS "request_id",
		NULL::text AS "surface",
		"source_api_action_events"."sequence"::numeric AS "sort_sequence",
		1 AS "sort_kind"
	FROM "source_api_action_events"
	INNER JOIN "workflow_commands"
		ON "workflow_commands"."id" = "source_api_action_events"."command_id"
	WHERE "workflow_commands"."family" = 'source_api_action'
	UNION ALL
	SELECT
		"workflow_commands"."id" || ':decision_rejected' AS "id",
		"workflow_commands"."id" AS "commit_id",
		'checkpoint' AS "entry_kind",
		"workflow_commands"."family" AS "family",
		"workflow_commands"."organization_id" AS "organization_id",
		COALESCE("workflow_commands"."action_id", "workflow_commands"."id") AS "stream_id",
		"workflow_commands"."created_at" AS "occurred_at",
		NULL::jsonb AS "actor_snapshot_json",
		NULL::text AS "caused_by_event_id",
		NULL::text AS "command_invocation_id",
		NULL::text AS "event_id",
		NULL::text AS "event_type",
		NULL::text AS "effect_id",
		NULL::text AS "effect_type",
		convert_to(jsonb_build_object(
			'actionId', "workflow_commands"."action_id",
			'rejectCode', "workflow_commands"."reject_code",
			'rejectDetail', "workflow_commands"."reject_detail"
		)::text, 'UTF8') AS "payload_bytes",
		'decision_rejected' AS "payload_type",
		NULL::text AS "request_id",
		NULL::text AS "surface",
		2::numeric AS "sort_sequence",
		1 AS "sort_kind"
	FROM "workflow_commands"
	WHERE "workflow_commands"."family" = 'source_api_action'
		AND "workflow_commands"."decision_kind" = 'rejected'
),
numbered_source_api_journal_entries AS (
	SELECT
		legacy_source_api_journal_entries.*,
		row_number() OVER (
			PARTITION BY "family", "stream_id"
			ORDER BY "sort_sequence", "sort_kind", "occurred_at", "id"
		)::integer AS "stream_position"
	FROM legacy_source_api_journal_entries
)
INSERT INTO "workflow_journal" (
	"id",
	"commit_id",
	"entry_kind",
	"family",
	"organization_id",
	"stream_id",
	"stream_position",
	"occurred_at",
	"actor_snapshot_json",
	"caused_by_event_id",
	"command_invocation_id",
	"event_id",
	"event_type",
	"effect_id",
	"effect_type",
	"payload_bytes",
	"payload_type",
	"request_id",
	"surface"
)
SELECT
	"id",
	"commit_id",
	"entry_kind",
	"family",
	"organization_id",
	"stream_id",
	"stream_position",
	"occurred_at",
	"actor_snapshot_json",
	"caused_by_event_id",
	"command_invocation_id",
	"event_id",
	"event_type",
	"effect_id",
	"effect_type",
	"payload_bytes",
	"payload_type",
	"request_id",
	"surface"
FROM numbered_source_api_journal_entries
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DELETE FROM "audit_projection_checkpoints" WHERE "projection_name" = 'audit_feed';--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_effect_dispatches" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "query_action_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_api_action_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_commands" CASCADE;
