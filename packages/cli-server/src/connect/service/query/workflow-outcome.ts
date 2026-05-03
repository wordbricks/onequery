import type { CliValidateQueryEffectResult } from "../../../domain/effects";
import type {
  CliQueryExecutionFailureResult,
  CliQueryWorkflowPreparationFailureResult,
} from "./workflow-result";
import type {
  QueryExecutionEffectResult,
  QueryPreparationEffectResult,
} from "./workflow-types";

export function toCliQueryPreparationFailureResult(input: {
  requestId: string;
  result: Exclude<
    CliValidateQueryEffectResult | QueryPreparationEffectResult,
    { kind: "query_ready" } | { kind: "source_query_interface_loaded" }
  >;
}): CliQueryWorkflowPreparationFailureResult {
  switch (input.result.kind) {
    case "source_not_found":
      return {
        kind: "source_not_found",
        orgSlug: input.result.orgSlug,
        requestId: input.result.requestId,
        sourceName: input.result.sourceName,
      };
    case "source_query_interface_missing":
      return {
        kind: "source_query_interface_missing",
        provider: input.result.provider,
        requestId: input.result.requestId,
        sourceName: input.result.sourceName,
        status: input.result.status,
      };
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
      };
    case "query_timed_out":
      return {
        detail: input.result.detail,
        kind: "query_timed_out",
        requestId: input.requestId,
      };
    case "query_execution_failed":
      return {
        detail: input.result.detail,
        kind: "query_execution_failed",
        requestId: input.requestId,
      };
  }
}
