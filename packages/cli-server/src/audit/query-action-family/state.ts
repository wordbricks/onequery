import type { WorkflowStateBase } from "../kernel";
import type {
  QueryActionMode,
  QueryActionSourceDescriptor,
} from "./descriptors";

export const QUERY_ACTION_PHASES = [
  "load_source",
  "validate_query",
  "load_credentials",
  "execute_query",
  "persist_usage",
  "completed",
] as const;
export type QueryActionPhase = (typeof QUERY_ACTION_PHASES)[number];

export const QUERY_ACTION_FAILURE_CODES = [
  "source_not_found",
  "source_query_interface_missing",
  "query_rejected",
  "query_preparation_failed",
  "query_unavailable",
  "query_timed_out",
  "query_execution_failed",
] as const;
export type QueryActionFailureCode =
  (typeof QUERY_ACTION_FAILURE_CODES)[number];

export const QUERY_ACTION_USAGE_RECORDING_STATUSES = [
  "not_started",
  "succeeded",
  "failed",
] as const;
export type QueryActionUsageRecordingStatus =
  (typeof QUERY_ACTION_USAGE_RECORDING_STATUSES)[number];

export type QueryActionState = WorkflowStateBase<
  QueryActionPhase,
  QueryActionFailureCode
> & {
  queryMode: QueryActionMode;
  sourceDescriptor: QueryActionSourceDescriptor | null;
  queryText: string;
  validatedQuery: string | null;
  usageRecordingStatus: QueryActionUsageRecordingStatus;
};
