import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { CliPersistUsageEffectResult } from "../../../domain/effects";
import type {
  CliQueryColumn,
  CliQueryPlanResult,
  CliSourceRecord,
  CliQuerySuccessResult,
} from "../../../domain/workflows";

export type CliQueryExecutionWorkflowResult =
  | {
      kind: "response_ready";
      response: CliQuerySuccessResult;
      usagePersistence: CliPersistUsageEffectResult;
    }
  | {
      kind: "source_not_found";
      orgSlug: string;
      sourceName: string;
      requestId: string;
    }
  | {
      kind: "source_not_queryable";
      requestId: string;
      sourceName: string;
      provider: ProviderType;
      status: DataSourceStatus;
    }
  | {
      kind: "query_rejected";
      requestId: string;
      detail: string;
    }
  | {
      kind: "query_preparation_failed";
      requestId: string;
      detail: string;
      hint?: string;
    }
  | {
      kind: "query_unavailable";
      requestId: string;
      detail: string;
      retryable: true;
    }
  | {
      kind: "query_timed_out";
      requestId: string;
      detail: string;
      retryable: true;
    }
  | {
      kind: "query_execution_failed";
      requestId: string;
      detail: string;
      retryable: false;
    };

export type CliQueryValidationWorkflowResult = CliQueryPlanResult;

export function buildCliQuerySuccessResponse(input: {
  source: CliSourceRecord;
  rows: Record<string, unknown>[];
  elapsedMs: number;
  truncated: boolean;
}): CliQuerySuccessResult {
  const columns = [
    ...input.rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => {
        set.add(key);
      });
      return set;
    }, new Set<string>()),
  ];

  return {
    columns: columns.map((name) => ({
      name,
      logicalType: inferLogicalType(name, input.rows),
    })),
    elapsedMs: Math.max(0, Math.trunc(input.elapsedMs)),
    rowCount: input.rows.length,
    rows: input.rows.map((row) =>
      columns.map((column) => normalizeCell(row[column]))
    ),
    source: {
      displayName: input.source.displayName,
      id: input.source.id,
      provider: input.source.provider,
      sourceKey: input.source.sourceKey,
      status: input.source.status,
    },
    truncated: input.truncated,
  };
}

function inferLogicalType(
  column: string,
  rows: Record<string, unknown>[]
): CliQueryColumn["logicalType"] {
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined) {
      continue;
    }

    if (value instanceof Date) {
      return "datetime";
    }

    if (Array.isArray(value)) {
      return "array";
    }

    switch (typeof value) {
      case "string": {
        return "string";
      }
      case "number": {
        return "number";
      }
      case "boolean": {
        return "boolean";
      }
      case "bigint": {
        return "bigint";
      }
      case "object": {
        return "json";
      }
      default: {
        return null;
      }
    }
  }

  return null;
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
