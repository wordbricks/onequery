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

const BigQueryRowFieldSchema: z.ZodType<BigQueryRowField> = z.looseObject({
  v: z.unknown().optional(),
});

const BigQueryRowSchema: z.ZodType<BigQueryRow> = z.looseObject({
  f: z.array(BigQueryRowFieldSchema).optional(),
});

const BigQuerySchemaFieldSchema: z.ZodType<BigQuerySchemaField> = z.lazy(() =>
  z.looseObject({
    fields: z.array(BigQuerySchemaFieldSchema).optional(),
    mode: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
  })
);

const BigQueryTableSchemaSchema: z.ZodType<BigQueryTableSchema> = z.looseObject(
  {
    fields: z.array(BigQuerySchemaFieldSchema).optional(),
  }
);

const BigQueryJobReferenceSchema: z.ZodType<BigQueryJobReference> =
  z.looseObject({
    jobId: z.string().optional(),
    location: z.string().optional(),
  });

const BigQueryJobsQueryResponseSchema: z.ZodType<BigQueryJobsQueryResponse> =
  z.looseObject({
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
  });

const BigQueryJobsInsertStatisticsSchema = z.looseObject({
  query: z
    .looseObject({
      totalBytesProcessed: z.string().optional(),
    })
    .optional(),
});

const BigQueryJobsInsertResponseSchema: z.ZodType<BigQueryJobsInsertResponse> =
  z.looseObject({
    jobReference: BigQueryJobReferenceSchema.optional(),
    statistics: BigQueryJobsInsertStatisticsSchema.optional(),
  });

const BigQueryDatasetsListResponseSchema: z.ZodType<BigQueryDatasetsListResponse> =
  z.looseObject({
    datasets: z.array(z.unknown()).optional(),
    nextPageToken: z.string().optional(),
  });

const BigQueryErrorPayloadSchema = z.looseObject({
  error: z
    .looseObject({
      message: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  message: z.string().optional(),
});

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
