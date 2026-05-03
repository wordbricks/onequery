CREATE TABLE "pending_workflow_effects" (
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"effect_id" text NOT NULL,
	"effect_type" text NOT NULL,
	"family" text NOT NULL,
	"last_error_code" text,
	"last_error_detail" text,
	"last_started_at" timestamp with time zone,
	"organization_id" text NOT NULL,
	"payload_bytes" "bytea" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"scheduled_by_entry_id" text NOT NULL,
	"status" text NOT NULL,
	"stream_id" text NOT NULL,
	"stream_position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_workflow_effects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_workflow_effects" ADD CONSTRAINT "pending_workflow_effects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pending_workflow_effects_family_effect_unique" ON "pending_workflow_effects" USING btree ("family","effect_id");--> statement-breakpoint
CREATE INDEX "idx_pending_workflow_effects_worker_scan" ON "pending_workflow_effects" USING btree ("family","organization_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_pending_workflow_effects_stream" ON "pending_workflow_effects" USING btree ("family","stream_id");
