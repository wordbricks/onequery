import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  decryptCredentialsObjectResult,
  decryptCredentialsResult,
  deriveKeyFromBase64Result,
  EncryptedCredentialsDecodeError,
  encryptCredentialsObject,
  generateMasterKey,
} from "./credential-encryption";

function expectValidMasterKey(value: string): Uint8Array {
  const parsed = deriveKeyFromBase64Result(value);
  if (parsed.isErr()) {
    throw new Error(`Expected valid master key: ${parsed.error.message}`);
  }

  return parsed.value;
}

describe("credential encryption", () => {
  it("round-trips credential payloads with trimmed base64 keys", () => {
    const masterKey = expectValidMasterKey(`  ${generateMasterKey()}\n`);
    const encrypted = encryptCredentialsObject(
      {
        secret: "value",
        type: "postgres",
      },
      masterKey
    );

    const decrypted = decryptCredentialsObjectResult(
      encrypted.ciphertext,
      encrypted.iv,
      masterKey,
      z.object({
        secret: z.string(),
        type: z.literal("postgres"),
      })
    );

    expect(decrypted.isOk()).toBe(true);
    if (decrypted.isErr()) {
      throw new Error(`Expected decrypt success: ${decrypted.error.message}`);
    }

    expect(decrypted.value).toEqual({
      secret: "value",
      type: "postgres",
    });
  });

  it("returns typed failures for malformed encrypted payloads", () => {
    const masterKey = expectValidMasterKey(generateMasterKey());
    const decrypted = decryptCredentialsResult("not-hex", "abcd", masterKey);

    expect(decrypted.isErr()).toBe(true);
    if (decrypted.isOk()) {
      throw new Error("Expected malformed ciphertext to fail");
    }

    expect(decrypted.error).toBeInstanceOf(EncryptedCredentialsDecodeError);
    expect(decrypted.error.message).toBe("Invalid encrypted credentials");
  });

  it("returns typed failures for invalid master keys", () => {
    const parsed = deriveKeyFromBase64Result("master");

    expect(parsed.isErr()).toBe(true);
    if (parsed.isOk()) {
      throw new Error("Expected invalid master key to fail");
    }

    expect(parsed.error.message).toBe(
      "Master encryption key must be valid base64 that decodes to exactly 32 bytes."
    );
  });
});
