import { Result } from "better-result";

import { parseDatasetsListResponse } from "./schemas";
import { requestBigQueryJson } from "./transport";
import type {
  BigQueryApiRequest,
  BigQueryDatasetsListResponse,
  BigQueryRunnerContext,
} from "./types";

type BigQueryDatasetState =
  | {
      kind: "loading_page";
      datasets: unknown[];
      pageToken?: string;
    }
  | {
      kind: "completed";
      datasets: unknown[];
    }
  | {
      kind: "failed";
      error: unknown;
    };

type BigQueryDatasetEvent =
  | {
      type: "page_loaded";
      response: BigQueryDatasetsListResponse;
    }
  | {
      type: "request_failed";
      error: unknown;
    };

type BigQueryDatasetEffect = Pick<BigQueryApiRequest, "path" | "query">;

export async function listProjectDatasets(
  input: BigQueryRunnerContext
): Promise<unknown[]> {
  let state = createBigQueryDatasetState();

  while (true) {
    if (state.kind === "completed") {
      return state.datasets;
    }

    if (state.kind === "failed") {
      throw state.error;
    }

    const effect = describeBigQueryDatasetEffect(state);
    const outcome = await Result.tryPromise(async () =>
      parseDatasetsListResponse(
        await requestBigQueryJson({
          accessTokenPromise: input.accessTokenPromise,
          projectId: input.projectId,
          ...effect,
        })
      )
    );

    state = outcome.isOk()
      ? reduceBigQueryDatasetState(state, {
          response: outcome.value,
          type: "page_loaded",
        })
      : reduceBigQueryDatasetState(state, {
          error: outcome.error,
          type: "request_failed",
        });
  }
}

function createBigQueryDatasetState(): BigQueryDatasetState {
  return {
    datasets: [],
    kind: "loading_page",
  };
}

function reduceBigQueryDatasetState(
  state: BigQueryDatasetState,
  event: BigQueryDatasetEvent
): BigQueryDatasetState {
  if (state.kind === "completed" || state.kind === "failed") {
    return state;
  }

  if (event.type === "request_failed") {
    return {
      error: event.error,
      kind: "failed",
    };
  }

  const datasets = [
    ...state.datasets,
    ...(Array.isArray(event.response.datasets) ? event.response.datasets : []),
  ];

  if (event.response.nextPageToken) {
    return {
      datasets,
      kind: "loading_page",
      pageToken: event.response.nextPageToken,
    };
  }

  return {
    datasets,
    kind: "completed",
  };
}

function describeBigQueryDatasetEffect(
  state: Extract<BigQueryDatasetState, { kind: "loading_page" }>
): BigQueryDatasetEffect {
  return {
    path: "/datasets",
    query: {
      all: "true",
      ...(state.pageToken ? { pageToken: state.pageToken } : {}),
    },
  };
}
