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

type ClosableDatabaseClient = {
  close?: () => Promise<unknown>;
  end?: (options?: { timeout?: number }) => Promise<unknown>;
};

type DbCacheEntry = {
  client: ClosableDatabaseClient;
  closed: boolean;
  closePromise?: Promise<void>;
  db: Database;
  engine: DatabaseEngine;
};

export type DatabaseHandle = {
  close(): Promise<void>;
  db: Database;
  engine: DatabaseEngine;
};

type DbCache = Map<string, DbCacheEntry>;

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
  return createDatabaseHandle(connectionString).db;
}

export function createDatabaseHandle(connectionString: string): DatabaseHandle {
  const cache = getDbCache();
  const cachedDb = cache.get(connectionString);
  if (cachedDb && !cachedDb.closed) {
    return {
      close: () => closeDatabaseHandle(connectionString, cachedDb),
      db: cachedDb.db,
      engine: cachedDb.engine,
    };
  }

  if (cachedDb?.closed) {
    cache.delete(connectionString);
  }

  let cacheEntry: DbCacheEntry;

  if (isPgliteConnectionString(connectionString)) {
    cacheEntry = createPgliteDbCacheEntry(connectionString);
  } else {
    const client = postgres(connectionString, {
      max: 5,
      // Disable fetch_types to avoid extra round-trip (unnecessary latency)
      fetch_types: false,
      prepare: true,
    });
    cacheEntry = {
      client,
      closed: false,
      db: drizzle(client, { schema }),
      engine: "postgres",
    };
  }

  cache.set(connectionString, cacheEntry);

  return {
    close: () => closeDatabaseHandle(connectionString, cacheEntry),
    db: cacheEntry.db,
    engine: cacheEntry.engine,
  };
}

async function closeDatabaseHandle(
  connectionString: string,
  cacheEntry: DbCacheEntry
): Promise<void> {
  if (cacheEntry.closed) {
    return;
  }

  if (cacheEntry.closePromise) {
    await cacheEntry.closePromise;
    return;
  }

  cacheEntry.closePromise = closeDatabaseClient(cacheEntry.client)
    .then(() => {
      cacheEntry.closed = true;
      getDbCache().delete(connectionString);
    })
    .finally(() => {
      if (!cacheEntry.closed) {
        cacheEntry.closePromise = undefined;
      }
    });

  await cacheEntry.closePromise;
}

async function closeDatabaseClient(
  client: ClosableDatabaseClient
): Promise<void> {
  if (typeof client.close === "function") {
    await client.close();
    return;
  }

  await client.end?.({ timeout: 0 });
}

function createPgliteDbCacheEntry(connectionString: string): DbCacheEntry {
  const client = new PGlite(
    ensurePgliteDataDir(connectionString),
    resolvePgliteRuntimeOptions()
  );

  return {
    client,
    closed: false,
    db: drizzlePglite(client, {
      schema,
    }),
    engine: "pglite",
  };
}

export * from "./schema";
