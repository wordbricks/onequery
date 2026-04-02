import { z } from "zod";

const opaqueSecretTransportSchema = z.string().trim().min(1);
export const MASTER_ENCRYPTION_KEY_BYTE_LENGTH = 32;

export const authSecretSchema = opaqueSecretTransportSchema;
export const connectorEnrollmentTokenSchema = opaqueSecretTransportSchema;

export function decodeMasterEncryptionKey(value: string): Uint8Array {
  const normalizedValue = value.trim();
  let decodedValue: string;

  try {
    decodedValue = atob(normalizedValue);
  } catch {
    throw new Error(
      "Master encryption key must be valid base64 that decodes to exactly 32 bytes."
    );
  }

  if (decodedValue.length !== MASTER_ENCRYPTION_KEY_BYTE_LENGTH) {
    throw new Error(
      "Master encryption key must be valid base64 that decodes to exactly 32 bytes."
    );
  }

  return Uint8Array.from(decodedValue, (char) => char.charCodeAt(0));
}

export const masterEncryptionKeySchema = opaqueSecretTransportSchema.superRefine(
  (value, context) => {
    try {
      decodeMasterEncryptionKey(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid master encryption key.",
      });
    }
  }
);

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
