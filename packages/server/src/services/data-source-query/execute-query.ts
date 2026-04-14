import { isRecord } from "@onequery/base";
import type {
  BigQueryCredentials,
  ConnectorCredentials,
  Database,
  DatabaseCredentials,
  LaminarCredentials,
  MySQLCredentials,
  PostgresCredentials,
} from "@onequery/db/server";

import {
  ConnectorJobTimeoutError,
  queueConnectorAthenaJob,
} from "../connectors/broker";
import type { ConnectorAthenaJobOutcome } from "../connectors/broker";
import { MAX_PROVIDER_ERROR_DETAIL_LENGTH } from "../provider-http";
import {
  calculateAthenaUsd,
  resolveAthenaPricingModel,
} from "./athena-pricing";
import type { AthenaPricingModel } from "./athena-pricing";
import { createBigQueryClient } from "./bigquery-client";
import {
  calculateBigQueryOnDemandUsd,
  resolveBigQueryPricingModel,
} from "./bigquery-pricing";
import type { BigQueryPricingModel } from "./bigquery-pricing";
import {
  buildPostgresClientConfig,
  isTlsVerificationError,
  resolveInitialPostgresTransportState,
  resolvePostgresFailureTransitions,
} from "./postgres-transport";
import type { PostgresClientConfig } from "./postgres-transport";
import { MAX_LIMIT, validateAndNormalizeReadOnlyQuery } from "./validate-sql";

const DEFAULT_LAMINAR_API_BASE_URL = "https://api.lmnr.ai";
export const QUERY_TIMEOUT_MS = 10_000;
const MAX_QUERY_TIMEOUT_MS = 60_000;
const CONNECTOR_RESULT_TIMEOUT_BUFFER_MS = 2000;
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
]);
const TRANSIENT_BIGQUERY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

type MySQLSslConfig = { rejectUnauthorized: boolean } | undefined;
type BigQueryQueryOptions = {
  timeoutMs?: number | null;
  location?: string;
};
type BigQueryRestQuery = {
  query: string;
  timeoutMs: number;
  maxResults: number;
  location?: string;
};

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export type BigQueryQueryExecutionStats = {
  provider: "bigquery";
  estimatedProcessedBytes: bigint | null;
  actualProcessedBytes: bigint | null;
  billableBytes: bigint | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  currency: "USD";
  pricingModel: BigQueryPricingModel;
  jobId?: string;
  location?: string;
  cacheHit?: boolean;
};

export type AthenaConnectorQueryExecutionStats = {
  provider: "aws_athena_connector";
  billableBytes: bigint | null;
  actualCostUsd: number | null;
  currency: "USD";
  pricingModel: AthenaPricingModel;
  connectorId: string;
  connectorJobId: string;
  athenaQueryExecutionId?: string;
  database: string;
  workgroup?: string;
  executionTimeMs?: number;
  rowCount?: number;
};

export type DatabaseQueryExecutionStats =
  | BigQueryQueryExecutionStats
  | AthenaConnectorQueryExecutionStats;

export type DatabaseQueryExecution = {
  rows: Record<string, unknown>[];
  stats?: DatabaseQueryExecutionStats;
};

export class DataSourceQueryExecutionError extends Error {
  readonly retryable: boolean;
  readonly timedOut: boolean;

  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      timedOut?: boolean;
    }
  ) {
    super(message);
    this.name = "DataSourceQueryExecutionError";
    this.retryable = options?.retryable ?? false;
    this.timedOut = options?.timedOut ?? false;
  }
}

export function resolveQueryTimeoutMs(
  clientTimeoutMs: number | null | undefined
): number {
  if (
    typeof clientTimeoutMs !== "number" ||
    !Number.isFinite(clientTimeoutMs) ||
    clientTimeoutMs <= 0
  ) {
    return QUERY_TIMEOUT_MS;
  }

  const rounded = Math.trunc(clientTimeoutMs);
  return Math.min(Math.max(rounded, 1000), MAX_QUERY_TIMEOUT_MS);
}

export async function executeDatabaseQuery(input: {
  credentials: DatabaseCredentials;
  sql: string;
  timeoutMs?: number | null;
  organizationId?: string;
  db?: Database;
}): Promise<Record<string, unknown>[]> {
  const result = await executeDatabaseQueryInternal(input, {
    includeStats: false,
  });
  return result.rows;
}

export async function executeDatabaseQueryWithStats(input: {
  credentials: DatabaseCredentials;
  sql: string;
  timeoutMs?: number | null;
  organizationId?: string;
  db?: Database;
}): Promise<DatabaseQueryExecution> {
  return executeDatabaseQueryInternal(input, {
    includeStats: true,
  });
}

async function executeDatabaseQueryInternal(
  input: {
    credentials: DatabaseCredentials;
    sql: string;
    timeoutMs?: number | null;
    organizationId?: string;
    db?: Database;
  },
  options: {
    includeStats: boolean;
  }
): Promise<DatabaseQueryExecution> {
  const timeoutMs = resolveQueryTimeoutMs(input.timeoutMs);
  const normalizedSql = await validateSqlForExecution(
    input.sql,
    input.credentials.type
  );

  try {
    if (input.credentials.type === "postgres") {
      return {
        rows: await executePostgresQuery(
          input.credentials,
          normalizedSql,
          timeoutMs
        ),
      };
    }

    if (input.credentials.type === "mysql") {
      return {
        rows: await executeMySQLQuery(
          input.credentials,
          normalizedSql,
          timeoutMs
        ),
      };
    }

    if (input.credentials.type === "bigquery") {
      if (options.includeStats) {
        return await executeBigQueryQueryWithStats(
          input.credentials,
          normalizedSql,
          {
            timeoutMs,
          }
        );
      }

      return {
        rows: await executeBigQueryQuery(input.credentials, normalizedSql, {
          timeoutMs,
        }),
      };
    }

    if (input.credentials.type === "aws_athena_connector") {
      if (!input.organizationId) {
        throw new DataSourceQueryExecutionError(
          "Organization ID is required for connector queries."
        );
      }

      if (options.includeStats) {
        return await executeConnectorQueryWithStats(
          input.credentials,
          normalizedSql,
          {
            db: input.db,
            organizationId: input.organizationId,
            timeoutMs,
          }
        );
      }

      return {
        rows: await executeConnectorQuery(input.credentials, normalizedSql, {
          db: input.db,
          organizationId: input.organizationId,
          timeoutMs,
        }),
      };
    }

    return {
      rows: await executeLaminarQuery(
        input.credentials,
        normalizedSql,
        timeoutMs
      ),
    };
  } catch (error) {
    throw toExecutionError(error);
  }
}

async function validateSqlForExecution(
  sql: string,
  provider: DatabaseCredentials["type"]
): Promise<string> {
  const validation = await validateAndNormalizeReadOnlyQuery(sql, provider);
  if (validation.isErr()) {
    throw new DataSourceQueryExecutionError(validation.error.message, {
      retryable: false,
      timedOut: false,
    });
  }

  return validation.value.sql;
}

function normalizeRecordRows(
  source: string,
  rows: unknown
): Record<string, unknown>[] {
  if (!Array.isArray(rows)) {
    throw new TypeError(`${source} query did not return rows.`);
  }

  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`${source} row ${index + 1} is not an object.`);
    }

    return row;
  });
}

function buildBigQueryQueryOptions(input: {
  query: string;
  timeoutMs: number;
  location?: string;
}): BigQueryRestQuery {
  const base: BigQueryRestQuery = {
    maxResults: MAX_LIMIT,
    query: input.query,
    timeoutMs: input.timeoutMs,
  };

  const location = normalizeBigQueryLocation(input.location);
  if (!location) {
    return base;
  }

  return {
    ...base,
    location,
  };
}

function normalizeBigQueryLocation(
  location: string | undefined
): string | undefined {
  if (location === undefined) {
    return undefined;
  }

  const normalized = location.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (
    normalized.length > 128 ||
    hasControlCharacters(normalized) ||
    !/^[A-Za-z0-9_-]+$/u.test(normalized)
  ) {
    throw new DataSourceQueryExecutionError("BigQuery location is invalid");
  }
  return normalized;
}

function parseIntegerString(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value !== "string" || !/^-?\d+$/u.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function runBigQueryDryRun(
  bigquery: Awaited<ReturnType<typeof createBigQueryClient>>,
  options: BigQueryRestQuery
): Promise<bigint | null> {
  return bigquery
    .runDryRun(options)
    .then((totalBytesProcessed) => parseIntegerString(totalBytesProcessed))
    .catch((error: unknown) => {
      console.warn("[query-database] BigQuery dry run failed", {
        error: toErrorMessage(error),
      });
      return null;
    });
}

async function executeBigQueryJob(
  bigquery: Awaited<ReturnType<typeof createBigQueryClient>>,
  queryOptions: BigQueryRestQuery
): Promise<DatabaseQueryExecution> {
  const execution = await bigquery.runQuery(queryOptions);
  const rows = normalizeRecordRows("BigQuery", execution.rows);
  const actualProcessedBytes = parseIntegerString(
    execution.totalBytesProcessed
  );
  const billableBytes = parseIntegerString(execution.totalBytesBilled);
  const pricingModel = resolveBigQueryPricingModel(billableBytes);

  return {
    rows,
    stats: {
      actualCostUsd:
        pricingModel === "on_demand"
          ? calculateBigQueryOnDemandUsd(billableBytes)
          : null,
      actualProcessedBytes,
      billableBytes,
      cacheHit: execution.cacheHit,
      currency: "USD",
      estimatedCostUsd: null,
      estimatedProcessedBytes: null,
      jobId: execution.jobId,
      location: execution.location ?? queryOptions.location,
      pricingModel,
      provider: "bigquery",
    },
  };
}

type NegotiatedSslMode =
  | PostgresCredentials["sslMode"]
  | MySQLCredentials["sslMode"];

function shouldUseSsl(sslMode: NegotiatedSslMode): boolean {
  return sslMode !== "disable";
}

function shouldFallbackToPlaintext(sslMode: NegotiatedSslMode): boolean {
  return sslMode === "prefer";
}

type PostgresQueryRunner = (
  config: PostgresClientConfig,
  query: string
) => Promise<Record<string, unknown>[]>;

async function runPostgresQuery(
  pg: typeof import("pg"),
  config: PostgresClientConfig,
  query: string
): Promise<Record<string, unknown>[]> {
  const client = new pg.Client(config);
  await client.connect();

  try {
    const result = await client.query(query);
    return normalizeRecordRows("PostgreSQL", result.rows);
  } finally {
    await client.end();
  }
}

async function resolvePostgresQueryRunner(): Promise<PostgresQueryRunner> {
  const pg = await import("pg");
  return (config, query) => runPostgresQuery(pg, config, query);
}

function buildMySQLConnectionConfig(
  creds: MySQLCredentials,
  ssl: MySQLSslConfig,
  timeoutMs: number
) {
  return {
    connectTimeout: timeoutMs,
    database: creds.database,
    host: creds.host,
    password: creds.password,
    port: creds.port,
    ssl,
    user: creds.username,
  };
}

function buildMySQLSslConfig(
  useSsl: boolean,
  rejectUnauthorized: boolean
): MySQLSslConfig {
  return useSsl ? { rejectUnauthorized } : undefined;
}

async function runMySQLQuery(
  mysql: typeof import("mysql2/promise"),
  config: ReturnType<typeof buildMySQLConnectionConfig>,
  query: string,
  timeoutMs: number
): Promise<Record<string, unknown>[]> {
  const connection = await mysql.createConnection(config);

  try {
    await connection.execute("SET SESSION max_execution_time = ?", [timeoutMs]);
    const result = await connection.execute(query);
    return normalizeRecordRows("MySQL", result[0]);
  } finally {
    await connection.end().catch(() => {});
  }
}

export async function executePostgresQuery(
  creds: PostgresCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS,
  runner?: PostgresQueryRunner
): Promise<Record<string, unknown>[]> {
  const queryRunner = runner ?? (await resolvePostgresQueryRunner());
  const initialState = resolveInitialPostgresTransportState(creds.sslMode);

  try {
    return await queryRunner(
      buildPostgresClientConfig(creds, initialState, timeoutMs),
      query
    );
  } catch (initialError) {
    let priorError = initialError;

    for (const transition of resolvePostgresFailureTransitions(
      creds.sslMode,
      initialError
    )) {
      try {
        return await queryRunner(
          buildPostgresClientConfig(creds, transition.nextState, timeoutMs),
          query
        );
      } catch (transitionError) {
        if (transition.preservePriorErrorOnFailure) {
          throw priorError;
        }

        priorError = transitionError;
      }
    }

    throw priorError;
  }
}

export async function executeMySQLQuery(
  creds: MySQLCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<Record<string, unknown>[]> {
  const mysql = await import("mysql2/promise");
  const sslMode = creds.sslMode;
  const initialUseSsl = shouldUseSsl(sslMode);
  const initialAttempt = runMySQLQuery(
    mysql,
    buildMySQLConnectionConfig(
      creds,
      buildMySQLSslConfig(initialUseSsl, true),
      timeoutMs
    ),
    query,
    timeoutMs
  );

  if (!shouldFallbackToPlaintext(sslMode)) {
    return initialAttempt;
  }

  const attemptPlaintext = async (error: unknown) => {
    try {
      return await runMySQLQuery(
        mysql,
        buildMySQLConnectionConfig(
          creds,
          buildMySQLSslConfig(false, false),
          timeoutMs
        ),
        query,
        timeoutMs
      );
    } catch {
      throw error;
    }
  };

  try {
    return await initialAttempt;
  } catch (error) {
    if (!isTlsVerificationError(error)) {
      return attemptPlaintext(error);
    }

    try {
      return await runMySQLQuery(
        mysql,
        buildMySQLConnectionConfig(
          creds,
          buildMySQLSslConfig(true, false),
          timeoutMs
        ),
        query,
        timeoutMs
      );
    } catch (relaxedError) {
      return attemptPlaintext(relaxedError);
    }
  }
}

export async function executeBigQueryQuery(
  creds: BigQueryCredentials,
  query: string,
  options?: BigQueryQueryOptions
): Promise<Record<string, unknown>[]> {
  const timeoutMs = resolveQueryTimeoutMs(options?.timeoutMs);
  const bigquery = await createBigQueryClient(creds);
  const queryOptions = buildBigQueryQueryOptions({
    location: options?.location,
    query,
    timeoutMs,
  });
  const execution = await executeBigQueryJob(bigquery, queryOptions);
  return execution.rows;
}

export async function executeBigQueryQueryWithStats(
  creds: BigQueryCredentials,
  query: string,
  options?: BigQueryQueryOptions
): Promise<DatabaseQueryExecution> {
  const timeoutMs = resolveQueryTimeoutMs(options?.timeoutMs);
  const bigquery = await createBigQueryClient(creds);
  const queryOptions = buildBigQueryQueryOptions({
    location: options?.location,
    query,
    timeoutMs,
  });
  const estimatedProcessedBytes = await runBigQueryDryRun(
    bigquery,
    queryOptions
  );
  const execution = await executeBigQueryJob(bigquery, queryOptions);
  if (!execution.stats || execution.stats.provider !== "bigquery") {
    return execution;
  }
  const pricingModel = execution.stats.pricingModel;
  return {
    rows: execution.rows,
    stats: {
      ...execution.stats,
      estimatedCostUsd:
        pricingModel === "on_demand"
          ? calculateBigQueryOnDemandUsd(estimatedProcessedBytes)
          : null,
      estimatedProcessedBytes,
    },
  };
}

export async function executeLaminarQuery(
  creds: LaminarCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<Record<string, unknown>[]> {
  const responseOutcome = await fetch(resolveLaminarQueryUrl(creds), {
    body: JSON.stringify({ query }),
    headers: {
      Authorization: `Bearer ${normalizeLaminarApiKey(creds.apiKey)}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: createTimeoutSignal(timeoutMs),
  })
    .then((response) => ({ response }))
    .catch((error: unknown) => ({ error }));

  if ("error" in responseOutcome) {
    throw responseOutcome.error;
  }

  const response = responseOutcome.response;
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new DataSourceQueryExecutionError(
      `Laminar query failed: ${response.status} ${sanitizeProviderErrorText(errorText, creds.apiKey)}`,
      {
        retryable: response.status === 429 || response.status >= 500,
        timedOut: response.status === 504,
      }
    );
  }

  const jsonOutcome = await response
    .json()
    .then((data) => ({ data }))
    .catch((error: unknown) => ({ error }));

  if ("error" in jsonOutcome) {
    throw jsonOutcome.error;
  }

  const payload = jsonOutcome.data;
  if (!isRecord(payload)) {
    throw new Error("Laminar query response was not an object.");
  }

  return normalizeRecordRows("Laminar", payload.data);
}

function resolveLaminarQueryUrl(credentials: LaminarCredentials): string {
  const trimmedBaseUrl = credentials.apiBaseUrl?.trim() ?? "";
  const configuredBaseUrl =
    trimmedBaseUrl.length > 0 ? trimmedBaseUrl : DEFAULT_LAMINAR_API_BASE_URL;
  const url = new URL(configuredBaseUrl);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DataSourceQueryExecutionError(
      "Laminar API base URL must use http or https"
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new DataSourceQueryExecutionError(
      "Laminar API base URL must not include URL credentials"
    );
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new DataSourceQueryExecutionError(
      "Laminar API base URL must not include query params or fragments"
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    // Comment: The relay only supports origin-level Laminar deployments because
    // it constructs a fixed root-relative `/v1/sql/query` path.
    throw new DataSourceQueryExecutionError(
      "Laminar API base URL must not include a path"
    );
  }

  return new URL("/v1/sql/query", `${url.origin}/`).toString();
}

function normalizeLaminarApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new DataSourceQueryExecutionError("Laminar API key is required");
  }
  return normalized;
}

function sanitizeProviderErrorText(text: string, secret: string): string {
  const normalizedSecret = secret.trim();
  const redacted =
    normalizedSecret.length === 0
      ? text
      : text.split(normalizedSecret).join("***");
  return redacted.trim().slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function normalizeConnectorRows(
  columns: { name: string; type: string }[],
  rows: string[][]
): Record<string, unknown>[] {
  const seenNames = new Set<string>();
  const normalizedNames = columns.map((column, index) => {
    const baseName =
      column.name.trim().length > 0 ? column.name : `column_${index + 1}`;
    if (!seenNames.has(baseName)) {
      seenNames.add(baseName);
      return baseName;
    }

    let duplicateIndex = 2;
    let candidate = `${baseName}_${duplicateIndex}`;
    while (seenNames.has(candidate)) {
      duplicateIndex += 1;
      candidate = `${baseName}_${duplicateIndex}`;
    }
    seenNames.add(candidate);
    return candidate;
  });

  return rows.map((row) => {
    const result: Record<string, unknown> = {};
    row.forEach((value, index) => {
      const key = normalizedNames[index] ?? `column_${index + 1}`;
      result[key] = value;
    });
    return result;
  });
}

function buildAthenaConnectorStats(input: {
  creds: ConnectorCredentials;
  outcome: Extract<ConnectorAthenaJobOutcome, { status: "success" }>;
}): AthenaConnectorQueryExecutionStats {
  const billableBytes = parseIntegerString(
    input.outcome.stats?.dataScannedBytes
  );
  const pricingModel = resolveAthenaPricingModel(billableBytes);

  return {
    actualCostUsd: calculateAthenaUsd(billableBytes),
    athenaQueryExecutionId: input.outcome.stats?.queryExecutionId,
    billableBytes,
    connectorId: input.creds.connectorId,
    connectorJobId: input.outcome.jobId,
    currency: "USD",
    database: input.creds.database,
    executionTimeMs: input.outcome.stats?.executionTimeMs,
    pricingModel,
    provider: "aws_athena_connector",
    rowCount: input.outcome.stats?.rowCount,
    workgroup: input.creds.workgroup,
  };
}

async function executeConnectorAthenaJob(
  creds: ConnectorCredentials,
  query: string,
  input: {
    db?: Database;
    timeoutMs?: number;
    organizationId: string;
  }
): Promise<Extract<ConnectorAthenaJobOutcome, { status: "success" }>> {
  const timeoutMs = input.timeoutMs ?? QUERY_TIMEOUT_MS;

  const outcome = await queueConnectorAthenaJob({
    ...(input.db ? { db: input.db } : {}),
    connectorId: creds.connectorId,
    database: creds.database,
    maxRows: creds.maxRows,
    organizationId: input.organizationId,
    sql: query,
    timeoutMs: creds.timeoutMs ?? timeoutMs,
    waitTimeoutMs: timeoutMs + CONNECTOR_RESULT_TIMEOUT_BUFFER_MS,
    workgroup: creds.workgroup,
  });
  if (outcome.isOk()) {
    if (outcome.value.status === "error") {
      throw new DataSourceQueryExecutionError(
        `Connector query failed (${outcome.value.error.code}): ${outcome.value.error.message}`,
        {
          retryable: outcome.value.error.code === "QUERY_TIMEOUT",
          timedOut: outcome.value.error.code === "QUERY_TIMEOUT",
        }
      );
    }

    return outcome.value;
  }

  if (outcome.error instanceof ConnectorJobTimeoutError) {
    throw new DataSourceQueryExecutionError(outcome.error.message, {
      retryable: true,
      timedOut: true,
    });
  }

  throw new DataSourceQueryExecutionError(outcome.error.message, {
    retryable: outcome.error.status >= 500,
    timedOut: false,
  });
}

export async function executeConnectorQuery(
  creds: ConnectorCredentials,
  query: string,
  input: {
    db?: Database;
    timeoutMs?: number;
    organizationId: string;
  }
): Promise<Record<string, unknown>[]> {
  const outcome = await executeConnectorAthenaJob(creds, query, input);
  return normalizeConnectorRows(outcome.columns, outcome.rows);
}

export async function executeConnectorQueryWithStats(
  creds: ConnectorCredentials,
  query: string,
  input: {
    db?: Database;
    timeoutMs?: number;
    organizationId: string;
  }
): Promise<DatabaseQueryExecution> {
  const outcome = await executeConnectorAthenaJob(creds, query, input);
  return {
    rows: normalizeConnectorRows(outcome.columns, outcome.rows),
    stats: buildAthenaConnectorStats({
      creds,
      outcome,
    }),
  };
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined") {
    return undefined;
  }

  if (typeof AbortSignal.timeout !== "function") {
    return undefined;
  }

  return AbortSignal.timeout(timeoutMs);
}

function toExecutionError(error: unknown): DataSourceQueryExecutionError {
  if (error instanceof DataSourceQueryExecutionError) {
    return error;
  }

  const message = toErrorMessage(error);
  const errorCode = readErrorCode(error);
  const timeout =
    errorCode === "ETIMEDOUT" ||
    errorCode === "PROTOCOL_SEQUENCE_TIMEOUT" ||
    message.toLowerCase().includes("timeout");
  const retryable =
    timeout ||
    (errorCode !== null && TRANSIENT_ERROR_CODES.has(errorCode)) ||
    isRetryableBigQueryError(error);

  return new DataSourceQueryExecutionError(message, {
    retryable,
    timedOut: timeout,
  });
}

function isRetryableBigQueryError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const code = error.code;
  return typeof code === "number" && TRANSIENT_BIGQUERY_STATUS_CODES.has(code);
}

function readErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }

  const code = error.code;
  return typeof code === "string" ? code : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
