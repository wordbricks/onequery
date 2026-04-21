import { createStableValueFingerprint } from "../lib/stable-fingerprint";
import {
  SourceApiDescriptorVersionMismatchError,
  SourceApiUnsupportedOperationError,
} from "./errors";
import { finalizeSourceApiPolicyPlan } from "./policy";
import { getSourceApiAdapter, sourceApiRegistry } from "./registry";
import type { SourceApiRegistry } from "./registry";
import type {
  PreparedHttpSourceApi,
  PreparedSourceApi,
  PreparedSourceConnection,
  PreparedStructuredSourceApi,
  SourceApiPreview,
  SourceApiActorContext,
  SourceApiDescriptor,
  SourceApiOperation,
  SourceApiDraft,
  UnboundPreparedSourceApi,
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
    throw new SourceApiUnsupportedOperationError(input.operationName);
  }

  return operation;
}

export function finalizePreparedSourceApi(
  plan: UnboundPreparedSourceApi
): PreparedSourceApi {
  const prepared = finalizeSourceApiPolicyPlan(plan);
  if (prepared.kind === "http_request") {
    return {
      ...prepared,
      preparedBinding: createStableValueFingerprint(prepared),
    } satisfies PreparedHttpSourceApi;
  }

  return {
    ...prepared,
    preparedBinding: createStableValueFingerprint(prepared),
  } satisfies PreparedStructuredSourceApi;
}

export function createSourceApiPreview(
  prepared: PreparedSourceApi
): SourceApiPreview {
  return {
    source: {
      sourceKey: prepared.sourceKey,
      provider: prepared.provider,
    },
    bodyKind: prepared.bodyKind,
    bodyPaths: [...prepared.bodyPaths],
    headerNames: [...prepared.headerNames],
    host: prepared.host,
    kind: prepared.kind,
    method: prepared.method,
    operation: prepared.operation,
    paginationPolicy: prepared.paginationPolicy,
    selector: prepared.selector,
    url: prepared.kind === "http_request" ? prepared.url : undefined,
  };
}

export async function prepareSourceApiDraft(input: {
  source: PreparedSourceConnection;
  actor: SourceApiActorContext;
  descriptor: SourceApiDescriptor;
  draft: SourceApiDraft;
  registry?: SourceApiRegistry;
}): Promise<PreparedSourceApi> {
  if (
    input.draft.descriptorVersion &&
    input.draft.descriptorVersion !== input.descriptor.descriptorVersion
  ) {
    throw new SourceApiDescriptorVersionMismatchError({
      expectedDescriptorVersion: input.descriptor.descriptorVersion,
      receivedDescriptorVersion: input.draft.descriptorVersion,
    });
  }

  const registry = input.registry ?? sourceApiRegistry;
  const adapter = getSourceApiAdapter(registry, input.source.provider);
  const prepared = await adapter.normalize({
    actor: input.actor,
    descriptor: input.descriptor,
    request: input.draft,
    source: input.source,
  });

  return finalizePreparedSourceApi(prepared);
}
