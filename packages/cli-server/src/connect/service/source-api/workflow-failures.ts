import type { SourceApiActionFailureCode } from "../../../audit";
import type { CliProblemKey } from "../../../domain/problems";

type SourceApiDescriptorResolutionFailureCode = Extract<
  SourceApiActionFailureCode,
  "descriptor_unavailable" | "permission_denied"
>;

type SourceApiRequestPreparationFailureCode = Extract<
  SourceApiActionFailureCode,
  "invalid_request" | "permission_denied" | "execution_state_invalid"
>;

type SourceApiPageFetchFailureCode = Extract<
  SourceApiActionFailureCode,
  | "invalid_request"
  | "request_timed_out"
  | "execution_failed"
  | "execution_state_invalid"
>;

export function toCliDescriptorResolutionProblemKey(
  failureCode: SourceApiDescriptorResolutionFailureCode
): CliProblemKey {
  switch (failureCode) {
    case "descriptor_unavailable":
      return "SOURCE_API_DESCRIBE_FAILED";
    case "permission_denied":
      return "SOURCE_API_FORBIDDEN";
    default:
      return assertNever(failureCode);
  }
}

export function toCliRequestPreparationProblemKey(
  failureCode: SourceApiRequestPreparationFailureCode
): CliProblemKey {
  switch (failureCode) {
    case "invalid_request":
      return "SOURCE_API_REQUEST_INVALID";
    case "permission_denied":
      return "SOURCE_API_FORBIDDEN";
    case "execution_state_invalid":
      return "SOURCE_API_EXECUTION_STATE_INVALID";
    default:
      return assertNever(failureCode);
  }
}

export function toCliPageFetchProblemKey(
  failureCode: SourceApiPageFetchFailureCode
): CliProblemKey {
  switch (failureCode) {
    case "invalid_request":
      return "SOURCE_API_REQUEST_INVALID";
    case "request_timed_out":
      return "SOURCE_API_EXECUTION_TIMED_OUT";
    case "execution_failed":
      return "SOURCE_API_EXECUTION_FAILED";
    case "execution_state_invalid":
      return "SOURCE_API_EXECUTION_STATE_INVALID";
    default:
      return assertNever(failureCode);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled source API workflow failure code: ${value}`);
}
