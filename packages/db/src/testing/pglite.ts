import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

import { schema } from "../client";
import type { Database } from "../client";
import { resolvePgliteRuntimeOptions } from "../pglite";
import { sql } from "../shared";

type PgTableRow = {
  tablename: string;
};

type PgTableResult =
  | PgTableRow[]
  | {
      rows: PgTableRow[];
    };

export type PgliteTestDatabase = {
  client: PGlite;
  db: Database;
};

export async function createPgliteTestDatabase(options: {
  migrationsFolder: string;
}): Promise<PgliteTestDatabase> {
  // Comment: CI can keep Vitest worker threads alive after file-backed PGlite
  // closes; in-memory PGlite follows Drizzle's test pattern and avoids NodeFS.
  const client = new PGlite(resolvePgliteRuntimeOptions());
  const db = drizzlePglite(client, { schema });

  await migratePglite(db, {
    migrationsFolder: options.migrationsFolder,
  });

  return {
    client,
    db,
  };
}

export async function resetPgliteTestDatabase(db: Database): Promise<void> {
  const tableResult = (await db.execute(sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `)) as PgTableResult;
  const tableRows = Array.isArray(tableResult) ? tableResult : tableResult.rows;

  if (tableRows.length === 0) {
    return;
  }

  await db.execute(sql`
    TRUNCATE TABLE ${sql.join(
      tableRows.map((row) => sql.identifier(row.tablename)),
      sql`, `
    )} RESTART IDENTITY CASCADE
  `);
}

export async function closePgliteTestDatabase(
  testDatabase: PgliteTestDatabase
): Promise<void> {
  await testDatabase.client.close();
}
