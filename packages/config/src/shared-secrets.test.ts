import { describe, expect, it } from "vitest";

import {
  decodeMasterEncryptionKey,
  decodeMasterEncryptionKeyResult,
  MASTER_ENCRYPTION_KEY_BYTE_LENGTH,
  MasterEncryptionKeyDecodeError,
  masterEncryptionKeySchema,
} from "./shared-secrets";
import { SAMPLE_MASTER_ENCRYPTION_KEY } from "./testing";

function expectDecodeSuccess(
  value: ReturnType<typeof decodeMasterEncryptionKeyResult>
) {
  if (value.isErr()) {
    throw new Error(
      `Expected master key decode success: ${value.error.message}`
    );
  }

  return value.value;
}

function expectDecodeFailure(
  value: ReturnType<typeof decodeMasterEncryptionKeyResult>
) {
  if (value.isOk()) {
    throw new Error("Expected master key decode failure.");
  }

  return value.error;
}

describe("@onequery/config shared-secrets", () => {
  it("decodes valid master encryption keys through the result API", () => {
    const decodedKey = expectDecodeSuccess(
      decodeMasterEncryptionKeyResult(`  ${SAMPLE_MASTER_ENCRYPTION_KEY}\n`)
    );

    expect(decodedKey).toBeInstanceOf(Uint8Array);
    expect(decodedKey).toHaveLength(MASTER_ENCRYPTION_KEY_BYTE_LENGTH);
    expect(Array.from(decodedKey.slice(0, 4))).toEqual([1, 1, 1, 1]);
  });

  it("returns typed domain errors for invalid master encryption keys", () => {
    const error = expectDecodeFailure(
      decodeMasterEncryptionKeyResult("master")
    );

    expect(error).toBeInstanceOf(MasterEncryptionKeyDecodeError);
    expect(error).toMatchObject({
      _tag: "MasterEncryptionKeyDecodeError",
      message:
        "Master encryption key must be valid base64 that decodes to exactly 32 bytes.",
    });
  });

  it("keeps the throwing decoder as a compatibility wrapper", () => {
    expect(() => decodeMasterEncryptionKey("master")).toThrow(
      MasterEncryptionKeyDecodeError
    );
  });

  it("surfaces the typed decode failure through schema validation", () => {
    const parsed = masterEncryptionKeySchema.safeParse("master");

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual([
      {
        code: "custom",
        message:
          "Master encryption key must be valid base64 that decodes to exactly 32 bytes.",
        path: [],
      },
    ]);
  });
});
