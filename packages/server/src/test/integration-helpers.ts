import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareApplicationDatabase } from "@onequery/db/server";
import { Hono } from "hono";

import { createServerApi } from "../app";
import { createMemoryApiRateLimitStorage } from "../lib/rate-limit-storage";
import {
  createTestRuntimeConfig,
  createTestRuntimeConfigFromDatabaseUrl,
} from "../routes/test-env";
import type { TestRuntimeConfigOverrides } from "../routes/test-env";
import { createServerStorage } from "../storage";

export type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

const migrationsFolder = fileURLToPath(
  new URL("../../../db/src/migrations", import.meta.url)
);

export function createRunId() {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function closeDatabase(db: ClosableDatabase): Promise<void> {
  const client = db.$client;

  if (client && typeof client.close === "function") {
    await client.close();
    return;
  }

  if (client && typeof client.end === "function") {
    await client.end({ timeout: 0 });
  }
}

export async function createPgliteDatabaseUrl(
  prefix: string,
  pathSegments: string[] = ["pglite", "onequery"]
): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const databaseUrl = `pglite:${join(root, ...pathSegments)}`;

  await prepareApplicationDatabase({
    connectionString: databaseUrl,
    migrationsFolder,
  });

  return databaseUrl;
}

export async function createRouteIntegrationHarness(
  overrides: TestRuntimeConfigOverrides = {}
) {
  const runtimeConfig =
    overrides.databaseUrl !== undefined
      ? createTestRuntimeConfigFromDatabaseUrl(overrides.databaseUrl, overrides)
      : overrides.storage?.connectionString !== undefined
        ? createTestRuntimeConfigFromDatabaseUrl(
            overrides.storage.connectionString,
            overrides
          )
        : createTestRuntimeConfig(overrides);
  const storage = createServerStorage(
    runtimeConfig,
    createMemoryApiRateLimitStorage(),
    {
      enableAuthTestUtils: true,
    }
  );
  const app = new Hono().route(
    "/api",
    createServerApi({
      enableAuthTestUtils: true,
      runtime: runtimeConfig,
      storage,
    })
  );
  const authContext = await storage.auth.$context;
  const test = authContext.test;

  if (!test.createOrganization || !test.saveOrganization || !test.addMember) {
    throw new Error(
      "Better Auth test utilities must expose organization helpers"
    );
  }

  return {
    app,
    auth: storage.auth,
    db: storage.db,
    runtimeConfig,
    test: test as typeof test & {
      addMember: NonNullable<typeof test.addMember>;
      createOrganization: NonNullable<typeof test.createOrganization>;
      saveOrganization: NonNullable<typeof test.saveOrganization>;
    },
  };
}
