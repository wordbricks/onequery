import {
  CLI_QUERY_ACTION_ACTOR_AUTH_MODES,
  CLI_QUERY_ACTION_EVENT_TYPES,
  CLI_QUERY_ACTION_STAGES,
  CLI_QUERY_ACTION_STATUSES,
  CLI_QUERY_ACTION_TYPES,
  CLI_QUERY_USAGE_PERSISTENCE_STATUSES,
} from "@onequery/contracts/audit";
import type {
  CliQueryActionActorAuthMode,
  CliQueryActionEventType,
  CliQueryActionStage,
  CliQueryActionStatus,
  CliQueryActionType,
  CliQueryUsagePersistenceStatus,
} from "@onequery/contracts/audit";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ForeignKeyBuilder } from "drizzle-orm/pg-core/foreign-keys";

import { organization } from "./auth";
import type { DataSourceStatus, ProviderType } from "./data-sources";
import { dataSources } from "./data-sources";
import { pgTable } from "./table";
import { ulid } from "./ulid";

type AnyPgColumn = import("drizzle-orm/pg-core").AnyPgColumn;
type PgTableExtraConfigValue =
  import("drizzle-orm/pg-core").PgTableExtraConfigValue;

export {
  CLI_QUERY_ACTION_ACTOR_AUTH_MODES,
  CLI_QUERY_ACTION_EVENT_TYPES,
  CLI_QUERY_ACTION_STAGES,
  CLI_QUERY_ACTION_STATUSES,
  CLI_QUERY_ACTION_TYPES,
  CLI_QUERY_USAGE_PERSISTENCE_STATUSES,
};
export type {
  CliQueryActionActorAuthMode,
  CliQueryActionEventType,
  CliQueryActionStage,
  CliQueryActionStatus,
  CliQueryActionType,
  CliQueryUsagePersistenceStatus,
};

const CLI_QUERY_ACTION_TYPES_SQL = CLI_QUERY_ACTION_TYPES.map(
  (type) => `'${type}'`
).join(", ");
const CLI_QUERY_ACTION_ACTOR_AUTH_MODES_SQL =
  CLI_QUERY_ACTION_ACTOR_AUTH_MODES.map((mode) => `'${mode}'`).join(", ");
const CLI_QUERY_ACTION_EVENT_TYPES_SQL = CLI_QUERY_ACTION_EVENT_TYPES.map(
  (type) => `'${type}'`
).join(", ");
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

export const cliQueryActions = pgTable(
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
    actorMembershipRoles: jsonb("actor_membership_roles")
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
    normalizedSqlChanged: boolean("normalized_sql_changed")
      .notNull()
      .default(false),
    rowCount: integer("row_count"),
    elapsedMs: integer("elapsed_ms"),
    errorDetail: text("error_detail"),
    errorHint: text("error_hint"),
    retryable: boolean("retryable"),
    lastEventId: text("last_event_id"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    version: integer("version").notNull().default(1),
  },
  (table): PgTableExtraConfigValue[] => [
    index("idx_cli_query_actions_org_created").on(
      table.organizationId,
      table.createdAt
    ),
    // Comment: This must be a table-level UNIQUE constraint rather than a
    // standalone unique index because Drizzle orders FK creation before index
    // creation during push/migration diffs for altered tables.
    unique("cli_query_actions_identity_unique").on(
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
    // Comment: Drizzle's public PG foreign key helper does not expose the lazy
    // callback form, so the circular last-event aggregate FK uses the builder
    // directly here to keep the schema source and generated migrations aligned.
    new ForeignKeyBuilder(() => ({
      columns: [table.id, table.lastEventId],
      foreignColumns: [
        cliQueryActionEvents.queryActionId as AnyPgColumn,
        cliQueryActionEvents.id as AnyPgColumn,
      ],
      name: "cli_query_actions_same_action_last_event_fk",
    })),
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

export const cliQueryActionEvents = pgTable(
  "cli_query_action_events",
  {
    id: text("id").primaryKey().$defaultFn(ulid),
    queryActionId: text("query_action_id")
      .notNull()
      .references((): AnyPgColumn => cliQueryActions.id, {
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
    actorMembershipRoles: jsonb("actor_membership_roles")
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
    normalizedSqlChanged: boolean("normalized_sql_changed")
      .notNull()
      .default(false),
    rowCount: integer("row_count"),
    elapsedMs: integer("elapsed_ms"),
    errorDetail: text("error_detail"),
    errorHint: text("error_hint"),
    retryable: boolean("retryable"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    causationEventId: text("causation_event_id"),
    orgSlug: text("org_slug"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
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
    // Comment: This must be a table-level UNIQUE constraint rather than a
    // standalone unique index because other composite FKs reference this exact
    // pair and Postgres validates that at FK-creation time.
    unique("cli_query_action_events_action_id_unique").on(
      table.queryActionId,
      table.id
    ),
    uniqueIndex("idx_cli_query_action_events_action_event_type_unique").on(
      table.queryActionId,
      table.eventType
    ),
    new ForeignKeyBuilder(() => ({
      columns: [
        table.queryActionId,
        table.organizationId,
        table.requestId,
        table.actionType,
        table.sourceKey,
      ],
      foreignColumns: [
        cliQueryActions.id as AnyPgColumn,
        cliQueryActions.organizationId as AnyPgColumn,
        cliQueryActions.requestId as AnyPgColumn,
        cliQueryActions.actionType as AnyPgColumn,
        cliQueryActions.sourceKey as AnyPgColumn,
      ],
      name: "cli_query_action_events_action_identity_fk",
    })),
    new ForeignKeyBuilder(() => ({
      columns: [table.queryActionId, table.causationEventId],
      foreignColumns: [
        cliQueryActionEvents.queryActionId as AnyPgColumn,
        cliQueryActionEvents.id as AnyPgColumn,
      ],
      name: "cli_query_action_events_same_action_causation_fk",
    })),
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

export type CliQueryAction = typeof cliQueryActions.$inferSelect;
export type NewCliQueryAction = typeof cliQueryActions.$inferInsert;
export type CliQueryActionEvent = typeof cliQueryActionEvents.$inferSelect;
export type NewCliQueryActionEvent = typeof cliQueryActionEvents.$inferInsert;
