import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeEach } from "vitest";

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

beforeEach(async () => {
  await migratePglite(pgliteTestDb, {
    migrationsFolder,
  });
}, 15_000);

afterEach(async () => {
  await pgliteTestDb.execute(sql`drop schema if exists public cascade`);
  await pgliteTestDb.execute(sql`create schema public`);
  await pgliteTestDb.execute(sql`drop schema if exists drizzle cascade`);
}, 15_000);

afterAll(async () => {
  await pgliteTestClient.close();
});
