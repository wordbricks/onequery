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
import type { SourceApiActionCommand } from "./commands";
import type { SourceApiActionEffect } from "./effects";
import type { SourceApiActionEvent } from "./events";
import {
  requireSourceApiActionRequestDescriptor,
  requireSourceApiActionSourceDescriptor,
} from "./invariants";
import type { SourceApiActionState } from "./state";

export type SourceApiActionRejectCode = SharedWorkflowRejectCode;

type SourceApiActionDecisionResult = ResultType<
  WorkflowDecision<
    SourceApiActionEvent,
    SourceApiActionEffect,
    SourceApiActionRejectCode
  >,
  WorkflowInternalInvariantError
>;

function okSourceApiDecision(
  decision: WorkflowDecision<
    SourceApiActionEvent,
    SourceApiActionEffect,
    SourceApiActionRejectCode
  >
): SourceApiActionDecisionResult {
  return Result.ok(decision);
}

export function decideSourceApiAction(
  state: SourceApiActionState | null,
  command: SourceApiActionCommand
): SourceApiActionDecisionResult {
  const commandType = command.commandPayload.type;
  const invariantContext = { commandType, scope: "decision" as const };

  switch (command.commandPayload.type) {
    case "start_describe": {
      if (state !== null) {
        return okSourceApiDecision(rejectInvalidPhase());
      }

      return okSourceApiDecision(
        acceptWorkflowDecision({
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
        })
      );
    }
    case "start_invoke": {
      if (state !== null) {
        return okSourceApiDecision(rejectInvalidPhase());
      }

      return okSourceApiDecision(
        acceptWorkflowDecision({
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
        })
      );
    }
    case "resume_invoke": {
      if (state === null) {
        return okSourceApiDecision(rejectUnknownAction());
      }

      if (state.phase !== "await_resume") {
        return okSourceApiDecision(rejectInvalidPhase());
      }

      if (command.commandPayload.resumeFromEventId !== state.lastEventId) {
        return okSourceApiDecision(rejectCausationMismatch());
      }

      if (
        state.preparedRequestFingerprint === null ||
        state.pageProgress === null ||
        state.requestDescriptor === null ||
        state.sourceDescriptor === null ||
        state.attemptNumber === null
      ) {
        return okSourceApiDecision(rejectInvalidPhase());
      }

      if (
        command.commandPayload.preparedRequestFingerprint !==
        state.preparedRequestFingerprint
      ) {
        return okSourceApiDecision(rejectCausationMismatch());
      }

      return okSourceApiDecision(
        acceptWorkflowDecision({
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
        })
      );
    }
    case "record_source_lookup": {
      if (state === null) {
        return okSourceApiDecision(rejectUnknownAction());
      }

      if (state.phase !== "load_source") {
        return okSourceApiDecision(rejectInvalidPhase());
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return okSourceApiDecision(rejectCausationMismatch());
      }

      switch (command.commandPayload.kind) {
        case "found":
          return okSourceApiDecision(
            acceptWorkflowDecision({
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
            })
          );
        case "not_found":
          return okSourceApiDecision(
            acceptWorkflowDecision({
              events: [
                {
                  sourceKey: command.commandPayload.sourceKey,
                  type: "source_not_found",
                },
              ],
            })
          );
      }
      break;
    }
    case "record_descriptor_resolution": {
      if (state === null) {
        return okSourceApiDecision(rejectUnknownAction());
      }

      if (state.phase !== "describe_source") {
        return okSourceApiDecision(rejectInvalidPhase());
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return okSourceApiDecision(rejectCausationMismatch());
      }

      const commandPayload = command.commandPayload;

      switch (commandPayload.kind) {
        case "resolved":
          return Result.gen(function* decideResolvedDescriptor() {
            const requestDescriptor =
              commandPayload.requestDescriptor ?? state.requestDescriptor;
            const source =
              state.requestKind === "invoke" && requestDescriptor !== null
                ? yield* requireSourceApiActionSourceDescriptor(
                    state,
                    invariantContext
                  )
                : null;

            return okSourceApiDecision(
              acceptWorkflowDecision({
                ...(source === null || requestDescriptor === null
                  ? {}
                  : {
                      effects: [
                        {
                          requestDescriptor,
                          source,
                          type: "prepare_request" as const,
                        },
                      ],
                    }),
                events: [
                  {
                    requestDescriptor: commandPayload.requestDescriptor,
                    type: "descriptor_resolved",
                  },
                ],
              })
            );
          });
        case "failed":
          return okSourceApiDecision(
            acceptWorkflowDecision({
              events: [
                {
                  detail: commandPayload.detail,
                  failureCode: commandPayload.failureCode,
                  type: "descriptor_resolution_failed",
                },
              ],
            })
          );
      }
      break;
    }
    case "record_request_preparation": {
      if (state === null) {
        return okSourceApiDecision(rejectUnknownAction());
      }

      if (state.phase !== "prepare_request") {
        return okSourceApiDecision(rejectInvalidPhase());
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return okSourceApiDecision(rejectCausationMismatch());
      }

      const commandPayload = command.commandPayload;

      switch (commandPayload.kind) {
        case "prepared":
          return Result.gen(function* decidePreparedRequest() {
            const preparedRequestFingerprint =
              commandPayload.preparedRequestFingerprint;
            const requestDescriptor =
              state.invokeMode === "execute"
                ? yield* requireSourceApiActionRequestDescriptor(
                    state,
                    invariantContext
                  )
                : null;
            const source =
              state.invokeMode === "execute"
                ? yield* requireSourceApiActionSourceDescriptor(
                    state,
                    invariantContext
                  )
                : null;

            return okSourceApiDecision(
              acceptWorkflowDecision({
                ...(requestDescriptor === null || source === null
                  ? {}
                  : {
                      effects: [
                        {
                          attemptNumber: 1,
                          pageIndex: 0,
                          preparedRequestFingerprint,
                          requestDescriptor,
                          source,
                          type: "execute_page" as const,
                        },
                      ],
                    }),
                events: [
                  {
                    preparedRequestFingerprint,
                    type: "request_prepared",
                  },
                ],
              })
            );
          });
        case "failed":
          return okSourceApiDecision(
            acceptWorkflowDecision({
              events: [
                {
                  detail: commandPayload.detail,
                  failureCode: commandPayload.failureCode,
                  type: "request_preparation_failed",
                },
              ],
            })
          );
      }
      break;
    }
    case "record_page_fetch": {
      if (state === null) {
        return okSourceApiDecision(rejectUnknownAction());
      }

      if (state.phase !== "execute_request") {
        return okSourceApiDecision(rejectInvalidPhase());
      }

      if (!hasMatchingCausation(state, command.causedByEventId)) {
        return okSourceApiDecision(rejectCausationMismatch());
      }

      const commandPayload = command.commandPayload;

      switch (commandPayload.kind) {
        case "succeeded":
          return okSourceApiDecision(
            acceptWorkflowDecision({
              events: [
                {
                  attemptNumber: commandPayload.attemptNumber,
                  contentType: commandPayload.contentType,
                  hasContinuation: commandPayload.hasContinuation,
                  httpStatus: commandPayload.httpStatus,
                  pageIndex: commandPayload.pageIndex,
                  responseBytes: commandPayload.responseBytes,
                  type: "page_fetch_succeeded",
                },
              ],
            })
          );
        case "terminal_failure":
          return okSourceApiDecision(
            acceptWorkflowDecision({
              events: [
                {
                  attemptNumber: commandPayload.attemptNumber,
                  detail: commandPayload.detail,
                  failureCode: commandPayload.failureCode,
                  kind: "terminal_failure",
                  pageIndex: commandPayload.pageIndex,
                  type: "page_fetch_failed",
                },
              ],
            })
          );
      }
      break;
    }
  }

  return okSourceApiDecision(rejectInvalidPhase());
}
