import { isRecord } from "@onequery/base";
import { z } from "zod";

import type {
  BigQueryDatasetsListResponse,
  BigQueryJobReference,
  BigQueryJobsInsertResponse,
  BigQueryJobsQueryResponse,
  BigQueryRow,
  BigQueryRowField,
  BigQuerySchemaField,
  BigQueryTableSchema,
} from "./types";

const BigQueryRowFieldSchema: z.ZodType<BigQueryRowField> = z
  .object({
    v: z.unknown().optional(),
  })
  .passthrough();

const BigQueryRowSchema: z.ZodType<BigQueryRow> = z
  .object({
    f: z.array(BigQueryRowFieldSchema).optional(),
  })
  .passthrough();

const BigQuerySchemaFieldSchema: z.ZodType<BigQuerySchemaField> = z.lazy(() =>
  z
    .object({
      fields: z.array(BigQuerySchemaFieldSchema).optional(),
      mode: z.string().optional(),
      name: z.string().optional(),
      type: z.string().optional(),
    })
    .passthrough()
);

const BigQueryTableSchemaSchema: z.ZodType<BigQueryTableSchema> = z
  .object({
    fields: z.array(BigQuerySchemaFieldSchema).optional(),
  })
  .passthrough();

const BigQueryJobReferenceSchema: z.ZodType<BigQueryJobReference> = z
  .object({
    jobId: z.string().optional(),
    location: z.string().optional(),
  })
  .passthrough();

const BigQueryJobsQueryResponseSchema: z.ZodType<BigQueryJobsQueryResponse> = z
  .object({
    cacheHit: z.boolean().optional(),
    jobComplete: z.boolean().optional(),
    jobReference: BigQueryJobReferenceSchema.optional(),
    location: z.string().optional(),
    pageToken: z.string().optional(),
    queryId: z.string().optional(),
    rows: z.array(BigQueryRowSchema).optional(),
    schema: BigQueryTableSchemaSchema.optional(),
    totalBytesBilled: z.string().optional(),
    totalBytesProcessed: z.string().optional(),
  })
  .passthrough();

const BigQueryJobsInsertStatisticsSchema = z
  .object({
    query: z
      .object({
        totalBytesProcessed: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const BigQueryJobsInsertResponseSchema: z.ZodType<BigQueryJobsInsertResponse> =
  z
    .object({
      jobReference: BigQueryJobReferenceSchema.optional(),
      statistics: BigQueryJobsInsertStatisticsSchema.optional(),
    })
    .passthrough();

const BigQueryDatasetsListResponseSchema: z.ZodType<BigQueryDatasetsListResponse> =
  z
    .object({
      datasets: z.array(z.unknown()).optional(),
      nextPageToken: z.string().optional(),
    })
    .passthrough();

const BigQueryErrorPayloadSchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        status: z.string().optional(),
      })
      .passthrough()
      .optional(),
    message: z.string().optional(),
  })
  .passthrough();

function parseBigQueryResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  objectMessage: string,
  shapeMessage: string
): T {
  if (!isRecord(value)) {
    throw new Error(objectMessage);
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(shapeMessage);
  }

  return result.data;
}

export function parseJobsQueryResponse(
  value: unknown
): BigQueryJobsQueryResponse {
  return parseBigQueryResponse(
    BigQueryJobsQueryResponseSchema,
    value,
    "BigQuery query response was not an object.",
    "BigQuery query response had an unexpected shape."
  );
}

export function parseJobsInsertResponse(
  value: unknown
): BigQueryJobsInsertResponse {
  return parseBigQueryResponse(
    BigQueryJobsInsertResponseSchema,
    value,
    "BigQuery dry run response was not an object.",
    "BigQuery dry run response had an unexpected shape."
  );
}

export function parseDatasetsListResponse(
  value: unknown
): BigQueryDatasetsListResponse {
  return parseBigQueryResponse(
    BigQueryDatasetsListResponseSchema,
    value,
    "BigQuery datasets response was not an object.",
    "BigQuery datasets response had an unexpected shape."
  );
}

export function readBigQueryErrorMessage(body: unknown): string | null {
  const result = BigQueryErrorPayloadSchema.safeParse(body);
  if (!result.success) {
    return null;
  }

  const message = result.data.error?.message ?? result.data.message ?? null;
  if (!message) {
    return null;
  }

  const status = result.data.error?.status;
  return status ? `${status}: ${message}` : message;
}
