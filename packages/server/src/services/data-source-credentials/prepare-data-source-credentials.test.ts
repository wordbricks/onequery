import type { ProviderType } from "@onequery/db/server";
import { describe, expect, it } from "vitest";

import {
  deriveKeyFromBase64Result,
  encryptCredentialsObject,
  generateMasterKey,
} from "../crypto/credential-encryption";
import { prepareDataSourceCredentials } from "./prepare-data-source-credentials";

function expectValidMasterKey(value: string): Uint8Array {
  const parsed = deriveKeyFromBase64Result(value);
  if (parsed.isErr()) {
    throw new Error(`Expected valid master key: ${parsed.error.message}`);
  }

  return parsed.value;
}

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
    const masterKey = expectValidMasterKey(masterKeyBase64);
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

    const result = await prepareDataSourceCredentials({
      dataSource: createRecord({
        credentialsEncrypted: encrypted.ciphertext,
        credentialsIv: encrypted.iv,
      }),
      masterEncryptionKey: masterKey,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw new Error("expected credential preparation to succeed");
    }

    expect(result.value).toMatchObject({
      credentials: {
        type: "postgres",
      },
      refreshed: false,
    });
  });

  it("redacts data source names and parser details from invalid credential errors", async () => {
    const masterKey = expectValidMasterKey(generateMasterKey());
    const result = await prepareDataSourceCredentials({
      dataSource: createRecord({
        credentialsEncrypted: "not-hex",
        credentialsIv: "still-not-hex",
        name: "Sensitive Production Warehouse",
      }),
      masterEncryptionKey: masterKey,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected invalid credential decryption to fail");
    }

    expect(result.error.message).toBe(
      "Invalid stored credentials for data source 'source_1'"
    );
  });

  it("rejects provider mismatches without echoing decrypted credential contents", async () => {
    const masterKeyBase64 = generateMasterKey();
    const masterKey = expectValidMasterKey(masterKeyBase64);
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
      masterEncryptionKey: masterKey,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected provider mismatch to fail");
    }

    expect(result.error.message).toBe(
      "Stored credentials type does not match provider for data source 'source_1'"
    );
  });
});
