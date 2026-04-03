import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/ciphers/utils.js";
import { base64ToBytes } from "@onequery/codecs/base64";
import type { z } from "zod";

const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;
const NONCE_HEX_LENGTH = NONCE_LENGTH * 2;
const MIN_GCM_CIPHERTEXT_LENGTH = 16;
const INVALID_MASTER_KEY_MESSAGE = "Invalid master encryption key";
const INVALID_ENCRYPTED_CREDENTIALS_MESSAGE = "Invalid encrypted credentials";

export type EncryptionResult = {
  ciphertext: string;
  iv: string;
};

export function deriveKeyFromBase64(masterKeyBase64: string): Uint8Array {
  const normalizedMasterKey = masterKeyBase64.trim();
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes.decode(normalizedMasterKey);
  } catch {
    throw new Error(INVALID_MASTER_KEY_MESSAGE);
  }

  if (keyBytes.length !== KEY_LENGTH) {
    throw new Error(INVALID_MASTER_KEY_MESSAGE);
  }

  return Uint8Array.from(keyBytes);
}

export function generateMasterKey(): string {
  const key = randomBytes(KEY_LENGTH);
  const normalizedKey = new Uint8Array(new ArrayBuffer(key.byteLength));
  normalizedKey.set(key);
  return base64ToBytes.encode(normalizedKey);
}

export function encryptCredentials(
  plaintext: string,
  masterKey: Uint8Array
): EncryptionResult {
  const nonce = randomBytes(NONCE_LENGTH);
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const aes = gcm(masterKey, nonce);
  const ciphertext = aes.encrypt(plaintextBytes);

  return {
    ciphertext: bytesToHex(ciphertext),
    iv: bytesToHex(nonce),
  };
}

export function decryptCredentials(
  ciphertextHex: string,
  ivHex: string,
  masterKey: Uint8Array
): string {
  const ciphertext = decodeEncryptedHex({
    minimumBytes: MIN_GCM_CIPHERTEXT_LENGTH,
    value: ciphertextHex,
  });
  const nonce = decodeEncryptedHex({
    expectedBytes: NONCE_LENGTH,
    expectedHexLength: NONCE_HEX_LENGTH,
    value: ivHex,
  });

  try {
    const aes = gcm(masterKey, nonce);
    const plaintext = aes.decrypt(ciphertext);

    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error(INVALID_ENCRYPTED_CREDENTIALS_MESSAGE);
  }
}

export function encryptCredentialsObject<T>(
  credentials: T,
  masterKey: Uint8Array
): EncryptionResult {
  const plaintext = JSON.stringify(credentials);
  return encryptCredentials(plaintext, masterKey);
}

export function decryptCredentialsObject<T extends z.ZodType>(
  ciphertextHex: string,
  ivHex: string,
  masterKey: Uint8Array,
  schema: T
): z.infer<T> {
  try {
    const plaintext = decryptCredentials(ciphertextHex, ivHex, masterKey);
    return schema.parse(JSON.parse(plaintext));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === INVALID_ENCRYPTED_CREDENTIALS_MESSAGE
    ) {
      throw error;
    }

    throw new Error(INVALID_ENCRYPTED_CREDENTIALS_MESSAGE, { cause: error });
  }
}

function decodeEncryptedHex(input: {
  value: string;
  expectedBytes?: number;
  expectedHexLength?: number;
  minimumBytes?: number;
}): Uint8Array {
  const normalizedValue = input.value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(INVALID_ENCRYPTED_CREDENTIALS_MESSAGE);
  }

  if (
    input.expectedHexLength !== undefined &&
    normalizedValue.length !== input.expectedHexLength
  ) {
    throw new Error(INVALID_ENCRYPTED_CREDENTIALS_MESSAGE);
  }

  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(normalizedValue);
  } catch {
    throw new Error(INVALID_ENCRYPTED_CREDENTIALS_MESSAGE);
  }

  if (
    input.expectedBytes !== undefined &&
    bytes.length !== input.expectedBytes
  ) {
    throw new Error(INVALID_ENCRYPTED_CREDENTIALS_MESSAGE);
  }

  if (input.minimumBytes !== undefined && bytes.length < input.minimumBytes) {
    throw new Error(INVALID_ENCRYPTED_CREDENTIALS_MESSAGE);
  }

  return bytes;
}
