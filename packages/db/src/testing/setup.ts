import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { test as baseTest } from "vitest";

import { schema } from "../client";
import type { Database } from "../client";
import { resolvePgliteRuntimeOptions } from "../pglite";
import { TransactionRollbackError } from "../shared";

const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url)
);

type MigratedPgliteTestDatabase = {
  db: Database;
};

export const test = baseTest.extend<{
  $file?: {
    migratedPgliteTestDatabase: MigratedPgliteTestDatabase;
  };
  $test?: {
    db: Database;
  };
}>({
  migratedPgliteTestDatabase: [
    async ({}, provide) => {
      // Comment: CI can keep Vitest worker threads alive after file-backed
      // PGlite closes; in-memory PGlite follows Drizzle's test pattern.
      const client = new PGlite(resolvePgliteRuntimeOptions());
      const db = drizzlePglite(client, {
        schema,
      });

      await migratePglite(db, {
        migrationsFolder,
      });

      try {
        await provide({
          db,
        });
      } finally {
        await client.close();
      }
    },
    {
      scope: "file",
    },
  ],
  db: async ({ migratedPgliteTestDatabase }, provide) => {
    try {
      // Comment: Drizzle PGlite transactions support nested savepoints, so
      // tests can share one migrated file scope while rolling back all writes.
      await migratedPgliteTestDatabase.db.transaction(async (tx) => {
        await provide(tx as Database);
        tx.rollback();
      });
    } catch (error) {
      if (error instanceof TransactionRollbackError) {
        return;
      }

      throw error;
    }
  },
});
