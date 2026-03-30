import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { getDatabaseEngine, postgresSchema } from "./client";

export type DatabasePreparationResult =
  | {
      engine: "postgres";
      mode: "migrate";
    }
  | {
      engine: "pglite";
      mode: "migrate";
    };

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

export async function prepareSelfHostDatabase(options: {
  connectionString: string;
  migrationsFolder: string;
}): Promise<DatabasePreparationResult> {
  if (getDatabaseEngine(options.connectionString) === "pglite") {
    const client = new PGlite(ensurePgliteDataDir(options.connectionString));

    try {
      const db = drizzlePglite(client, { schema: postgresSchema });
      await migratePglite(db, {
        migrationsFolder: options.migrationsFolder,
      });
    } finally {
      await client.close();
    }

    return {
      engine: "pglite",
      mode: "migrate",
    };
  }

  const client = postgres(options.connectionString, {
    fetch_types: false,
    max: 1,
    // Comment: Drizzle's Postgres migrator issues idempotent CREATE statements
    // on every startup; PostgreSQL emits NOTICEs for the already-existing
    // drizzle schema/table, which is noise during `bun dev`.
    onnotice() {},
    prepare: false,
  });

  try {
    const db = drizzle(client, { schema: postgresSchema });
    await migratePostgres(db, {
      migrationsFolder: options.migrationsFolder,
    });
  } finally {
    await client.end({ timeout: 0 });
  }

  return {
    engine: "postgres",
    mode: "migrate",
  };
}
