import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach } from "vitest";

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

const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url)
);

// Comment: CI can keep Vitest worker threads alive after file-backed PGlite
// closes; in-memory PGlite follows Drizzle's test pattern and avoids NodeFS.
const pgliteTestClient = new PGlite(resolvePgliteRuntimeOptions());
const pgliteDrizzleDb = drizzlePglite(pgliteTestClient, {
  schema,
});
export const pgliteTestDb = pgliteDrizzleDb as Database;

async function resetPgliteTestDatabase(db: Database): Promise<void> {
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

beforeAll(async () => {
  await migratePglite(pgliteDrizzleDb, {
    migrationsFolder,
  });
}, 15_000);

beforeEach(async () => {
  await resetPgliteTestDatabase(pgliteTestDb);
});

afterAll(async () => {
  await pgliteTestClient.close();
});
