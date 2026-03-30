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
      engine: "sqlite";
      mode: "bootstrap";
    };

export async function prepareSelfHostDatabase(options: {
  connectionString: string;
  migrationsFolder: string;
}): Promise<DatabasePreparationResult> {
  if (getDatabaseEngine(options.connectionString) === "sqlite") {
    // Comment: SQLite still bootstraps schema from the checked-in runtime schema
    // in createDb(); only Postgres consumes the Drizzle SQL migrations folder.
    return {
      engine: "sqlite",
      mode: "bootstrap",
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
