import { isRecord } from "@onequery/base";
import type { BigQueryCredentials } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import { createBigQueryClient } from "./bigquery-client";

export type BigQueryDatasetInfo = {
  id: string;
  location?: string;
};

class BigQueryDatasetLookupError extends TaggedError(
  "BigQueryDatasetLookupError"
)<{
  message: string;
  cause?: unknown;
}>() {}

export async function listBigQueryDatasets(
  credentials: BigQueryCredentials
): Promise<ResultType<BigQueryDatasetInfo[], BigQueryDatasetLookupError>> {
  const datasetsOutcome = await Result.tryPromise({
    try: async () => {
      const bigquery = await createBigQueryClient(credentials);
      return bigquery.listDatasets();
    },
    catch: (cause) =>
      new BigQueryDatasetLookupError({
        cause,
        message: toErrorMessage(cause),
      }),
  });

  if (datasetsOutcome.isErr()) {
    return Result.err(datasetsOutcome.error);
  }

  const datasets = datasetsOutcome.value
    .map((dataset) => toDatasetInfo(dataset))
    .filter((dataset): dataset is BigQueryDatasetInfo => dataset !== null);

  return Result.ok(dedupeDatasetInfos(datasets));
}

export async function listBigQueryDatasetIds(
  credentials: BigQueryCredentials
): Promise<ResultType<string[], BigQueryDatasetLookupError>> {
  const datasetsOutcome = await listBigQueryDatasets(credentials);
  if (datasetsOutcome.isErr()) {
    return Result.err(datasetsOutcome.error);
  }

  return Result.ok(datasetsOutcome.value.map((dataset) => dataset.id));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function normalizeDatasetId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const colonIndex = trimmed.lastIndexOf(":");
  const dotIndex = trimmed.lastIndexOf(".");
  const splitIndex = Math.max(colonIndex, dotIndex);
  if (splitIndex >= 0) {
    return trimmed.slice(splitIndex + 1);
  }

  return trimmed;
}

function readDatasetLocation(
  dataset: Record<string, unknown>
): string | undefined {
  const directLocation =
    typeof dataset.location === "string" ? dataset.location : undefined;
  if (directLocation) {
    return directLocation;
  }

  const metadata = isRecord(dataset.metadata) ? dataset.metadata : null;
  if (!metadata) {
    return undefined;
  }

  const metadataLocation =
    typeof metadata.location === "string" ? metadata.location : undefined;
  return metadataLocation;
}

function toDatasetInfo(dataset: unknown): BigQueryDatasetInfo | null {
  if (!isRecord(dataset)) {
    return null;
  }

  const rawId =
    typeof dataset.id === "string"
      ? dataset.id
      : isRecord(dataset.datasetReference) &&
          typeof dataset.datasetReference.datasetId === "string"
        ? dataset.datasetReference.datasetId
        : null;
  if (typeof rawId !== "string") {
    return null;
  }

  const id = normalizeDatasetId(rawId);
  if (id.length === 0) {
    return null;
  }

  const location = readDatasetLocation(dataset);
  return location ? { id, location } : { id };
}

function dedupeDatasetInfos(
  datasets: BigQueryDatasetInfo[]
): BigQueryDatasetInfo[] {
  const byId = new Map<string, BigQueryDatasetInfo>();
  datasets.forEach((dataset) => {
    const existing = byId.get(dataset.id);
    if (!existing) {
      byId.set(dataset.id, dataset);
      return;
    }

    if (existing.location) {
      return;
    }

    if (dataset.location) {
      byId.set(dataset.id, dataset);
    }
  });

  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}
