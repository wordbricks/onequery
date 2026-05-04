import type { WorkflowStateBase } from "../kernel";
import type {
  SourceApiActionInvokeMode,
  SourceApiActionPageProgress,
  SourceApiActionRequestDescriptor,
  SourceApiActionRequestKind,
  SourceApiActionSourceDescriptor,
} from "./descriptors";

export const SOURCE_API_ACTION_PHASES = [
  "load_source",
  "describe_source",
  "prepare_request",
  "execute_request",
  "await_resume",
  "completed",
] as const;
export type SourceApiActionPhase = (typeof SOURCE_API_ACTION_PHASES)[number];

export const SOURCE_API_ACTION_FAILURE_CODES = [
  "source_not_found",
  "descriptor_unavailable",
  "invalid_request",
  "permission_denied",
  "request_timed_out",
  "execution_failed",
  "execution_state_invalid",
] as const;
export type SourceApiActionFailureCode =
  (typeof SOURCE_API_ACTION_FAILURE_CODES)[number];

export type SourceApiActionState = WorkflowStateBase<
  SourceApiActionPhase,
  SourceApiActionFailureCode
> & {
  attemptNumber: number | null;
  invokeMode: SourceApiActionInvokeMode | null;
  pageProgress: SourceApiActionPageProgress | null;
  preparedRequestFingerprint: string | null;
  requestDescriptor: SourceApiActionRequestDescriptor | null;
  requestKind: SourceApiActionRequestKind;
  sourceDescriptor: SourceApiActionSourceDescriptor | null;
};
