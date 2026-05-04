import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareApplicationDatabase } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import { Hono } from "hono";
import { testClient } from "hono/testing";

import { createServerApiApp } from "../app";
import { createMemoryApiRateLimitStorage } from "../lib/rate-limit-storage";
import { createTestRuntimeConfigFromDatabaseUrl } from "../routes/test-env";
import type { TestRuntimeConfigOverrides } from "../routes/test-env";
import { createServerStorage } from "../storage";

export type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

class RouteIntegrationHarnessError extends TaggedError(
  "RouteIntegrationHarnessError"
)<{
  cause?: unknown;
  message: string;
  reason:
    | "database_setup_failed"
    | "invalid_runtime_config"
    | "missing_auth_test_utils";
}>() {}

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
  const databaseUrlResult = await Result.tryPromise({
    try: async () => {
      if (overrides.databaseUrl !== undefined) {
        return overrides.databaseUrl;
      }

      if (overrides.storage?.connectionString !== undefined) {
        return overrides.storage.connectionString;
      }

      return createPgliteDatabaseUrl("onequery-route-harness-");
    },
    catch: (cause) =>
      new RouteIntegrationHarnessError({
        cause,
        message: "Failed to prepare route integration database",
        reason: "database_setup_failed",
      }),
  });
  if (databaseUrlResult.isErr()) {
    return Result.err(databaseUrlResult.error);
  }

  const runtimeConfig = createTestRuntimeConfigFromDatabaseUrl(
    databaseUrlResult.value,
    overrides
  );
  if (runtimeConfig.isErr()) {
    return Result.err(
      new RouteIntegrationHarnessError({
        cause: runtimeConfig.error,
        message: runtimeConfig.error.message,
        reason: "invalid_runtime_config",
      })
    );
  }

  const storage = createServerStorage(
    runtimeConfig.value,
    createMemoryApiRateLimitStorage(),
    {
      enableAuthTestUtils: true,
    }
  );
  const app = new Hono().route(
    "/api",
    createServerApiApp({
      enableAuthTestUtils: true,
      runtime: runtimeConfig.value,
      storage,
    })
  );
  const authContext = await storage.auth.$context;
  const test = authContext.test;

  if (!test.createOrganization || !test.saveOrganization || !test.addMember) {
    return Result.err(
      new RouteIntegrationHarnessError({
        message: "Better Auth test utilities must expose organization helpers",
        reason: "missing_auth_test_utils",
      })
    );
  }

  return Result.ok({
    app,
    auth: storage.auth,
    client: testClient(app),
    db: storage.db,
    runtimeConfig: runtimeConfig.value,
    test: test as typeof test & {
      addMember: NonNullable<typeof test.addMember>;
      createOrganization: NonNullable<typeof test.createOrganization>;
      saveOrganization: NonNullable<typeof test.saveOrganization>;
    },
  });
}
