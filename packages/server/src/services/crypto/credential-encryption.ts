import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/ciphers/utils.js";
import { base64ToBytes } from "@onequery/codecs/base64";
import {
  decodeMasterEncryptionKeyResult,
  MASTER_ENCRYPTION_KEY_BYTE_LENGTH,
} from "@onequery/config/shared-secrets";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import type { z } from "zod";

const NONCE_LENGTH = 12;
const NONCE_HEX_LENGTH = NONCE_LENGTH * 2;
const MIN_GCM_CIPHERTEXT_LENGTH = 16;
const INVALID_ENCRYPTED_CREDENTIALS_MESSAGE = "Invalid encrypted credentials";

export type EncryptionResult = {
  ciphertext: string;
  iv: string;
};

export class EncryptedCredentialsDecodeError extends TaggedError(
  "EncryptedCredentialsDecodeError"
)<{
  cause?: unknown;
  message: string;
}>() {
  constructor(args: { cause?: unknown } = {}) {
    super({
      ...args,
      message: INVALID_ENCRYPTED_CREDENTIALS_MESSAGE,
    });
  }
}

type DecodeEncryptedHexResult = ResultType<
  Uint8Array,
  EncryptedCredentialsDecodeError
>;

export type DecryptCredentialsResult = ResultType<
  string,
  EncryptedCredentialsDecodeError
>;

export type DecryptCredentialsObjectResult<T extends z.ZodType> = ResultType<
  z.infer<T>,
  EncryptedCredentialsDecodeError
>;

function createInvalidEncryptedCredentialsError(cause?: unknown) {
  return new EncryptedCredentialsDecodeError({ cause });
}

export const deriveKeyFromBase64Result = decodeMasterEncryptionKeyResult;

export function generateMasterKey(): string {
  const key = randomBytes(MASTER_ENCRYPTION_KEY_BYTE_LENGTH);
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

export function encryptCredentialsObject<T>(
  credentials: T,
  masterKey: Uint8Array
): EncryptionResult {
  const plaintext = JSON.stringify(credentials);
  return encryptCredentials(plaintext, masterKey);
}

export function decryptCredentialsResult(
  ciphertextHex: string,
  ivHex: string,
  masterKey: Uint8Array
): DecryptCredentialsResult {
  return Result.gen(function* decryptCredentialsFlow() {
    const ciphertext = yield* decodeEncryptedHexResult({
      minimumBytes: MIN_GCM_CIPHERTEXT_LENGTH,
      value: ciphertextHex,
    });
    const nonce = yield* decodeEncryptedHexResult({
      expectedBytes: NONCE_LENGTH,
      expectedHexLength: NONCE_HEX_LENGTH,
      value: ivHex,
    });
    const plaintext = yield* Result.try({
      try: () => {
        const aes = gcm(masterKey, nonce);
        const decrypted = aes.decrypt(ciphertext);
        return new TextDecoder().decode(decrypted);
      },
      catch: (cause) => createInvalidEncryptedCredentialsError(cause),
    });

    return Result.ok(plaintext);
  });
}

export function decryptCredentialsObjectResult<T extends z.ZodType>(
  ciphertextHex: string,
  ivHex: string,
  masterKey: Uint8Array,
  schema: T
): DecryptCredentialsObjectResult<T> {
  return Result.gen(function* decryptCredentialsObjectFlow() {
    const plaintext = yield* decryptCredentialsResult(
      ciphertextHex,
      ivHex,
      masterKey
    );
    const parsedJson = yield* Result.try({
      try: () => JSON.parse(plaintext),
      catch: (cause) => createInvalidEncryptedCredentialsError(cause),
    });
    const parsedCredentials = schema.safeParse(parsedJson);
    if (!parsedCredentials.success) {
      return yield* createInvalidEncryptedCredentialsError(
        parsedCredentials.error
      );
    }

    return Result.ok(parsedCredentials.data);
  });
}

function decodeEncryptedHexResult(input: {
  value: string;
  expectedBytes?: number;
  expectedHexLength?: number;
  minimumBytes?: number;
}): DecodeEncryptedHexResult {
  const normalizedValue = input.value.trim();

  if (normalizedValue.length === 0) {
    return Result.err(createInvalidEncryptedCredentialsError());
  }

  if (
    input.expectedHexLength !== undefined &&
    normalizedValue.length !== input.expectedHexLength
  ) {
    return Result.err(createInvalidEncryptedCredentialsError());
  }

  const bytes = Result.try({
    try: () => hexToBytes(normalizedValue),
    catch: (cause) => createInvalidEncryptedCredentialsError(cause),
  });
  if (bytes.isErr()) {
    return Result.err(bytes.error);
  }

  if (
    input.expectedBytes !== undefined &&
    bytes.value.length !== input.expectedBytes
  ) {
    return Result.err(createInvalidEncryptedCredentialsError());
  }

  if (
    input.minimumBytes !== undefined &&
    bytes.value.length < input.minimumBytes
  ) {
    return Result.err(createInvalidEncryptedCredentialsError());
  }

  return Result.ok(bytes.value);
}
