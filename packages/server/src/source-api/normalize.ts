import { createHash } from "node:crypto";

import { finalizeSourceApiPolicyPlan } from "./policy";
import { getSourceApiAdapter, sourceApiRegistry } from "./registry";
import type { SourceApiRegistry } from "./registry";
import type {
  NormalizedExecutionPlan,
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiDescriptor,
  SourceApiExecuteRequest,
  SourceApiOperation,
  UnfingerprintedNormalizedExecutionPlan,
} from "./types";

export function getSourceApiOperation(
  descriptor: SourceApiDescriptor,
  operationName: string
): SourceApiOperation | null {
  return (
    descriptor.operations.find(
      (operation) => operation.name === operationName.trim()
    ) ?? null
  );
}

export function requireSourceApiOperation(input: {
  descriptor: SourceApiDescriptor;
  operationName: string;
}): SourceApiOperation {
  const operation = getSourceApiOperation(
    input.descriptor,
    input.operationName
  );
  if (!operation) {
    throw new Error(`Unsupported source API operation: ${input.operationName}`);
  }

  return operation;
}

export function finalizeNormalizedExecutionPlan(
  plan: UnfingerprintedNormalizedExecutionPlan
): NormalizedExecutionPlan {
  const policyPlan = finalizeSourceApiPolicyPlan(plan);
  return {
    ...policyPlan,
    requestFingerprint: createSourceApiRequestFingerprint(policyPlan),
  };
}

export function createSourceApiRequestFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("base64url");
}

export async function normalizeSourceApiRequest(input: {
  source: PreparedSourceConnection;
  actor: SourceApiActorContext;
  descriptor: SourceApiDescriptor;
  request: SourceApiExecuteRequest;
  registry?: SourceApiRegistry;
}): Promise<NormalizedExecutionPlan> {
  if (
    input.request.descriptorVersion &&
    input.request.descriptorVersion !== input.descriptor.descriptorVersion
  ) {
    throw new Error(
      `descriptor_version mismatch: expected "${input.descriptor.descriptorVersion}", received "${input.request.descriptorVersion}"`
    );
  }

  const registry = input.registry ?? sourceApiRegistry;
  const adapter = getSourceApiAdapter(registry, input.source.provider);

  return finalizeNormalizedExecutionPlan(
    await adapter.normalize({
      actor: input.actor,
      descriptor: input.descriptor,
      request: input.request,
      source: input.source,
    })
  );
}

function stableStringify(value: unknown): string {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value instanceof Uint8Array) {
    return `[${Array.from(value).join(",")}]`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    );
    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableStringify(entryValue)}`
      )
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}
