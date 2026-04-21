import type { CliValidateQueryEffectResult } from "../../../domain/effects";
import type {
  CliQueryExecutionFailureResult,
  CliQueryWorkflowPreparationFailureResult,
} from "./workflow-result";
import type { QueryExecutionEffectResult } from "./workflow-types";

export function toCliQueryPreparationFailureResult(input: {
  requestId: string;
  result: Exclude<CliValidateQueryEffectResult, { kind: "query_ready" }>;
}): CliQueryWorkflowPreparationFailureResult {
  switch (input.result.kind) {
    case "query_rejected":
      return {
        detail: input.result.detail,
        kind: "query_rejected",
        requestId: input.requestId,
      };
    case "query_preparation_failed":
      return {
        detail: input.result.detail,
        hint: input.result.hint,
        kind: "query_preparation_failed",
        requestId: input.requestId,
      };
  }
}

export function toCliQueryExecutionFailureResult(input: {
  requestId: string;
  result: Exclude<QueryExecutionEffectResult, { kind: "succeeded" }>;
}): CliQueryExecutionFailureResult {
  switch (input.result.kind) {
    case "query_unavailable":
      return {
        detail: input.result.detail,
        kind: "query_unavailable",
        requestId: input.requestId,
        retryable: true,
      };
    case "query_timed_out":
      return {
        detail: input.result.detail,
        kind: "query_timed_out",
        requestId: input.requestId,
        retryable: true,
      };
    case "query_execution_failed":
      return {
        detail: input.result.detail,
        kind: "query_execution_failed",
        requestId: input.requestId,
        retryable: false,
      };
  }
}
