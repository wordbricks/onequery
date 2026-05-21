import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach } from "vitest";

import { schema } from "../client";
import { resolvePgliteRuntimeOptions } from "../pglite";
import { sql } from "../shared";

const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url)
);

// Comment: CI can keep Vitest worker threads alive after file-backed PGlite
// closes; in-memory PGlite follows Drizzle's test pattern and avoids NodeFS.
const pgliteTestClient = new PGlite(resolvePgliteRuntimeOptions());
export const pgliteTestDb = drizzlePglite(pgliteTestClient, {
  schema,
});

type PgTableRow = {
  tablename: string;
};

function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function readRows<Row>(result: unknown): Row[] {
  return Array.isArray(result)
    ? result
    : ((result as { rows?: Row[] }).rows ?? []);
}

async function truncatePublicTables() {
  const tables = readRows<PgTableRow>(
    await pgliteTestDb.execute(sql`
      select tablename
      from pg_tables
      where schemaname = 'public'
    `)
  );

  if (tables.length === 0) {
    return;
  }

  const tableList = tables
    .map(({ tablename }) => `"public".${quotePgIdentifier(tablename)}`)
    .join(", ");

  await pgliteTestDb.execute(
    sql.raw(`truncate table ${tableList} restart identity cascade`)
  );
}

beforeAll(async () => {
  // Comment: migration is the slow PGlite path in CI; keep the migrated schema
  // and Drizzle metadata for this test file, then reset data between tests.
  await migratePglite(pgliteTestDb, {
    migrationsFolder,
  });
}, 60_000);

beforeEach(async () => {
  await truncatePublicTables();
}, 15_000);

afterAll(async () => {
  await pgliteTestClient.close();
});
