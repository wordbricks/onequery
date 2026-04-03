import { mkdtempSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDatabaseRuntime,
  getDatabaseSchema,
  prepareApplicationDatabase,
  sql,
} from "./server";

type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

const DEFAULT_TEST_DATABASE_URL = "postgres://test:test@localhost:5454/test";

async function closeDatabase(db: ClosableDatabase): Promise<void> {
  const client = db.$client;
  if (client && typeof client.close === "function") {
    await client.close();
    return;
  }

  if (client && typeof client.end === "function") {
    await client.end({ timeout: 0 });
  }
}

async function isTcpPortReachable(
  host: string,
  port: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();

    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

const liveDockerDatabaseReachable = await isTcpPortReachable("127.0.0.1", 5454);
const liveDatabaseTest = liveDockerDatabaseReachable ? it : it.skip;
const migrationsFolder = fileURLToPath(
  new URL("./migrations", import.meta.url)
);

describe("database runtime", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("boots the PGlite runtime and keeps a stable runtime schema marker", async () => {
    const root = mkdtempSync(join(tmpdir(), "onequery-db-runtime-test-"));
    const connectionString = `pglite:${join(root, "pglite", "onequery")}`;
    await prepareApplicationDatabase({
      connectionString,
      migrationsFolder,
    });
    const runtime = createDatabaseRuntime(connectionString);
    openedDatabases.push(runtime.db as ClosableDatabase);

    expect(runtime.engine).toBe("pglite");
    expect(runtime.schema.organization).toBeDefined();
    expect(getDatabaseSchema(runtime.db)).toBe(runtime.schema);

    const dbWithInternals = runtime.db as typeof runtime.db & {
      [key: symbol]: unknown;
      _?: {
        fullSchema?: unknown;
      };
    };

    const originalInternals = dbWithInternals._;
    Object.defineProperty(dbWithInternals, "_", {
      configurable: true,
      value: undefined,
    });

    expect(dbWithInternals[Symbol.for("onequery.db.runtime-schema")]).toBe(
      runtime.schema
    );
    expect(getDatabaseSchema(runtime.db)).toBe(runtime.schema);

    Object.defineProperty(dbWithInternals, "_", {
      configurable: true,
      value: originalInternals,
    });
  });

  // Comment: this integration check uses the shared local/CI test Postgres DSN
  // and only runs when the Docker-exposed port is reachable.
  liveDatabaseTest(
    "boots the Postgres runtime against the live docker database",
    async () => {
      const runtime = createDatabaseRuntime(DEFAULT_TEST_DATABASE_URL);
      openedDatabases.push(runtime.db as ClosableDatabase);

      expect(runtime.engine).toBe("postgres");
      expect(runtime.schema.organization).toBeDefined();

      const rows = await runtime.db.execute(sql`select 1 as ok`);
      expect(rows).toEqual([{ ok: 1 }]);
    }
  );
});
