import { createHmac, timingSafeEqual } from "node:crypto";

import { SourceApiInvalidRequestError } from "../errors";
import type { SourceApiPaginationTokenPayload } from "../types";

type DecodeOpaquePageTokenInput = {
  token: string;
  secret: string | Uint8Array;
  expected: {
    sourceKey: string;
    operation: string;
    preparedBinding: string;
    descriptorVersion?: string;
  };
  now?: Date;
};

type EncodeOpaquePageTokenInput = {
  payload: SourceApiPaginationTokenPayload;
  secret: string | Uint8Array;
};

export function encodeOpaquePageToken(
  input: EncodeOpaquePageTokenInput
): string {
  const payload = toBase64Url(
    Buffer.from(JSON.stringify(input.payload), "utf8")
  );
  const signature = signTokenPayload(payload, input.secret);
  return `${payload}.${signature}`;
}

export function decodeOpaquePageToken(
  input: DecodeOpaquePageTokenInput
): SourceApiPaginationTokenPayload {
  const [encodedPayload, signature] = input.token.split(".", 2);
  if (!encodedPayload || !signature) {
    throw new SourceApiInvalidRequestError("Invalid pagination token");
  }

  const expectedSignature = signTokenPayload(encodedPayload, input.secret);
  if (
    !timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    )
  ) {
    throw new SourceApiInvalidRequestError(
      "Invalid pagination token signature"
    );
  }

  const payload = readPaginationTokenPayload(encodedPayload);

  if (payload.sourceKey !== input.expected.sourceKey) {
    throw new SourceApiInvalidRequestError(
      "Pagination token source key mismatch"
    );
  }
  if (payload.operation !== input.expected.operation) {
    throw new SourceApiInvalidRequestError(
      "Pagination token operation mismatch"
    );
  }
  if (payload.preparedBinding !== input.expected.preparedBinding) {
    throw new SourceApiInvalidRequestError(
      "Pagination token prepared binding mismatch"
    );
  }
  if (
    payload.descriptorVersion !== undefined &&
    payload.descriptorVersion !== input.expected.descriptorVersion
  ) {
    throw new SourceApiInvalidRequestError(
      "Pagination token descriptor version mismatch"
    );
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(payload.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new SourceApiInvalidRequestError("Pagination token expired");
  }

  return payload;
}

function readPaginationTokenPayload(
  encodedPayload: string
): SourceApiPaginationTokenPayload {
  try {
    return JSON.parse(
      Buffer.from(fromBase64Url(encodedPayload), "base64url").toString("utf8")
    ) as SourceApiPaginationTokenPayload;
  } catch {
    throw new SourceApiInvalidRequestError("Invalid pagination token");
  }
}

function signTokenPayload(
  payload: string,
  secret: string | Uint8Array
): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("base64url");
}
