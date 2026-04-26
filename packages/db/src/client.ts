// Comment: Both runtime engines use the same Drizzle schema object; keep the
// schema as a static export instead of deriving it back from DB instances.
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
import { schema } from "./schema";

const DB_CACHE_SYMBOL = Symbol.for("onequery.db.instance-cache");

export type DatabaseEngine = "postgres" | "pglite";
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

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

export function getDatabaseEngine(connectionString: string): DatabaseEngine {
  return isPgliteConnectionString(connectionString) ? "pglite" : "postgres";
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
    db = drizzle(client, { schema });
  }

  cache.set(connectionString, db);

  return db;
}

function createPgliteDb(connectionString: string): Database {
  const client = new PGlite(
    ensurePgliteDataDir(connectionString),
    resolvePgliteRuntimeOptions()
  );
  return drizzlePglite(client, {
    schema,
  });
}

export * from "./schema";
