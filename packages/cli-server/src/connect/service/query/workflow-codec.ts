import { DATA_SOURCE_STATUS, PROVIDER_TYPES } from "@onequery/db/server";
import { z } from "zod";

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
  createQueryAuditProblem,
  requireLastCommittedEvent,
} from "./workflow-runtime";
import type {
  QueryCredentialsLoadResult,
  QueryExecutionEffectResult,
  QuerySourceLookupResult,
  StoredAcceptedQueryActionDecision,
  StoredAcceptedQueryActionResultCommand,
} from "./workflow-types";

const CliQuerySuccessResultSchema = z
  .object({
    columns: z.array(
      z
        .object({
          logicalType: z
            .enum([
              "string",
              "number",
              "boolean",
              "bigint",
              "datetime",
              "array",
              "json",
            ])
            .nullable(),
          name: z.string(),
        })
        .strict()
    ),
    elapsedMs: z.number().int(),
    rowCount: z.number().int(),
    rows: z.array(z.array(z.string())),
    source: z
      .object({
        displayName: z.string().nullable(),
        id: z.string(),
        provider: z.enum(PROVIDER_TYPES),
        sourceKey: z.string(),
        status: z.enum(DATA_SOURCE_STATUS),
      })
      .strict(),
    truncated: z.boolean(),
  })
  .strict();

const StoredQueryValidationResultPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("accepted"),
      truncated: z.boolean(),
      type: z.literal("record_query_validation"),
      validatedQuery: z.string(),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string().optional(),
      kind: z.literal("rejected"),
      type: z.literal("record_query_validation"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string(),
      kind: z.literal("preparation_failed"),
      type: z.literal("record_query_validation"),
    })
    .strict(),
]);

const StoredQueryExecutionResultPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      elapsedMs: z.number().int(),
      kind: z.literal("succeeded"),
      response: CliQuerySuccessResultSchema,
      rowCount: z.number().int(),
      type: z.literal("record_query_execution"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      kind: z.literal("unavailable"),
      type: z.literal("record_query_execution"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      kind: z.literal("timed_out"),
      type: z.literal("record_query_execution"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      kind: z.literal("failed"),
      type: z.literal("record_query_execution"),
    })
    .strict(),
]);

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
        kind: "queryable_source_loaded",
      };
    case "source_not_found":
      return {
        kind: "source_not_found",
        orgSlug: input.orgSlug,
        requestId: input.requestId,
        sourceName: input.sourceName,
      };
    case "source_not_queryable":
      return {
        kind: "source_not_queryable",
        provider: event.provider,
        requestId: input.requestId,
        sourceName: input.sourceName,
        status: event.sourceStatus,
      };
    default:
      throw createQueryAuditProblem(
        `query_action replay expected a source lookup event but loaded ${event.type}`
      );
  }
}

export function toStoredQueryValidationResult(
  commandPayload: StoredAcceptedQueryActionResultCommand["commandPayload"]
): CliValidateQueryEffectResult {
  const parsed =
    StoredQueryValidationResultPayloadSchema.safeParse(commandPayload);
  if (!parsed.success) {
    throw createQueryAuditProblem(
      "query_action stored validation result payload is corrupt",
      parsed.error
    );
  }

  switch (parsed.data.kind) {
    case "accepted":
      return {
        kind: "query_ready",
        normalizedSql: parsed.data.validatedQuery,
        truncated: parsed.data.truncated,
      };
    case "rejected":
      return {
        detail: parsed.data.detail,
        kind: "query_rejected",
      };
    case "preparation_failed":
      return {
        detail: parsed.data.detail,
        hint: parsed.data.hint,
        kind: "query_preparation_failed",
      };
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
      throw createQueryAuditProblem(
        `query_action replay expected a credentials load event but loaded ${event.type}`
      );
  }
}

export function toStoredQueryExecutionResult(
  commandPayload: StoredAcceptedQueryActionResultCommand["commandPayload"]
): QueryExecutionEffectResult {
  const parsed =
    StoredQueryExecutionResultPayloadSchema.safeParse(commandPayload);
  if (!parsed.success) {
    throw createQueryAuditProblem(
      "query_action stored execution result payload is corrupt",
      parsed.error
    );
  }

  switch (parsed.data.kind) {
    case "succeeded":
      return {
        kind: "succeeded",
        response: parsed.data.response,
      };
    case "unavailable":
      return {
        detail: parsed.data.detail,
        kind: "query_unavailable",
        retryable: true,
      };
    case "timed_out":
      return {
        detail: parsed.data.detail,
        kind: "query_timed_out",
        retryable: true,
      };
    case "failed":
      return {
        detail: parsed.data.detail,
        kind: "query_execution_failed",
        retryable: false,
      };
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
      throw createQueryAuditProblem(
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
