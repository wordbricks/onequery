import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  decryptCredentials,
  decryptCredentialsObject,
  deriveKeyFromBase64,
  encryptCredentialsObject,
  generateMasterKey,
} from "./credential-encryption";

describe("credential encryption", () => {
  it("round-trips credential payloads with trimmed base64 keys", () => {
    const masterKey = deriveKeyFromBase64(`  ${generateMasterKey()}\n`);
    const encrypted = encryptCredentialsObject(
      {
        secret: "value",
        type: "postgres",
      },
      masterKey
    );

    expect(
      decryptCredentialsObject(
        encrypted.ciphertext,
        encrypted.iv,
        masterKey,
        z.object({
          secret: z.string(),
          type: z.literal("postgres"),
        })
      )
    ).toEqual({
      secret: "value",
      type: "postgres",
    });
  });

  it("rejects malformed encrypted payloads with a generic error", () => {
    const masterKey = deriveKeyFromBase64(generateMasterKey());

    expect(() => decryptCredentials("not-hex", "abcd", masterKey)).toThrow(
      "Invalid encrypted credentials"
    );
  });
});
