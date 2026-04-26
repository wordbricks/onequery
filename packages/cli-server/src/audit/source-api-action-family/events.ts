import type { WorkflowCommittedEvent } from "../kernel";
import type {
  SourceApiActionInvokeMode,
  SourceApiActionRequestDescriptor,
  SourceApiActionRequestKind,
  SourceApiActionSourceDescriptor,
} from "./descriptors";
import type { SourceApiActionFailureCode } from "./state";

export type SourceApiActionEvent =
  | {
      invokeMode: SourceApiActionInvokeMode | null;
      requestDescriptor: SourceApiActionRequestDescriptor | null;
      requestKind: SourceApiActionRequestKind;
      type: "action_received";
    }
  | {
      source: SourceApiActionSourceDescriptor;
      type: "source_loaded";
    }
  | {
      sourceKey: string;
      type: "source_not_found";
    }
  | {
      requestDescriptor: SourceApiActionRequestDescriptor | null;
      type: "descriptor_resolved";
    }
  | {
      detail: string;
      failureCode: Extract<
        SourceApiActionFailureCode,
        "descriptor_unavailable" | "permission_denied"
      >;
      type: "descriptor_resolution_failed";
    }
  | {
      preparedRequestFingerprint: string;
      type: "request_prepared";
    }
  | {
      detail: string;
      failureCode: Extract<
        SourceApiActionFailureCode,
        "invalid_request" | "permission_denied" | "execution_state_invalid"
      >;
      type: "request_preparation_failed";
    }
  | {
      attemptNumber: number;
      type: "resume_requested";
    }
  | {
      attemptNumber: number;
      contentType: string | null;
      hasContinuation: boolean;
      httpStatus: number;
      pageIndex: number;
      responseBytes: number | null;
      type: "page_fetch_succeeded";
    }
  | {
      attemptNumber: number;
      detail: string;
      failureCode: Extract<
        SourceApiActionFailureCode,
        | "invalid_request"
        | "request_timed_out"
        | "execution_failed"
        | "execution_state_invalid"
      >;
      kind: "terminal_failure";
      pageIndex: number;
      type: "page_fetch_failed";
    };

export type SourceApiActionCommittedEvent =
  WorkflowCommittedEvent<SourceApiActionEvent>;
