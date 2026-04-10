import type {
  SourceApiExample,
  SourceApiFieldPolicy,
  SourceApiHeaderPolicy,
  SourceApiOperation,
  SourceApiPaginationPolicy,
  SourceApiSelectorKind,
} from "../types";

type CreateStructuredRequestOperationInput = {
  name: string;
  summary: string;
  description: string;
  selectorKind?: SourceApiSelectorKind;
  selectorLabel?: string;
  allowedRequestHeaders?: readonly string[];
  allowedResponseHeaders?: readonly string[];
  fieldPolicy?: Partial<SourceApiFieldPolicy>;
  paginationPolicy?: SourceApiPaginationPolicy;
  examples?: readonly SourceApiExample[];
  notes?: readonly string[];
};

const DEFAULT_STRUCTURED_FIELD_POLICY: SourceApiFieldPolicy = {
  acceptsInput: true,
  allowsRawFields: true,
  allowsTypedFields: true,
  inputMode: "request_object",
  mergePatches: true,
  supportsArrayPaths: true,
  supportsNestedPaths: true,
};

export function createStructuredRequestOperation(
  input: CreateStructuredRequestOperationInput
): SourceApiOperation {
  const headerPolicy: SourceApiHeaderPolicy = {
    allowedRequestHeaders: input.allowedRequestHeaders ?? [],
    allowedResponseHeaders: input.allowedResponseHeaders ?? [],
  };

  return {
    description: input.description,
    examples: input.examples ?? [],
    fieldPolicy: {
      ...DEFAULT_STRUCTURED_FIELD_POLICY,
      ...input.fieldPolicy,
    },
    headerPolicy,
    kind: "structured_request",
    methodPolicy: {
      allowedMethods: ["POST"],
      defaultMethod: "POST",
    },
    name: input.name,
    notes: input.notes ?? [],
    paginationPolicy: input.paginationPolicy ?? "none",
    selectorKind: input.selectorKind ?? "none",
    selectorLabel: input.selectorLabel,
    summary: input.summary,
  };
}

export function mergeStructuredFieldPatch(input: {
  base?: Record<string, unknown>;
  patch?: Record<string, unknown>;
}): Record<string, unknown> {
  return mergeObjects(input.base ?? {}, input.patch ?? {});
}

function mergeObjects(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = merged[key];
    if (isPlainRecord(baseValue) && isPlainRecord(patchValue)) {
      merged[key] = mergeObjects(baseValue, patchValue);
      continue;
    }

    merged[key] = patchValue;
  }

  return merged;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
