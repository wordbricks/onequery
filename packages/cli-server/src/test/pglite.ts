import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, prepareApplicationDatabase, sql } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";

type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

type PgTableRow = {
  tablename: string;
};

type PgTableResult =
  | PgTableRow[]
  | {
      rows: PgTableRow[];
    };

export type PgliteTestDatabase = {
  connectionString: string;
  db: Database;
  rootDir: string;
};

export async function createPgliteTestDatabase(options: {
  migrationsFolder: string;
  prefix: string;
}): Promise<PgliteTestDatabase> {
  const rootDir = mkdtempSync(join(tmpdir(), options.prefix));
  const connectionString = `pglite:${join(rootDir, "db")}`;

  await prepareApplicationDatabase({
    connectionString,
    migrationsFolder: options.migrationsFolder,
  });

  return {
    connectionString,
    db: createDb(connectionString),
    rootDir,
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
  const db = testDatabase.db as ClosableDatabase;
  const client = db.$client;
  if (client && typeof client.close === "function") {
    await client.close();
  } else if (client && typeof client.end === "function") {
    await client.end({ timeout: 0 });
  }

  // Comment: createDb() keeps a process-global cache for runtime DB reuse; PGlite
  // tests create disposable data dirs, so teardown must evict the closed entry.
  const globalWithDbCache = globalThis as typeof globalThis &
    Record<symbol, Map<string, unknown> | undefined>;
  globalWithDbCache[Symbol.for("onequery.db.instance-cache")]?.delete(
    testDatabase.connectionString
  );

  rmSync(testDatabase.rootDir, {
    force: true,
    recursive: true,
  });
}
