import { createHmac, timingSafeEqual } from "node:crypto";

import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { base64UrlToBytes, base64UrlToUtf8 } from "@onequery/codecs/base64";

import { SourceApiExpiredError, SourceApiInvalidRequestError } from "../errors";
import type {
  PreparedHttpSourceApi,
  PreparedSourceApi,
  PreparedStructuredSourceApi,
  SourceApiContinuationTokenPayload,
  SourceApiHeader,
  SourceApiRequestBody,
} from "../types";

const SOURCE_API_CONTINUATION_TOKEN_VERSION = 1;
const DEFAULT_SOURCE_API_CONTINUATION_TOKEN_TTL_MS = 5 * 60_000;
const CONTINUATION_TOKEN_BINARY_BODY_KEY = "valueBase64Url";

type EncodeSourceApiContinuationTokenInput = {
  organizationSlug: string;
  prepared: PreparedSourceApi;
  secret: string | Uint8Array;
  state: JsonValue;
  now?: Date;
  ttlMs?: number;
};

type DecodeSourceApiContinuationTokenInput = {
  token: string;
  secret: string | Uint8Array;
  now?: Date;
};

type ParsedSourceApiContinuationTokenPayload = Omit<
  SourceApiContinuationTokenPayload,
  "version"
> & {
  version: number;
};

type SerializedSourceApiRequestBody =
  | { kind: "none" }
  | { kind: "json"; value: JsonValue }
  | { kind: "text"; value: string }
  | {
      kind: "binary";
      [CONTINUATION_TOKEN_BINARY_BODY_KEY]: string;
    };

type SerializedPreparedSourceApi = Omit<PreparedSourceApi, "body"> & {
  body: SerializedSourceApiRequestBody;
};

type SerializedSourceApiContinuationTokenPayload = Omit<
  ParsedSourceApiContinuationTokenPayload,
  "prepared"
> & {
  prepared: SerializedPreparedSourceApi;
};

export function encodeSourceApiContinuationToken(
  input: EncodeSourceApiContinuationTokenInput
): string {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_SOURCE_API_CONTINUATION_TOKEN_TTL_MS;
  const payload = serializeSourceApiContinuationTokenPayload({
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    issuedAt: now.toISOString(),
    organizationSlug: input.organizationSlug,
    prepared: input.prepared,
    state: input.state,
    version: SOURCE_API_CONTINUATION_TOKEN_VERSION,
  });
  const signature = signTokenPayload(payload, input.secret);
  return `${payload}.${signature}`;
}

export function decodeSourceApiContinuationToken(
  input: DecodeSourceApiContinuationTokenInput
): SourceApiContinuationTokenPayload {
  const { encodedPayload, signature } = readSignedTokenParts(input.token);
  const expectedSignature = signTokenPayload(encodedPayload, input.secret);
  if (!hasMatchingSignature(signature, expectedSignature)) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token signature"
    );
  }

  const payload = readSourceApiContinuationTokenPayload(encodedPayload);
  if (payload.version !== SOURCE_API_CONTINUATION_TOKEN_VERSION) {
    throw new SourceApiInvalidRequestError(
      "Unsupported source API continuation token version"
    );
  }
  if (payload.organizationSlug.trim().length === 0) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  const expiresAt = new Date(payload.expiresAt);
  const now = input.now ?? new Date();
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new SourceApiExpiredError("Source API continuation token expired");
  }

  return {
    ...payload,
    version: SOURCE_API_CONTINUATION_TOKEN_VERSION,
  };
}

function readSignedTokenParts(token: string): {
  encodedPayload: string;
  signature: string;
} {
  const separatorIndex = token.indexOf(".");
  if (
    separatorIndex <= 0 ||
    separatorIndex !== token.lastIndexOf(".") ||
    separatorIndex >= token.length - 1
  ) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  return {
    encodedPayload: token.slice(0, separatorIndex),
    signature: token.slice(separatorIndex + 1),
  };
}

function hasMatchingSignature(signature: string, expectedSignature: string) {
  const receivedBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expectedSignature, "utf8");
  if (receivedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(receivedBytes, expectedBytes);
}

function readSourceApiContinuationTokenPayload(
  encodedPayload: string
): ParsedSourceApiContinuationTokenPayload {
  return parseSourceApiContinuationTokenPayload(
    readSourceApiContinuationTokenJson(encodedPayload)
  );
}

function readSourceApiContinuationTokenJson(encodedPayload: string): unknown {
  try {
    return JSON.parse(base64UrlToUtf8.decode(encodedPayload));
  } catch {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }
}

function parseSourceApiContinuationTokenPayload(
  value: unknown
): ParsedSourceApiContinuationTokenPayload {
  if (!isPlainRecord(value)) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  return {
    expiresAt: readRequiredString(value.expiresAt),
    issuedAt: readRequiredString(value.issuedAt),
    organizationSlug: readRequiredString(value.organizationSlug),
    prepared: parsePreparedSourceApi(value.prepared),
    state: value.state as JsonValue,
    version,
  };
}

function parsePreparedSourceApi(value: unknown): PreparedSourceApi {
  if (!isPlainRecord(value)) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  const body = parsePreparedSourceApiRequestBody(value.body);
  const bodyKind = readSourceApiBodyKind(value.bodyKind);
  if (bodyKind !== body.kind) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  const base = {
    body,
    bodyKind,
    bodyPaths: readStringArray(value.bodyPaths),
    descriptorVersion: readOptionalString(value.descriptorVersion),
    headerNames: readStringArray(value.headerNames),
    headers: readSourceApiHeaders(value.headers),
    host: readOptionalString(value.host),
    operation: readRequiredString(value.operation),
    paginationPolicy: readSourceApiPaginationPolicy(value.paginationPolicy),
    preparedBinding: readRequiredString(value.preparedBinding),
    provider: readRequiredString(
      value.provider
    ) as PreparedSourceApi["provider"],
    selector: readOptionalString(value.selector),
    selectorTemplate: readOptionalString(value.selectorTemplate),
    sourceId: readRequiredString(value.sourceId),
    sourceKey: readRequiredString(value.sourceKey),
  };
  const method = readRequiredString(value.method);

  if (value.kind === "http_request") {
    return {
      ...base,
      kind: "http_request",
      metadata: readOptionalJsonObject(value.metadata),
      method,
      query: readOptionalJsonObject(value.query),
      timeoutMs: readOptionalFiniteNumber(value.timeoutMs),
      url: readRequiredString(value.url),
    } satisfies PreparedHttpSourceApi;
  }

  if (value.kind === "structured_request") {
    return {
      ...base,
      kind: "structured_request",
      metadata: readOptionalJsonObject(value.metadata),
      method,
      request: readJsonObject(value.request),
    } satisfies PreparedStructuredSourceApi;
  }

  throw new SourceApiInvalidRequestError(
    "Invalid source API continuation token"
  );
}

function parsePreparedSourceApiRequestBody(
  value: unknown
): SourceApiRequestBody {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  switch (value.kind) {
    case "none":
      return { kind: "none" };
    case "json":
      if (!Object.hasOwn(value, "value")) {
        throw new SourceApiInvalidRequestError(
          "Invalid source API continuation token"
        );
      }
      return {
        kind: "json",
        value: value.value as JsonValue,
      };
    case "text":
      return {
        kind: "text",
        value: readRequiredString(value.value),
      };
    case "binary":
      return {
        kind: "binary",
        value: readBase64UrlBytes(value[CONTINUATION_TOKEN_BINARY_BODY_KEY]),
      };
    default:
      throw new SourceApiInvalidRequestError(
        "Invalid source API continuation token"
      );
  }
}

function readSourceApiBodyKind(value: unknown): PreparedSourceApi["bodyKind"] {
  if (
    value === "none" ||
    value === "json" ||
    value === "text" ||
    value === "binary"
  ) {
    return value;
  }

  throw new SourceApiInvalidRequestError(
    "Invalid source API continuation token"
  );
}

function readSourceApiPaginationPolicy(
  value: unknown
): PreparedSourceApi["paginationPolicy"] {
  if (value === "none" || value === "continuation_token") {
    return value;
  }

  throw new SourceApiInvalidRequestError(
    "Invalid source API continuation token"
  );
}

function readSourceApiHeaders(value: unknown): SourceApiHeader[] {
  if (!Array.isArray(value)) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  return value.map((header) => {
    if (!isPlainRecord(header)) {
      throw new SourceApiInvalidRequestError(
        "Invalid source API continuation token"
      );
    }

    return {
      name: readRequiredString(header.name),
      value: readRequiredString(header.value),
    };
  });
}

function serializeSourceApiContinuationTokenPayload(
  payload: SourceApiContinuationTokenPayload
): string {
  const serializedPayload: SerializedSourceApiContinuationTokenPayload = {
    ...payload,
    prepared: serializePreparedSourceApi(payload.prepared),
  };
  return base64UrlToUtf8.encode(JSON.stringify(serializedPayload));
}

function serializePreparedSourceApi(
  prepared: PreparedSourceApi
): SerializedPreparedSourceApi {
  return {
    ...prepared,
    // Keep binary encoding local to the request body. A generic JSON reviver
    // would rewrite user JSON by key shape, which is not acceptable here.
    body: serializePreparedSourceApiRequestBody(prepared.body),
  };
}

function serializePreparedSourceApiRequestBody(
  body: SourceApiRequestBody
): SerializedSourceApiRequestBody {
  if (body.kind !== "binary") {
    return body;
  }

  return {
    [CONTINUATION_TOKEN_BINARY_BODY_KEY]: base64UrlToBytes.encode(
      new Uint8Array(body.value)
    ),
    kind: "binary",
  };
}

function signTokenPayload(
  payload: string,
  secret: string | Uint8Array
): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function readRequiredString(value: unknown): string {
  if (typeof value !== "string") {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readRequiredString(value);
}

function readStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  return [...value];
}

function readJsonObject(value: unknown): JsonObject {
  if (!isPlainRecord(value)) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  return value as JsonObject;
}

function readOptionalJsonObject(value: unknown): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readJsonObject(value);
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }

  return value;
}

function readBase64UrlBytes(value: unknown): Uint8Array {
  try {
    return base64UrlToBytes.decode(readRequiredString(value));
  } catch {
    throw new SourceApiInvalidRequestError(
      "Invalid source API continuation token"
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
