import type { SourceApiDescriptor } from "@onequery/server/source-api";

import type { CliProblemKey } from "../../domain/problems";
import type { WorkflowCommandEnvelope } from "../kernel";
import type {
  SourceApiActionInvokeMode,
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
  StoredSourceApiExecutionResult,
} from "./descriptors";
import type { SourceApiActionFailureCode } from "./state";

export type SourceApiActionCommandPayload =
  | {
      sourceKey: string;
      type: "start_describe";
    }
  | {
      invokeMode: SourceApiActionInvokeMode;
      requestDescriptor: SourceApiActionRequestDescriptor;
      sourceKey: string;
      type: "start_invoke";
    }
  | {
      preparedRequestFingerprint: string;
      resumeFromEventId: string;
      type: "resume_invoke";
    }
  | {
      kind: "found";
      source: SourceApiActionSourceDescriptor;
      type: "record_source_lookup";
    }
  | {
      kind: "not_found";
      sourceKey: string;
      type: "record_source_lookup";
    }
  | {
      descriptor: SourceApiDescriptor;
      kind: "resolved";
      requestDescriptor: SourceApiActionRequestDescriptor | null;
      type: "record_descriptor_resolution";
    }
  | {
      detail: string;
      failureCode: Extract<
        SourceApiActionFailureCode,
        "descriptor_unavailable" | "permission_denied"
      >;
      kind: "failed";
      problemKey: CliProblemKey;
      type: "record_descriptor_resolution";
    }
  | {
      kind: "prepared";
      preparedRequestFingerprint: string;
      type: "record_request_preparation";
    }
  | {
      detail: string;
      failureCode: Extract<
        SourceApiActionFailureCode,
        "invalid_request" | "permission_denied" | "execution_state_invalid"
      >;
      kind: "failed";
      problemKey: CliProblemKey;
      type: "record_request_preparation";
    }
  | {
      attemptNumber: number;
      contentType: string | null;
      executionResult: StoredSourceApiExecutionResult;
      hasContinuation: boolean;
      httpStatus: number;
      kind: "succeeded";
      pageIndex: number;
      responseBytes: number | null;
      type: "record_page_fetch";
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
      problemKey: CliProblemKey;
      type: "record_page_fetch";
    };

export type SourceApiActionCommand = WorkflowCommandEnvelope<
  "source_api_action",
  SourceApiActionCommandPayload
>;
