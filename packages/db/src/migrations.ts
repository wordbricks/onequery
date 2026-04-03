import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { getDatabaseEngine, postgresSchema } from "./client";
import { ensurePgliteDataDir, resolvePgliteRuntimeOptions } from "./pglite";

export type DatabasePreparationResult =
  | {
      engine: "postgres";
      mode: "migrate";
    }
  | {
      engine: "pglite";
      mode: "migrate";
    };

export async function prepareApplicationDatabase(options: {
  connectionString: string;
  migrationsFolder: string;
}): Promise<DatabasePreparationResult> {
  if (getDatabaseEngine(options.connectionString) === "pglite") {
    const client = new PGlite(
      ensurePgliteDataDir(options.connectionString),
      resolvePgliteRuntimeOptions()
    );

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
