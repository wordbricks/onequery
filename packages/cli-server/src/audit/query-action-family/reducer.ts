import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import type { WorkflowInternalInvariantError } from "../invariant-errors";
import type { QueryActionCommittedEvent } from "./events";
import { requireQueryActionState } from "./invariants";
import type { QueryActionFailureCode, QueryActionState } from "./state";

function okQueryActionState(
  state: QueryActionState
): ResultType<QueryActionState, WorkflowInternalInvariantError> {
  return Result.ok(state);
}

export function reduceQueryAction(
  state: QueryActionState | null,
  event: QueryActionCommittedEvent
): ResultType<QueryActionState, WorkflowInternalInvariantError> {
  switch (event.type) {
    case "action_received":
      return okQueryActionState({
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
      });
    case "source_loaded":
      return Result.gen(function* reduceSourceLoaded() {
        const current = yield* requireQueryActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okQueryActionState({
          ...current,
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          phase: "validate_query",
          sourceDescriptor: event.source,
        });
      });
    case "source_not_found":
      return completeFailedQueryAction(state, event, "source_not_found");
    case "source_query_interface_missing":
      return completeFailedQueryAction(
        state,
        event,
        "source_query_interface_missing"
      );
    case "query_validated":
      return Result.gen(function* reduceQueryValidated() {
        const current = yield* requireQueryActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okQueryActionState({
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
        });
      });
    case "query_rejected":
      return completeFailedQueryAction(state, event, "query_rejected");
    case "credentials_loaded":
      return Result.gen(function* reduceCredentialsLoaded() {
        const current = yield* requireQueryActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okQueryActionState({
          ...current,
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          phase: "execute_query",
        });
      });
    case "query_preparation_failed":
      return completeFailedQueryAction(
        state,
        event,
        "query_preparation_failed"
      );
    case "query_executed":
      return Result.gen(function* reduceQueryExecuted() {
        const current = yield* requireQueryActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okQueryActionState({
          ...current,
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          phase: "persist_usage",
        });
      });
    case "query_unavailable":
      return completeFailedQueryAction(state, event, "query_unavailable");
    case "query_timed_out":
      return completeFailedQueryAction(state, event, "query_timed_out");
    case "query_execution_failed":
      return completeFailedQueryAction(state, event, "query_execution_failed");
    case "usage_persisted":
      return Result.gen(function* reduceUsagePersisted() {
        const current = yield* requireQueryActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okQueryActionState({
          ...current,
          completedAt: event.occurredAt,
          failureCode: null,
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          outcome: "succeeded",
          phase: "completed",
          usageRecordingStatus: "succeeded",
        });
      });
    case "usage_persist_failed":
      return Result.gen(function* reduceUsagePersistFailed() {
        const current = yield* requireQueryActionState(state, {
          eventType: event.type,
          scope: "reducer",
        });
        return okQueryActionState({
          ...current,
          completedAt: event.occurredAt,
          failureCode: null,
          lastEventId: event.id,
          lastEventSequence: event.sequence,
          outcome: "succeeded",
          phase: "completed",
          usageRecordingStatus: "failed",
        });
      });
  }
}

function completeFailedQueryAction(
  state: QueryActionState | null,
  event: Pick<
    QueryActionCommittedEvent,
    "id" | "occurredAt" | "sequence" | "type"
  >,
  failureCode: QueryActionFailureCode
): ResultType<QueryActionState, WorkflowInternalInvariantError> {
  return Result.gen(function* completeFailedQueryActionFlow() {
    const current = yield* requireQueryActionState(state, {
      eventType: event.type,
      scope: "reducer",
    });
    return okQueryActionState({
      ...current,
      completedAt: event.occurredAt,
      failureCode,
      lastEventId: event.id,
      lastEventSequence: event.sequence,
      outcome: "failed",
      phase: "completed",
    });
  });
}
