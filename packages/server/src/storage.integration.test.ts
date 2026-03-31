import { existsSync } from "node:fs";

import { eq } from "@onequery/db/server";
import { afterEach, describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../dev-config/src/master-encryption-key";
import { verifyOrgAccess } from "./lib/verify-org-access";
import { getServerStorage } from "./storage";
import {
  closeDatabase,
  createPgliteDatabaseUrl,
} from "./test/integration-helpers";
import type { ClosableDatabase } from "./test/integration-helpers";

async function createPgliteStorage() {
  const databaseUrl = await createPgliteDatabaseUrl("onequery-storage-test-");
  const pgliteDir = databaseUrl.replace("pglite:", "");

  return {
    pgliteDir,
    storage: getServerStorage({
      BETTER_AUTH_SECRET: "test-better-auth-secret-1234567890",
      BETTER_AUTH_URL: "http://localhost:4545",
      DATABASE_URL: databaseUrl,
      DISABLE_RATE_LIMIT: true,
      MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
      WEB_URL: "http://localhost:4545",
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
      new Request("http://localhost:4545/api/auth/sign-up/email", {
        body: JSON.stringify({
          email: "owner@example.com",
          name: "Owner",
          password: "password123",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:4545",
        },
        method: "POST",
      })
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
