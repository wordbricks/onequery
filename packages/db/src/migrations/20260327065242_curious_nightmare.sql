CREATE TABLE "account" (
	"access_token" text,
	"access_token_expires_at" timestamp,
	"account_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"id_token" text,
	"password" text,
	"provider_id" text NOT NULL,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_code" (
	"client_id" text,
	"device_code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"scope" text,
	"status" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text
);
--> statement-breakpoint
ALTER TABLE "device_code" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitation" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"inviter_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" text,
	"status" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"logo" text,
	"metadata" text,
	"name" text NOT NULL,
	"slug" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"active_organization_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"ip_address" text,
	"token" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"image" text,
	"name" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verification" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bigquery_query_costs" (
	"actual_bytes_billed" bigint,
	"actual_bytes_processed" bigint,
	"actual_cost_usd" double precision,
	"cache_hit" boolean,
	"connection_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"estimated_bytes_processed" bigint,
	"estimated_cost_usd" double precision,
	"executed_at" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"location" text,
	"organization_id" text NOT NULL,
	"pricing_model" text DEFAULT 'unknown' NOT NULL,
	"query_id" text NOT NULL,
	"tool_call_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bigquery_query_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cli_query_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"actor_auth_mode" text NOT NULL,
	"actor_membership_roles" jsonb NOT NULL,
	"request_id" text NOT NULL,
	"action_type" text NOT NULL,
	"stage" text DEFAULT 'received' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"usage_persistence_status" text DEFAULT 'not_started' NOT NULL,
	"source_key" text NOT NULL,
	"source_id" text,
	"provider" text,
	"source_status" text,
	"sql" text NOT NULL,
	"normalized_sql" text,
	"max_rows" integer,
	"max_bytes" integer,
	"cell_max_chars" integer,
	"timeout_ms" integer,
	"normalized_sql_changed" boolean DEFAULT false NOT NULL,
	"row_count" integer,
	"elapsed_ms" integer,
	"error_detail" text,
	"error_hint" text,
	"retryable" boolean,
	"last_event_id" text,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cli_query_actions_identity_unique" UNIQUE("id","organization_id","request_id","action_type","source_key"),
	CONSTRAINT "cli_query_actions_action_type_check" CHECK ("cli_query_actions"."action_type" in ('validate', 'execute')),
	CONSTRAINT "cli_query_actions_actor_auth_mode_check" CHECK ("cli_query_actions"."actor_auth_mode" in ('browser_session', 'bearer_token')),
	CONSTRAINT "cli_query_actions_stage_check" CHECK ("cli_query_actions"."stage" in ('received', 'load_source', 'validate_query', 'load_credentials', 'execute_query', 'persist_usage', 'completed')),
	CONSTRAINT "cli_query_actions_status_check" CHECK ("cli_query_actions"."status" in ('pending', 'succeeded', 'source_not_found', 'source_not_queryable', 'query_rejected', 'query_preparation_failed', 'query_unavailable', 'query_timed_out', 'query_execution_failed')),
	CONSTRAINT "cli_query_actions_usage_persistence_status_check" CHECK ("cli_query_actions"."usage_persistence_status" in ('not_started', 'succeeded', 'failed')),
	CONSTRAINT "cli_query_actions_completed_stage_check" CHECK (( (stage = 'completed' and completed_at is not null) or (stage <> 'completed' and completed_at is null) )),
	CONSTRAINT "cli_query_actions_stage_status_alignment_check" CHECK (( (stage = 'completed' and status <> 'pending') or (stage <> 'completed' and status = 'pending') )),
	CONSTRAINT "cli_query_actions_pre_completion_usage_check" CHECK (( stage = 'completed' or usage_persistence_status = 'not_started' ))
);
--> statement-breakpoint
ALTER TABLE "cli_query_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cli_query_action_events" (
	"id" text PRIMARY KEY NOT NULL,
	"query_action_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"actor_auth_mode" text NOT NULL,
	"actor_membership_roles" jsonb NOT NULL,
	"request_id" text NOT NULL,
	"action_type" text NOT NULL,
	"event_type" text NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"usage_persistence_status" text NOT NULL,
	"source_key" text NOT NULL,
	"source_id" text,
	"provider" text,
	"source_status" text,
	"sql" text,
	"normalized_sql" text,
	"max_rows" integer,
	"max_bytes" integer,
	"cell_max_chars" integer,
	"timeout_ms" integer,
	"normalized_sql_changed" boolean DEFAULT false NOT NULL,
	"row_count" integer,
	"elapsed_ms" integer,
	"error_detail" text,
	"error_hint" text,
	"retryable" boolean,
	"occurred_at" timestamp with time zone NOT NULL,
	"causation_event_id" text,
	"org_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cli_query_action_events_action_id_unique" UNIQUE("query_action_id","id"),
	CONSTRAINT "cli_query_action_events_sql_payload_check" CHECK (( (event_type = 'action_received' and sql is not null) or (event_type <> 'action_received' and sql is null) )),
	CONSTRAINT "cli_query_action_events_causation_chain_check" CHECK (( (event_type = 'action_received' and causation_event_id is null) or (event_type <> 'action_received' and causation_event_id is not null) )),
	CONSTRAINT "cli_query_action_events_validated_normalized_sql_check" CHECK ((event_type <> 'query_validated' or normalized_sql is not null)),
	CONSTRAINT "cli_query_action_events_lifecycle_check" CHECK (( (event_type = 'action_received' and stage = 'received' and status = 'pending' and usage_persistence_status = 'not_started') or (event_type = 'source_loaded' and stage = 'validate_query' and status = 'pending' and usage_persistence_status = 'not_started') or (event_type = 'source_not_found' and stage = 'completed' and status = 'source_not_found' and usage_persistence_status = 'not_started') or (event_type = 'source_not_queryable' and stage = 'completed' and status = 'source_not_queryable' and usage_persistence_status = 'not_started') or ( event_type = 'query_validated' and ( (action_type = 'validate' and stage = 'completed' and status = 'succeeded' and usage_persistence_status = 'not_started') or (action_type = 'execute' and stage = 'load_credentials' and status = 'pending' and usage_persistence_status = 'not_started') ) ) or (event_type = 'query_rejected' and stage = 'completed' and status = 'query_rejected' and usage_persistence_status = 'not_started') or (event_type = 'credentials_loaded' and stage = 'execute_query' and status = 'pending' and usage_persistence_status = 'not_started') or (event_type = 'query_preparation_failed' and stage = 'completed' and status = 'query_preparation_failed' and usage_persistence_status = 'not_started') or (event_type = 'query_executed' and stage = 'persist_usage' and status = 'pending' and usage_persistence_status = 'not_started') or (event_type = 'query_unavailable' and stage = 'completed' and status = 'query_unavailable' and usage_persistence_status = 'not_started') or (event_type = 'query_timed_out' and stage = 'completed' and status = 'query_timed_out' and usage_persistence_status = 'not_started') or (event_type = 'query_execution_failed' and stage = 'completed' and status = 'query_execution_failed' and usage_persistence_status = 'not_started') or (event_type = 'usage_persisted' and stage = 'completed' and status = 'succeeded' and usage_persistence_status = 'succeeded') or (event_type = 'usage_persist_failed' and stage = 'completed' and status = 'succeeded' and usage_persistence_status = 'failed') )),
	CONSTRAINT "cli_query_action_events_action_type_check" CHECK ("cli_query_action_events"."action_type" in ('validate', 'execute')),
	CONSTRAINT "cli_query_action_events_actor_auth_mode_check" CHECK ("cli_query_action_events"."actor_auth_mode" in ('browser_session', 'bearer_token')),
	CONSTRAINT "cli_query_action_events_event_type_check" CHECK ("cli_query_action_events"."event_type" in ('action_received', 'source_loaded', 'source_not_found', 'source_not_queryable', 'query_validated', 'query_rejected', 'credentials_loaded', 'query_preparation_failed', 'query_executed', 'query_unavailable', 'query_timed_out', 'query_execution_failed', 'usage_persisted', 'usage_persist_failed')),
	CONSTRAINT "cli_query_action_events_stage_check" CHECK ("cli_query_action_events"."stage" in ('received', 'load_source', 'validate_query', 'load_credentials', 'execute_query', 'persist_usage', 'completed')),
	CONSTRAINT "cli_query_action_events_status_check" CHECK ("cli_query_action_events"."status" in ('pending', 'succeeded', 'source_not_found', 'source_not_queryable', 'query_rejected', 'query_preparation_failed', 'query_unavailable', 'query_timed_out', 'query_execution_failed')),
	CONSTRAINT "cli_query_action_events_usage_persistence_status_check" CHECK ("cli_query_action_events"."usage_persistence_status" in ('not_started', 'succeeded', 'failed')),
	CONSTRAINT "cli_query_action_events_causation_not_self_check" CHECK ("cli_query_action_events"."causation_event_id" is null or "cli_query_action_events"."causation_event_id" <> "cli_query_action_events"."id")
);
--> statement-breakpoint
ALTER TABLE "cli_query_action_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "connector_jobs" (
	"completed_at" timestamp with time zone,
	"connector_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"database" text NOT NULL,
	"job_id" text PRIMARY KEY NOT NULL,
	"leased_at" timestamp with time zone,
	"max_rows" integer,
	"outcome" jsonb,
	"sql" text NOT NULL,
	"status" text NOT NULL,
	"timeout_ms" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workgroup" text
);
--> statement-breakpoint
ALTER TABLE "connector_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "connectors" (
	"auth_token_hash" text NOT NULL,
	"connector_id" text PRIMARY KEY NOT NULL,
	"connector_name" text NOT NULL,
	"health_status" text,
	"last_heartbeat_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"metadata" jsonb,
	"organization_id" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connectors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "data_source_query_costs" (
	"actual_cost_usd" double precision,
	"actual_processed_bytes" bigint,
	"billable_bytes" bigint,
	"cache_hit" boolean,
	"connection_name" text NOT NULL,
	"connector_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"database" text,
	"estimated_cost_usd" double precision,
	"estimated_processed_bytes" bigint,
	"executed_at" timestamp with time zone NOT NULL,
	"execution_time_ms" integer,
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"location" text,
	"organization_id" text NOT NULL,
	"pricing_model" text DEFAULT 'unknown' NOT NULL,
	"provider" text NOT NULL,
	"query_execution_id" text,
	"query_id" text NOT NULL,
	"row_count" integer,
	"tool_call_id" text NOT NULL,
	"workgroup" text
);
--> statement-breakpoint
ALTER TABLE "data_source_query_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "data_sources" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credentials_encrypted" text NOT NULL,
	"credentials_iv" text NOT NULL,
	"error_message" text,
	"id" text PRIMARY KEY NOT NULL,
	"last_used_at" timestamp with time zone,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text,
	"scope" text,
	"status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"use_as_data_source" boolean DEFAULT true NOT NULL,
	CONSTRAINT "data_sources_organization_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "data_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "data_source_table_usage" (
	"column_memos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_source_id" text NOT NULL,
	"formatted" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"memo_updated_at" timestamp with time zone,
	"memo_updated_by" text,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"schema_hash" text,
	"table_lineage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"table_memos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tables" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_source_table_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"north_star_metric" text,
	"kpis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website_url" text,
	"monthly_budget_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_code" ADD CONSTRAINT "device_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bigquery_query_costs" ADD CONSTRAINT "bigquery_query_costs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_actions" ADD CONSTRAINT "cli_query_actions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_actions" ADD CONSTRAINT "cli_query_actions_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_actions" ADD CONSTRAINT "cli_query_actions_same_action_last_event_fk" FOREIGN KEY ("id","last_event_id") REFERENCES "public"."cli_query_action_events"("query_action_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_action_events" ADD CONSTRAINT "cli_query_action_events_query_action_id_cli_query_actions_id_fk" FOREIGN KEY ("query_action_id") REFERENCES "public"."cli_query_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_action_events" ADD CONSTRAINT "cli_query_action_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_action_events" ADD CONSTRAINT "cli_query_action_events_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_action_events" ADD CONSTRAINT "cli_query_action_events_action_identity_fk" FOREIGN KEY ("query_action_id","organization_id","request_id","action_type","source_key") REFERENCES "public"."cli_query_actions"("id","organization_id","request_id","action_type","source_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_action_events" ADD CONSTRAINT "cli_query_action_events_same_action_causation_fk" FOREIGN KEY ("query_action_id","causation_event_id") REFERENCES "public"."cli_query_action_events"("query_action_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_query_action_events" ADD CONSTRAINT "cli_query_action_events_causation_event_id_cli_query_action_events_id_fk" FOREIGN KEY ("causation_event_id") REFERENCES "public"."cli_query_action_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_jobs" ADD CONSTRAINT "connector_jobs_connector_id_connectors_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("connector_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_query_costs" ADD CONSTRAINT "data_source_query_costs_connector_id_connectors_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("connector_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_query_costs" ADD CONSTRAINT "data_source_query_costs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_table_usage" ADD CONSTRAINT "data_source_table_usage_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_table_usage" ADD CONSTRAINT "data_source_table_usage_memo_updated_by_user_id_fk" FOREIGN KEY ("memo_updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_table_usage" ADD CONSTRAINT "data_source_table_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_profiles" ADD CONSTRAINT "organization_profiles_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_device_code_key" ON "device_code" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_user_code_key" ON "device_code" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "device_code_user_id_idx" ON "device_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "device_code_expires_at_idx" ON "device_code" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_bigquery_query_costs_org" ON "bigquery_query_costs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_bigquery_query_costs_executed_at" ON "bigquery_query_costs" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "idx_cli_query_actions_org_created" ON "cli_query_actions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_cli_query_actions_actor_user_id" ON "cli_query_actions" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_cli_query_actions_request_id" ON "cli_query_actions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_cli_query_actions_source_id" ON "cli_query_actions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_cli_query_actions_status" ON "cli_query_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cli_query_action_events_action_occurred" ON "cli_query_action_events" USING btree ("query_action_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "idx_cli_query_action_events_org_occurred" ON "cli_query_action_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_cli_query_action_events_actor_user_id" ON "cli_query_action_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_cli_query_action_events_request_id" ON "cli_query_action_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_cli_query_action_events_causation" ON "cli_query_action_events" USING btree ("causation_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cli_query_action_events_action_event_type_unique" ON "cli_query_action_events" USING btree ("query_action_id","event_type");--> statement-breakpoint
CREATE INDEX "idx_connector_jobs_connector_created" ON "connector_jobs" USING btree ("connector_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_connector_jobs_status_created" ON "connector_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_connectors_organization" ON "connectors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_connectors_last_seen" ON "connectors" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connectors_auth_token_hash_unique" ON "connectors" USING btree ("auth_token_hash");--> statement-breakpoint
CREATE INDEX "idx_data_source_query_costs_org" ON "data_source_query_costs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_data_source_query_costs_provider" ON "data_source_query_costs" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_data_source_query_costs_executed_at" ON "data_source_query_costs" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "idx_data_sources_organization" ON "data_sources" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_data_sources_provider" ON "data_sources" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_data_sources_provider_account" ON "data_sources" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "idx_data_sources_status" ON "data_sources" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_data_source_table_usage_source" ON "data_source_table_usage" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "idx_data_source_table_usage_org" ON "data_source_table_usage" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_data_source_table_usage_provider" ON "data_source_table_usage" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_data_source_table_usage_generated_at" ON "data_source_table_usage" USING btree ("generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_org_profiles_org" ON "organization_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_profiles_created" ON "organization_profiles" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_profiles_user" ON "user_profiles" USING btree ("user_id");