import {
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { pgTable } from "./table";

export const CONNECTOR_HEALTH_STATUS = ["healthy", "degraded"] as const;

export type ConnectorHealthStatus = (typeof CONNECTOR_HEALTH_STATUS)[number];

export const CONNECTOR_JOB_STATUS = [
  "queued",
  "leased",
  "completed",
  "expired",
] as const;

export type ConnectorJobStatus = (typeof CONNECTOR_JOB_STATUS)[number];

export type ConnectorMetadata = {
  version?: string;
  runtime?: string;
  awsRegion?: string;
};

export type ConnectorJobColumn = {
  name: string;
  type: string;
};

export type ConnectorAthenaJobOutcome =
  | {
      jobId: string;
      status: "success";
      columns: ConnectorJobColumn[];
      rows: string[][];
      stats?: {
        executionTimeMs?: number;
        rowCount?: number;
        dataScannedBytes?: string;
        queryExecutionId?: string;
      };
    }
  | {
      jobId: string;
      status: "error";
      error: {
        code: string;
        message: string;
      };
    };

export const connectors = pgTable(
  "connectors",
  {
    authTokenHash: text("auth_token_hash").notNull(),
    connectorId: text("connector_id").primaryKey(),
    connectorName: text("connector_name").notNull(),
    healthStatus: text("health_status").$type<ConnectorHealthStatus>(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<ConnectorMetadata>(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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

export const connectorJobs = pgTable(
  "connector_jobs",
  {
    completedAt: timestamp("completed_at", { withTimezone: true }),
    connectorId: text("connector_id")
      .notNull()
      .references(() => connectors.connectorId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    database: text("database").notNull(),
    jobId: text("job_id").primaryKey(),
    leasedAt: timestamp("leased_at", { withTimezone: true }),
    maxRows: integer("max_rows"),
    outcome: jsonb("outcome").$type<ConnectorAthenaJobOutcome>(),
    sql: text("sql").notNull(),
    status: text("status").notNull().$type<ConnectorJobStatus>(),
    timeoutMs: integer("timeout_ms"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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

export type Connector = typeof connectors.$inferSelect;
export type NewConnector = typeof connectors.$inferInsert;
export type ConnectorJob = typeof connectorJobs.$inferSelect;
export type NewConnectorJob = typeof connectorJobs.$inferInsert;
