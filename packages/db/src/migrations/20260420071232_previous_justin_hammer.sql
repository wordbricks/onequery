CREATE TABLE "audit_projection_checkpoints" (
	"family" text NOT NULL,
	"last_commit_position" bigint DEFAULT 0 NOT NULL,
	"projection_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_projection_checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "query_actions" (
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"id" text PRIMARY KEY NOT NULL,
	"last_event_id" text NOT NULL,
	"last_event_sequence" integer NOT NULL,
	"organization_id" text NOT NULL,
	"outcome" text NOT NULL,
	"phase" text NOT NULL,
	"query_mode" text NOT NULL,
	"query_text" text NOT NULL,
	"source_descriptor_json" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"usage_recording_status" text NOT NULL,
	"validated_query" text,
	CONSTRAINT "query_actions_completed_at_outcome_check" CHECK ((("query_actions"."outcome" = 'pending' and "query_actions"."completed_at" is null) or ("query_actions"."outcome" <> 'pending' and "query_actions"."completed_at" is not null))),
	CONSTRAINT "query_actions_completed_phase_outcome_check" CHECK ((("query_actions"."outcome" = 'pending' and "query_actions"."phase" <> 'completed') or ("query_actions"."outcome" <> 'pending' and "query_actions"."phase" = 'completed'))),
	CONSTRAINT "query_actions_failure_code_outcome_check" CHECK ((("query_actions"."outcome" = 'failed' and "query_actions"."failure_code" is not null) or ("query_actions"."outcome" <> 'failed' and "query_actions"."failure_code" is null))),
	CONSTRAINT "query_actions_last_event_sequence_positive_check" CHECK ("query_actions"."last_event_sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "query_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "query_action_events" (
	"action_id" text NOT NULL,
	"command_id" text NOT NULL,
	"commit_position" bigserial NOT NULL,
	"event_type" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_json" jsonb NOT NULL,
	"sequence" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "query_action_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_api_actions" (
	"attempt_number" integer,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"id" text PRIMARY KEY NOT NULL,
	"invoke_mode" text,
	"last_event_id" text NOT NULL,
	"last_event_sequence" integer NOT NULL,
	"organization_id" text NOT NULL,
	"outcome" text NOT NULL,
	"page_progress_json" jsonb,
	"phase" text NOT NULL,
	"prepared_request_fingerprint" text,
	"request_descriptor_json" jsonb,
	"request_kind" text NOT NULL,
	"source_descriptor_json" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_api_actions_completed_at_outcome_check" CHECK ((("source_api_actions"."outcome" = 'pending' and "source_api_actions"."completed_at" is null) or ("source_api_actions"."outcome" <> 'pending' and "source_api_actions"."completed_at" is not null))),
	CONSTRAINT "source_api_actions_completed_phase_outcome_check" CHECK ((("source_api_actions"."outcome" = 'pending' and "source_api_actions"."phase" <> 'completed') or ("source_api_actions"."outcome" <> 'pending' and "source_api_actions"."phase" = 'completed'))),
	CONSTRAINT "source_api_actions_failure_code_outcome_check" CHECK ((("source_api_actions"."outcome" = 'failed' and "source_api_actions"."failure_code" is not null) or ("source_api_actions"."outcome" <> 'failed' and "source_api_actions"."failure_code" is null))),
	CONSTRAINT "source_api_actions_last_event_sequence_positive_check" CHECK ("source_api_actions"."last_event_sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "source_api_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_api_action_events" (
	"action_id" text NOT NULL,
	"command_id" text NOT NULL,
	"commit_position" bigserial NOT NULL,
	"event_type" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_json" jsonb NOT NULL,
	"sequence" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_api_action_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workflow_commands" (
	"action_id" text,
	"actor_snapshot_json" jsonb NOT NULL,
	"caused_by_event_id" text,
	"command_invocation_id" text NOT NULL,
	"command_payload_json" jsonb NOT NULL,
	"command_type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decision_kind" text NOT NULL,
	"family" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"reject_code" text,
	"reject_detail" text,
	"request_id" text NOT NULL,
	"surface" text NOT NULL,
	CONSTRAINT "workflow_commands_decision_reject_alignment_check" CHECK ((("workflow_commands"."decision_kind" = 'rejected' and "workflow_commands"."reject_code" is not null) or ("workflow_commands"."decision_kind" = 'accepted' and "workflow_commands"."reject_code" is null))),
	CONSTRAINT "workflow_commands_accepted_action_id_check" CHECK (("workflow_commands"."decision_kind" = 'rejected' or "workflow_commands"."action_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "workflow_commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workflow_effect_dispatches" (
	"action_id" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effect_key" text NOT NULL,
	"effect_type" text NOT NULL,
	"family" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"last_error_code" text,
	"last_error_detail" text,
	"leased_until" timestamp with time zone,
	"origin_event_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "workflow_effect_dispatches_completion_status_check" CHECK ((("workflow_effect_dispatches"."status" = 'completed' and "workflow_effect_dispatches"."completed_at" is not null) or ("workflow_effect_dispatches"."status" <> 'completed' and "workflow_effect_dispatches"."completed_at" is null)))
);
--> statement-breakpoint
ALTER TABLE "workflow_effect_dispatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "query_actions" ADD CONSTRAINT "query_actions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_action_events" ADD CONSTRAINT "query_action_events_action_id_query_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."query_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_action_events" ADD CONSTRAINT "query_action_events_command_id_workflow_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."workflow_commands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_api_actions" ADD CONSTRAINT "source_api_actions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_api_action_events" ADD CONSTRAINT "source_api_action_events_action_id_source_api_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."source_api_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_api_action_events" ADD CONSTRAINT "source_api_action_events_command_id_workflow_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."workflow_commands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_commands" ADD CONSTRAINT "workflow_commands_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_audit_projection_checkpoints_projection_family_unique" ON "audit_projection_checkpoints" USING btree ("projection_name","family");--> statement-breakpoint
CREATE INDEX "idx_query_actions_org_started" ON "query_actions" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_query_action_events_action_sequence_unique" ON "query_action_events" USING btree ("action_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_query_action_events_commit_position_unique" ON "query_action_events" USING btree ("commit_position");--> statement-breakpoint
CREATE INDEX "idx_query_action_events_command_sequence" ON "query_action_events" USING btree ("command_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_source_api_actions_org_started" ON "source_api_actions" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_source_api_action_events_action_sequence_unique" ON "source_api_action_events" USING btree ("action_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_source_api_action_events_commit_position_unique" ON "source_api_action_events" USING btree ("commit_position");--> statement-breakpoint
CREATE INDEX "idx_source_api_action_events_command_sequence" ON "source_api_action_events" USING btree ("command_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workflow_commands_family_invocation_unique" ON "workflow_commands" USING btree ("family","command_invocation_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_commands_action_created" ON "workflow_commands" USING btree ("family","action_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_commands_org_created" ON "workflow_commands" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workflow_effect_dispatches_effect_key_unique" ON "workflow_effect_dispatches" USING btree ("effect_key");--> statement-breakpoint
CREATE INDEX "idx_workflow_effect_dispatches_status_available" ON "workflow_effect_dispatches" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_effect_dispatches_family_action_created" ON "workflow_effect_dispatches" USING btree ("family","action_id","created_at");