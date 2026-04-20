CREATE TABLE "audit_feed_entries" (
	"action_name" text NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"family" text NOT NULL,
	"family_action_id" text NOT NULL,
	"family_preview_json" jsonb,
	"last_event_at" timestamp with time zone NOT NULL,
	"last_projected_sequence" integer NOT NULL,
	"last_event_type" text NOT NULL,
	"metrics_json" jsonb,
	"organization_id" text NOT NULL,
	"origin_actor_json" jsonb NOT NULL,
	"origin_surface" text NOT NULL,
	"outcome" text NOT NULL,
	"phase" text NOT NULL,
	"search_document" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"subtitle" text NOT NULL,
	"target_json" jsonb NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "audit_feed_entries_family_action_pk" PRIMARY KEY("family","family_action_id")
);
--> statement-breakpoint
ALTER TABLE "audit_feed_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_projection_checkpoints" ALTER COLUMN "last_commit_position" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "audit_feed_entries" ADD CONSTRAINT "audit_feed_entries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_feed_entries_org_started_identity" ON "audit_feed_entries" USING btree ("organization_id","started_at","family","family_action_id");--> statement-breakpoint
CREATE INDEX "idx_audit_feed_entries_org_family_started" ON "audit_feed_entries" USING btree ("organization_id","family","started_at");