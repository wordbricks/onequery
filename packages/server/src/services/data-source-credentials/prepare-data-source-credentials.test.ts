import type { ProviderType } from "@onequery/db/server";
import { describe, expect, it } from "vitest";

import {
  deriveKeyFromBase64,
  encryptCredentialsObject,
  generateMasterKey,
} from "../crypto/credential-encryption";
import { prepareDataSourceCredentials } from "./prepare-data-source-credentials";

function createRecord(
  input?: Partial<{
    credentialsEncrypted: string;
    credentialsIv: string;
    id: string;
    name: string;
    provider: ProviderType;
  }>
) {
  return {
    credentialsEncrypted: input?.credentialsEncrypted ?? "abcd",
    credentialsIv: input?.credentialsIv ?? "abcd",
    id: input?.id ?? "source_1",
    name: input?.name ?? "Sensitive Production Warehouse",
    provider: input?.provider ?? "postgres",
  };
}

describe("prepare data source credentials", () => {
  it("decrypts matching stored credentials", async () => {
    const masterKeyBase64 = generateMasterKey();
    const masterKey = deriveKeyFromBase64(masterKeyBase64);
    const encrypted = encryptCredentialsObject(
      {
        database: "app",
        host: "localhost",
        password: "secret",
        port: 5432,
        sslMode: "prefer",
        type: "postgres",
        username: "app",
      },
      masterKey
    );

    await expect(
      prepareDataSourceCredentials({
        dataSource: createRecord({
          credentialsEncrypted: encrypted.ciphertext,
          credentialsIv: encrypted.iv,
        }),
        masterEncryptionKey: masterKeyBase64,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        credentials: {
          type: "postgres",
        },
        refreshed: false,
      },
    });
  });

  it("redacts data source names and parser details from invalid credential errors", async () => {
    const result = await prepareDataSourceCredentials({
      dataSource: createRecord({
        credentialsEncrypted: "not-hex",
        credentialsIv: "still-not-hex",
        name: "Sensitive Production Warehouse",
      }),
      masterEncryptionKey: generateMasterKey(),
    });

    expect(result).toEqual({
      error: "Invalid stored credentials for data source 'source_1'",
      ok: false,
    });
  });

  it("rejects provider mismatches without echoing decrypted credential contents", async () => {
    const masterKeyBase64 = generateMasterKey();
    const masterKey = deriveKeyFromBase64(masterKeyBase64);
    const encrypted = encryptCredentialsObject(
      {
        apiKey: "secret-api-key",
        type: "linear",
      },
      masterKey
    );

    const result = await prepareDataSourceCredentials({
      dataSource: createRecord({
        credentialsEncrypted: encrypted.ciphertext,
        credentialsIv: encrypted.iv,
        provider: "postgres",
      }),
      masterEncryptionKey: masterKeyBase64,
    });

    expect(result).toEqual({
      error:
        "Stored credentials type does not match provider for data source 'source_1'",
      ok: false,
    });
  });
});
