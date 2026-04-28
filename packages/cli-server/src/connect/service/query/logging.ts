import type { ProviderType } from "@onequery/db/server";

import {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
} from "../../../observability";
import type {
  CliQueryExecutionFailure,
  CliQueryExecutionSuccess,
  CliQueryValidationFailure,
} from "./types";

type CliQueryLoggingDependencies = {
  buildCliRequestLogDetails: typeof buildCliRequestLogDetails;
  logCliEvent: typeof logCliEvent;
  recordCliCounterMetric: typeof recordCliCounterMetric;
};

const defaultCliQueryLoggingDependencies: CliQueryLoggingDependencies = {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
};

export function createCliQueryLogging(
  dependencies: CliQueryLoggingDependencies = defaultCliQueryLoggingDependencies
) {
  function logCliQueryValidationFailure(
    c: Parameters<typeof buildCliRequestLogDetails>[0],
    sourceKey: string,
    result: CliQueryValidationFailure
  ) {
    switch (result.kind) {
      case "source_not_found": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.plan.source_not_found",
          details: dependencies.buildCliRequestLogDetails(c, {
            orgSlug: result.orgSlug,
            source: sourceKey,
            httpStatus: 404,
          }),
        });
        return;
      }
      case "source_query_interface_missing": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.plan.source_query_interface_missing",
          details: dependencies.buildCliRequestLogDetails(c, {
            source: sourceKey,
            provider: result.provider,
            sourceStatus: result.status,
            httpStatus: 400,
          }),
        });
        return;
      }
      case "query_rejected": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.plan.rejected",
          details: dependencies.buildCliRequestLogDetails(c, {
            source: sourceKey,
            detail: result.detail,
            httpStatus: 400,
          }),
        });
        return;
      }
      case "query_preparation_failed": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.plan.preparation_failed",
          details: dependencies.buildCliRequestLogDetails(c, {
            source: sourceKey,
            detail: result.detail,
            hint: result.hint,
            httpStatus: 500,
          }),
        });
      }
    }
  }

  function logCliQueryValidationAccepted(input: {
    c: Parameters<typeof buildCliRequestLogDetails>[0];
    provider: ProviderType;
    sourceKey: string;
    truncated: boolean;
  }) {
    dependencies.logCliEvent({
      details: dependencies.buildCliRequestLogDetails(input.c, {
        source: input.sourceKey,
        provider: input.provider,
        truncated: input.truncated,
      }),
      event: "query.plan.accepted",
      level: "info",
    });
  }

  function logCliQueryExecutionFailure(input: {
    c: Parameters<typeof buildCliRequestLogDetails>[0];
    durationMs: number;
    result: CliQueryExecutionFailure;
    sourceKey: string;
  }) {
    const httpStatus = getCliQueryFailureHttpStatus(input.result);

    switch (input.result.kind) {
      case "source_not_found": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.plan.source_not_found",
          details: dependencies.buildCliRequestLogDetails(input.c, {
            orgSlug: input.result.orgSlug,
            source: input.sourceKey,
            httpStatus,
            durationMs: input.durationMs,
          }),
        });
        return;
      }
      case "source_query_interface_missing": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.plan.source_query_interface_missing",
          details: dependencies.buildCliRequestLogDetails(input.c, {
            source: input.result.sourceName,
            provider: input.result.provider,
            sourceStatus: input.result.status,
            httpStatus,
            durationMs: input.durationMs,
          }),
        });
        return;
      }
      case "query_rejected": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.plan.rejected",
          details: dependencies.buildCliRequestLogDetails(input.c, {
            source: input.sourceKey,
            detail: input.result.detail,
            httpStatus,
            durationMs: input.durationMs,
          }),
        });
        return;
      }
      case "query_preparation_failed": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.plan.preparation_failed",
          details: dependencies.buildCliRequestLogDetails(input.c, {
            source: input.sourceKey,
            detail: input.result.detail,
            hint: input.result.hint,
            httpStatus,
            durationMs: input.durationMs,
          }),
        });
        return;
      }
      case "query_unavailable": {
        dependencies.recordCliCounterMetric({
          name: "cli.query.retryable_total",
          tags: {
            outcome: input.result.kind,
          },
        });
        dependencies.logCliEvent({
          level: "warn",
          event: "query.execution.unavailable",
          details: dependencies.buildCliRequestLogDetails(input.c, {
            source: input.sourceKey,
            detail: input.result.detail,
            httpStatus,
            durationMs: input.durationMs,
            retryable: true,
          }),
        });
        return;
      }
      case "query_timed_out": {
        dependencies.recordCliCounterMetric({
          name: "cli.query.timeout_total",
        });
        dependencies.recordCliCounterMetric({
          name: "cli.query.retryable_total",
          tags: {
            outcome: input.result.kind,
          },
        });
        dependencies.logCliEvent({
          level: "warn",
          event: "query.execution.timed_out",
          details: dependencies.buildCliRequestLogDetails(input.c, {
            source: input.sourceKey,
            detail: input.result.detail,
            httpStatus,
            durationMs: input.durationMs,
            retryable: true,
          }),
        });
        return;
      }
      case "query_execution_failed": {
        dependencies.logCliEvent({
          level: "warn",
          event: "query.execution.failed",
          details: dependencies.buildCliRequestLogDetails(input.c, {
            source: input.sourceKey,
            detail: input.result.detail,
            httpStatus,
            durationMs: input.durationMs,
            retryable: false,
          }),
        });
      }
    }
  }

  function logCliQueryExecutionSuccess(input: {
    c: Parameters<typeof buildCliRequestLogDetails>[0];
    durationMs: number;
    response: Pick<
      CliQueryExecutionSuccess["response"],
      "source" | "rowCount" | "elapsedMs" | "truncated"
    >;
    sourceKey: string;
    usagePersistence: CliQueryExecutionSuccess["usagePersistence"];
  }) {
    // Comment: execute already traverses validation on the same request path, so
    // re-emitting query.plan.accepted here makes validate+execute callers double
    // count a single accepted plan in logs.
    dependencies.logCliEvent({
      details: dependencies.buildCliRequestLogDetails(input.c, {
        source: input.sourceKey,
        provider: input.response.source.provider,
        rowCount: input.response.rowCount,
        queryElapsedMs: input.response.elapsedMs,
        truncated: input.response.truncated,
        durationMs: input.durationMs,
      }),
      event: "query.execution.succeeded",
      level: "info",
    });

    if (input.usagePersistence.kind === "usage_persist_failed") {
      dependencies.logCliEvent({
        details: dependencies.buildCliRequestLogDetails(input.c, {
          sourceId: input.usagePersistence.sourceId,
          detail: input.usagePersistence.detail,
        }),
        event: "query.usage_persist_failed",
        level: "warn",
      });
    }
  }

  return {
    logCliQueryExecutionFailure,
    logCliQueryExecutionSuccess,
    logCliQueryValidationAccepted,
    logCliQueryValidationFailure,
  };
}

const cliQueryLogging = createCliQueryLogging();

export const logCliQueryValidationFailure =
  cliQueryLogging.logCliQueryValidationFailure;
export const logCliQueryValidationAccepted =
  cliQueryLogging.logCliQueryValidationAccepted;
export const logCliQueryExecutionFailure =
  cliQueryLogging.logCliQueryExecutionFailure;
export const logCliQueryExecutionSuccess =
  cliQueryLogging.logCliQueryExecutionSuccess;

function getCliQueryFailureHttpStatus(
  result: CliQueryExecutionFailure
): 400 | 404 | 500 | 503 | 504 {
  switch (result.kind) {
    case "source_query_interface_missing":
    case "query_rejected": {
      return 400;
    }
    case "source_not_found": {
      return 404;
    }
    case "query_preparation_failed":
    case "query_execution_failed": {
      return 500;
    }
    case "query_unavailable": {
      return 503;
    }
    case "query_timed_out": {
      return 504;
    }
  }
}
