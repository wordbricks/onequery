import { z } from "zod";

import { WORKFLOW_OUTCOMES } from "../kernel";
import type { WorkflowStateBase } from "../kernel";
import {
  QUERY_ACTION_MODES,
  QueryActionSourceDescriptorSchema,
} from "./descriptors";
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
  "source_not_queryable",
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

export const QueryActionStateSchema = z
  .object({
    completedAt: z.date().nullable(),
    failureCode: z.enum(QUERY_ACTION_FAILURE_CODES).nullable(),
    lastEventId: z.string(),
    lastEventSequence: z.number().int(),
    outcome: z.enum(WORKFLOW_OUTCOMES),
    phase: z.enum(QUERY_ACTION_PHASES),
    queryMode: z.enum(QUERY_ACTION_MODES),
    queryText: z.string(),
    sourceDescriptor: QueryActionSourceDescriptorSchema.nullable(),
    startedAt: z.date(),
    usageRecordingStatus: z.enum(QUERY_ACTION_USAGE_RECORDING_STATUSES),
    validatedQuery: z.string().nullable(),
  })
  .strict();
