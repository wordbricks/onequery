import { createDatabaseRuntime, eq } from "@onequery/db/server";
import { Hono } from "hono";
import { testClient } from "hono/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { SessionData } from "../../middleware/session";
import type { ServerRuntimeVariables } from "../../runtime-context";
import {
  deriveKeyFromBase64,
  encryptCredentialsObject,
  generateMasterKey,
} from "../../services/crypto/credential-encryption";
import type { StorageVariables } from "../../storage";
import {
  closeDatabase,
  createPgliteDatabaseUrl,
} from "../../test/integration-helpers";
import type { ClosableDatabase } from "../../test/integration-helpers";
import { createTestRuntimeConfigFromDatabaseUrl } from "../test-env";
import { createProviderRoute } from "./create-provider-route";

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

describe("createProviderRoute", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("decrypts credentials, executes the handler, and updates lastUsedAt", async () => {
    const dbUrl = await createPgliteDatabaseUrl(
      "onequery-provider-route-test-",
      ["db"]
    );
    const masterKeyBase64 = generateMasterKey();
    const masterKey = deriveKeyFromBase64(masterKeyBase64);

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

    const encrypted = encryptCredentialsObject(
      {
        apiKey: "api-key",
        region: "us" as const,
        secretKey: "secret-key",
        type: "amplitude" as const,
      },
      masterKey
    );
    await runtime.db.insert(runtime.schema.dataSources).values({
      credentialsEncrypted: encrypted.ciphertext,
      credentialsIv: encrypted.iv,
      id: "ds-1",
      name: "Amplitude Source",
      organizationId: "org-1",
      provider: "amplitude",
      status: "active",
      useAsDataSource: true,
    });

    const execute = vi.fn().mockResolvedValue({ ok: true });
    const methodSchema = z.enum(["ping"]);
    const route = createProviderRoute<
      {
        apiKey: string;
        region: "us" | "eu";
        secretKey: string;
        type: "amplitude";
      },
      typeof methodSchema,
      { endpoint: string },
      "/amplitude/query"
    >({
      credentialsGuard: (
        value
      ): value is {
        apiKey: string;
        region: "us" | "eu";
        secretKey: string;
        type: "amplitude";
      } =>
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        value.type === "amplitude",
      execute,
      methodSchema,
      parseRequest: () => ({ data: { endpoint: "/events" }, ok: true }),
      provider: "amplitude",
      providerLabel: "Amplitude",
      routePath: "/amplitude/query",
    });

    const app = new Hono<{
      Variables: ServerRuntimeVariables &
        StorageVariables & { session: SessionData | null };
    }>()
      .use("*", async (c, next) => {
        c.set("storage", {
          db: runtime.db,
          schema: runtime.schema,
        } as StorageVariables["storage"]);
        c.set(
          "runtime",
          createTestRuntimeConfigFromDatabaseUrl(dbUrl, {
            crypto: {
              masterEncryptionKey: masterKeyBase64,
            },
          })
        );
        c.set("session", createSession("user-1"));
        await next();
      })
      .route("/", route);

    const response = await testClient(app).amplitude.query.$post({
      json: {
        method: "ping",
        organizationId: "org-1",
        request: {},
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ type: "amplitude" }),
        organizationId: "org-1",
        request: { endpoint: "/events" },
      })
    );

    const persisted = await runtime.db.query.dataSources.findFirst({
      columns: { lastUsedAt: true },
      where: eq(runtime.schema.dataSources.id, "ds-1"),
    });
    expect(persisted?.lastUsedAt).toBeInstanceOf(Date);
  });
});
