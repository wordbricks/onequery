import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type {
  BigQueryQueryCostCurrency,
  BigQueryQueryCostPricingModel,
} from "./schema/bigquery-query-costs";
import { CLI_QUERY_ACTION_EVENT_TYPES } from "./schema/cli-query-action-events";
import type { CliQueryActionEventType } from "./schema/cli-query-action-events";
import {
  CLI_QUERY_ACTION_ACTOR_AUTH_MODES,
  CLI_QUERY_ACTION_STAGES,
  CLI_QUERY_ACTION_STATUSES,
  CLI_QUERY_ACTION_TYPES,
  CLI_QUERY_USAGE_PERSISTENCE_STATUSES,
} from "./schema/cli-query-actions";
import type {
  CliQueryActionActorAuthMode,
  CliQueryActionStage,
  CliQueryActionStatus,
  CliQueryActionType,
  CliQueryUsagePersistenceStatus,
} from "./schema/cli-query-actions";
import type {
  ConnectorAthenaJobOutcome,
  ConnectorHealthStatus,
  ConnectorJobStatus,
  ConnectorMetadata,
} from "./schema/connectors";
import type {
  DataSourceQueryCostCurrency,
  DataSourceQueryCostPricingModel,
  DataSourceQueryCostProvider,
} from "./schema/data-source-query-costs";
import type {
  TableUsageColumnMemo,
  TableUsageLineage,
  TableUsageTable,
  TableUsageTableMemo,
} from "./schema/data-source-table-usage";
import type { DataSourceStatus, ProviderType } from "./schema/data-sources";
import { ulid } from "./schema/ulid";

type AnySQLiteColumn = import("drizzle-orm/sqlite-core").AnySQLiteColumn;
type SQLiteTableExtraConfigValue =
  import("drizzle-orm/sqlite-core").SQLiteTableExtraConfigValue;

const CLI_QUERY_ACTION_TYPES_SQL = CLI_QUERY_ACTION_TYPES.map(
  (type) => `'${type}'`
).join(", ");
const CLI_QUERY_ACTION_ACTOR_AUTH_MODES_SQL =
  CLI_QUERY_ACTION_ACTOR_AUTH_MODES.map((mode) => `'${mode}'`).join(", ");
const CLI_QUERY_ACTION_STAGES_SQL = CLI_QUERY_ACTION_STAGES.map(
  (stage) => `'${stage}'`
).join(", ");
const CLI_QUERY_ACTION_STATUSES_SQL = CLI_QUERY_ACTION_STATUSES.map(
  (status) => `'${status}'`
).join(", ");
const CLI_QUERY_USAGE_PERSISTENCE_STATUSES_SQL =
  CLI_QUERY_USAGE_PERSISTENCE_STATUSES.map((status) => `'${status}'`).join(
    ", "
  );
const CLI_QUERY_ACTION_EVENT_TYPES_SQL = CLI_QUERY_ACTION_EVENT_TYPES.map(
  (type) => `'${type}'`
).join(", ");
const CLI_QUERY_ACTIONS_COMPLETED_STAGE_SQL = [
  "(",
  "(stage = 'completed' and completed_at is not null)",
  "or",
  "(stage <> 'completed' and completed_at is null)",
  ")",
].join(" ");
const CLI_QUERY_ACTIONS_STAGE_STATUS_SQL = [
  "(",
  "(stage = 'completed' and status <> 'pending')",
  "or",
  "(stage <> 'completed' and status = 'pending')",
  ")",
].join(" ");
const CLI_QUERY_ACTIONS_PRE_COMPLETION_USAGE_SQL = [
  "(",
  "stage = 'completed'",
  "or",
  "usage_persistence_status = 'not_started'",
  ")",
].join(" ");
const CLI_QUERY_ACTION_EVENTS_SQL_PAYLOAD_SQL = [
  "(",
  "(event_type = 'action_received' and sql is not null)",
  "or",
  "(event_type <> 'action_received' and sql is null)",
  ")",
].join(" ");
const CLI_QUERY_ACTION_EVENTS_CAUSATION_CHAIN_SQL = [
  "(",
  "(event_type = 'action_received' and causation_event_id is null)",
  "or",
  "(event_type <> 'action_received' and causation_event_id is not null)",
  ")",
].join(" ");
const CLI_QUERY_ACTION_EVENTS_VALIDATED_NORMALIZED_SQL_SQL =
  "(event_type <> 'query_validated' or normalized_sql is not null)";
const CLI_QUERY_ACTION_EVENTS_LIFECYCLE_SQL = [
  "(",
  "(event_type = 'action_received' and stage = 'received' and status = 'pending' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'source_loaded' and stage = 'validate_query' and status = 'pending' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'source_not_found' and stage = 'completed' and status = 'source_not_found' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'source_not_queryable' and stage = 'completed' and status = 'source_not_queryable' and usage_persistence_status = 'not_started')",
  "or",
  "(",
  "event_type = 'query_validated'",
  "and (",
  "(action_type = 'validate' and stage = 'completed' and status = 'succeeded' and usage_persistence_status = 'not_started')",
  "or",
  "(action_type = 'execute' and stage = 'load_credentials' and status = 'pending' and usage_persistence_status = 'not_started')",
  ")",
  ")",
  "or",
  "(event_type = 'query_rejected' and stage = 'completed' and status = 'query_rejected' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'credentials_loaded' and stage = 'execute_query' and status = 'pending' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'query_preparation_failed' and stage = 'completed' and status = 'query_preparation_failed' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'query_executed' and stage = 'persist_usage' and status = 'pending' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'query_unavailable' and stage = 'completed' and status = 'query_unavailable' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'query_timed_out' and stage = 'completed' and status = 'query_timed_out' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'query_execution_failed' and stage = 'completed' and status = 'query_execution_failed' and usage_persistence_status = 'not_started')",
  "or",
  "(event_type = 'usage_persisted' and stage = 'completed' and status = 'succeeded' and usage_persistence_status = 'succeeded')",
  "or",
  "(event_type = 'usage_persist_failed' and stage = 'completed' and status = 'succeeded' and usage_persistence_status = 'failed')",
  ")",
].join(" ");

export const user = sqliteTable("user", {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .defaultNow()
    .notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const organization = sqliteTable("organization", {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .defaultNow()
    .notNull(),
  id: text("id").primaryKey(),
  logo: text("logo"),
  metadata: text("metadata"),
  name: text("name").notNull(),
  slug: text("slug").unique(),
});

export const session = sqliteTable(
  "session",
  {
    activeOrganizationId: text("active_organization_id").references(
      () => organization.id,
      { onDelete: "set null" }
    ),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const account = sqliteTable(
  "account",
  {
    // Comment: Better Auth persists provider tokens/password hashes in this
    // canonical table shape. Re-encrypting or relocating these fields would
    // require a coordinated auth/data migration outside this scoped pass.
    accessToken: text("access_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    accountId: text("account_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const member = sqliteTable(
  "member",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table): SQLiteTableExtraConfigValue[] => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ]
);

export const invitation = sqliteTable(
  "invitation",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
    email: text("email").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role"),
    status: text("status").notNull(),
  },
  (table): SQLiteTableExtraConfigValue[] => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);

export const deviceCode = sqliteTable(
  "device_code",
  {
    clientId: text("client_id"),
    deviceCode: text("device_code").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
    pollingInterval: integer("polling_interval"),
    scope: text("scope"),
    status: text("status").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("device_code_device_code_key").on(table.deviceCode),
    uniqueIndex("device_code_user_code_key").on(table.userCode),
    index("device_code_user_id_idx").on(table.userId),
    index("device_code_expires_at_idx").on(table.expiresAt),
  ]
);

export const dataSources = sqliteTable(
  "data_sources",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .defaultNow()
      .notNull(),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    credentialsIv: text("credentials_iv").notNull(),
    errorMessage: text("error_message"),
    id: text("id").primaryKey().$defaultFn(ulid),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().$type<ProviderType>(),
    providerAccountId: text("provider_account_id"),
    scope: text("scope"),
    status: text("status")
      .notNull()
      .$type<DataSourceStatus>()
      .default("active"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    useAsDataSource: integer("use_as_data_source", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (table) => [
    unique("data_sources_organization_name_unique").on(
      table.organizationId,
      table.name
    ),
    index("idx_data_sources_organization").on(table.organizationId),
    index("idx_data_sources_provider").on(table.provider),
    index("idx_data_sources_provider_account").on(
      table.provider,
      table.providerAccountId
    ),
    index("idx_data_sources_status").on(table.status),
  ]
);

export const connectors = sqliteTable(
  "connectors",
  {
    authTokenHash: text("auth_token_hash").notNull(),
    connectorId: text("connector_id").primaryKey(),
    connectorName: text("connector_name").notNull(),
    healthStatus: text("health_status").$type<ConnectorHealthStatus>(),
    lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    metadata: text("metadata", { mode: "json" }).$type<ConnectorMetadata>(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    registeredAt: integer("registered_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_connectors_organization").on(table.organizationId),
    index("idx_connectors_last_seen").on(table.lastSeenAt),
    uniqueIndex("idx_connectors_auth_token_hash_unique").on(
      table.authTokenHash
    ),
  ]
);

export const connectorJobs = sqliteTable(
  "connector_jobs",
  {
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    connectorId: text("connector_id")
      .notNull()
      .references(() => connectors.connectorId, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    database: text("database").notNull(),
    jobId: text("job_id").primaryKey(),
    leasedAt: integer("leased_at", { mode: "timestamp_ms" }),
    maxRows: integer("max_rows"),
    outcome: text("outcome", {
      mode: "json",
    }).$type<ConnectorAthenaJobOutcome>(),
    sql: text("sql").notNull(),
    status: text("status").notNull().$type<ConnectorJobStatus>(),
    timeoutMs: integer("timeout_ms"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    workgroup: text("workgroup"),
  },
  (table) => [
    index("idx_connector_jobs_connector_created").on(
      table.connectorId,
      table.createdAt
    ),
    index("idx_connector_jobs_status_created").on(
      table.status,
      table.createdAt
    ),
  ]
);

export const dataSourceQueryCosts = sqliteTable(
  "data_source_query_costs",
  {
    actualCostUsd: real("actual_cost_usd"),
    actualProcessedBytes: numeric("actual_processed_bytes", {
      mode: "bigint",
    }),
    billableBytes: numeric("billable_bytes", {
      mode: "bigint",
    }),
    cacheHit: integer("cache_hit", { mode: "boolean" }),
    connectionName: text("connection_name").notNull(),
    connectorId: text("connector_id").references(() => connectors.connectorId, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    currency: text("currency")
      .$type<DataSourceQueryCostCurrency>()
      .notNull()
      .default("USD"),
    database: text("database"),
    estimatedCostUsd: real("estimated_cost_usd"),
    estimatedProcessedBytes: numeric("estimated_processed_bytes", {
      mode: "bigint",
    }),
    executedAt: integer("executed_at", { mode: "timestamp_ms" }).notNull(),
    executionTimeMs: integer("execution_time_ms"),
    id: text("id").primaryKey().$defaultFn(ulid),
    jobId: text("job_id"),
    location: text("location"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pricingModel: text("pricing_model")
      .$type<DataSourceQueryCostPricingModel>()
      .notNull()
      .default("unknown"),
    provider: text("provider").$type<DataSourceQueryCostProvider>().notNull(),
    queryExecutionId: text("query_execution_id"),
    queryId: text("query_id").notNull(),
    rowCount: integer("row_count"),
    toolCallId: text("tool_call_id").notNull(),
    workgroup: text("workgroup"),
  },
  (table) => [
    index("idx_data_source_query_costs_org").on(table.organizationId),
    index("idx_data_source_query_costs_provider").on(table.provider),
    index("idx_data_source_query_costs_executed_at").on(table.executedAt),
  ]
);

export const bigqueryQueryCosts = sqliteTable(
  "bigquery_query_costs",
  {
    actualBytesBilled: numeric("actual_bytes_billed", {
      mode: "bigint",
    }),
    actualBytesProcessed: numeric("actual_bytes_processed", {
      mode: "bigint",
    }),
    actualCostUsd: real("actual_cost_usd"),
    cacheHit: integer("cache_hit", { mode: "boolean" }),
    connectionName: text("connection_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    currency: text("currency")
      .$type<BigQueryQueryCostCurrency>()
      .notNull()
      .default("USD"),
    estimatedBytesProcessed: numeric("estimated_bytes_processed", {
      mode: "bigint",
    }),
    estimatedCostUsd: real("estimated_cost_usd"),
    executedAt: integer("executed_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    jobId: text("job_id"),
    location: text("location"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pricingModel: text("pricing_model")
      .$type<BigQueryQueryCostPricingModel>()
      .notNull()
      .default("unknown"),
    queryId: text("query_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
  },
  (table) => [
    index("idx_bigquery_query_costs_org").on(table.organizationId),
    index("idx_bigquery_query_costs_executed_at").on(table.executedAt),
  ]
);

export const cliQueryActions = sqliteTable(
  "cli_query_actions",
  {
    id: text("id").primaryKey().$defaultFn(ulid),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorAuthMode: text("actor_auth_mode")
      .$type<CliQueryActionActorAuthMode>()
      .notNull(),
    actorMembershipRoles: text("actor_membership_roles", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    requestId: text("request_id").notNull(),
    actionType: text("action_type").$type<CliQueryActionType>().notNull(),
    stage: text("stage")
      .$type<CliQueryActionStage>()
      .notNull()
      .default("received"),
    status: text("status")
      .$type<CliQueryActionStatus>()
      .notNull()
      .default("pending"),
    usagePersistenceStatus: text("usage_persistence_status")
      .$type<CliQueryUsagePersistenceStatus>()
      .notNull()
      .default("not_started"),
    sourceKey: text("source_key").notNull(),
    sourceId: text("source_id").references(() => dataSources.id, {
      onDelete: "set null",
    }),
    provider: text("provider").$type<ProviderType>(),
    sourceStatus: text("source_status").$type<DataSourceStatus>(),
    sql: text("sql").notNull(),
    normalizedSql: text("normalized_sql"),
    maxRows: integer("max_rows"),
    maxBytes: integer("max_bytes"),
    cellMaxChars: integer("cell_max_chars"),
    timeoutMs: integer("timeout_ms"),
    normalizedSqlChanged: integer("normalized_sql_changed", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    rowCount: integer("row_count"),
    elapsedMs: integer("elapsed_ms"),
    errorDetail: text("error_detail"),
    errorHint: text("error_hint"),
    retryable: integer("retryable", { mode: "boolean" }),
    lastEventId: text("last_event_id"),
    lastEventAt: integer("last_event_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("idx_cli_query_actions_org_created").on(
      table.organizationId,
      table.createdAt
    ),
    // Comment: This composite unique looks redundant next to the action PK,
    // but SQLite needs the exact referenced column set to be unique before the
    // denormalized event snapshot can prove it belongs to the same action row.
    uniqueIndex("idx_cli_query_actions_identity_unique").on(
      table.id,
      table.organizationId,
      table.requestId,
      table.actionType,
      table.sourceKey
    ),
    index("idx_cli_query_actions_actor_user_id").on(table.actorUserId),
    index("idx_cli_query_actions_request_id").on(table.requestId),
    index("idx_cli_query_actions_source_id").on(table.sourceId),
    index("idx_cli_query_actions_status").on(table.status),
    // Comment: SQLite enforcement for the circular same-action last-event FK
    // lives in `sqlite-bootstrap.ts`; mirroring the same composite self/cross
    // reference here trips Drizzle's recursive table inference.
    check(
      "cli_query_actions_action_type_check",
      sql`${table.actionType} in (${sql.raw(CLI_QUERY_ACTION_TYPES_SQL)})`
    ),
    check(
      "cli_query_actions_actor_auth_mode_check",
      sql`${table.actorAuthMode} in (${sql.raw(CLI_QUERY_ACTION_ACTOR_AUTH_MODES_SQL)})`
    ),
    check(
      "cli_query_actions_stage_check",
      sql`${table.stage} in (${sql.raw(CLI_QUERY_ACTION_STAGES_SQL)})`
    ),
    check(
      "cli_query_actions_status_check",
      sql`${table.status} in (${sql.raw(CLI_QUERY_ACTION_STATUSES_SQL)})`
    ),
    check(
      "cli_query_actions_usage_persistence_status_check",
      sql`${table.usagePersistenceStatus} in (${sql.raw(CLI_QUERY_USAGE_PERSISTENCE_STATUSES_SQL)})`
    ),
    check(
      "cli_query_actions_completed_stage_check",
      sql.raw(CLI_QUERY_ACTIONS_COMPLETED_STAGE_SQL)
    ),
    check(
      "cli_query_actions_stage_status_alignment_check",
      sql.raw(CLI_QUERY_ACTIONS_STAGE_STATUS_SQL)
    ),
    check(
      "cli_query_actions_pre_completion_usage_check",
      sql.raw(CLI_QUERY_ACTIONS_PRE_COMPLETION_USAGE_SQL)
    ),
  ]
);

export const cliQueryActionEvents = sqliteTable(
  "cli_query_action_events",
  {
    id: text("id").primaryKey().$defaultFn(ulid),
    queryActionId: text("query_action_id")
      .notNull()
      .references((): AnySQLiteColumn => cliQueryActions.id, {
        onDelete: "cascade",
      }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorAuthMode: text("actor_auth_mode")
      .$type<CliQueryActionActorAuthMode>()
      .notNull(),
    actorMembershipRoles: text("actor_membership_roles", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    requestId: text("request_id").notNull(),
    actionType: text("action_type").$type<CliQueryActionType>().notNull(),
    eventType: text("event_type").$type<CliQueryActionEventType>().notNull(),
    stage: text("stage").$type<CliQueryActionStage>().notNull(),
    status: text("status").$type<CliQueryActionStatus>().notNull(),
    usagePersistenceStatus: text("usage_persistence_status")
      .$type<CliQueryUsagePersistenceStatus>()
      .notNull(),
    sourceKey: text("source_key").notNull(),
    sourceId: text("source_id").references(() => dataSources.id, {
      onDelete: "set null",
    }),
    provider: text("provider").$type<ProviderType>(),
    sourceStatus: text("source_status").$type<DataSourceStatus>(),
    sql: text("sql"),
    normalizedSql: text("normalized_sql"),
    maxRows: integer("max_rows"),
    maxBytes: integer("max_bytes"),
    cellMaxChars: integer("cell_max_chars"),
    timeoutMs: integer("timeout_ms"),
    normalizedSqlChanged: integer("normalized_sql_changed", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    rowCount: integer("row_count"),
    elapsedMs: integer("elapsed_ms"),
    errorDetail: text("error_detail"),
    errorHint: text("error_hint"),
    retryable: integer("retryable", { mode: "boolean" }),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    causationEventId: text("causation_event_id"),
    orgSlug: text("org_slug"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_cli_query_action_events_action_occurred").on(
      table.queryActionId,
      table.occurredAt,
      table.id
    ),
    index("idx_cli_query_action_events_org_occurred").on(
      table.organizationId,
      table.occurredAt
    ),
    index("idx_cli_query_action_events_actor_user_id").on(table.actorUserId),
    index("idx_cli_query_action_events_request_id").on(table.requestId),
    index("idx_cli_query_action_events_causation").on(table.causationEventId),
    // Comment: This exact pair is intentionally unique so aggregates and
    // causal pointers can reference only events owned by the same action.
    uniqueIndex("idx_cli_query_action_events_action_id_unique").on(
      table.queryActionId,
      table.id
    ),
    uniqueIndex("idx_cli_query_action_events_action_event_type_unique").on(
      table.queryActionId,
      table.eventType
    ),
    // Comment: The actual SQLite database still enforces the composite
    // same-action identity and causation FKs via bootstrap DDL. Keeping those
    // circular FKs out of the mirror avoids a TS7022 recursive inference loop.
    foreignKey({
      columns: [table.causationEventId],
      foreignColumns: [table.id],
      name: "cli_query_action_events_causation_event_id_cli_query_action_events_id_fk",
    }).onDelete("set null"),
    check(
      "cli_query_action_events_sql_payload_check",
      sql.raw(CLI_QUERY_ACTION_EVENTS_SQL_PAYLOAD_SQL)
    ),
    check(
      "cli_query_action_events_causation_chain_check",
      sql.raw(CLI_QUERY_ACTION_EVENTS_CAUSATION_CHAIN_SQL)
    ),
    check(
      "cli_query_action_events_validated_normalized_sql_check",
      sql.raw(CLI_QUERY_ACTION_EVENTS_VALIDATED_NORMALIZED_SQL_SQL)
    ),
    check(
      "cli_query_action_events_lifecycle_check",
      sql.raw(CLI_QUERY_ACTION_EVENTS_LIFECYCLE_SQL)
    ),
    check(
      "cli_query_action_events_action_type_check",
      sql`${table.actionType} in (${sql.raw(CLI_QUERY_ACTION_TYPES_SQL)})`
    ),
    check(
      "cli_query_action_events_actor_auth_mode_check",
      sql`${table.actorAuthMode} in (${sql.raw(CLI_QUERY_ACTION_ACTOR_AUTH_MODES_SQL)})`
    ),
    check(
      "cli_query_action_events_event_type_check",
      sql`${table.eventType} in (${sql.raw(CLI_QUERY_ACTION_EVENT_TYPES_SQL)})`
    ),
    check(
      "cli_query_action_events_stage_check",
      sql`${table.stage} in (${sql.raw(CLI_QUERY_ACTION_STAGES_SQL)})`
    ),
    check(
      "cli_query_action_events_status_check",
      sql`${table.status} in (${sql.raw(CLI_QUERY_ACTION_STATUSES_SQL)})`
    ),
    check(
      "cli_query_action_events_usage_persistence_status_check",
      sql`${table.usagePersistenceStatus} in (${sql.raw(CLI_QUERY_USAGE_PERSISTENCE_STATUSES_SQL)})`
    ),
    check(
      "cli_query_action_events_causation_not_self_check",
      sql`${table.causationEventId} is null or ${table.causationEventId} <> ${table.id}`
    ),
  ]
);

export const dataSourceTableUsage = sqliteTable(
  "data_source_table_usage",
  {
    columnMemos: text("column_memos", { mode: "json" })
      .$type<Record<string, Record<string, TableUsageColumnMemo>>>()
      .notNull()
      .default({}),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    formatted: text("formatted").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    memoUpdatedAt: integer("memo_updated_at", { mode: "timestamp_ms" }),
    memoUpdatedBy: text("memo_updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().$type<ProviderType>(),
    schemaHash: text("schema_hash"),
    tableLineage: text("table_lineage", { mode: "json" })
      .$type<TableUsageLineage>()
      .notNull()
      .default({}),
    tableMemos: text("table_memos", { mode: "json" })
      .$type<Record<string, TableUsageTableMemo>>()
      .notNull()
      .default({}),
    tables: text("tables", { mode: "json" })
      .$type<TableUsageTable[]>()
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_data_source_table_usage_source").on(table.dataSourceId),
    index("idx_data_source_table_usage_org").on(table.organizationId),
    index("idx_data_source_table_usage_provider").on(table.provider),
    index("idx_data_source_table_usage_generated_at").on(table.generatedAt),
  ]
);

export const organizationProfiles = sqliteTable(
  "organization_profiles",
  {
    id: text("id").primaryKey().$defaultFn(ulid),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    northStarMetric: text("north_star_metric"),
    kpis: text("kpis", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    websiteUrl: text("website_url"),
    monthlyBudgetUsd: real("monthly_budget_usd"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_org_profiles_org").on(table.organizationId),
    index("idx_org_profiles_created").on(table.createdAt),
  ]
);

export const userProfiles = sqliteTable(
  "user_profiles",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow(),
    id: text("id").primaryKey().$defaultFn(ulid),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("idx_user_profiles_user").on(table.userId)]
);

export const organizationProfilesRelations = relations(
  organizationProfiles,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationProfiles.organizationId],
      references: [organization.id],
    }),
  })
);

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(user, {
    fields: [userProfiles.userId],
    references: [user.id],
  }),
}));

export const connectorsRelations = relations(connectors, ({ many, one }) => ({
  jobs: many(connectorJobs),
  organization: one(organization, {
    fields: [connectors.organizationId],
    references: [organization.id],
  }),
  queryCosts: many(dataSourceQueryCosts),
}));

export const connectorJobsRelations = relations(connectorJobs, ({ one }) => ({
  connector: one(connectors, {
    fields: [connectorJobs.connectorId],
    references: [connectors.connectorId],
  }),
}));

export const dataSourceQueryCostsRelations = relations(
  dataSourceQueryCosts,
  ({ one }) => ({
    connector: one(connectors, {
      fields: [dataSourceQueryCosts.connectorId],
      references: [connectors.connectorId],
    }),
    organization: one(organization, {
      fields: [dataSourceQueryCosts.organizationId],
      references: [organization.id],
    }),
  })
);

export const bigqueryQueryCostsRelations = relations(
  bigqueryQueryCosts,
  ({ one }) => ({
    organization: one(organization, {
      fields: [bigqueryQueryCosts.organizationId],
      references: [organization.id],
    }),
  })
);

export const cliQueryActionsRelations = relations(
  cliQueryActions,
  ({ many, one }) => ({
    events: many(cliQueryActionEvents, {
      relationName: "cli_query_action_events_by_action",
    }),
    lastEvent: one(cliQueryActionEvents, {
      fields: [cliQueryActions.id, cliQueryActions.lastEventId],
      relationName: "cli_query_action_last_event",
      references: [cliQueryActionEvents.queryActionId, cliQueryActionEvents.id],
    }),
    organization: one(organization, {
      fields: [cliQueryActions.organizationId],
      references: [organization.id],
    }),
    source: one(dataSources, {
      fields: [cliQueryActions.sourceId],
      references: [dataSources.id],
    }),
  })
);

export const cliQueryActionEventsRelations = relations(
  cliQueryActionEvents,
  ({ many, one }) => ({
    action: one(cliQueryActions, {
      fields: [cliQueryActionEvents.queryActionId],
      relationName: "cli_query_action_events_by_action",
      references: [cliQueryActions.id],
    }),
    causationEvent: one(cliQueryActionEvents, {
      fields: [
        cliQueryActionEvents.queryActionId,
        cliQueryActionEvents.causationEventId,
      ],
      references: [cliQueryActionEvents.queryActionId, cliQueryActionEvents.id],
      relationName: "cli_query_action_event_causation",
    }),
    causedEvents: many(cliQueryActionEvents, {
      relationName: "cli_query_action_event_causation",
    }),
    organization: one(organization, {
      fields: [cliQueryActionEvents.organizationId],
      references: [organization.id],
    }),
    source: one(dataSources, {
      fields: [cliQueryActionEvents.sourceId],
      references: [dataSources.id],
    }),
  })
);

export const dataSourceTableUsageRelations = relations(
  dataSourceTableUsage,
  ({ one }) => ({
    dataSource: one(dataSources, {
      fields: [dataSourceTableUsage.dataSourceId],
      references: [dataSources.id],
    }),
    memoUpdatedByUser: one(user, {
      fields: [dataSourceTableUsage.memoUpdatedBy],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [dataSourceTableUsage.organizationId],
      references: [organization.id],
    }),
  })
);

export const dataSourcesRelations = relations(dataSources, ({ one }) => ({
  organization: one(organization, {
    fields: [dataSources.organizationId],
    references: [organization.id],
  }),
  tableUsage: one(dataSourceTableUsage, {
    fields: [dataSources.id],
    references: [dataSourceTableUsage.dataSourceId],
  }),
}));

export const sqliteSchema = {
  account,
  bigqueryQueryCosts,
  bigqueryQueryCostsRelations,
  cliQueryActionEvents,
  cliQueryActionEventsRelations,
  cliQueryActions,
  cliQueryActionsRelations,
  connectorJobs,
  connectorJobsRelations,
  connectors,
  connectorsRelations,
  dataSourceQueryCosts,
  dataSourceQueryCostsRelations,
  dataSourceTableUsage,
  dataSourceTableUsageRelations,
  dataSources,
  dataSourcesRelations,
  deviceCode,
  invitation,
  member,
  organization,
  organizationProfiles,
  organizationProfilesRelations,
  session,
  user,
  userProfiles,
  userProfilesRelations,
  verification,
};
