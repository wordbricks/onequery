import { create, fromJson, isFieldSet, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import type {
  SourceApiDescriptor,
  SourceApiFieldPolicy,
  SourceApiHeaderPolicy,
  SourceApiMethodPolicy,
  SourceApiOperation,
  SourceApiSource,
} from "@onequery/server/source-api";
import { canonicalizeSourceApiHeaderNames } from "@onequery/server/source-api/header-policy";

import * as sourceApiPb from "../../../connect/gen/onequery/workflow/v1/source_api_action_pb";
import { assertNever } from "../../storage/protobuf-codec";
import type {
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
  StoredSourceApiExecutionResult,
} from "../descriptors";
import {
  fromSourceApiInputMode,
  fromSourceApiOperationKind,
  fromSourceApiPaginationPolicy,
  fromSourceApiSelectorKind,
  fromWorkflowSourceProvider,
  toSourceApiInputMode,
  toSourceApiOperationKind,
  toSourceApiPaginationPolicy,
  toSourceApiSelectorKind,
  toWorkflowSourceProvider,
} from "./enums";
import { requireMessage } from "./shared";

export function toSourceApiSourceDescriptorMessage(
  source: SourceApiActionSourceDescriptor
) {
  return create(sourceApiPb.SourceApiActionSourceDescriptorSchema, {
    ...(source.displayName === null ? {} : { displayName: source.displayName }),
    provider: toWorkflowSourceProvider(source.provider),
    sourceId: source.sourceId,
    sourceKey: source.sourceKey,
  });
}

export function fromSourceApiSourceDescriptorMessage(
  source: sourceApiPb.SourceApiActionSourceDescriptor | undefined
): SourceApiActionSourceDescriptor {
  const value = requireMessage(source, "source");

  return {
    displayName: isFieldSet(
      value,
      sourceApiPb.SourceApiActionSourceDescriptorSchema.field.displayName
    )
      ? value.displayName
      : null,
    provider: fromWorkflowSourceProvider(value.provider),
    sourceId: value.sourceId,
    sourceKey: value.sourceKey,
  };
}

export function toSourceApiRequestDescriptorMessage(
  descriptor: SourceApiActionRequestDescriptor
) {
  return create(sourceApiPb.SourceApiActionRequestDescriptorSchema, {
    ...(descriptor.descriptorVersion === null
      ? {}
      : { descriptorVersion: descriptor.descriptorVersion }),
    ...(descriptor.kind === null
      ? {}
      : { kind: toSourceApiOperationKind(descriptor.kind) }),
    ...(descriptor.method === null ? {} : { method: descriptor.method }),
    operation: descriptor.operation,
    ...(descriptor.paginationPolicy === null
      ? {}
      : {
          paginationPolicy: toSourceApiPaginationPolicy(
            descriptor.paginationPolicy
          ),
        }),
    ...(descriptor.selector === null ? {} : { selector: descriptor.selector }),
  });
}

export function fromSourceApiRequestDescriptorMessage(
  descriptor: sourceApiPb.SourceApiActionRequestDescriptor | undefined
): SourceApiActionRequestDescriptor {
  const value = requireMessage(descriptor, "request_descriptor");

  return {
    descriptorVersion: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.descriptorVersion
    )
      ? value.descriptorVersion
      : null,
    kind: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.kind
    )
      ? fromSourceApiOperationKind(value.kind)
      : null,
    method: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.method
    )
      ? value.method
      : null,
    operation: value.operation,
    paginationPolicy: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.paginationPolicy
    )
      ? fromSourceApiPaginationPolicy(value.paginationPolicy)
      : null,
    selector: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.selector
    )
      ? value.selector
      : null,
  };
}

export function toSourceApiDescriptorMessage(descriptor: SourceApiDescriptor) {
  return create(sourceApiPb.SourceApiActionDescriptorSchema, {
    ...(descriptor.defaultPathOperation === undefined
      ? {}
      : { defaultPathOperation: descriptor.defaultPathOperation }),
    descriptorVersion: descriptor.descriptorVersion,
    examples: descriptor.examples.map(toSourceApiExampleMessage),
    notes: [...descriptor.notes],
    operations: descriptor.operations.map(toSourceApiOperationMessage),
    source: create(sourceApiPb.SourceApiActionDescriptorSourceSchema, {
      ...(descriptor.source.displayName === undefined ||
      descriptor.source.displayName === null
        ? {}
        : { displayName: descriptor.source.displayName }),
      provider: toWorkflowSourceProvider(descriptor.source.provider),
      sourceKey: descriptor.source.sourceKey,
    }),
  });
}

export function fromSourceApiDescriptorMessage(
  descriptor: sourceApiPb.SourceApiActionDescriptor | undefined
): SourceApiDescriptor {
  const value = requireMessage(descriptor, "descriptor");
  const source = requireMessage(value.source, "source");

  return {
    ...(isFieldSet(
      value,
      sourceApiPb.SourceApiActionDescriptorSchema.field.defaultPathOperation
    )
      ? { defaultPathOperation: value.defaultPathOperation }
      : {}),
    descriptorVersion: value.descriptorVersion,
    examples: value.examples.map(fromSourceApiExampleMessage),
    notes: [...value.notes],
    operations: value.operations.map(fromSourceApiOperationMessage),
    source: {
      ...(isFieldSet(
        source,
        sourceApiPb.SourceApiActionDescriptorSourceSchema.field.displayName
      )
        ? { displayName: source.displayName }
        : {}),
      provider: fromWorkflowSourceProvider(source.provider),
      sourceKey: source.sourceKey,
    },
  };
}

function toSourceApiOperationMessage(operation: SourceApiOperation) {
  return create(sourceApiPb.SourceApiActionOperationSchema, {
    description: operation.description,
    examples: operation.examples.map(toSourceApiExampleMessage),
    fieldPolicy: toSourceApiFieldPolicyMessage(operation.fieldPolicy),
    headerPolicy: toSourceApiHeaderPolicyMessage(operation.headerPolicy),
    kind: toSourceApiOperationKind(operation.kind),
    methodPolicy: toSourceApiMethodPolicyMessage(operation.methodPolicy),
    name: operation.name,
    notes: [...operation.notes],
    paginationPolicy: toSourceApiPaginationPolicy(operation.paginationPolicy),
    ...(operation.selectorLabel === undefined
      ? {}
      : { selectorLabel: operation.selectorLabel }),
    selectorKind: toSourceApiSelectorKind(operation.selectorKind),
    summary: operation.summary,
  });
}

function fromSourceApiOperationMessage(
  operation: sourceApiPb.SourceApiActionOperation
): SourceApiOperation {
  return {
    description: operation.description,
    examples: operation.examples.map(fromSourceApiExampleMessage),
    fieldPolicy: fromSourceApiFieldPolicyMessage(operation.fieldPolicy),
    headerPolicy: fromSourceApiHeaderPolicyMessage(operation.headerPolicy),
    kind: fromSourceApiOperationKind(operation.kind),
    methodPolicy: fromSourceApiMethodPolicyMessage(operation.methodPolicy),
    name: operation.name,
    notes: [...operation.notes],
    paginationPolicy: fromSourceApiPaginationPolicy(operation.paginationPolicy),
    ...(isFieldSet(
      operation,
      sourceApiPb.SourceApiActionOperationSchema.field.selectorLabel
    )
      ? { selectorLabel: operation.selectorLabel }
      : {}),
    selectorKind: fromSourceApiSelectorKind(operation.selectorKind),
    summary: operation.summary,
  };
}

function toSourceApiMethodPolicyMessage(policy: SourceApiMethodPolicy) {
  return create(sourceApiPb.SourceApiActionMethodPolicySchema, {
    allowedMethods: [...policy.allowedMethods],
    ...(policy.defaultMethod === undefined
      ? {}
      : { defaultMethod: policy.defaultMethod }),
  });
}

function fromSourceApiMethodPolicyMessage(
  policy: sourceApiPb.SourceApiActionMethodPolicy | undefined
): SourceApiMethodPolicy {
  const value = requireMessage(policy, "method_policy");

  return {
    allowedMethods: [...value.allowedMethods],
    ...(isFieldSet(
      value,
      sourceApiPb.SourceApiActionMethodPolicySchema.field.defaultMethod
    )
      ? { defaultMethod: value.defaultMethod }
      : {}),
  };
}

function toSourceApiFieldPolicyMessage(policy: SourceApiFieldPolicy) {
  return create(sourceApiPb.SourceApiActionFieldPolicySchema, {
    acceptsInput: policy.acceptsInput,
    allowsRawFields: policy.allowsRawFields,
    allowsTypedFields: policy.allowsTypedFields,
    inputMode: toSourceApiInputMode(policy.inputMode),
    mergePatches: policy.mergePatches,
    supportsArrayPaths: policy.supportsArrayPaths,
    supportsNestedPaths: policy.supportsNestedPaths,
  });
}

function fromSourceApiFieldPolicyMessage(
  policy: sourceApiPb.SourceApiActionFieldPolicy | undefined
): SourceApiFieldPolicy {
  const value = requireMessage(policy, "field_policy");

  return {
    acceptsInput: value.acceptsInput,
    allowsRawFields: value.allowsRawFields,
    allowsTypedFields: value.allowsTypedFields,
    inputMode: fromSourceApiInputMode(value.inputMode),
    mergePatches: value.mergePatches,
    supportsArrayPaths: value.supportsArrayPaths,
    supportsNestedPaths: value.supportsNestedPaths,
  };
}

function toSourceApiHeaderPolicyMessage(policy: SourceApiHeaderPolicy) {
  return create(sourceApiPb.SourceApiActionHeaderPolicySchema, {
    allowedRequestHeaderNames: canonicalizeSourceApiHeaderNames(
      policy.allowedRequestHeaders
    ),
    allowedResponseHeaderNames: canonicalizeSourceApiHeaderNames(
      policy.allowedResponseHeaders
    ),
  });
}

function fromSourceApiHeaderPolicyMessage(
  policy: sourceApiPb.SourceApiActionHeaderPolicy | undefined
): SourceApiHeaderPolicy {
  const value = requireMessage(policy, "header_policy");

  return {
    allowedRequestHeaders: [...value.allowedRequestHeaderNames],
    allowedResponseHeaders: [...value.allowedResponseHeaderNames],
  };
}

function toSourceApiExampleMessage(
  example: SourceApiDescriptor["examples"][number]
) {
  return create(sourceApiPb.SourceApiActionExampleSchema, {
    command: example.command,
    ...(example.description === undefined
      ? {}
      : { description: example.description }),
    label: example.label,
  });
}

function fromSourceApiExampleMessage(
  example: sourceApiPb.SourceApiActionExample
) {
  return {
    command: example.command,
    ...(isFieldSet(
      example,
      sourceApiPb.SourceApiActionExampleSchema.field.description
    )
      ? { description: example.description }
      : {}),
    label: example.label,
  };
}

export function toSourceApiExecutionResultMessage(
  result: StoredSourceApiExecutionResult
) {
  return create(sourceApiPb.SourceApiActionExecutionResultSchema, {
    body: toSourceApiExecutionBodyMessage(result.body),
    contentType: result.contentType,
    headers: result.headers.map((header) =>
      create(sourceApiPb.WorkflowSourceHeaderSchema, {
        name: header.name,
        value: header.value,
      })
    ),
    ...(result.nextContinuationState === undefined
      ? {}
      : {
          nextContinuationState: fromJson(
            ValueSchema,
            result.nextContinuationState
          ),
        }),
    operation: result.operation,
    ...(result.selector === undefined ? {} : { selector: result.selector }),
    httpStatus: result.status,
    source: toSourceApiExecutionSourceMessage(result.source),
  });
}

export function fromSourceApiExecutionResultMessage(
  result: sourceApiPb.SourceApiActionExecutionResult | undefined
): StoredSourceApiExecutionResult {
  const value = requireMessage(result, "execution_result");

  return {
    body: fromSourceApiExecutionBodyMessage(value.body),
    contentType: value.contentType,
    headers: value.headers.map((header) => ({
      name: header.name,
      value: header.value,
    })),
    ...(value.nextContinuationState === undefined
      ? {}
      : {
          nextContinuationState: toJson(
            ValueSchema,
            value.nextContinuationState
          ),
        }),
    operation: value.operation,
    ...(isFieldSet(
      value,
      sourceApiPb.SourceApiActionExecutionResultSchema.field.selector
    )
      ? { selector: value.selector }
      : {}),
    source: fromSourceApiExecutionSourceMessage(value.source),
    status: value.httpStatus,
  };
}

function toSourceApiExecutionSourceMessage(source: SourceApiSource) {
  return create(sourceApiPb.SourceApiActionExecutionSourceSchema, {
    ...(source.displayName === undefined || source.displayName === null
      ? {}
      : { displayName: source.displayName }),
    provider: toWorkflowSourceProvider(source.provider),
    sourceKey: source.sourceKey,
  });
}

function fromSourceApiExecutionSourceMessage(
  source: sourceApiPb.SourceApiActionExecutionSource | undefined
) {
  const value = requireMessage(source, "source");

  return {
    ...(isFieldSet(
      value,
      sourceApiPb.SourceApiActionExecutionSourceSchema.field.displayName
    )
      ? { displayName: value.displayName }
      : {}),
    provider: fromWorkflowSourceProvider(value.provider),
    sourceKey: value.sourceKey,
  };
}

function toSourceApiExecutionBodyMessage(
  body: StoredSourceApiExecutionResult["body"]
): sourceApiPb.SourceApiActionExecutionResult["body"] {
  switch (body.kind) {
    case "none":
      return {
        case: "none",
        value: create(sourceApiPb.SourceApiActionEmptyBodySchema),
      };
    case "json":
      return {
        case: "json",
        value: fromJson(ValueSchema, body.value),
      };
    case "text":
      return {
        case: "text",
        value: body.value,
      };
    case "binary":
      return {
        case: "binary",
        value: body.value,
      };
    default:
      return assertNever(body);
  }
}

function fromSourceApiExecutionBodyMessage(
  body: sourceApiPb.SourceApiActionExecutionResult["body"]
): StoredSourceApiExecutionResult["body"] {
  switch (body.case) {
    case "none":
      return {
        kind: "none",
      };
    case "json":
      return {
        kind: "json",
        value: toJson(ValueSchema, body.value),
      };
    case "text":
      return {
        kind: "text",
        value: body.value,
      };
    case "binary":
      return {
        kind: "binary",
        value: new Uint8Array(body.value),
      };
    case undefined:
      throw new Error("source api execution result body missing oneof case");
    default:
      return assertNever(body);
  }
}
