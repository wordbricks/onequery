import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import type { WorkflowInternalInvariantError } from "../invariant-errors";
import type { SourceApiActionCommittedEvent } from "./events";
import { requireSourceApiActionState } from "./invariants";
import type { SourceApiActionFailureCode, SourceApiActionState } from "./state";

function okSourceApiActionState(
  state: SourceApiActionState
): ResultType<SourceApiActionState, WorkflowInternalInvariantError> {
  return Result.ok(state);
}

export function reduceSourceApiAction(
  state: SourceApiActionState | null,
  event: SourceApiActionCommittedEvent
): ResultType<SourceApiActionState, WorkflowInternalInvariantError> {
  switch (event.type) {
    case "action_received":
      return okSourceApiActionState({
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
      });
    case "source_loaded":
      return Result.gen(function* reduceSourceLoaded() {
        const current = yield* requireSourceApiActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okSourceApiActionState({
          ...current,
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          phase: "describe_source",
          sourceDescriptor: event.source,
        });
      });
    case "source_not_found":
      return completeFailedSourceApiAction(state, event, "source_not_found");
    case "descriptor_resolved":
      return Result.gen(function* reduceDescriptorResolved() {
        const current = yield* requireSourceApiActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okSourceApiActionState({
          ...current,
          completedAt:
            current.requestKind === "describe"
              ? event.occurredAt
              : current.completedAt,
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          outcome: current.requestKind === "describe" ? "succeeded" : "pending",
          phase:
            current.requestKind === "describe"
              ? "completed"
              : "prepare_request",
          requestDescriptor:
            event.requestDescriptor ?? current.requestDescriptor,
        });
      });
    case "descriptor_resolution_failed":
      return completeFailedSourceApiAction(state, event, event.failureCode);
    case "request_prepared":
      return Result.gen(function* reduceRequestPrepared() {
        const current = yield* requireSourceApiActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okSourceApiActionState({
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
        });
      });
    case "request_preparation_failed":
      return completeFailedSourceApiAction(state, event, event.failureCode);
    case "resume_requested":
      return Result.gen(function* reduceResumeRequested() {
        const current = yield* requireSourceApiActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okSourceApiActionState({
          ...current,
          attemptNumber: event.attemptNumber,
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          pageProgress: null,
          phase: "execute_request",
        });
      });
    case "page_fetch_succeeded":
      return Result.gen(function* reducePageFetchSucceeded() {
        const current = yield* requireSourceApiActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okSourceApiActionState({
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
        });
      });
    case "page_fetch_failed":
      return completeFailedSourceApiAction(state, event, event.failureCode);
  }
}

function completeFailedSourceApiAction(
  state: SourceApiActionState | null,
  event: Pick<
    SourceApiActionCommittedEvent,
    "id" | "occurredAt" | "sequence" | "type"
  >,
  failureCode: SourceApiActionFailureCode
): ResultType<SourceApiActionState, WorkflowInternalInvariantError> {
  return Result.gen(function* completeFailedSourceApiActionFlow() {
    const current = yield* requireSourceApiActionState(state, {
      eventType: event.type,
      scope: "reducer",
    });
    return okSourceApiActionState({
      ...current,
      completedAt: event.occurredAt,
      failureCode,
      lastEventId: event.id,
      lastEventSequence: event.sequence,
      outcome: "failed",
      pageProgress: null,
      phase: "completed",
    });
  });
}
