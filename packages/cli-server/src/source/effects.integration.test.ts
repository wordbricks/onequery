import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CredentialsSchema,
  createDb,
  eq,
  getDatabaseSchema,
  prepareApplicationDatabase,
} from "@onequery/db/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptCredentialsObject,
  deriveKeyFromBase64,
  generateMasterKey,
} from "@onequery/server/services/crypto/credential-encryption";

import { runCliConnectSourceEffect } from "./effects";

type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
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
  new URL("../../../db/src/migrations", import.meta.url)
);

async function createTestDb() {
  const connectionString = `pglite:${join(tmpdir(), "pglite", randomUUID())}`;
  await prepareApplicationDatabase({
    connectionString,
    migrationsFolder,
  });
  return createDb(connectionString);
}

describe("runCliConnectSourceEffect", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("encrypts and persists source credentials with a generated master key", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const schema = getDatabaseSchema(db);
    await db.insert(schema.organization).values({
      id: "org_1",
      name: "Org One",
      slug: "org-one",
    });

    const masterEncryptionKey = generateMasterKey();
    const masterKey = deriveKeyFromBase64(masterEncryptionKey);
    const result = await runCliConnectSourceEffect({
      db,
      effect: {
        credentials: {
          database: "analytics",
          host: "localhost",
          password: "secret",
          port: 5432,
          sslMode: "prefer",
          type: "postgres",
          username: "postgres",
        },
        kind: "connect_source",
        name: "warehouse",
        organizationId: "org_1",
        provider: "postgres",
      },
      masterEncryptionKey: masterKey,
    });

    expect(result).toMatchObject({
      kind: "connected",
      source: {
        provider: "postgres",
        sourceKey: "warehouse",
        status: "active",
      },
    });

    const persisted = await db.query.dataSources.findFirst({
      columns: {
        credentialsEncrypted: true,
        credentialsIv: true,
        provider: true,
      },
      where: eq(schema.dataSources.organizationId, "org_1"),
    });

    expect(persisted?.provider).toBe("postgres");
    expect(persisted?.credentialsEncrypted).toBeTruthy();
    expect(persisted?.credentialsIv).toBeTruthy();
    expect(
      decryptCredentialsObject(
        persisted?.credentialsEncrypted ?? "",
        persisted?.credentialsIv ?? "",
        masterKey,
        CredentialsSchema
      )
    ).toMatchObject({
      database: "analytics",
      type: "postgres",
      username: "postgres",
    });
  });
});
