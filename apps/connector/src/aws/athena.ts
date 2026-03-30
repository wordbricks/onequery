import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";

import type { AthenaQuerySuccessResult, ConnectorErrorCode } from "../types";
import { sleep, toErrorMessage } from "../utils";

const ATHENA_POLL_INTERVAL_MS = 1000;

type AthenaExecutorConfig = {
  region: string;
  defaultDatabase: string;
  defaultWorkgroup: string;
  outputLocation: string;
  queryTimeoutMs: number;
  maxRows: number;
  maxPayloadBytes: number;
};

type AthenaQueryRequest = {
  jobId: string;
  sql: string;
  database?: string;
  workgroup?: string;
  timeoutMs?: number;
  maxRows?: number;
};

export class AthenaQueryExecutionError extends Error {
  readonly code: ConnectorErrorCode;

  constructor(input: { code: ConnectorErrorCode; message: string }) {
    super(input.message);
    this.name = "AthenaQueryExecutionError";
    this.code = input.code;
  }
}

export class AthenaExecutor {
  readonly #client: AthenaClient;
  readonly #config: AthenaExecutorConfig;

  constructor(config: AthenaExecutorConfig) {
    this.#config = config;
    this.#client = new AthenaClient({ region: config.region });
  }

  async executeQuery(
    input: AthenaQueryRequest
  ): Promise<AthenaQuerySuccessResult> {
    const resolvedTimeoutMs = resolveTimeoutMs(
      input.timeoutMs,
      this.#config.queryTimeoutMs
    );
    const resolvedMaxRows = resolveMaxRows(input.maxRows, this.#config.maxRows);

    try {
      const startedAtMs = Date.now();
      const queryExecutionId = await this.#startQueryExecution(input);
      const completedExecution = await this.#waitForQueryCompletion({
        queryExecutionId,
        timeoutMs: resolvedTimeoutMs,
      });

      const { columns, rows } = await this.#fetchRows({
        jobId: input.jobId,
        maxRows: resolvedMaxRows,
        queryExecutionId,
      });

      const executionTimeMs =
        completedExecution?.Statistics?.EngineExecutionTimeInMillis ??
        Date.now() - startedAtMs;
      const stats = {
        dataScannedBytes: normalizeAthenaStatistic(
          completedExecution?.Statistics?.DataScannedInBytes
        ),
        executionTimeMs,
        queryExecutionId,
        rowCount: rows.length,
      };

      const payload = {
        columns,
        jobId: input.jobId,
        rows,
        stats,
        status: "success",
      } satisfies AthenaQuerySuccessResult;

      assertPayloadSizeWithinLimit(payload, this.#config.maxPayloadBytes);
      return payload;
    } catch (error) {
      if (error instanceof AthenaQueryExecutionError) {
        throw error;
      }

      throw mapAthenaError(error);
    }
  }

  async #startQueryExecution(input: AthenaQueryRequest): Promise<string> {
    const response = await this.#client.send(
      new StartQueryExecutionCommand({
        QueryExecutionContext: {
          Database: input.database ?? this.#config.defaultDatabase,
        },
        QueryString: input.sql,
        ResultConfiguration: {
          OutputLocation: this.#config.outputLocation,
        },
        WorkGroup: input.workgroup ?? this.#config.defaultWorkgroup,
      })
    );

    const queryExecutionId = response.QueryExecutionId;
    if (!queryExecutionId) {
      throw new AthenaQueryExecutionError({
        code: "QUERY_FAILED",
        message: "Athena did not return a QueryExecutionId",
      });
    }

    return queryExecutionId;
  }

  async #waitForQueryCompletion(input: {
    queryExecutionId: string;
    timeoutMs: number;
  }) {
    const deadlineMs = Date.now() + input.timeoutMs;

    while (Date.now() < deadlineMs) {
      const response = await this.#client.send(
        new GetQueryExecutionCommand({
          QueryExecutionId: input.queryExecutionId,
        })
      );

      const execution = response.QueryExecution;
      const state = execution?.Status?.State;
      if (state === "SUCCEEDED") {
        return execution;
      }

      if (state === "FAILED" || state === "CANCELLED") {
        throw new AthenaQueryExecutionError({
          code: "QUERY_FAILED",
          message:
            execution?.Status?.StateChangeReason ??
            `Athena query ended with state ${state}`,
        });
      }

      await sleep(ATHENA_POLL_INTERVAL_MS);
    }

    throw new AthenaQueryExecutionError({
      code: "QUERY_TIMEOUT",
      message: `Athena query timed out after ${input.timeoutMs}ms`,
    });
  }

  async #fetchRows(input: {
    queryExecutionId: string;
    maxRows: number;
    jobId: string;
  }): Promise<{
    columns: { name: string; type: string }[];
    rows: string[][];
  }> {
    let nextToken: string | undefined;
    const rows: string[][] = [];
    let columns: { name: string; type: string }[] = [];
    let isFirstPage = true;

    do {
      const response = await this.#client.send(
        new GetQueryResultsCommand({
          MaxResults: 1_000,
          NextToken: nextToken,
          QueryExecutionId: input.queryExecutionId,
        })
      );

      if (columns.length === 0) {
        columns =
          response.ResultSet?.ResultSetMetadata?.ColumnInfo?.map((column) => ({
            name: column.Name ?? "unknown",
            type: column.Type ?? "unknown",
          })) ?? [];
      }

      const pageRows = response.ResultSet?.Rows ?? [];
      for (const row of pageRows) {
        const values = (row.Data ?? []).map((cell) => cell.VarCharValue ?? "");
        if (isFirstPage && isHeaderRow(values, columns)) {
          isFirstPage = false;
          continue;
        }

        isFirstPage = false;
        rows.push(values);

        if (rows.length >= input.maxRows) {
          break;
        }
      }

      if (rows.length >= input.maxRows) {
        break;
      }

      nextToken = response.NextToken;
    } while (nextToken);

    const payloadPreview = {
      columns,
      jobId: input.jobId,
      rows,
      status: "success",
    } satisfies Omit<AthenaQuerySuccessResult, "stats">;
    assertPayloadSizeWithinLimit(payloadPreview, this.#config.maxPayloadBytes);

    return { columns, rows };
  }
}

function resolveTimeoutMs(
  jobTimeoutMs: number | undefined,
  defaultTimeoutMs: number
): number {
  if (
    typeof jobTimeoutMs !== "number" ||
    !Number.isFinite(jobTimeoutMs) ||
    jobTimeoutMs <= 0
  ) {
    return defaultTimeoutMs;
  }

  const rounded = Math.trunc(jobTimeoutMs);
  return Math.min(rounded, defaultTimeoutMs);
}

function resolveMaxRows(
  jobMaxRows: number | undefined,
  defaultMaxRows: number
): number {
  if (
    typeof jobMaxRows !== "number" ||
    !Number.isFinite(jobMaxRows) ||
    jobMaxRows <= 0
  ) {
    return defaultMaxRows;
  }

  const rounded = Math.trunc(jobMaxRows);
  return Math.min(rounded, defaultMaxRows);
}

function normalizeAthenaStatistic(
  value: number | undefined
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.trunc(value).toString();
}

function isHeaderRow(
  values: string[],
  columns: { name: string; type: string }[]
): boolean {
  if (values.length !== columns.length || columns.length === 0) {
    return false;
  }

  return values.every((value, index) => {
    const column = columns[index];
    if (!column) {
      return false;
    }
    return value === column.name;
  });
}

function assertPayloadSizeWithinLimit(
  payload: unknown,
  maxPayloadBytes: number
): void {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (payloadBytes > maxPayloadBytes) {
    throw new AthenaQueryExecutionError({
      code: "RESULT_TOO_LARGE",
      message: `Result payload exceeded ${maxPayloadBytes} bytes`,
    });
  }
}

function mapAthenaError(error: unknown): AthenaQueryExecutionError {
  const message = toErrorMessage(error);
  const name = readErrorName(error);

  if (name.includes("AccessDenied") || /access denied/i.test(message)) {
    return new AthenaQueryExecutionError({
      code: "AWS_ACCESS_DENIED",
      message,
    });
  }

  if (/expiredtoken|invalidsignature|security token/i.test(message)) {
    return new AthenaQueryExecutionError({
      code: "AUTH_FAILED",
      message,
    });
  }

  return new AthenaQueryExecutionError({
    code: "QUERY_FAILED",
    message,
  });
}

function readErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  if (isRecord(error) && typeof error.name === "string") {
    return error.name;
  }

  return "UnknownError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
