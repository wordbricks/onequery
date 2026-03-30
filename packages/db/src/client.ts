import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Comment: The public @onequery/db surface stays stable while the runtime now
// selects either a remote Postgres connection or a local PGlite data dir.
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as authSchema from "./schema/auth";
import * as bigQueryQueryCostsSchema from "./schema/bigquery-query-costs";
import * as cliQueryActionEventsSchema from "./schema/cli-query-action-events";
import * as cliQueryActionsSchema from "./schema/cli-query-actions";
import * as connectorsSchema from "./schema/connectors";
import * as dataSourceQueryCostsSchema from "./schema/data-source-query-costs";
import * as dataSourceTableUsageSchema from "./schema/data-source-table-usage";
import * as dataSourcesSchema from "./schema/data-sources";
import * as organizationProfilesSchema from "./schema/organization-profiles";
import * as relationsSchema from "./schema/relations";
import * as userProfilesSchema from "./schema/user-profiles";

export const postgresSchema = {
  ...authSchema,
  ...bigQueryQueryCostsSchema,
  ...cliQueryActionsSchema,
  ...cliQueryActionEventsSchema,
  ...dataSourcesSchema,
  ...dataSourceQueryCostsSchema,
  ...dataSourceTableUsageSchema,
  ...connectorsSchema,
  ...organizationProfilesSchema,
  ...userProfilesSchema,
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

function isPgliteConnectionString(connectionString: string): boolean {
  return (
    connectionString === "memory://" ||
    connectionString.startsWith("pglite:") ||
    connectionString.startsWith("pglite://")
  );
}

function resolvePgliteDataDir(connectionString: string): string {
  if (connectionString === "memory://") {
    return connectionString;
  }

  if (connectionString.startsWith("pglite://")) {
    return connectionString.slice("pglite://".length - 1);
  }

  if (connectionString.startsWith("pglite:")) {
    return connectionString.slice("pglite:".length);
  }

  throw new Error(`Unsupported PGlite connection string: ${connectionString}`);
}

function ensurePgliteDataDir(connectionString: string): string {
  const dataDir = resolvePgliteDataDir(connectionString);

  if (dataDir !== "memory://") {
    mkdirSync(dirname(dataDir), {
      recursive: true,
    });
  }

  return dataDir;
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
  const client = new PGlite(ensurePgliteDataDir(connectionString));
  return drizzlePglite(client, {
    schema: postgresSchema,
  });
}

export * from "./schema/auth";
export * from "./schema/bigquery-query-costs";
export * from "./schema/connectors";
export * from "./schema/data-source-query-costs";
export * from "./schema/data-source-table-usage";
export * from "./schema/data-sources";
export * from "./schema/organization-profiles";
export * from "./schema/relations";
export * from "./schema/user-profiles";
