import { DATA_SOURCE_STATUS, PROVIDER_TYPES } from "@onequery/db/server";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";
import { z } from "zod";

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

export const QUERY_ACTION_MODES = ["validate", "execute"] as const;
export type QueryActionMode = (typeof QUERY_ACTION_MODES)[number];

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

export type QueryActionSourceDescriptor = {
  displayName: string | null;
  name: string;
  organizationId: string;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
  sourceStatus: DataSourceStatus;
};

export const QueryActionSourceDescriptorSchema = z
  .object({
    displayName: z.string().nullable(),
    name: z.string(),
    organizationId: z.string(),
    provider: z.enum(PROVIDER_TYPES),
    sourceId: z.string(),
    sourceKey: z.string(),
    sourceStatus: z.enum(DATA_SOURCE_STATUS),
  })
  .strict();

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

export type QueryActionCommandPayload =
  | {
      type: "start_validate";
      queryText: string;
      sourceKey: string;
    }
  | {
      type: "start_execute";
      queryText: string;
      sourceKey: string;
    }
  | {
      type: "record_source_lookup";
      kind: "found";
      source: QueryActionSourceDescriptor;
    }
  | {
      type: "record_source_lookup";
      kind: "not_found";
      sourceKey: string;
    }
  | {
      type: "record_source_lookup";
      kind: "not_queryable";
      provider: ProviderType;
      sourceStatus: DataSourceStatus;
    }
  | {
      type: "record_query_validation";
      detail?: never;
      hint?: never;
      kind: "accepted";
      validatedQuery: string;
    }
  | {
      type: "record_query_validation";
      detail: string;
      hint?: string;
      kind: "rejected";
    }
  | {
      type: "record_query_validation";
      detail: string;
      hint?: string;
      kind: "preparation_failed";
    }
  | {
      type: "record_credentials_load";
      kind: "loaded";
    }
  | {
      type: "record_credentials_load";
      detail: string;
      hint?: string;
      kind: "preparation_failed";
    }
  | {
      type: "record_query_execution";
      elapsedMs: number;
      kind: "succeeded";
      rowCount: number;
    }
  | {
      type: "record_query_execution";
      detail: string;
      kind: "unavailable";
    }
  | {
      type: "record_query_execution";
      detail: string;
      kind: "timed_out";
    }
  | {
      type: "record_query_execution";
      detail: string;
      kind: "failed";
    }
  | {
      type: "record_usage_persistence";
      kind: "succeeded";
    }
  | {
      type: "record_usage_persistence";
      detail: string;
      kind: "failed";
    };

export type QueryActionCommand = WorkflowCommandEnvelope<
  "query_action",
  QueryActionCommandPayload
>;

export type QueryActionEvent =
  | {
      queryMode: QueryActionMode;
      queryText: string;
      type: "action_received";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "source_loaded";
    }
  | {
      sourceKey: string;
      type: "source_not_found";
    }
  | {
      provider: ProviderType;
      sourceStatus: DataSourceStatus;
      type: "source_not_queryable";
    }
  | {
      type: "query_validated";
      validatedQuery: string;
    }
  | {
      detail: string;
      hint?: string;
      type: "query_rejected";
    }
  | {
      type: "credentials_loaded";
    }
  | {
      detail: string;
      hint?: string;
      type: "query_preparation_failed";
    }
  | {
      elapsedMs: number;
      rowCount: number;
      type: "query_executed";
    }
  | {
      detail: string;
      type: "query_unavailable";
    }
  | {
      detail: string;
      type: "query_timed_out";
    }
  | {
      detail: string;
      type: "query_execution_failed";
    }
  | {
      type: "usage_persisted";
    }
  | {
      detail: string;
      type: "usage_persist_failed";
    };

export const QueryActionEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      queryMode: z.enum(QUERY_ACTION_MODES),
      queryText: z.string(),
      type: z.literal("action_received"),
    })
    .strict(),
  z
    .object({
      source: QueryActionSourceDescriptorSchema,
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
      provider: z.enum(PROVIDER_TYPES),
      sourceStatus: z.enum(DATA_SOURCE_STATUS),
      type: z.literal("source_not_queryable"),
    })
    .strict(),
  z
    .object({
      type: z.literal("query_validated"),
      validatedQuery: z.string(),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string().optional(),
      type: z.literal("query_rejected"),
    })
    .strict(),
  z
    .object({
      type: z.literal("credentials_loaded"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string().optional(),
      type: z.literal("query_preparation_failed"),
    })
    .strict(),
  z
    .object({
      elapsedMs: z.number(),
      rowCount: z.number(),
      type: z.literal("query_executed"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_unavailable"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_timed_out"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_execution_failed"),
    })
    .strict(),
  z
    .object({
      type: z.literal("usage_persisted"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("usage_persist_failed"),
    })
    .strict(),
]);

export type QueryActionCommittedEvent =
  WorkflowCommittedEvent<QueryActionEvent>;

export type QueryActionEffect =
  | {
      organizationId: string;
      sourceKey: string;
      type: "load_source";
    }
  | {
      queryText: string;
      source: QueryActionSourceDescriptor;
      type: "validate_query";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "load_credentials";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "execute_query";
      validatedQuery: string;
    }
  | {
      sourceId: string;
      type: "persist_usage";
    };

export type QueryActionRejectCode = SharedWorkflowRejectCode;

export function decideQueryAction(
  state: QueryActionState | null,
  command: QueryActionCommand
): WorkflowDecision<
  QueryActionEvent,
  QueryActionEffect,
  QueryActionRejectCode
> {
  switch (command.commandPayload.type) {
    case "start_validate": {
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
            queryMode: "validate",
            queryText: command.commandPayload.queryText,
            type: "action_received",
          },
        ],
      });
    }
    case "start_execute": {
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
            queryMode: "execute",
            queryText: command.commandPayload.queryText,
            type: "action_received",
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
                queryText: state.queryText,
                source: command.commandPayload.source,
                type: "validate_query",
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
        case "not_queryable":
          return acceptWorkflowDecision({
            events: [
              {
                provider: command.commandPayload.provider,
                sourceStatus: command.commandPayload.sourceStatus,
                type: "source_not_queryable",
              },
            ],
          });
      }
      break;
    }
    case "record_query_validation": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "validate_query") {
        return rejectInvalidPhase();
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return rejectCausationMismatch();
      }

      switch (command.commandPayload.kind) {
        case "accepted":
          return acceptWorkflowDecision({
            ...(state.queryMode === "execute"
              ? {
                  effects: [
                    {
                      source: requireQueryActionSourceDescriptor(state),
                      type: "load_credentials" as const,
                    },
                  ],
                }
              : {}),
            events: [
              {
                type: "query_validated",
                validatedQuery: command.commandPayload.validatedQuery,
              },
            ],
          });
        case "rejected":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                ...(command.commandPayload.hint === undefined
                  ? {}
                  : { hint: command.commandPayload.hint }),
                type: "query_rejected",
              },
            ],
          });
        case "preparation_failed":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                ...(command.commandPayload.hint === undefined
                  ? {}
                  : { hint: command.commandPayload.hint }),
                type: "query_preparation_failed",
              },
            ],
          });
      }
      break;
    }
    case "record_credentials_load": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "load_credentials") {
        return rejectInvalidPhase();
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return rejectCausationMismatch();
      }

      switch (command.commandPayload.kind) {
        case "loaded":
          return acceptWorkflowDecision({
            effects: [
              {
                source: requireQueryActionSourceDescriptor(state),
                type: "execute_query",
                validatedQuery: requireValidatedQuery(state),
              },
            ],
            events: [{ type: "credentials_loaded" }],
          });
        case "preparation_failed":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                ...(command.commandPayload.hint === undefined
                  ? {}
                  : { hint: command.commandPayload.hint }),
                type: "query_preparation_failed",
              },
            ],
          });
      }
      break;
    }
    case "record_query_execution": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "execute_query") {
        return rejectInvalidPhase();
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return rejectCausationMismatch();
      }

      switch (command.commandPayload.kind) {
        case "succeeded":
          return acceptWorkflowDecision({
            effects: [
              {
                sourceId: requireQueryActionSourceDescriptor(state).sourceId,
                type: "persist_usage",
              },
            ],
            events: [
              {
                elapsedMs: command.commandPayload.elapsedMs,
                rowCount: command.commandPayload.rowCount,
                type: "query_executed",
              },
            ],
          });
        case "unavailable":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                type: "query_unavailable",
              },
            ],
          });
        case "timed_out":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                type: "query_timed_out",
              },
            ],
          });
        case "failed":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                type: "query_execution_failed",
              },
            ],
          });
      }
      break;
    }
    case "record_usage_persistence": {
      if (state === null) {
        return rejectUnknownAction();
      }

      if (state.phase !== "persist_usage") {
        return rejectInvalidPhase();
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return rejectCausationMismatch();
      }

      switch (command.commandPayload.kind) {
        case "succeeded":
          return acceptWorkflowDecision({
            events: [{ type: "usage_persisted" }],
          });
        case "failed":
          return acceptWorkflowDecision({
            events: [
              {
                detail: command.commandPayload.detail,
                type: "usage_persist_failed",
              },
            ],
          });
      }
      break;
    }
  }

  return rejectInvalidPhase();
}

export function reduceQueryAction(
  state: QueryActionState | null,
  event: QueryActionCommittedEvent
): QueryActionState {
  switch (event.type) {
    case "action_received":
      return {
        completedAt: null,
        failureCode: null,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        outcome: "pending",
        phase: "load_source",
        queryMode: event.queryMode,
        queryText: event.queryText,
        sourceDescriptor: null,
        startedAt: event.occurredAt,
        usageRecordingStatus: "not_started",
        validatedQuery: null,
      };
    case "source_loaded":
      return {
        ...requireQueryActionState(state),
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        phase: "validate_query",
        sourceDescriptor: event.source,
      };
    case "source_not_found":
      return completeFailedQueryAction(state, event, "source_not_found");
    case "source_not_queryable":
      return completeFailedQueryAction(state, event, "source_not_queryable");
    case "query_validated": {
      const current = requireQueryActionState(state);
      return {
        ...current,
        completedAt:
          current.queryMode === "validate"
            ? event.occurredAt
            : current.completedAt,
        failureCode: null,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        outcome: current.queryMode === "validate" ? "succeeded" : "pending",
        phase:
          current.queryMode === "validate" ? "completed" : "load_credentials",
        validatedQuery: event.validatedQuery,
      };
    }
    case "query_rejected":
      return completeFailedQueryAction(state, event, "query_rejected");
    case "credentials_loaded":
      return {
        ...requireQueryActionState(state),
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        phase: "execute_query",
      };
    case "query_preparation_failed":
      return completeFailedQueryAction(
        state,
        event,
        "query_preparation_failed"
      );
    case "query_executed":
      return {
        ...requireQueryActionState(state),
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        phase: "persist_usage",
      };
    case "query_unavailable":
      return completeFailedQueryAction(state, event, "query_unavailable");
    case "query_timed_out":
      return completeFailedQueryAction(state, event, "query_timed_out");
    case "query_execution_failed":
      return completeFailedQueryAction(state, event, "query_execution_failed");
    case "usage_persisted":
      return {
        ...requireQueryActionState(state),
        completedAt: event.occurredAt,
        failureCode: null,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        outcome: "succeeded",
        phase: "completed",
        usageRecordingStatus: "succeeded",
      };
    case "usage_persist_failed":
      return {
        ...requireQueryActionState(state),
        completedAt: event.occurredAt,
        failureCode: null,
        lastEventId: event.id,
        lastEventSequence: event.sequence,
        outcome: "succeeded",
        phase: "completed",
        usageRecordingStatus: "failed",
      };
  }
}

function completeFailedQueryAction(
  state: QueryActionState | null,
  event: Pick<QueryActionCommittedEvent, "id" | "occurredAt" | "sequence">,
  failureCode: QueryActionFailureCode
): QueryActionState {
  return {
    ...requireQueryActionState(state),
    completedAt: event.occurredAt,
    failureCode,
    lastEventId: event.id,
    lastEventSequence: event.sequence,
    outcome: "failed",
    phase: "completed",
  };
}

function requireQueryActionState(
  state: QueryActionState | null
): QueryActionState {
  if (state === null) {
    throw new Error("query action state is required");
  }

  return state;
}

function requireQueryActionSourceDescriptor(
  state: Pick<QueryActionState, "sourceDescriptor">
): QueryActionSourceDescriptor {
  if (state.sourceDescriptor === null) {
    throw new Error("query action source descriptor is required");
  }

  return state.sourceDescriptor;
}

function requireValidatedQuery(
  state: Pick<QueryActionState, "validatedQuery">
): string {
  if (state.validatedQuery === null) {
    throw new Error("validated query is required");
  }

  return state.validatedQuery;
}
