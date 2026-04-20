import { base64ToBytes } from "@onequery/codecs/base64";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { z } from "zod";

const opaqueSecretTransportSchema = z.string().trim().min(1);
export const MASTER_ENCRYPTION_KEY_BYTE_LENGTH = 32;
const INVALID_MASTER_ENCRYPTION_KEY_MESSAGE =
  "Master encryption key must be valid base64 that decodes to exactly 32 bytes.";

export const authSecretSchema = opaqueSecretTransportSchema;
export const connectorEnrollmentTokenSchema = opaqueSecretTransportSchema;

export class MasterEncryptionKeyDecodeError extends TaggedError(
  "MasterEncryptionKeyDecodeError"
)<{
  cause?: unknown;
  message: string;
}>() {
  constructor(args: { cause?: unknown } = {}) {
    super({
      ...args,
      message: INVALID_MASTER_ENCRYPTION_KEY_MESSAGE,
    });
  }
}

export type MasterEncryptionKeyDecodeResult = ResultType<
  Uint8Array,
  MasterEncryptionKeyDecodeError
>;

function createInvalidMasterEncryptionKeyError(cause?: unknown) {
  return new MasterEncryptionKeyDecodeError({ cause });
}

export function decodeMasterEncryptionKeyResult(
  value: string
): MasterEncryptionKeyDecodeResult {
  const normalizedValue = value.trim();
  const decodedValue = Result.try({
    try: () => base64ToBytes.decode(normalizedValue),
    catch: (cause) => createInvalidMasterEncryptionKeyError(cause),
  });

  if (decodedValue.isErr()) {
    return Result.err(decodedValue.error);
  }

  if (decodedValue.value.length !== MASTER_ENCRYPTION_KEY_BYTE_LENGTH) {
    return Result.err(createInvalidMasterEncryptionKeyError());
  }

  return Result.ok(Uint8Array.from(decodedValue.value));
}

export function decodeMasterEncryptionKey(value: string): Uint8Array {
  const decodedValue = decodeMasterEncryptionKeyResult(value);
  if (decodedValue.isErr()) {
    throw decodedValue.error;
  }

  return decodedValue.value;
}

export const masterEncryptionKeySchema =
  opaqueSecretTransportSchema.superRefine((value, context) => {
    const decodedValue = decodeMasterEncryptionKeyResult(value);
    if (decodedValue.isErr()) {
      context.addIssue({
        code: "custom",
        message: decodedValue.error.message,
      });
    }
  });

export const sharedSecretSectionsSchema = z
  .object({
    auth: z
      .object({
        secret: authSecretSchema,
      })
      .strict(),
    connectors: z
      .object({
        enrollment_token: connectorEnrollmentTokenSchema,
      })
      .strict(),
    crypto: z
      .object({
        master_encryption_key: masterEncryptionKeySchema,
      })
      .strict(),
  })
  .strict();
