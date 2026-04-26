import { z } from "zod";

import type { WorkflowCommittedEvent } from "../kernel";
import {
  SOURCE_API_ACTION_INVOKE_MODES,
  SOURCE_API_ACTION_REQUEST_KINDS,
  SourceApiActionRequestDescriptorSchema,
  SourceApiActionSourceDescriptorSchema,
} from "./descriptors";
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

export const SourceApiActionEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      invokeMode: z.enum(SOURCE_API_ACTION_INVOKE_MODES).nullable(),
      requestDescriptor: SourceApiActionRequestDescriptorSchema.nullable(),
      requestKind: z.enum(SOURCE_API_ACTION_REQUEST_KINDS),
      type: z.literal("action_received"),
    })
    .strict(),
  z
    .object({
      source: SourceApiActionSourceDescriptorSchema,
      type: z.literal("source_loaded"),
    })
    .strict(),
  z
    .object({
      sourceKey: z.string(),
      type: z.literal("source_not_found"),
    })
    .strict(),
  z
    .object({
      requestDescriptor: SourceApiActionRequestDescriptorSchema.nullable(),
      type: z.literal("descriptor_resolved"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      failureCode: z.enum(["descriptor_unavailable", "permission_denied"]),
      type: z.literal("descriptor_resolution_failed"),
    })
    .strict(),
  z
    .object({
      preparedRequestFingerprint: z.string(),
      type: z.literal("request_prepared"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      failureCode: z.enum([
        "invalid_request",
        "permission_denied",
        "execution_state_invalid",
      ]),
      type: z.literal("request_preparation_failed"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      type: z.literal("resume_requested"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      contentType: z.string().nullable(),
      hasContinuation: z.boolean(),
      httpStatus: z.number().int(),
      pageIndex: z.number().int(),
      responseBytes: z.number().int().nullable(),
      type: z.literal("page_fetch_succeeded"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      detail: z.string(),
      failureCode: z.enum([
        "invalid_request",
        "request_timed_out",
        "execution_failed",
        "execution_state_invalid",
      ]),
      kind: z.literal("terminal_failure"),
      pageIndex: z.number().int(),
      type: z.literal("page_fetch_failed"),
    })
    .strict(),
]);

export type SourceApiActionCommittedEvent =
  WorkflowCommittedEvent<SourceApiActionEvent>;
