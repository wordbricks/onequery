import type { QueryActionSourceDescriptor } from "../../../audit";
import type { CliPersistUsageEffectResult } from "../../../domain/effects";
import type {
  CliQuerySourceRecord,
  CliSourceRecord,
} from "../../../domain/workflows";
import {
  createQueryAuditCorruptionProblem,
  requireLastCommittedEvent,
} from "./workflow-runtime";
import type {
  QueryExecutionEffectResult,
  QueryPreparationEffectResult,
  StoredAcceptedQueryActionDecision,
  StoredAcceptedQueryActionResultCommand,
} from "./workflow-types";

export function toStoredQueryPreparationResult(input: {
  commandPayload: StoredAcceptedQueryActionResultCommand["commandPayload"];
  decision: StoredAcceptedQueryActionDecision;
  orgSlug: string;
  requestId: string;
  sourceName: string;
}): QueryPreparationEffectResult {
  switch (input.commandPayload.type) {
    case "record_validate_preparation":
      switch (input.commandPayload.kind) {
        case "accepted":
          return {
            kind: "query_ready",
            normalizedSql: input.commandPayload.validatedQuery,
            source: input.commandPayload.source,
            truncated: input.commandPayload.truncated,
          };
        case "rejected":
          return {
            detail: input.commandPayload.detail,
            kind: "query_rejected",
          };
        case "not_found":
          return {
            kind: "source_not_found",
            orgSlug: input.orgSlug,
            requestId: input.requestId,
            sourceName: input.sourceName,
          };
        case "query_interface_missing":
          return {
            kind: "source_query_interface_missing",
            provider: input.commandPayload.provider,
            requestId: input.requestId,
            sourceName: input.sourceName,
            status: input.commandPayload.sourceStatus,
          };
        case "failed":
          return {
            detail: input.commandPayload.detail,
            hint: input.commandPayload.hint,
            kind: "query_preparation_failed",
          };
        default:
          return assertNever(input.commandPayload);
      }
    case "record_execute_preparation":
      switch (input.commandPayload.kind) {
        case "succeeded":
          return {
            kind: "query_ready",
            normalizedSql: input.commandPayload.validatedQuery,
            source: input.commandPayload.source,
            truncated: input.commandPayload.truncated,
          };
        case "rejected":
          return {
            detail: input.commandPayload.detail,
            kind: "query_rejected",
          };
        case "not_found":
          return {
            kind: "source_not_found",
            orgSlug: input.orgSlug,
            requestId: input.requestId,
            sourceName: input.sourceName,
          };
        case "query_interface_missing":
          return {
            kind: "source_query_interface_missing",
            provider: input.commandPayload.provider,
            requestId: input.requestId,
            sourceName: input.sourceName,
            status: input.commandPayload.sourceStatus,
          };
        case "failed":
          return {
            detail: input.commandPayload.detail,
            hint: input.commandPayload.hint,
            kind: "query_preparation_failed",
          };
        default:
          return assertNever(input.commandPayload);
      }
    default:
      throw createQueryAuditCorruptionProblem(
        `query_action replay expected a preparation result command but loaded ${input.commandPayload.type}`
      );
  }
}

export function toStoredQueryExecutionResult(
  commandPayload: StoredAcceptedQueryActionResultCommand["commandPayload"]
): QueryExecutionEffectResult {
  if (commandPayload.type !== "record_query_execution") {
    throw createQueryAuditCorruptionProblem(
      `query_action replay expected an execution result command but loaded ${commandPayload.type}`
    );
  }

  switch (commandPayload.kind) {
    case "succeeded":
      return {
        kind: "succeeded",
        response: commandPayload.response,
      };
    case "unavailable":
      return {
        detail: commandPayload.detail,
        kind: "query_unavailable",
      };
    case "timed_out":
      return {
        detail: commandPayload.detail,
        kind: "query_timed_out",
      };
    case "failed":
      return {
        detail: commandPayload.detail,
        kind: "query_execution_failed",
      };
    default:
      return assertNever(commandPayload);
  }
}

export function toStoredUsagePersistenceResult(input: {
  decision: StoredAcceptedQueryActionDecision;
  sourceId: string;
}): CliPersistUsageEffectResult {
  const event = requireLastCommittedEvent(input.decision);

  switch (event.type) {
    case "usage_persisted":
      return {
        kind: "usage_persisted",
      };
    case "usage_persist_failed":
      return {
        detail: event.detail,
        kind: "usage_persist_failed",
        sourceId: input.sourceId,
      };
    default:
      throw createQueryAuditCorruptionProblem(
        `query_action replay expected a usage persistence event but loaded ${event.type}`
      );
  }
}

export function toQueryActionSourceDescriptor(
  source: CliQuerySourceRecord
): QueryActionSourceDescriptor {
  return {
    displayName: source.displayName,
    name: source.name,
    organizationId: source.organizationId,
    provider: source.provider,
    sourceId: source.id,
    sourceKey: source.sourceKey,
    sourceStatus: source.status,
  };
}

export function toCliSourceRecord(
  source: QueryActionSourceDescriptor
): CliSourceRecord {
  return {
    displayName: source.displayName,
    id: source.sourceId,
    provider: source.provider,
    sourceKey: source.sourceKey,
    status: source.sourceStatus,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled query workflow projection case: ${String(value)}`);
}
