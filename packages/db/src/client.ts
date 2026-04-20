// Comment: The public @onequery/db surface stays stable while the runtime now
// selects either a remote Postgres connection or a local PGlite data dir.
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  ensurePgliteDataDir,
  isPgliteConnectionString,
  resolvePgliteRuntimeOptions,
} from "./pglite";
import * as auditFeedEntriesSchema from "./schema/audit-feed-entries";
import * as auditProjectionCheckpointsSchema from "./schema/audit-projection-checkpoints";
import * as auditWorkflowSchema from "./schema/audit-workflow";
import * as authSchema from "./schema/auth";
import * as bigQueryQueryCostsSchema from "./schema/bigquery-query-costs";
import * as connectorsSchema from "./schema/connectors";
import * as dataSourceQueryCostsSchema from "./schema/data-source-query-costs";
import * as dataSourceTableUsageSchema from "./schema/data-source-table-usage";
import * as dataSourcesSchema from "./schema/data-sources";
import * as organizationProfilesSchema from "./schema/organization-profiles";
import * as queryActionEventsSchema from "./schema/query-action-events";
import * as queryActionsSchema from "./schema/query-actions";
import * as relationsSchema from "./schema/relations";
import * as sourceApiActionEventsSchema from "./schema/source-api-action-events";
import * as sourceApiActionsSchema from "./schema/source-api-actions";
import * as userProfilesSchema from "./schema/user-profiles";
import * as workflowCommandsSchema from "./schema/workflow-commands";
import * as workflowEffectDispatchesSchema from "./schema/workflow-effect-dispatches";

export const postgresSchema = {
  ...auditFeedEntriesSchema,
  ...auditProjectionCheckpointsSchema,
  ...auditWorkflowSchema,
  ...authSchema,
  ...bigQueryQueryCostsSchema,
  ...dataSourcesSchema,
  ...dataSourceQueryCostsSchema,
  ...dataSourceTableUsageSchema,
  ...connectorsSchema,
  ...organizationProfilesSchema,
  ...queryActionsSchema,
  ...queryActionEventsSchema,
  ...sourceApiActionsSchema,
  ...sourceApiActionEventsSchema,
  ...userProfilesSchema,
  ...workflowCommandsSchema,
  ...workflowEffectDispatchesSchema,
  ...relationsSchema,
};

export const schema = postgresSchema;

const DB_CACHE_SYMBOL = Symbol.for("onequery.db.instance-cache");
const DB_RUNTIME_SCHEMA_SYMBOL = Symbol.for("onequery.db.runtime-schema");

export type DatabaseEngine = "postgres" | "pglite";
export type DatabaseSchema = typeof postgresSchema;
export type Database = PgDatabase<PgQueryResultHKT, typeof postgresSchema>;
export type DatabaseRuntime = {
  db: Database;
  engine: DatabaseEngine;
  schema: DatabaseSchema;
};

type DbCache = Map<string, Database>;

function getDbCache(): DbCache {
  const globalWithCache = globalThis as typeof globalThis & {
    [DB_CACHE_SYMBOL]?: DbCache;
  };

  if (!globalWithCache[DB_CACHE_SYMBOL]) {
    globalWithCache[DB_CACHE_SYMBOL] = new Map();
  }

  return globalWithCache[DB_CACHE_SYMBOL];
}

function attachRuntimeSchema(
  db: Database,
  runtimeSchema: DatabaseSchema
): Database {
  Object.defineProperty(db, DB_RUNTIME_SCHEMA_SYMBOL, {
    configurable: true,
    enumerable: false,
    value: runtimeSchema,
    writable: false,
  });
  return db;
}

export function getDatabaseEngine(connectionString: string): DatabaseEngine {
  return isPgliteConnectionString(connectionString) ? "pglite" : "postgres";
}

export function getDatabaseSchemaForEngine(
  _engine: DatabaseEngine
): DatabaseSchema {
  return postgresSchema;
}

export function getDatabaseSchema(db: Database): DatabaseSchema {
  const stableRuntimeSchema = (
    db as Database & {
      [DB_RUNTIME_SCHEMA_SYMBOL]?: DatabaseSchema;
    }
  )[DB_RUNTIME_SCHEMA_SYMBOL];
  if (stableRuntimeSchema) {
    return stableRuntimeSchema;
  }

  const drizzleRuntimeSchema = (
    db as Database & {
      _: {
        fullSchema?: DatabaseSchema;
      };
    }
  )._?.fullSchema;

  if (!drizzleRuntimeSchema) {
    throw new Error("Database instance does not expose a runtime schema");
  }

  return drizzleRuntimeSchema;
}

export function createDatabaseRuntime(
  connectionString: string
): DatabaseRuntime {
  const engine = getDatabaseEngine(connectionString);
  return {
    db: createDb(connectionString),
    engine,
    schema: getDatabaseSchemaForEngine(engine),
  };
}

export function createDb(connectionString: string): Database {
  const cache = getDbCache();
  const cachedDb = cache.get(connectionString);
  if (cachedDb) {
    return cachedDb;
  }

  let db: Database;

  if (isPgliteConnectionString(connectionString)) {
    db = createPgliteDb(connectionString);
  } else {
    const client = postgres(connectionString, {
      max: 5,
      // Disable fetch_types to avoid extra round-trip (unnecessary latency)
      fetch_types: false,
      prepare: true,
    });
    db = drizzle(client, { schema: postgresSchema });
  }

  db = attachRuntimeSchema(db, postgresSchema);
  cache.set(connectionString, db);

  return db;
}

function createPgliteDb(connectionString: string): Database {
  const client = new PGlite(
    ensurePgliteDataDir(connectionString),
    resolvePgliteRuntimeOptions()
  );
  return drizzlePglite(client, {
    schema: postgresSchema,
  });
}

export * from "./schema/audit-feed-entries";
export * from "./schema/audit-projection-checkpoints";
export * from "./schema/audit-workflow";
export * from "./schema/auth";
export * from "./schema/bigquery-query-costs";
export * from "./schema/connectors";
export * from "./schema/data-source-query-costs";
export * from "./schema/data-source-table-usage";
export * from "./schema/data-sources";
export * from "./schema/organization-profiles";
export * from "./schema/query-action-events";
export * from "./schema/query-actions";
export * from "./schema/relations";
export * from "./schema/source-api-action-events";
export * from "./schema/source-api-actions";
export * from "./schema/user-profiles";
export * from "./schema/workflow-commands";
export * from "./schema/workflow-effect-dispatches";
