import { isSourceProviderId } from "@onequery/db/server";
import type { ProviderType } from "@onequery/db/server";
import * as sourceApiPb from "@onequery/proto-workflow/workflow/v1/source_api_action_pb";
import type {
  SourceApiFieldPolicy,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  SourceApiSelectorKind,
} from "@onequery/server/source-api";

import { assertNever } from "../../storage/protobuf-codec";
import type {
  SourceApiActionInvokeMode,
  SourceApiActionRequestKind,
} from "../descriptors";
import type { SourceApiActionFailureCode } from "../state";

export function toWorkflowSourceProvider(provider: ProviderType) {
  return provider;
}

export function fromWorkflowSourceProvider(provider: string): ProviderType {
  if (isSourceProviderId(provider)) {
    return provider;
  }
  throw new Error(`unsupported workflow source provider: ${provider}`);
}

export function toSourceApiRequestKind(kind: SourceApiActionRequestKind) {
  switch (kind) {
    case "describe":
      return sourceApiPb.SourceApiActionRequestKind.DESCRIBE;
    case "invoke":
      return sourceApiPb.SourceApiActionRequestKind.INVOKE;
    default:
      return assertNever(kind);
  }
}

export function fromSourceApiRequestKind(
  kind: sourceApiPb.SourceApiActionRequestKind
): SourceApiActionRequestKind {
  switch (kind) {
    case sourceApiPb.SourceApiActionRequestKind.DESCRIBE:
      return "describe";
    case sourceApiPb.SourceApiActionRequestKind.INVOKE:
      return "invoke";
    case sourceApiPb.SourceApiActionRequestKind.UNSPECIFIED:
      throw new Error("source api request kind is unspecified");
    default:
      throw new Error(`unsupported source api request kind: ${kind}`);
  }
}

export function toSourceApiInvokeMode(mode: SourceApiActionInvokeMode) {
  switch (mode) {
    case "preview_only":
      return sourceApiPb.SourceApiActionInvokeMode.PREVIEW_ONLY;
    case "execute":
      return sourceApiPb.SourceApiActionInvokeMode.EXECUTE;
    default:
      return assertNever(mode);
  }
}

export function fromSourceApiInvokeMode(
  mode: sourceApiPb.SourceApiActionInvokeMode
): SourceApiActionInvokeMode {
  switch (mode) {
    case sourceApiPb.SourceApiActionInvokeMode.PREVIEW_ONLY:
      return "preview_only";
    case sourceApiPb.SourceApiActionInvokeMode.EXECUTE:
      return "execute";
    case sourceApiPb.SourceApiActionInvokeMode.UNSPECIFIED:
      throw new Error("source api invoke mode is unspecified");
    default:
      throw new Error(`unsupported source api invoke mode: ${mode}`);
  }
}

export function toSourceApiOperationKind(kind: SourceApiOperationKind) {
  switch (kind) {
    case "http_request":
      return sourceApiPb.SourceApiActionOperationKind.HTTP_REQUEST;
    case "structured_request":
      return sourceApiPb.SourceApiActionOperationKind.STRUCTURED_REQUEST;
    default:
      return assertNever(kind);
  }
}

export function fromSourceApiOperationKind(
  kind: sourceApiPb.SourceApiActionOperationKind
): SourceApiOperationKind {
  switch (kind) {
    case sourceApiPb.SourceApiActionOperationKind.HTTP_REQUEST:
      return "http_request";
    case sourceApiPb.SourceApiActionOperationKind.STRUCTURED_REQUEST:
      return "structured_request";
    case sourceApiPb.SourceApiActionOperationKind.UNSPECIFIED:
      throw new Error("source api operation kind is unspecified");
    default:
      throw new Error(`unsupported source api operation kind: ${kind}`);
  }
}

export function toSourceApiSelectorKind(kind: SourceApiSelectorKind) {
  switch (kind) {
    case "none":
      return sourceApiPb.SourceApiActionSelectorKind.NONE;
    case "path":
      return sourceApiPb.SourceApiActionSelectorKind.PATH;
    case "identifier":
      return sourceApiPb.SourceApiActionSelectorKind.IDENTIFIER;
    default:
      return assertNever(kind);
  }
}

export function fromSourceApiSelectorKind(
  kind: sourceApiPb.SourceApiActionSelectorKind
): SourceApiSelectorKind {
  switch (kind) {
    case sourceApiPb.SourceApiActionSelectorKind.NONE:
      return "none";
    case sourceApiPb.SourceApiActionSelectorKind.PATH:
      return "path";
    case sourceApiPb.SourceApiActionSelectorKind.IDENTIFIER:
      return "identifier";
    case sourceApiPb.SourceApiActionSelectorKind.UNSPECIFIED:
      throw new Error("source api selector kind is unspecified");
    default:
      throw new Error(`unsupported source api selector kind: ${kind}`);
  }
}

export function toSourceApiPaginationPolicy(policy: SourceApiPaginationPolicy) {
  switch (policy) {
    case "none":
      return sourceApiPb.SourceApiActionPaginationPolicy.NONE;
    case "continuation_token":
      return sourceApiPb.SourceApiActionPaginationPolicy.CONTINUATION_TOKEN;
    default:
      return assertNever(policy);
  }
}

export function fromSourceApiPaginationPolicy(
  policy: sourceApiPb.SourceApiActionPaginationPolicy
): SourceApiPaginationPolicy {
  switch (policy) {
    case sourceApiPb.SourceApiActionPaginationPolicy.NONE:
      return "none";
    case sourceApiPb.SourceApiActionPaginationPolicy.CONTINUATION_TOKEN:
      return "continuation_token";
    case sourceApiPb.SourceApiActionPaginationPolicy.UNSPECIFIED:
      throw new Error("source api pagination policy is unspecified");
    default:
      throw new Error(`unsupported source api pagination policy: ${policy}`);
  }
}

export function toSourceApiInputMode(mode: SourceApiFieldPolicy["inputMode"]) {
  switch (mode) {
    case "none":
      return sourceApiPb.SourceApiActionInputMode.NONE;
    case "request_object":
      return sourceApiPb.SourceApiActionInputMode.REQUEST_OBJECT;
    case "request_body":
      return sourceApiPb.SourceApiActionInputMode.REQUEST_BODY;
    default:
      return assertNever(mode);
  }
}

export function fromSourceApiInputMode(
  mode: sourceApiPb.SourceApiActionInputMode
): SourceApiFieldPolicy["inputMode"] {
  switch (mode) {
    case sourceApiPb.SourceApiActionInputMode.NONE:
      return "none";
    case sourceApiPb.SourceApiActionInputMode.REQUEST_OBJECT:
      return "request_object";
    case sourceApiPb.SourceApiActionInputMode.REQUEST_BODY:
      return "request_body";
    case sourceApiPb.SourceApiActionInputMode.UNSPECIFIED:
      throw new Error("source api input mode is unspecified");
    default:
      throw new Error(`unsupported source api input mode: ${mode}`);
  }
}

export function toSourceApiFailureCode(code: SourceApiActionFailureCode) {
  switch (code) {
    case "source_not_found":
      return sourceApiPb.SourceApiActionFailureCode.SOURCE_NOT_FOUND;
    case "descriptor_unavailable":
      return sourceApiPb.SourceApiActionFailureCode.DESCRIPTOR_UNAVAILABLE;
    case "invalid_request":
      return sourceApiPb.SourceApiActionFailureCode.INVALID_REQUEST;
    case "permission_denied":
      return sourceApiPb.SourceApiActionFailureCode.PERMISSION_DENIED;
    case "request_timed_out":
      return sourceApiPb.SourceApiActionFailureCode.REQUEST_TIMED_OUT;
    case "execution_failed":
      return sourceApiPb.SourceApiActionFailureCode.EXECUTION_FAILED;
    case "execution_state_invalid":
      return sourceApiPb.SourceApiActionFailureCode.EXECUTION_STATE_INVALID;
    default:
      return assertNever(code);
  }
}

export function fromDescriptorResolutionFailureCode(
  code: sourceApiPb.SourceApiActionFailureCode
): Extract<
  SourceApiActionFailureCode,
  "descriptor_unavailable" | "permission_denied"
> {
  switch (code) {
    case sourceApiPb.SourceApiActionFailureCode.DESCRIPTOR_UNAVAILABLE:
      return "descriptor_unavailable";
    case sourceApiPb.SourceApiActionFailureCode.PERMISSION_DENIED:
      return "permission_denied";
    case sourceApiPb.SourceApiActionFailureCode.UNSPECIFIED:
      throw new Error("source api failure code is unspecified");
    default:
      throw new Error(
        `unsupported descriptor resolution failure code: ${code}`
      );
  }
}

export function fromRequestPreparationFailureCode(
  code: sourceApiPb.SourceApiActionFailureCode
): Extract<
  SourceApiActionFailureCode,
  "invalid_request" | "permission_denied" | "execution_state_invalid"
> {
  switch (code) {
    case sourceApiPb.SourceApiActionFailureCode.INVALID_REQUEST:
      return "invalid_request";
    case sourceApiPb.SourceApiActionFailureCode.PERMISSION_DENIED:
      return "permission_denied";
    case sourceApiPb.SourceApiActionFailureCode.EXECUTION_STATE_INVALID:
      return "execution_state_invalid";
    case sourceApiPb.SourceApiActionFailureCode.UNSPECIFIED:
      throw new Error("source api failure code is unspecified");
    default:
      throw new Error(`unsupported request preparation failure code: ${code}`);
  }
}

export function fromPageFetchFailureCode(
  code: sourceApiPb.SourceApiActionFailureCode
): Extract<
  SourceApiActionFailureCode,
  | "invalid_request"
  | "request_timed_out"
  | "execution_failed"
  | "execution_state_invalid"
> {
  switch (code) {
    case sourceApiPb.SourceApiActionFailureCode.INVALID_REQUEST:
      return "invalid_request";
    case sourceApiPb.SourceApiActionFailureCode.REQUEST_TIMED_OUT:
      return "request_timed_out";
    case sourceApiPb.SourceApiActionFailureCode.EXECUTION_FAILED:
      return "execution_failed";
    case sourceApiPb.SourceApiActionFailureCode.EXECUTION_STATE_INVALID:
      return "execution_state_invalid";
    case sourceApiPb.SourceApiActionFailureCode.UNSPECIFIED:
      throw new Error("source api failure code is unspecified");
    default:
      throw new Error(`unsupported page fetch failure code: ${code}`);
  }
}
