import type { ProviderType } from "@onequery/db/server";
import type {
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
} from "@onequery/server/source-api";

import {
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
  "request_failed",
  "request_timed_out",
  "execution_failed",
  "execution_state_invalid",
] as const;
export type SourceApiActionFailureCode =
  (typeof SOURCE_API_ACTION_FAILURE_CODES)[number];

export type SourceApiActionSourceDescriptor = {
  displayName: string | null;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
};

export type SourceApiActionRequestDescriptor = {
  descriptorVersion: string | null;
  kind: SourceApiOperationKind | null;
  method: string | null;
  operation: string;
  paginationPolicy: SourceApiPaginationPolicy | null;
  selector: string | null;
};

export type SourceApiActionPageProgress = {
  nextPageIndex: number;
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
        "invalid_request" | "permission_denied"
      >;
      kind: "failed";
      type: "record_request_preparation";
    }
  | {
      attemptNumber: number;
      contentType: string | null;
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
      kind: "retryable_failure";
      pageIndex: number;
      type: "record_page_fetch";
    }
  | {
      attemptNumber: number;
      detail: string;
      failureCode: Extract<
        SourceApiActionFailureCode,
        | "request_failed"
        | "request_timed_out"
        | "execution_failed"
        | "execution_state_invalid"
      >;
      kind: "terminal_failure";
      pageIndex: number;
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
        "invalid_request" | "permission_denied"
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
        | "request_failed"
        | "request_timed_out"
        | "execution_failed"
        | "execution_state_invalid"
      > | null;
      kind: "retryable_failure" | "terminal_failure";
      pageIndex: number;
      type: "page_fetch_failed";
    };

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
        case "retryable_failure":
          return acceptWorkflowDecision({
            events: [
              {
                attemptNumber: command.commandPayload.attemptNumber,
                detail: command.commandPayload.detail,
                failureCode: null,
                kind: "retryable_failure",
                pageIndex: command.commandPayload.pageIndex,
                type: "page_fetch_failed",
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
    case "page_fetch_failed": {
      if (event.kind === "retryable_failure") {
        return {
          ...requireSourceApiActionState(state),
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          pageProgress: { nextPageIndex: event.pageIndex },
          phase: "await_resume",
        };
      }

      return completeFailedSourceApiAction(
        state,
        event,
        requireSourceApiTerminalFailureCode(event.failureCode)
      );
    }
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

function requireSourceApiTerminalFailureCode(
  failureCode: SourceApiActionEvent extends infer Event
    ? Event extends { type: "page_fetch_failed"; failureCode: infer Code }
      ? Code
      : never
    : never
): Extract<
  SourceApiActionFailureCode,
  | "request_failed"
  | "request_timed_out"
  | "execution_failed"
  | "execution_state_invalid"
> {
  if (failureCode === null) {
    throw new Error("terminal page fetch failure code is required");
  }

  return failureCode;
}
