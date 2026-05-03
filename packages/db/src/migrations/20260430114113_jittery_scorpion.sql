CREATE TABLE "workflow_journal" (
	"command_invocation_id" text,
	"commit_id" text NOT NULL,
	"commit_position" bigserial NOT NULL,
	"entry_kind" text NOT NULL,
	"event_id" text,
	"event_type" text,
	"effect_id" text,
	"effect_type" text,
	"family" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"organization_id" text NOT NULL,
	"payload_bytes" "bytea",
	"payload_type" text,
	"stream_id" text NOT NULL,
	"stream_position" integer NOT NULL,
	CONSTRAINT "workflow_journal_command_invocation_check" CHECK (("workflow_journal"."entry_kind" = 'command' and "workflow_journal"."command_invocation_id" is not null) or ("workflow_journal"."entry_kind" <> 'command' and "workflow_journal"."command_invocation_id" is null))
);
--> statement-breakpoint
ALTER TABLE "workflow_journal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_journal" ADD CONSTRAINT "workflow_journal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workflow_journal_stream_position_unique" ON "workflow_journal" USING btree ("family","stream_id","stream_position");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workflow_journal_commit_position_unique" ON "workflow_journal" USING btree ("commit_position");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workflow_journal_command_invocation_unique" ON "workflow_journal" USING btree ("family","command_invocation_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_journal_commit" ON "workflow_journal" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_journal_stream" ON "workflow_journal" USING btree ("family","stream_id","stream_position");--> statement-breakpoint
CREATE INDEX "idx_workflow_journal_effect" ON "workflow_journal" USING btree ("family","stream_id","effect_id");