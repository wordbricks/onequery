import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { eq, prepareSelfHostDatabase } from "@onequery/db/server";
import { LOCAL_TOPOLOGY } from "@onequery/dev-config/topology";
import { afterEach, describe, expect, it } from "vitest";

import { verifyOrgAccess } from "./lib/verify-org-access";
import { getServerStorage } from "./storage";

type ClosableDatabase = {
  $client?: {
    close?: () => void;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

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

const migrationsFolder = fileURLToPath(
  new URL("../../db/src/migrations", import.meta.url)
);

async function createPgliteStorage() {
  const root = mkdtempSync(join(tmpdir(), "onequery-storage-test-"));
  const pgliteDir = join(root, "pglite", "onequery");
  const databaseUrl = `pglite:${pgliteDir}`;
  const bundledWebOrigin = LOCAL_TOPOLOGY.web.bundled.origin;
  await prepareSelfHostDatabase({
    connectionString: databaseUrl,
    migrationsFolder,
  });

  return {
    pgliteDir,
    storage: getServerStorage({
      BETTER_AUTH_SECRET: "test-better-auth-secret-1234567890",
      BETTER_AUTH_URL: bundledWebOrigin,
      DATABASE_URL: databaseUrl,
      DISABLE_RATE_LIMIT: true,
      MASTER_ENCRYPTION_KEY: "sample-encryption-key",
      WEB_URL: bundledWebOrigin,
    }),
  };
}

describe("server storage", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("boots PGlite storage and persists auth, org, and data-source state", async () => {
    const { pgliteDir, storage } = await createPgliteStorage();
    openedDatabases.push(storage.db as ClosableDatabase);

    expect(storage.engine).toBe("pglite");

    const signupResponse = await storage.auth.handler(
      new Request(
        `${LOCAL_TOPOLOGY.web.bundled.origin}/api/auth/sign-up/email`,
        {
          body: JSON.stringify({
            email: "owner@example.com",
            name: "Owner",
            password: "password123",
          }),
          headers: {
            "content-type": "application/json",
            origin: LOCAL_TOPOLOGY.web.bundled.origin,
          },
          method: "POST",
        }
      )
    );

    expect(signupResponse.status).toBe(200);
    expect(existsSync(pgliteDir)).toBe(true);

    const users = await storage.db.query.user.findMany({
      columns: {
        id: true,
      },
    });
    const owner = users[0];
    expect(owner).toBeDefined();
    if (!owner) {
      throw new Error("Expected seeded owner user");
    }

    const { dataSources, member, organization } = storage.schema;

    await storage.db.insert(organization).values({
      id: "org_1",
      name: "Org One",
      slug: "org-one",
    });
    await storage.db.insert(member).values({
      id: "member_1",
      organizationId: "org_1",
      role: "owner",
      userId: owner.id,
    });
    await storage.db.insert(dataSources).values({
      credentialsEncrypted: "cipher",
      credentialsIv: "iv",
      id: "source_1",
      name: "warehouse",
      organizationId: "org_1",
      provider: "postgres",
      status: "active",
    });

    await expect(verifyOrgAccess(storage.db, owner.id, "org_1")).resolves.toBe(
      true
    );

    const persistedSources = await storage.db.query.dataSources.findMany({
      where: eq(dataSources.organizationId, "org_1"),
    });

    expect(persistedSources).toHaveLength(1);
    expect(persistedSources[0]?.provider).toBe("postgres");
  });
});
