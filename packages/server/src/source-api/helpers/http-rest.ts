import { SourceApiInvalidRequestError } from "../errors";
import type {
  SourceApiExample,
  SourceApiFieldPolicy,
  SourceApiHeader,
  SourceApiHeaderPolicy,
  SourceApiMethodPolicy,
  SourceApiOperation,
  SourceApiPaginationPolicy,
  SourceApiRequestBody,
  SourceApiResponseBody,
  SourceApiSelectorKind,
} from "../types";

type CreateHttpRequestOperationInput = {
  name: string;
  summary: string;
  description: string;
  selectorKind: SourceApiSelectorKind;
  selectorLabel?: string;
  defaultMethod?: string;
  allowedMethods?: readonly string[];
  allowedRequestHeaders?: readonly string[];
  allowedResponseHeaders?: readonly string[];
  fieldPolicy?: Partial<SourceApiFieldPolicy>;
  paginationPolicy?: SourceApiPaginationPolicy;
  examples?: readonly SourceApiExample[];
  notes?: readonly string[];
};

const DEFAULT_HTTP_FIELD_POLICY: SourceApiFieldPolicy = {
  acceptsInput: true,
  allowsRawFields: true,
  allowsTypedFields: true,
  inputMode: "request_body",
  mergePatches: false,
  supportsArrayPaths: true,
  supportsNestedPaths: true,
};

export const DEFAULT_SOURCE_API_CONTENT_TYPE = "application/octet-stream";

export function createHttpRequestOperation(
  input: CreateHttpRequestOperationInput
): SourceApiOperation {
  const methodPolicy: SourceApiMethodPolicy = {
    allowedMethods: input.allowedMethods ?? ["GET"],
    defaultMethod: input.defaultMethod,
  };
  const headerPolicy: SourceApiHeaderPolicy = {
    allowedRequestHeaders: input.allowedRequestHeaders ?? [],
    allowedResponseHeaders: input.allowedResponseHeaders ?? [],
  };

  return {
    description: input.description,
    examples: input.examples ?? [],
    fieldPolicy: {
      ...DEFAULT_HTTP_FIELD_POLICY,
      ...input.fieldPolicy,
    },
    headerPolicy,
    kind: "http_request",
    methodPolicy,
    name: input.name,
    notes: input.notes ?? [],
    paginationPolicy: input.paginationPolicy ?? "none",
    selectorKind: input.selectorKind,
    selectorLabel: input.selectorLabel,
    summary: input.summary,
  };
}

export function resolveHttpMethodOverride(input: {
  methodOverride?: string;
  policy: SourceApiMethodPolicy;
}): string {
  const fallback =
    input.policy.defaultMethod ?? input.policy.allowedMethods[0] ?? "GET";
  const method = (input.methodOverride ?? fallback).trim().toUpperCase();

  if (!input.policy.allowedMethods.includes(method)) {
    throw new SourceApiInvalidRequestError(
      `Unsupported HTTP method override: ${method}`
    );
  }

  return method;
}

export function normalizeAllowedHeaders(input: {
  headers: readonly SourceApiHeader[];
  allowedNames: readonly string[];
}): SourceApiHeader[] {
  const allowlist = new Set(
    input.allowedNames.map((name) => name.toLowerCase())
  );
  const seen = new Set<string>();

  return input.headers.map((header) => {
    const name = header.name.trim();
    const lowerName = name.toLowerCase();
    if (name.length === 0) {
      throw new SourceApiInvalidRequestError(
        "Request headers must include a name"
      );
    }
    if (!allowlist.has(lowerName)) {
      throw new SourceApiInvalidRequestError(
        `Unsupported request header: ${name}`
      );
    }
    if (seen.has(lowerName)) {
      throw new SourceApiInvalidRequestError(
        `Duplicate request header: ${name}`
      );
    }
    seen.add(lowerName);

    return {
      name,
      value: header.value,
    };
  });
}

export function filterAllowedResponseHeaders(input: {
  headers: readonly SourceApiHeader[];
  allowedNames: readonly string[];
  contentType?: string;
}): SourceApiHeader[] {
  const allowlist = new Set(
    input.allowedNames.map((name) => name.toLowerCase())
  );
  if (allowlist.size === 0) {
    return [];
  }

  const filtered: SourceApiHeader[] = [];
  const seen = new Set<string>();
  for (const header of input.headers) {
    const name = header.name.trim();
    const lowerName = name.toLowerCase();
    if (name.length === 0 || !allowlist.has(lowerName) || seen.has(lowerName)) {
      continue;
    }

    seen.add(lowerName);
    filtered.push({
      name,
      value: header.value,
    });
  }

  const contentType = input.contentType?.trim();
  if (
    contentType &&
    allowlist.has("content-type") &&
    !seen.has("content-type")
  ) {
    filtered.push({
      name: "content-type",
      value: contentType,
    });
  }

  return filtered;
}

export function toHeaderRecord(
  headers: readonly SourceApiHeader[]
): Record<string, string> {
  return Object.fromEntries(
    headers.map((header) => [header.name, header.value])
  );
}

export function getSourceApiBodyKind(
  body: SourceApiRequestBody
): SourceApiRequestBody["kind"] {
  return body.kind;
}

export type SourceApiHttpTransportResponse = {
  body: SourceApiResponseBody;
  contentType: string;
  headers: SourceApiHeader[];
  status: number;
};

export function normalizeSourceApiContentType(
  contentType: string | null | undefined
): string {
  const normalized = contentType?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : DEFAULT_SOURCE_API_CONTENT_TYPE;
}

export async function readSourceApiHttpTransportResponse(
  response: Response
): Promise<SourceApiHttpTransportResponse> {
  const contentType = normalizeSourceApiContentType(
    response.headers.get("content-type")
  );
  const bytes = new Uint8Array(await response.arrayBuffer());

  return {
    body: parseSourceApiHttpResponseBody({
      bytes,
      contentType,
      status: response.status,
    }),
    contentType,
    headers: Array.from(response.headers.entries()).map(([name, value]) => ({
      name,
      value,
    })),
    status: response.status,
  };
}

export function parseSourceApiHttpResponseBody(input: {
  bytes: Uint8Array;
  contentType: string;
  status: number;
}): SourceApiResponseBody {
  if (input.status === 204 || input.bytes.length === 0) {
    return { kind: "none" };
  }

  if (
    input.contentType.includes("application/json") ||
    input.contentType.includes("+json")
  ) {
    const text = new TextDecoder().decode(input.bytes);
    if (text.trim().length === 0) {
      return { kind: "none" };
    }

    return {
      kind: "json",
      value: JSON.parse(text),
    };
  }

  if (
    input.contentType.startsWith("text/") ||
    input.contentType.includes("application/xml") ||
    input.contentType.includes("application/x-www-form-urlencoded")
  ) {
    const text = new TextDecoder().decode(input.bytes);
    if (text.trim().length === 0) {
      return { kind: "none" };
    }

    return {
      kind: "text",
      value: text,
    };
  }

  return {
    kind: "binary",
    value: input.bytes,
  };
}
