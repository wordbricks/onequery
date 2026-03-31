import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDatabaseRuntime,
  eq,
  prepareSelfHostDatabase,
} from "@onequery/db/server";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../../../dev-config/src/master-encryption-key";
import type { ServerEnv } from "../../env";
import type { SessionData } from "../../middleware/session";
import type { StorageVariables } from "../../storage";
import { dataSourcesCrudRoute } from "./crud";

const migrationsFolder = fileURLToPath(
  new URL("../../../../db/src/migrations", import.meta.url)
);

type ClosableDatabase = {
  $client?: {
    close?: () => void;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

function createSession(userId: string): SessionData {
  return {
    session: {
      activeOrganizationId: null,
      expiresAt: new Date(Date.now() + 60_000),
      id: "session-1",
      token: "token-1",
      userId,
    },
    user: {
      email: "owner@example.com",
      id: userId,
      image: null,
      name: "Owner",
    },
  };
}

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

describe("dataSourcesCrudRoute", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("creates a postgres data source with the default test env encryption key", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "onequery-data-sources-crud-test-")
    );
    const dbUrl = `pglite:${join(root, "db")}`;
    const env: ServerEnv = {
      BETTER_AUTH_SECRET: "test-better-auth-secret",
      BETTER_AUTH_URL: "http://localhost:4545",
      DATABASE_URL: dbUrl,
      MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
      WEB_URL: "http://localhost:4545",
    };

    await prepareSelfHostDatabase({
      connectionString: dbUrl,
      migrationsFolder,
    });
    const runtime = createDatabaseRuntime(dbUrl);
    openedDatabases.push(runtime.db as ClosableDatabase);

    await runtime.db.insert(runtime.schema.organization).values({
      id: "org-1",
      name: "Acme",
      slug: "acme",
    });
    await runtime.db.insert(runtime.schema.user).values({
      email: "owner@example.com",
      id: "user-1",
      name: "Owner",
    });
    await runtime.db.insert(runtime.schema.member).values({
      id: "member-1",
      organizationId: "org-1",
      role: "owner",
      userId: "user-1",
    });

    const app = new Hono<{
      Bindings: ServerEnv;
      Variables: StorageVariables & { session: SessionData | null };
    }>()
      .use("*", async (c, next) => {
        c.set("storage", {
          db: runtime.db,
          schema: runtime.schema,
        } as StorageVariables["storage"]);
        c.set("session", createSession("user-1"));
        await next();
      })
      .route("/", dataSourcesCrudRoute);

    const response = await app.fetch(
      new Request("http://localhost/", {
        body: JSON.stringify({
          credentials: {
            database: "analytics",
            host: "localhost",
            password: "password",
            port: 5432,
            sslMode: "prefer",
            type: "postgres",
            username: "postgres",
          },
          name: "Warehouse",
          organizationId: "org-1",
          provider: "postgres",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
      env
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      dataSource: {
        name: "Warehouse",
        provider: "postgres",
        status: "active",
      },
    });

    const persisted = await runtime.db.query.dataSources.findFirst({
      columns: {
        credentialsEncrypted: true,
        id: true,
        name: true,
        provider: true,
      },
      where: eq(runtime.schema.dataSources.organizationId, "org-1"),
    });

    expect(persisted).toMatchObject({
      name: "Warehouse",
      provider: "postgres",
    });
    expect(persisted?.credentialsEncrypted).toBeTruthy();
  });
});
