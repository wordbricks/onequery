import { createDatabaseRuntime, eq } from "@onequery/db/server";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import type { ServerEnv } from "../../env";
import type { SessionData } from "../../middleware/session";
import type { StorageVariables } from "../../storage";
import {
  closeDatabase,
  createPgliteDatabaseUrl,
} from "../../test/integration-helpers";
import type { ClosableDatabase } from "../../test/integration-helpers";
import { createTestEnv } from "../test-env";
import { dataSourcesCrudRoute } from "./crud";

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

describe("dataSourcesCrudRoute", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("creates a postgres data source with the default test env encryption key", async () => {
    const dbUrl = await createPgliteDatabaseUrl(
      "onequery-data-sources-crud-test-",
      ["db"]
    );
    const env = createTestEnv({
      DATABASE_URL: dbUrl,
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
