import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import type { WorkflowInternalInvariantError } from "../invariant-errors";
import {
  acceptWorkflowDecision,
  hasMatchingCausation,
  rejectCausationMismatch,
  rejectInvalidPhase,
  rejectUnknownAction,
} from "../kernel";
import type { SharedWorkflowRejectCode, WorkflowDecision } from "../kernel";
import type { QueryActionCommand } from "./commands";
import type { QueryActionEffect } from "./effects";
import type { QueryActionEvent } from "./events";
import { requireQueryActionSourceDescriptor } from "./invariants";
import type { QueryActionState } from "./state";

export type QueryActionRejectCode = SharedWorkflowRejectCode;

type QueryActionDecisionResult = ResultType<
  WorkflowDecision<QueryActionEvent, QueryActionEffect, QueryActionRejectCode>,
  WorkflowInternalInvariantError
>;

function okQueryDecision(
  decision: WorkflowDecision<
    QueryActionEvent,
    QueryActionEffect,
    QueryActionRejectCode
  >
): QueryActionDecisionResult {
  return Result.ok(decision);
}

function queryEvents(
  events: [QueryActionEvent, ...QueryActionEvent[]]
): [QueryActionEvent, ...QueryActionEvent[]] {
  return events;
}

export function decideQueryAction(
  state: QueryActionState | null,
  command: QueryActionCommand
): QueryActionDecisionResult {
  const commandType = command.commandPayload.type;
  const invariantContext = { commandType, scope: "decision" as const };

  switch (command.commandPayload.type) {
    case "start_validate": {
      if (state !== null) {
        return okQueryDecision(rejectInvalidPhase());
      }

      return okQueryDecision(
        acceptWorkflowDecision({
          effects: [
            {
              organizationId: command.organizationId,
              queryText: command.commandPayload.queryText,
              sourceKey: command.commandPayload.sourceKey,
              type: "prepare_validate_query",
            },
          ],
          events: [
            {
              queryMode: "validate",
              queryText: command.commandPayload.queryText,
              type: "action_received",
            },
          ],
        })
      );
    }
    case "start_execute": {
      if (state !== null) {
        return okQueryDecision(rejectInvalidPhase());
      }

      return okQueryDecision(
        acceptWorkflowDecision({
          effects: [
            {
              organizationId: command.organizationId,
              queryText: command.commandPayload.queryText,
              sourceKey: command.commandPayload.sourceKey,
              type: "prepare_execute_query",
            },
          ],
          events: [
            {
              queryMode: "execute",
              queryText: command.commandPayload.queryText,
              type: "action_received",
            },
          ],
        })
      );
    }
    case "record_validate_preparation": {
      if (state === null) {
        return okQueryDecision(rejectUnknownAction());
      }

      if (state.phase !== "load_source" || state.queryMode !== "validate") {
        return okQueryDecision(rejectInvalidPhase());
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return okQueryDecision(rejectCausationMismatch());
      }

      const commandPayload = command.commandPayload;

      switch (commandPayload.kind) {
        case "accepted":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: queryEvents([
                {
                  source: commandPayload.source,
                  type: "source_loaded",
                },
                {
                  type: "query_validated",
                  validatedQuery: commandPayload.validatedQuery,
                },
              ]),
            })
          );
        case "rejected":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: queryEvents([
                {
                  source: commandPayload.source,
                  type: "source_loaded",
                },
                {
                  detail: commandPayload.detail,
                  type: "query_rejected",
                },
              ]),
            })
          );
        case "not_found":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [
                {
                  sourceKey: commandPayload.sourceKey,
                  type: "source_not_found",
                },
              ],
            })
          );
        case "query_interface_missing":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [
                {
                  provider: commandPayload.provider,
                  sourceStatus: commandPayload.sourceStatus,
                  type: "source_query_interface_missing",
                },
              ],
            })
          );
        case "failed":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: queryEvents(
                commandPayload.source === undefined
                  ? [
                      {
                        detail: commandPayload.detail,
                        hint: commandPayload.hint,
                        type: "query_preparation_failed",
                      },
                    ]
                  : [
                      {
                        source: commandPayload.source,
                        type: "source_loaded",
                      },
                      {
                        detail: commandPayload.detail,
                        hint: commandPayload.hint,
                        type: "query_preparation_failed",
                      },
                    ]
              ),
            })
          );
      }
      break;
    }
    case "record_execute_preparation": {
      if (state === null) {
        return okQueryDecision(rejectUnknownAction());
      }

      if (state.phase !== "load_source" || state.queryMode !== "execute") {
        return okQueryDecision(rejectInvalidPhase());
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return okQueryDecision(rejectCausationMismatch());
      }

      const commandPayload = command.commandPayload;

      switch (commandPayload.kind) {
        case "succeeded":
          return okQueryDecision(
            acceptWorkflowDecision({
              effects: [
                {
                  source: commandPayload.source,
                  type: "execute_query",
                  validatedQuery: commandPayload.validatedQuery,
                },
              ],
              events: queryEvents([
                {
                  source: commandPayload.source,
                  type: "source_loaded",
                },
                {
                  type: "query_validated",
                  validatedQuery: commandPayload.validatedQuery,
                },
                { type: "credentials_loaded" },
              ]),
            })
          );
        case "rejected":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: queryEvents([
                {
                  source: commandPayload.source,
                  type: "source_loaded",
                },
                {
                  detail: commandPayload.detail,
                  type: "query_rejected",
                },
              ]),
            })
          );
        case "not_found":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [
                {
                  sourceKey: commandPayload.sourceKey,
                  type: "source_not_found",
                },
              ],
            })
          );
        case "query_interface_missing":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [
                {
                  provider: commandPayload.provider,
                  sourceStatus: commandPayload.sourceStatus,
                  type: "source_query_interface_missing",
                },
              ],
            })
          );
        case "failed":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: queryEvents(
                commandPayload.source === undefined
                  ? [
                      {
                        detail: commandPayload.detail,
                        hint: commandPayload.hint,
                        type: "query_preparation_failed",
                      },
                    ]
                  : [
                      {
                        source: commandPayload.source,
                        type: "source_loaded",
                      },
                      {
                        detail: commandPayload.detail,
                        hint: commandPayload.hint,
                        type: "query_preparation_failed",
                      },
                    ]
              ),
            })
          );
      }
      break;
    }
    case "record_query_execution": {
      if (state === null) {
        return okQueryDecision(rejectUnknownAction());
      }

      if (state.phase !== "execute_query") {
        return okQueryDecision(rejectInvalidPhase());
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return okQueryDecision(rejectCausationMismatch());
      }

      const commandPayload = command.commandPayload;

      switch (commandPayload.kind) {
        case "succeeded":
          return Result.gen(function* decideSucceededQueryExecution() {
            const source = yield* requireQueryActionSourceDescriptor(
              state,
              invariantContext
            );

            return okQueryDecision(
              acceptWorkflowDecision({
                effects: [
                  {
                    sourceId: source.sourceId,
                    type: "persist_usage",
                  },
                ],
                events: [
                  {
                    elapsedMs: commandPayload.response.elapsedMs,
                    rowCount: commandPayload.response.rowCount,
                    type: "query_executed",
                  },
                ],
              })
            );
          });
        case "unavailable":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [
                {
                  detail: commandPayload.detail,
                  type: "query_unavailable",
                },
              ],
            })
          );
        case "timed_out":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [
                {
                  detail: commandPayload.detail,
                  type: "query_timed_out",
                },
              ],
            })
          );
        case "failed":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [
                {
                  detail: commandPayload.detail,
                  type: "query_execution_failed",
                },
              ],
            })
          );
      }
      break;
    }
    case "record_usage_persistence": {
      if (state === null) {
        return okQueryDecision(rejectUnknownAction());
      }

      if (state.phase !== "persist_usage") {
        return okQueryDecision(rejectInvalidPhase());
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return okQueryDecision(rejectCausationMismatch());
      }

      const commandPayload = command.commandPayload;

      switch (commandPayload.kind) {
        case "succeeded":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [{ type: "usage_persisted" }],
            })
          );
        case "failed":
          return okQueryDecision(
            acceptWorkflowDecision({
              events: [
                {
                  detail: commandPayload.detail,
                  type: "usage_persist_failed",
                },
              ],
            })
          );
      }
      break;
    }
  }

  return okQueryDecision(rejectInvalidPhase());
}
