import type {
  SourceApiDescriptor,
  SourceApiHeaderPolicy,
  SourceApiOperation,
} from "../types";

// Comment: HTTP header names are case-insensitive, but the CLI and workflow
// protobuf contracts persist descriptor header policies as lowercase tokens.
export function canonicalizeSourceApiHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

export function canonicalizeSourceApiHeaderNames(
  names: readonly string[]
): string[] {
  const canonicalNames = new Set<string>();

  for (const name of names) {
    canonicalNames.add(canonicalizeSourceApiHeaderName(name));
  }

  return [...canonicalNames];
}

export function canonicalizeSourceApiHeaderPolicy(
  policy: SourceApiHeaderPolicy
): SourceApiHeaderPolicy {
  return {
    allowedRequestHeaders: canonicalizeSourceApiHeaderNames(
      policy.allowedRequestHeaders
    ),
    allowedResponseHeaders: canonicalizeSourceApiHeaderNames(
      policy.allowedResponseHeaders
    ),
  };
}

export function canonicalizeSourceApiOperationHeaderPolicy(
  operation: SourceApiOperation
): SourceApiOperation {
  return {
    ...operation,
    headerPolicy: canonicalizeSourceApiHeaderPolicy(operation.headerPolicy),
  };
}

export function canonicalizeSourceApiDescriptorHeaderPolicies(
  descriptor: SourceApiDescriptor
): SourceApiDescriptor {
  return {
    ...descriptor,
    operations: descriptor.operations.map(
      canonicalizeSourceApiOperationHeaderPolicy
    ),
  };
}
