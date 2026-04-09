import type {
  SourceApiExample,
  SourceApiFieldPolicy,
  SourceApiHeader,
  SourceApiHeaderPolicy,
  SourceApiMethodPolicy,
  SourceApiOperation,
  SourceApiPaginationPolicy,
  SourceApiRequestBody,
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
    throw new Error(`Unsupported HTTP method override: ${method}`);
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
      throw new Error("Request headers must include a name");
    }
    if (!allowlist.has(lowerName)) {
      throw new Error(`Unsupported request header: ${name}`);
    }
    if (seen.has(lowerName)) {
      throw new Error(`Duplicate request header: ${name}`);
    }
    seen.add(lowerName);

    return {
      name,
      value: header.value,
    };
  });
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
