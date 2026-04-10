import { createHmac, timingSafeEqual } from "node:crypto";

import { SourceApiExpiredError, SourceApiInvalidRequestError } from "../errors";
import type { PreparedSourceApi } from "../types";

const PREPARED_SOURCE_API_TOKEN_VERSION = 1;
const DEFAULT_PREPARED_SOURCE_API_TOKEN_TTL_MS = 5 * 60_000;
const PREPARED_TOKEN_BYTES_KEY = "__onequery_bytes";

export type PreparedSourceApiTokenPayload = {
  version: typeof PREPARED_SOURCE_API_TOKEN_VERSION;
  organizationSlug: string;
  issuedAt: string;
  expiresAt: string;
  prepared: PreparedSourceApi;
};

type EncodePreparedSourceApiTokenInput = {
  organizationSlug: string;
  prepared: PreparedSourceApi;
  secret: string | Uint8Array;
  now?: Date;
  ttlMs?: number;
};

type DecodePreparedSourceApiTokenInput = {
  token: string;
  secret: string | Uint8Array;
  now?: Date;
};

export function encodePreparedSourceApiToken(
  input: EncodePreparedSourceApiTokenInput
): string {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_PREPARED_SOURCE_API_TOKEN_TTL_MS;
  const payload = serializePreparedSourceApiTokenPayload({
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    issuedAt: now.toISOString(),
    organizationSlug: input.organizationSlug,
    prepared: input.prepared,
    version: PREPARED_SOURCE_API_TOKEN_VERSION,
  });
  const signature = signTokenPayload(payload, input.secret);
  return `${payload}.${signature}`;
}

export function decodePreparedSourceApiToken(
  input: DecodePreparedSourceApiTokenInput
): PreparedSourceApiTokenPayload {
  const [encodedPayload, signature] = input.token.split(".", 2);
  if (!encodedPayload || !signature) {
    throw new SourceApiInvalidRequestError("Invalid prepared token");
  }

  const expectedSignature = signTokenPayload(encodedPayload, input.secret);
  if (signature.length !== expectedSignature.length) {
    throw new SourceApiInvalidRequestError("Invalid prepared token signature");
  }
  if (
    !timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    )
  ) {
    throw new SourceApiInvalidRequestError("Invalid prepared token signature");
  }

  const payload = readPreparedSourceApiTokenPayload(encodedPayload);
  if (payload.version !== PREPARED_SOURCE_API_TOKEN_VERSION) {
    throw new SourceApiInvalidRequestError(
      "Unsupported prepared token version"
    );
  }
  if (payload.organizationSlug.trim().length === 0) {
    throw new SourceApiInvalidRequestError("Invalid prepared token");
  }

  const expiresAt = new Date(payload.expiresAt);
  const now = input.now ?? new Date();
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new SourceApiExpiredError("Prepared source API token expired");
  }

  return payload;
}

function readPreparedSourceApiTokenPayload(
  encodedPayload: string
): PreparedSourceApiTokenPayload {
  try {
    return JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
      preparedTokenReviver
    ) as PreparedSourceApiTokenPayload;
  } catch {
    throw new SourceApiInvalidRequestError("Invalid prepared token");
  }
}

function serializePreparedSourceApiTokenPayload(
  payload: PreparedSourceApiTokenPayload
): string {
  return Buffer.from(
    JSON.stringify(payload, preparedTokenReplacer),
    "utf8"
  ).toString("base64url");
}

function signTokenPayload(
  payload: string,
  secret: string | Uint8Array
): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function preparedTokenReplacer(_: string, value: unknown) {
  if (value instanceof Uint8Array) {
    return {
      [PREPARED_TOKEN_BYTES_KEY]: Buffer.from(value).toString("base64url"),
    };
  }

  return value;
}

function preparedTokenReviver(_: string, value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    PREPARED_TOKEN_BYTES_KEY in value &&
    typeof (value as Record<string, unknown>)[PREPARED_TOKEN_BYTES_KEY] ===
      "string"
  ) {
    const encodedBytes = (value as Record<string, unknown>)[
      PREPARED_TOKEN_BYTES_KEY
    ];
    return new Uint8Array(Buffer.from(encodedBytes as string, "base64url"));
  }

  return value;
}
