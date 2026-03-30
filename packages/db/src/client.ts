// Comment: Phase 3 keeps the public @onequery/db surface stable while the runtime
// can now select SQLite or Postgres once at startup.
import { createRequire } from "node:module";

import BetterSqliteClient from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
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
import { bootstrapSqliteDatabase } from "./sqlite-bootstrap";
import { sqliteSchema } from "./sqlite-schema";

const require = createRequire(import.meta.url);

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

export type DatabaseEngine = "postgres" | "sqlite";
export type DatabaseSchema = typeof postgresSchema;
export type Database = PostgresJsDatabase<typeof postgresSchema>;
export type DatabaseRuntime = {
  db: Database;
  engine: DatabaseEngine;
  schema: DatabaseSchema;
};

type DbCache = Map<string, Database>;
type BunSqliteModule = typeof import("bun:sqlite");
type BunSqliteDrizzleModule = typeof import("drizzle-orm/bun-sqlite");

function isBunRuntime(): boolean {
  return typeof Bun !== "undefined";
}

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

function isSqliteConnectionString(connectionString: string): boolean {
  return (
    connectionString === ":memory:" ||
    connectionString.startsWith("sqlite:") ||
    connectionString.endsWith(".sqlite") ||
    connectionString.endsWith(".db")
  );
}

function resolveSqlitePath(connectionString: string): string {
  if (connectionString === ":memory:") {
    return connectionString;
  }

  if (connectionString.startsWith("sqlite://")) {
    return connectionString.slice("sqlite://".length - 1);
  }

  if (connectionString.startsWith("sqlite:")) {
    return connectionString.slice("sqlite:".length);
  }

  return connectionString;
}

export function getDatabaseEngine(connectionString: string): DatabaseEngine {
  return isSqliteConnectionString(connectionString) ? "sqlite" : "postgres";
}

export function getDatabaseSchemaForEngine(
  engine: DatabaseEngine
): DatabaseSchema {
  if (engine === "sqlite") {
    return sqliteSchema as unknown as DatabaseSchema;
  }

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
  const runtimeSchema = isSqliteConnectionString(connectionString)
    ? (sqliteSchema as unknown as DatabaseSchema)
    : postgresSchema;

  const cache = getDbCache();
  const cachedDb = cache.get(connectionString);
  if (cachedDb) {
    return cachedDb;
  }

  let db: Database;

  if (isSqliteConnectionString(connectionString)) {
    db = createSqliteDb(connectionString);
  } else {
    const client = postgres(connectionString, {
      max: 5,
      // Disable fetch_types to avoid extra round-trip (unnecessary latency)
      fetch_types: false,
      prepare: true,
    });
    db = drizzle(client, { schema: postgresSchema });
  }

  db = attachRuntimeSchema(db, runtimeSchema);
  cache.set(connectionString, db);

  return db;
}

function createSqliteDb(connectionString: string): Database {
  const sqlitePath = resolveSqlitePath(connectionString);

  if (isBunRuntime()) {
    // CONTEXT: Bun self-host runtime cannot load better-sqlite3, so use the
    // native bun:sqlite driver with Drizzle's Bun adapter instead.
    const { Database: BunSqliteDatabase } =
      require("bun:sqlite") as BunSqliteModule;
    const { drizzle: drizzleBunSqlite } =
      require("drizzle-orm/bun-sqlite") as BunSqliteDrizzleModule;
    const client = new BunSqliteDatabase(sqlitePath);
    bootstrapSqliteDatabase(client);
    return drizzleBunSqlite(client, {
      schema: sqliteSchema,
    }) as unknown as Database;
  }

  const client = new BetterSqliteClient(sqlitePath);
  bootstrapSqliteDatabase(client);
  return drizzleSqlite(client, {
    schema: sqliteSchema,
  }) as unknown as Database;
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
