import { z } from "zod";

import { WORKFLOW_OUTCOMES } from "../kernel";
import type { WorkflowStateBase } from "../kernel";
import {
  SOURCE_API_ACTION_INVOKE_MODES,
  SOURCE_API_ACTION_REQUEST_KINDS,
  SourceApiActionPageProgressSchema,
  SourceApiActionRequestDescriptorSchema,
  SourceApiActionSourceDescriptorSchema,
} from "./descriptors";
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

export const SourceApiActionStateSchema = z
  .object({
    attemptNumber: z.number().int().nullable(),
    completedAt: z.date().nullable(),
    failureCode: z.enum(SOURCE_API_ACTION_FAILURE_CODES).nullable(),
    invokeMode: z.enum(SOURCE_API_ACTION_INVOKE_MODES).nullable(),
    lastEventId: z.string(),
    lastEventSequence: z.number().int(),
    outcome: z.enum(WORKFLOW_OUTCOMES),
    pageProgress: SourceApiActionPageProgressSchema.nullable(),
    phase: z.enum(SOURCE_API_ACTION_PHASES),
    preparedRequestFingerprint: z.string().nullable(),
    requestDescriptor: SourceApiActionRequestDescriptorSchema.nullable(),
    requestKind: z.enum(SOURCE_API_ACTION_REQUEST_KINDS),
    sourceDescriptor: SourceApiActionSourceDescriptorSchema.nullable(),
    startedAt: z.date(),
  })
  .strict();
