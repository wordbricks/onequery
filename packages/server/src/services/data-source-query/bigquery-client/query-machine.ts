import { Result } from "better-result";

import { mergeSchemaWithRows } from "./rows";
import { parseJobsQueryResponse } from "./schemas";
import { createRequestId, requestBigQueryJson } from "./transport";
import type {
  BigQueryApiRequest,
  BigQueryJobsQueryResponse,
  BigQueryQueryRequest,
  BigQueryQueryResult,
  BigQueryQuerySummary,
  BigQueryRunnerContext,
} from "./types";

type BigQueryQueryState =
  | {
      kind: "submitting";
      request: BigQueryQueryRequest;
      deadlineMs: number;
    }
  | {
      kind: "awaiting_completion";
      request: BigQueryQueryRequest;
      deadlineMs: number;
      queryId: string;
      summary: BigQueryQuerySummary;
      location?: string;
    }
  | {
      kind: "loading_page";
      request: BigQueryQueryRequest;
      deadlineMs: number;
      summary: BigQueryQuerySummary;
      queryId: string;
      pageToken: string;
    }
  | {
      kind: "completed";
      result: BigQueryQueryResult;
    }
  | {
      kind: "timed_out";
      timeoutMs: number;
    }
  | {
      kind: "failed";
      error: unknown;
    };

type BigQueryQueryEvent =
  | {
      type: "request_succeeded";
      response: BigQueryJobsQueryResponse;
    }
  | {
      type: "request_failed";
      error: unknown;
    };

type BigQueryQueryEffect = BigQueryApiRequest;

export async function runBigQueryQuery(
  input: BigQueryRunnerContext & BigQueryQueryRequest
): Promise<BigQueryQueryResult> {
  const initialState = createBigQueryQueryState({
    query: input.query,
    timeoutMs: input.timeoutMs,
    ...(input.location ? { location: input.location } : {}),
  });

  return runBigQueryQueryStateMachine(initialState, {
    accessTokenPromise: input.accessTokenPromise,
    projectId: input.projectId,
  });
}

async function runBigQueryQueryStateMachine(
  initialState: BigQueryQueryState,
  context: BigQueryRunnerContext
): Promise<BigQueryQueryResult> {
  let state = initialState;

  while (true) {
    if (state.kind === "completed") {
      return state.result;
    }

    if (state.kind === "timed_out") {
      throw createBigQueryQueryTimeoutError(state.timeoutMs);
    }

    if (state.kind === "failed") {
      throw state.error;
    }

    const nowMs = Date.now();
    if (isBigQueryQueryDeadlineExceeded(state, nowMs)) {
      state = {
        kind: "timed_out",
        timeoutMs: state.request.timeoutMs,
      };
      continue;
    }

    const effect = describeBigQueryQueryEffect(state, nowMs);
    const outcome = await Result.tryPromise(async () =>
      parseJobsQueryResponse(
        await requestBigQueryJson({
          ...context,
          ...effect,
        })
      )
    );

    state = outcome.isOk()
      ? reduceBigQueryQueryState(state, {
          response: outcome.value,
          type: "request_succeeded",
        })
      : reduceBigQueryQueryState(state, {
          error: outcome.error,
          type: "request_failed",
        });
  }
}

function createBigQueryQueryState(
  request: BigQueryQueryRequest
): BigQueryQueryState {
  return {
    deadlineMs: Date.now() + request.timeoutMs,
    kind: "submitting",
    request,
  };
}

function reduceBigQueryQueryState(
  state: BigQueryQueryState,
  event: BigQueryQueryEvent
): BigQueryQueryState {
  if (state.kind === "completed" || state.kind === "timed_out") {
    return state;
  }

  if (event.type === "request_failed") {
    return {
      error: event.error,
      kind: "failed",
    };
  }

  if (state.kind === "failed") {
    return state;
  }

  switch (state.kind) {
    case "submitting": {
      if (event.response.jobComplete === false) {
        const queryId = readQueryId(event.response);
        if (!queryId) {
          return {
            kind: "failed",
            error: new Error(
              "BigQuery query response did not include a query identifier."
            ),
          };
        }

        return {
          kind: "awaiting_completion",
          request: state.request,
          deadlineMs: state.deadlineMs,
          queryId,
          summary: mergeBigQueryQuerySummary({
            response: event.response,
            existingSummary: null,
            fallbackLocation: state.request.location,
          }),
          location: resolveQueryLocation(
            event.response,
            state.request.location
          ),
        };
      }

      return advanceBigQueryQueryState({
        request: state.request,
        deadlineMs: state.deadlineMs,
        response: event.response,
        existingSummary: null,
        fallbackLocation: state.request.location,
      });
    }
    case "awaiting_completion": {
      if (event.response.jobComplete === false) {
        return {
          kind: "awaiting_completion",
          request: state.request,
          deadlineMs: state.deadlineMs,
          queryId: readQueryId(event.response) ?? state.queryId,
          summary: mergeBigQueryQuerySummary({
            response: event.response,
            existingSummary: state.summary,
            fallbackLocation: state.location ?? state.request.location,
          }),
          location:
            resolveQueryLocation(
              event.response,
              state.location ?? state.request.location
            ) ?? state.location,
        };
      }

      return advanceBigQueryQueryState({
        request: state.request,
        deadlineMs: state.deadlineMs,
        response: event.response,
        existingSummary: state.summary,
        fallbackLocation: state.location ?? state.request.location,
      });
    }
    case "loading_page": {
      if (event.response.jobComplete === false) {
        return {
          kind: "failed",
          error: new Error("BigQuery pagination response was incomplete."),
        };
      }

      return advanceBigQueryQueryState({
        request: state.request,
        deadlineMs: state.deadlineMs,
        response: event.response,
        existingSummary: state.summary,
        fallbackLocation: state.summary.location ?? state.request.location,
      });
    }
  }
}

function advanceBigQueryQueryState(input: {
  request: BigQueryQueryRequest;
  deadlineMs: number;
  response: BigQueryJobsQueryResponse;
  existingSummary: BigQueryQuerySummary | null;
  fallbackLocation?: string;
}): BigQueryQueryState {
  const summary = mergeBigQueryQuerySummary({
    existingSummary: input.existingSummary,
    fallbackLocation: input.fallbackLocation,
    response: input.response,
  });

  if (input.response.pageToken) {
    const queryId = summary.queryId;
    if (!queryId) {
      return {
        error: new Error(
          "BigQuery query response did not include a query identifier."
        ),
        kind: "failed",
      };
    }

    return {
      deadlineMs: input.deadlineMs,
      kind: "loading_page",
      pageToken: input.response.pageToken,
      queryId,
      request: input.request,
      summary,
    };
  }

  return {
    kind: "completed",
    result: finalizeBigQueryQuerySummary(summary),
  };
}

function mergeBigQueryQuerySummary(input: {
  response: BigQueryJobsQueryResponse;
  existingSummary: BigQueryQuerySummary | null;
  fallbackLocation?: string;
}): BigQueryQuerySummary {
  const priorSummary = input.existingSummary;
  const schema = input.response.schema ?? priorSummary?.schema;
  const rows = [
    ...(priorSummary?.rows ?? []),
    ...mergeSchemaWithRows(schema, input.response.rows),
  ];

  // Comment: BigQuery continuation responses may omit identifiers or stats that
  // were present earlier, or surface a newer identifier shape later in the
  // lifecycle. Preserve prior values only when the current response omits them.
  return {
    cacheHit:
      typeof input.response.cacheHit === "boolean"
        ? input.response.cacheHit
        : priorSummary?.cacheHit,
    jobId: input.response.jobReference?.jobId ?? priorSummary?.jobId,
    location: resolveQueryLocation(
      input.response,
      priorSummary?.location ?? input.fallbackLocation
    ),
    queryId: readQueryId(input.response) ?? priorSummary?.queryId,
    rows,
    schema,
    totalBytesBilled:
      input.response.totalBytesBilled ?? priorSummary?.totalBytesBilled,
    totalBytesProcessed:
      input.response.totalBytesProcessed ?? priorSummary?.totalBytesProcessed,
  };
}

function finalizeBigQueryQuerySummary(
  summary: BigQueryQuerySummary
): BigQueryQueryResult {
  return {
    cacheHit: summary.cacheHit,
    jobId: summary.jobId,
    location: summary.location,
    rows: summary.rows,
    totalBytesBilled: summary.totalBytesBilled,
    totalBytesProcessed: summary.totalBytesProcessed,
  };
}

function describeBigQueryQueryEffect(
  state: Exclude<
    BigQueryQueryState,
    { kind: "completed" } | { kind: "timed_out" } | { kind: "failed" }
  >,
  nowMs: number
): BigQueryQueryEffect {
  const timeoutMs = resolveBigQueryQueryEffectTimeoutMs(
    state.deadlineMs,
    nowMs
  );

  switch (state.kind) {
    case "submitting": {
      return {
        path: "/queries",
        method: "POST",
        timeoutMs,
        body: {
          query: state.request.query,
          useLegacySql: false,
          timeoutMs,
          formatOptions: {
            useInt64Timestamp: true,
          },
          requestId: createRequestId(),
          ...(state.request.location
            ? { location: state.request.location }
            : {}),
        },
      };
    }
    case "awaiting_completion": {
      return {
        path: `/queries/${state.queryId}`,
        timeoutMs,
        query: {
          timeoutMs: String(timeoutMs),
          "formatOptions.useInt64Timestamp": "true",
          ...(state.location ? { location: state.location } : {}),
        },
      };
    }
    case "loading_page": {
      return {
        path: `/queries/${state.queryId}`,
        timeoutMs,
        query: {
          pageToken: state.pageToken,
          timeoutMs: String(timeoutMs),
          "formatOptions.useInt64Timestamp": "true",
          ...(state.summary.location
            ? { location: state.summary.location }
            : {}),
        },
      };
    }
  }
}

function createBigQueryQueryTimeoutError(timeoutMs: number): Error {
  const timeoutError = new Error(
    `BigQuery query did not complete before ${timeoutMs}ms.`
  );
  Object.assign(timeoutError, { code: "ETIMEDOUT" });
  return timeoutError;
}

function isBigQueryQueryDeadlineExceeded(
  state: Extract<
    BigQueryQueryState,
    | { kind: "submitting" }
    | { kind: "awaiting_completion" }
    | { kind: "loading_page" }
  >,
  nowMs: number
): boolean {
  return nowMs >= state.deadlineMs;
}

function resolveBigQueryQueryEffectTimeoutMs(
  deadlineMs: number,
  nowMs: number
): number {
  return Math.max(1, deadlineMs - nowMs);
}

function readQueryId(response: BigQueryJobsQueryResponse): string | undefined {
  // Comment: BigQuery identifies the same query through either `queryId` or
  // `jobReference.jobId` depending on the endpoint. Treat them as one key.
  return response.jobReference?.jobId ?? response.queryId;
}

function resolveQueryLocation(
  response: BigQueryJobsQueryResponse,
  fallbackLocation: string | undefined
): string | undefined {
  return (
    response.jobReference?.location ?? response.location ?? fallbackLocation
  );
}
