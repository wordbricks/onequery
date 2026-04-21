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

export function logCliQueryValidationFailure(
  c: Parameters<typeof buildCliRequestLogDetails>[0],
  sourceKey: string,
  result: CliQueryValidationFailure
) {
  switch (result.kind) {
    case "source_not_found": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_found",
        details: buildCliRequestLogDetails(c, {
          orgSlug: result.orgSlug,
          source: sourceKey,
          httpStatus: 404,
        }),
      });
      return;
    }
    case "source_not_queryable": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_queryable",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          provider: result.provider,
          sourceStatus: result.status,
          httpStatus: 400,
        }),
      });
      return;
    }
    case "query_rejected": {
      logCliEvent({
        level: "warn",
        event: "query.plan.rejected",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          detail: result.detail,
          httpStatus: 400,
        }),
      });
      return;
    }
    case "query_preparation_failed": {
      logCliEvent({
        level: "warn",
        event: "query.plan.preparation_failed",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          detail: result.detail,
          hint: result.hint,
          httpStatus: 500,
        }),
      });
    }
  }
}

export function logCliQueryValidationAccepted(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  provider: ProviderType;
  sourceKey: string;
  truncated: boolean;
}) {
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.provider,
      truncated: input.truncated,
    }),
    event: "query.plan.accepted",
    level: "info",
  });
}

export function logCliQueryExecutionFailure(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  durationMs: number;
  result: CliQueryExecutionFailure;
  sourceKey: string;
}) {
  const httpStatus = getCliQueryFailureHttpStatus(input.result);

  switch (input.result.kind) {
    case "source_not_found": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_found",
        details: buildCliRequestLogDetails(input.c, {
          orgSlug: input.result.orgSlug,
          source: input.sourceKey,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "source_not_queryable": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_queryable",
        details: buildCliRequestLogDetails(input.c, {
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
      logCliEvent({
        level: "warn",
        event: "query.plan.rejected",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "query_preparation_failed": {
      logCliEvent({
        level: "warn",
        event: "query.plan.preparation_failed",
        details: buildCliRequestLogDetails(input.c, {
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
      recordCliCounterMetric({
        name: "cli.query.retryable_total",
        tags: {
          outcome: input.result.kind,
        },
      });
      logCliEvent({
        level: "warn",
        event: "query.execution.unavailable",
        details: buildCliRequestLogDetails(input.c, {
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
      recordCliCounterMetric({
        name: "cli.query.timeout_total",
      });
      recordCliCounterMetric({
        name: "cli.query.retryable_total",
        tags: {
          outcome: input.result.kind,
        },
      });
      logCliEvent({
        level: "warn",
        event: "query.execution.timed_out",
        details: buildCliRequestLogDetails(input.c, {
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
      logCliEvent({
        level: "warn",
        event: "query.execution.failed",
        details: buildCliRequestLogDetails(input.c, {
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

export function logCliQueryExecutionSuccess(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  durationMs: number;
  response: Pick<
    CliQueryExecutionSuccess["response"],
    "source" | "rowCount" | "elapsedMs" | "truncated"
  >;
  sourceKey: string;
  usagePersistence: CliQueryExecutionSuccess["usagePersistence"];
}) {
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.response.source.provider,
      truncated: input.response.truncated,
      durationMs: input.durationMs,
    }),
    event: "query.plan.accepted",
    level: "info",
  });
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.response.source.provider,
      rowCount: input.response.rowCount,
      queryElapsedMs: input.response.elapsedMs,
      durationMs: input.durationMs,
    }),
    event: "query.execution.succeeded",
    level: "info",
  });

  if (input.usagePersistence.kind === "usage_persist_failed") {
    logCliEvent({
      details: buildCliRequestLogDetails(input.c, {
        sourceId: input.usagePersistence.sourceId,
        detail: input.usagePersistence.detail,
      }),
      event: "query.usage_persist_failed",
      level: "warn",
    });
  }
}

function getCliQueryFailureHttpStatus(
  result: CliQueryExecutionFailure
): 400 | 404 | 500 | 503 | 504 {
  switch (result.kind) {
    case "source_not_queryable":
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
