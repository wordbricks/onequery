import type { QueryActionSourceDescriptor } from "../../../audit";
import type {
  CliPersistUsageEffectResult,
  CliValidateQueryEffectResult,
} from "../../../domain/effects";
import type {
  CliQuerySourceRecord,
  CliSourceRecord,
} from "../../../domain/workflows";
import {
  createQueryAuditCorruptionProblem,
  requireLastCommittedEvent,
} from "./workflow-runtime";
import type {
  QueryCredentialsLoadResult,
  QueryExecutionEffectResult,
  QuerySourceLookupResult,
  StoredAcceptedQueryActionDecision,
  StoredAcceptedQueryActionResultCommand,
} from "./workflow-types";

export function toStoredQuerySourceLookupResult(input: {
  decision: StoredAcceptedQueryActionDecision;
  orgSlug: string;
  requestId: string;
  sourceName: string;
}): QuerySourceLookupResult {
  const event = requireLastCommittedEvent(input.decision);

  switch (event.type) {
    case "source_loaded":
      return {
        kind: "source_query_interface_loaded",
      };
    case "source_not_found":
      return {
        kind: "source_not_found",
        orgSlug: input.orgSlug,
        requestId: input.requestId,
        sourceName: input.sourceName,
      };
    case "source_query_interface_missing":
      return {
        kind: "source_query_interface_missing",
        provider: event.provider,
        requestId: input.requestId,
        sourceName: input.sourceName,
        status: event.sourceStatus,
      };
    default:
      throw createQueryAuditCorruptionProblem(
        `query_action replay expected a source lookup event but loaded ${event.type}`
      );
  }
}

export function toStoredQueryValidationResult(
  commandPayload: StoredAcceptedQueryActionResultCommand["commandPayload"]
): CliValidateQueryEffectResult {
  if (commandPayload.type !== "record_query_validation") {
    throw createQueryAuditCorruptionProblem(
      `query_action replay expected a validation result command but loaded ${commandPayload.type}`
    );
  }

  switch (commandPayload.kind) {
    case "accepted":
      return {
        kind: "query_ready",
        normalizedSql: commandPayload.validatedQuery,
        truncated: commandPayload.truncated,
      };
    case "rejected":
      return {
        detail: commandPayload.detail,
        kind: "query_rejected",
      };
    case "preparation_failed":
      return {
        detail: commandPayload.detail,
        hint: commandPayload.hint,
        kind: "query_preparation_failed",
      };
    default:
      return assertNever(commandPayload);
  }
}

export function toStoredQueryCredentialsLoadResult(
  decision: StoredAcceptedQueryActionDecision
): QueryCredentialsLoadResult {
  const event = requireLastCommittedEvent(decision);

  switch (event.type) {
    case "credentials_loaded":
      return {
        kind: "loaded",
      };
    case "query_preparation_failed":
      return {
        detail: event.detail,
        kind: "credentials_invalid",
      };
    default:
      throw createQueryAuditCorruptionProblem(
        `query_action replay expected a credentials load event but loaded ${event.type}`
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
