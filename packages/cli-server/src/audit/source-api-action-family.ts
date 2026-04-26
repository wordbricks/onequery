import type { JsonValue } from "@bufbuild/protobuf";
import { PROVIDER_TYPES } from "@onequery/db/server";
import type { ProviderType } from "@onequery/db/server";
import type {
  SourceApiDescriptor,
  SourceApiHeader,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  SourceApiSource,
} from "@onequery/server/source-api";
import { z } from "zod";

import { CLI_PROBLEM_KEYS } from "../domain/problems";
import type { CliProblemKey } from "../domain/problems";
import {
  WORKFLOW_OUTCOMES,
  acceptWorkflowDecision,
  hasMatchingCausation,
  rejectCausationMismatch,
  rejectInvalidPhase,
  rejectUnknownAction,
} from "./kernel";
import type {
  SharedWorkflowRejectCode,
  WorkflowCommandEnvelope,
  WorkflowCommittedEvent,
  WorkflowDecision,
  WorkflowStateBase,
} from "./kernel";

export const SOURCE_API_ACTION_REQUEST_KINDS = ["describe", "invoke"] as const;
export type SourceApiActionRequestKind =
  (typeof SOURCE_API_ACTION_REQUEST_KINDS)[number];

export const SOURCE_API_ACTION_INVOKE_MODES = [
  "preview_only",
  "execute",
] as const;
export type SourceApiActionInvokeMode =
  (typeof SOURCE_API_ACTION_INVOKE_MODES)[number];

export const SOURCE_API_OPERATION_KINDS = [
  "http_request",
  "structured_request",
] as const satisfies readonly SourceApiOperationKind[];

export const SOURCE_API_PAGINATION_POLICIES = [
  "none",
  "continuation_token",
] as const satisfies readonly SourceApiPaginationPolicy[];

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

const CliProblemKeySchema = z.enum(
  CLI_PROBLEM_KEYS as [CliProblemKey, ...CliProblemKey[]]
);

export type SourceApiActionSourceDescriptor = {
  displayName: string | null;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
};

export const SourceApiActionSourceDescriptorSchema = z
  .object({
    displayName: z.string().nullable(),
    provider: z.enum(PROVIDER_TYPES),
    sourceId: z.string(),
    sourceKey: z.string(),
  })
  .strict();

export type SourceApiActionRequestDescriptor = {
  descriptorVersion: string | null;
  kind: SourceApiOperationKind | null;
  method: string | null;
  operation: string;
  paginationPolicy: SourceApiPaginationPolicy | null;
  selector: string | null;
};

export const SourceApiActionRequestDescriptorSchema = z
  .object({
    descriptorVersion: z.string().nullable(),
    kind: z.enum(SOURCE_API_OPERATION_KINDS).nullable(),
    method: z.string().nullable(),
    operation: z.string(),
    paginationPolicy: z.enum(SOURCE_API_PAGINATION_POLICIES).nullable(),
    selector: z.string().nullable(),
  })
  .strict();

export type SourceApiActionPageProgress = {
  nextPageIndex: number;
};

export const SourceApiActionPageProgressSchema = z
  .object({
    nextPageIndex: z.number().int(),
  })
  .strict();

export type StoredSourceApiResponseBody =
  | {
      kind: "none";
    }
  | {
      kind: "json";
      value: JsonValue;
    }
  | {
      kind: "text";
      value: string;
    }
  | {
      base64: string;
      kind: "binary";
    };

export type StoredSourceApiExecutionResult = {
  body: StoredSourceApiResponseBody;
  contentType: string;
  headers: readonly SourceApiHeader[];
  nextContinuationState?: JsonValue;
  operation: string;
  selector?: string;
  source: SourceApiSource;
  status: number;
};

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
      problemKey: CliProblemKey;
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
      problemKey: CliProblemKey;
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
      problemKey: CliProblemKey;
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
      problemKey: CliProblemKeySchema,
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
      problemKey: CliProblemKeySchema,
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
      problemKey: CliProblemKeySchema,
      type: z.literal("page_fetch_failed"),
    })
    .strict(),
]);

export type SourceApiActionCommittedEvent =
  WorkflowCommittedEvent<SourceApiActionEvent>;

export type SourceApiActionEffect =
  | {
      organizationId: string;
      sourceKey: string;
      type: "load_source";
    }
  | {
      source: SourceApiActionSourceDescriptor;
      type: "resolve_descriptor";
    }
  | {
      requestDescriptor: SourceApiActionRequestDescriptor;
      source: SourceApiActionSourceDescriptor;
      type: "prepare_request";
    }
  | {
      attemptNumber: number;
      pageIndex: number;
      preparedRequestFingerprint: string;
      requestDescriptor: SourceApiActionRequestDescriptor;
      source: SourceApiActionSourceDescriptor;
      type: "execute_page";
    };

export const SourceApiActionEffectSchema = z.discriminatedUnion("type", [
  z
    .object({
      organizationId: z.string(),
      sourceKey: z.string(),
      type: z.literal("load_source"),
    })
    .strict(),
  z
    .object({
      source: SourceApiActionSourceDescriptorSchema,
      type: z.literal("resolve_descriptor"),
    })
    .strict(),
  z
    .object({
      requestDescriptor: SourceApiActionRequestDescriptorSchema,
      source: SourceApiActionSourceDescriptorSchema,
      type: z.literal("prepare_request"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      pageIndex: z.number().int(),
      preparedRequestFingerprint: z.string(),
      requestDescriptor: SourceApiActionRequestDescriptorSchema,
      source: SourceApiActionSourceDescriptorSchema,
      type: z.literal("execute_page"),
    })
    .strict(),
]);

export type SourceApiActionRejectCode = SharedWorkflowRejectCode;

export function decideSourceApiAction(
  state: SourceApiActionState | null,
  command: SourceApiActionCommand
): WorkflowDecision<
  SourceApiActionEvent,
  SourceApiActionEffect,
  SourceApiActionRejectCode
> {
  switch (command.commandPayload.type) {
    case "start_describe": {
      if (state !== null) {
        return rejectInvalidPhase();
      }

      return acceptWorkflowDecision({
        effects: [
          {
            organizationId: command.organizationId,
            sourceKey: command.commandPayload.sourceKey,
            type: "load_source",
          },
        ],
        events: [
          {
            invokeMode: null,
            requestDescriptor: null,
            requestKind: "describe",
            type: "action_received",
          },
        ],
      });
    }
    case "start_invoke": {
      if (state !== null) {
        return rejectInvalidPhase();
      }

      return acceptWorkflowDecision({
        effects: [
          {
            organizationId: command.organizationId,
            sourceKey: command.commandPayload.sourceKey,
            type: "load_source",
          },
        ],
        events: [
          {
            invokeMode: command.commandPayload.invokeMode,
            requestDescriptor: command.commandPayload.requestDescriptor,
            requestKind: "invoke",
            type: "action_received",
          },
        ],
      });
    }
    case "resume_invoke": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "await_resume") {
        return rejectInvalidPhase();
      }

      if (command.commandPayload.resumeFromEventId !== state.lastEventId) {
        return rejectCausationMismatch();
      }

      if (
        state.preparedRequestFingerprint === null ||
        state.pageProgress === null ||
        state.requestDescriptor === null ||
        state.sourceDescriptor === null ||
        state.attemptNumber === null
      ) {
        return rejectInvalidPhase();
      }

      if (
        command.commandPayload.preparedRequestFingerprint !==
        state.preparedRequestFingerprint
      ) {
        return rejectCausationMismatch();
      }

      return acceptWorkflowDecision({
        effects: [
          {
            attemptNumber: state.attemptNumber + 1,
            pageIndex: state.pageProgress.nextPageIndex,
            preparedRequestFingerprint: state.preparedRequestFingerprint,
            requestDescriptor: state.requestDescriptor,
            source: state.sourceDescriptor,
            type: "execute_page",
          },
        ],
        events: [
          {
            attemptNumber: state.attemptNumber + 1,
            type: "resume_requested",
          },
        ],
      });
    }
    case "record_source_lookup": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "load_source") {
        return rejectInvalidPhase();
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return rejectCausationMismatch();
      }

      switch (command.commandPayload.kind) {
        case "found":
          return acceptWorkflowDecision({
            effects: [
              {
                source: command.commandPayload.source,
                type: "resolve_descriptor",
              },
            ],
            events: [
              {
                source: command.commandPayload.source,
                type: "source_loaded",
              },
            ],
          });
        case "not_found":
          return acceptWorkflowDecision({
            events: [
              {
                sourceKey: command.commandPayload.sourceKey,
                type: "source_not_found",
              },
            ],
          });
      }
      break;
    }
    case "record_descriptor_resolution": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "describe_source") {
        return rejectInvalidPhase();
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return rejectCausationMismatch();
      }

      switch (command.commandPayload.kind) {
        case "resolved": {
          const requestDescriptor =
            command.commandPayload.requestDescriptor ?? state.requestDescriptor;
          return acceptWorkflowDecision({
            ...(state.requestKind === "invoke" && requestDescriptor !== null
              ? {
                  effects: [
                    {
                      requestDescriptor,
                      source: requireSourceApiActionSourceDescriptor(state),
                      type: "prepare_request" as const,
                    },
                  ],
                }
              : {}),
            events: [
              {
                requestDescriptor: command.commandPayload.requestDescriptor,
                type: "descriptor_resolved",
              },
            ],
          });
        }
        case "failed":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                failureCode: command.commandPayload.failureCode,
                problemKey: command.commandPayload.problemKey,
                type: "descriptor_resolution_failed",
              },
            ],
          });
      }
      break;
    }
    case "record_request_preparation": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "prepare_request") {
        return rejectInvalidPhase();
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return rejectCausationMismatch();
      }

      switch (command.commandPayload.kind) {
        case "prepared": {
          const preparedRequestFingerprint =
            command.commandPayload.preparedRequestFingerprint;
          return acceptWorkflowDecision({
            ...(state.invokeMode === "execute"
              ? {
                  effects: [
                    {
                      attemptNumber: 1,
                      pageIndex: 0,
                      preparedRequestFingerprint,
                      requestDescriptor:
                        requireSourceApiActionRequestDescriptor(state),
                      source: requireSourceApiActionSourceDescriptor(state),
                      type: "execute_page" as const,
                    },
                  ],
                }
              : {}),
            events: [
              {
                preparedRequestFingerprint,
                type: "request_prepared",
              },
            ],
          });
        }
        case "failed":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                failureCode: command.commandPayload.failureCode,
                problemKey: command.commandPayload.problemKey,
                type: "request_preparation_failed",
              },
            ],
          });
      }
      break;
    }
    case "record_page_fetch": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "execute_request") {
        return rejectInvalidPhase();
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return rejectCausationMismatch();
      }

      switch (command.commandPayload.kind) {
        case "succeeded":
          return acceptWorkflowDecision({
            events: [
              {
                attemptNumber: command.commandPayload.attemptNumber,
                contentType: command.commandPayload.contentType,
                hasContinuation: command.commandPayload.hasContinuation,
                httpStatus: command.commandPayload.httpStatus,
                pageIndex: command.commandPayload.pageIndex,
                responseBytes: command.commandPayload.responseBytes,
                type: "page_fetch_succeeded",
              },
            ],
          });
        case "terminal_failure":
          return acceptWorkflowDecision({
            events: [
              {
                attemptNumber: command.commandPayload.attemptNumber,
                detail: command.commandPayload.detail,
                failureCode: command.commandPayload.failureCode,
                kind: "terminal_failure",
                pageIndex: command.commandPayload.pageIndex,
                problemKey: command.commandPayload.problemKey,
                type: "page_fetch_failed",
              },
            ],
          });
      }
      break;
    }
  }

  return rejectInvalidPhase();
}

export function reduceSourceApiAction(
  state: SourceApiActionState | null,
  event: SourceApiActionCommittedEvent
): SourceApiActionState {
  switch (event.type) {
    case "action_received":
      return {
        attemptNumber: null,
        completedAt: null,
        failureCode: null,
        invokeMode: event.invokeMode,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        outcome: "pending",
        pageProgress: null,
        phase: "load_source",
        preparedRequestFingerprint: null,
        requestDescriptor: event.requestDescriptor,
        requestKind: event.requestKind,
        sourceDescriptor: null,
        startedAt: event.occurredAt,
      };
    case "source_loaded":
      return {
        ...requireSourceApiActionState(state),
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        phase: "describe_source",
        sourceDescriptor: event.source,
      };
    case "source_not_found":
      return completeFailedSourceApiAction(state, event, "source_not_found");
    case "descriptor_resolved": {
      const current = requireSourceApiActionState(state);
      return {
        ...current,
        completedAt:
          current.requestKind === "describe"
            ? event.occurredAt
            : current.completedAt,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        outcome: current.requestKind === "describe" ? "succeeded" : "pending",
        phase:
          current.requestKind === "describe" ? "completed" : "prepare_request",
        requestDescriptor: event.requestDescriptor ?? current.requestDescriptor,
      };
    }
    case "descriptor_resolution_failed":
      return completeFailedSourceApiAction(state, event, event.failureCode);
    case "request_prepared": {
      const current = requireSourceApiActionState(state);
      return {
        ...current,
        attemptNumber: current.invokeMode === "execute" ? 1 : null,
        completedAt:
          current.invokeMode === "preview_only"
            ? event.occurredAt
            : current.completedAt,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        outcome:
          current.invokeMode === "preview_only" ? "succeeded" : "pending",
        phase:
          current.invokeMode === "preview_only"
            ? "completed"
            : "execute_request",
        preparedRequestFingerprint: event.preparedRequestFingerprint,
      };
    }
    case "request_preparation_failed":
      return completeFailedSourceApiAction(state, event, event.failureCode);
    case "resume_requested":
      return {
        ...requireSourceApiActionState(state),
        attemptNumber: event.attemptNumber,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        pageProgress: null,
        phase: "execute_request",
      };
    case "page_fetch_succeeded": {
      const current = requireSourceApiActionState(state);
      return {
        ...current,
        completedAt: event.hasContinuation
          ? current.completedAt
          : event.occurredAt,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        outcome: event.hasContinuation ? "pending" : "succeeded",
        pageProgress: event.hasContinuation
          ? { nextPageIndex: event.pageIndex + 1 }
          : null,
        phase: event.hasContinuation ? "await_resume" : "completed",
      };
    }
    case "page_fetch_failed":
      return completeFailedSourceApiAction(state, event, event.failureCode);
  }
}

function completeFailedSourceApiAction(
  state: SourceApiActionState | null,
  event: Pick<SourceApiActionCommittedEvent, "id" | "occurredAt" | "sequence">,
  failureCode: SourceApiActionFailureCode
): SourceApiActionState {
  return {
    ...requireSourceApiActionState(state),
    completedAt: event.occurredAt,
    failureCode,
    lastEventId: event.id,
    lastEventSequence: event.sequence,
    outcome: "failed",
    pageProgress: null,
    phase: "completed",
  };
}

function requireSourceApiActionState(
  state: SourceApiActionState | null
): SourceApiActionState {
  if (state === null) {
    throw new Error("source api action state is required");
  }

  return state;
}

function requireSourceApiActionSourceDescriptor(
  state: Pick<SourceApiActionState, "sourceDescriptor">
): SourceApiActionSourceDescriptor {
  if (state.sourceDescriptor === null) {
    throw new Error("source api action source descriptor is required");
  }

  return state.sourceDescriptor;
}

function requireSourceApiActionRequestDescriptor(
  state: Pick<SourceApiActionState, "requestDescriptor">
): SourceApiActionRequestDescriptor {
  if (state.requestDescriptor === null) {
    throw new Error("source api action request descriptor is required");
  }

  return state.requestDescriptor;
}
