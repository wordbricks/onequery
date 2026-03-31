import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb, prepareSelfHostDatabase } from "@onequery/db/server";
import { Hono } from "hono";

import { serverApiRoutes } from "../app";
import { createAuth } from "../auth";
import type { ServerEnv } from "../env";
import { createTestEnv } from "../routes/test-env";

export type ClosableDatabase = {
  $client?: {
    close?: () => void;
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

  await prepareSelfHostDatabase({
    connectionString: databaseUrl,
    migrationsFolder,
  });

  return databaseUrl;
}

export async function createRouteIntegrationHarness(
  overrides: Partial<ServerEnv> = {}
) {
  const env = createTestEnv({
    DISABLE_RATE_LIMIT: true,
    ...overrides,
  });
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Test environment must provide DATABASE_URL");
  }

  const db = createDb(databaseUrl);
  const auth = createAuth({
    baseURL: env.BETTER_AUTH_URL,
    databaseUrl,
    disableRateLimit: true,
    enableTestUtils: true,
    secret: env.BETTER_AUTH_SECRET,
  });
  const app = new Hono().route("/api", serverApiRoutes);
  const authContext = await auth.$context;
  const test = authContext.test;

  if (!test.createOrganization || !test.saveOrganization || !test.addMember) {
    throw new Error(
      "Better Auth test utilities must expose organization helpers"
    );
  }

  return {
    app,
    auth,
    db,
    env,
    test: test as typeof test & {
      addMember: NonNullable<typeof test.addMember>;
      createOrganization: NonNullable<typeof test.createOrganization>;
      saveOrganization: NonNullable<typeof test.saveOrganization>;
    },
  };
}
