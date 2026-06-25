import { isRecord } from "@onequery/base";
import type { CloudflareR2SqlCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import {
  createFailedConnectionTest,
  runProviderConnectionTest,
} from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import type { QueryErrorClassification } from "../../core/errors";
import {
  ProviderResponseFailure,
  QueryInputFailure,
  toErrorMessage,
  toQueryFailure,
} from "../../core/errors";
import { normalizeRecordRows } from "../../core/rows";
import {
  hasControlCharacters,
  sanitizeProviderErrorText,
} from "../../core/security";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "../../core/timeout";
import type { QueryDeadline } from "../../core/timeout";
import type { DatabaseQueryResult } from "../../core/types";
import { validateReadOnlySql } from "../../core/validation";

const DEFAULT_CLOUDFLARE_R2_SQL_API_BASE_URL =
  "https://api.sql.cloudflarestorage.com/api/v1";
const TRANSIENT_CLOUDFLARE_R2_SQL_STATUS_CODES = new Set([
  429, 500, 502, 503, 504,
]);
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

export async function executeCloudflareR2SqlQuery(
  creds: CloudflareR2SqlCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  return Result.gen(async function* executeCloudflareR2SqlQueryFlow() {
    const apiToken = yield* normalizeCloudflareR2SqlApiToken(creds.apiToken);
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          fetch(resolveCloudflareR2SqlQueryUrl(creds), {
            body: JSON.stringify({
              query,
              warehouse: resolveCloudflareR2SqlWarehouseName(creds),
            }),
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            signal: createQueryDeadline(timeoutMs).createAbortSignal(),
          }),
        catch: (error) =>
          toQueryFailure({
            classifier: classifyCloudflareR2SqlError,
            error,
            provider: "cloudflare_r2_sql",
          }),
      })
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return Result.err(
        new ProviderResponseFailure({
          message: `Cloudflare R2 SQL query failed: ${response.status} ${sanitizeCloudflareR2SqlErrorText(errorText, apiToken)}`,
          provider: "cloudflare_r2_sql",
          retryable: TRANSIENT_CLOUDFLARE_R2_SQL_STATUS_CODES.has(
            response.status
          ),
          timedOut: response.status === 504,
        })
      );
    }

    const payload = yield* Result.await(
      Result.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new ProviderResponseFailure({
            cause,
            message: `Cloudflare R2 SQL query returned invalid JSON: ${toErrorMessage(cause)}`,
            provider: "cloudflare_r2_sql",
            retryable: false,
            timedOut: false,
          }),
      })
    );
    const rows = yield* extractCloudflareR2SqlRows(payload, apiToken);
    return Result.ok(rows);
  });
}

export const cloudflareR2SqlQueryDriver = {
  provider: "cloudflare_r2_sql",
  capabilities: {
    cancellation: "best_effort",
    connectionTest: true,
    dryRun: false,
    stats: false,
  },
  validateSql: async ({ sql }) =>
    validateReadOnlySql({
      provider: "cloudflare_r2_sql",
      sql,
    }),
  execute: async ({ credentials, deadline, sql }) =>
    (
      await executeCloudflareR2SqlQuery(credentials, sql, deadline.timeoutMs)
    ).map((rows) => ({ rows })),
  classifyError: classifyCloudflareR2SqlError,
  testConnection: async ({ credentials, deadline }) =>
    runCloudflareR2SqlConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<CloudflareR2SqlCredentials>;

function resolveCloudflareR2SqlQueryUrl(
  credentials: CloudflareR2SqlCredentials
) {
  const trimmedBaseUrl = credentials.apiBaseUrl?.trim() ?? "";
  const configuredBaseUrl =
    trimmedBaseUrl.length > 0
      ? trimmedBaseUrl
      : DEFAULT_CLOUDFLARE_R2_SQL_API_BASE_URL;
  const baseUrl = configuredBaseUrl.replace(/\/+$/, "");
  const accountId = encodeURIComponent(credentials.accountId.trim());
  const bucketName = encodeURIComponent(credentials.bucketName.trim());

  return `${baseUrl}/accounts/${accountId}/r2-sql/query/${bucketName}`;
}

function resolveCloudflareR2SqlWarehouseName(
  credentials: CloudflareR2SqlCredentials
) {
  return `${credentials.accountId.trim()}_${credentials.bucketName.trim()}`;
}

function normalizeCloudflareR2SqlApiToken(
  apiToken: string
): DatabaseQueryResult<string> {
  const normalized = apiToken.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    return Result.err(
      new QueryInputFailure({
        message: "Cloudflare R2 SQL API token is required",
        provider: "cloudflare_r2_sql",
      })
    );
  }
  return Result.ok(normalized);
}

function extractCloudflareR2SqlRows(
  payload: unknown,
  apiToken: string
): DatabaseQueryResult<Record<string, unknown>[]> {
  if (!isRecord(payload)) {
    return Result.err(
      new ProviderResponseFailure({
        message: "Cloudflare R2 SQL query response was not an object.",
        provider: "cloudflare_r2_sql",
        retryable: false,
        timedOut: false,
      })
    );
  }

  if (payload.success === false) {
    return Result.err(
      new ProviderResponseFailure({
        message: `Cloudflare R2 SQL query failed: ${sanitizeCloudflareR2SqlErrorText(readCloudflareR2SqlErrorText(payload), apiToken)}`,
        provider: "cloudflare_r2_sql",
        retryable: false,
        timedOut: false,
      })
    );
  }

  const result = payload.result;
  if (!isRecord(result)) {
    return Result.err(
      new ProviderResponseFailure({
        message: "Cloudflare R2 SQL query response did not include a result.",
        provider: "cloudflare_r2_sql",
        retryable: false,
        timedOut: false,
      })
    );
  }

  return Result.try({
    try: () => normalizeRecordRows("Cloudflare R2 SQL", result.rows),
    catch: (cause) =>
      new ProviderResponseFailure({
        cause,
        message: toErrorMessage(cause),
        provider: "cloudflare_r2_sql",
        retryable: false,
        timedOut: false,
      }),
  });
}

function readCloudflareR2SqlErrorText(
  payload: Record<string, unknown>
): string {
  const errors = payload.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return "Unknown error";
  }

  return errors
    .map((entry) => {
      if (!isRecord(entry)) {
        return String(entry);
      }
      const code =
        typeof entry.code === "number" || typeof entry.code === "string"
          ? `${entry.code}: `
          : "";
      const message =
        typeof entry.message === "string"
          ? entry.message
          : JSON.stringify(entry);
      return `${code}${message}`;
    })
    .join("; ");
}

function sanitizeCloudflareR2SqlErrorText(
  text: string,
  apiToken: string
): string {
  return sanitizeProviderErrorText(
    text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]"),
    apiToken
  );
}

async function runCloudflareR2SqlConnectionTest(
  credentials: CloudflareR2SqlCredentials,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  return runProviderConnectionTest({
    deadline,
    execute: () =>
      executeCloudflareR2SqlQuery(
        credentials,
        CONNECTION_TEST_QUERY,
        deadline.timeoutMs
      ),
    mapError: (error, latencyMs) => {
      const statusCode = readCloudflareR2SqlStatusCode(error);
      if (statusCode === 401) {
        return createFailedConnectionTest({
          detail: "Invalid or expired Cloudflare R2 SQL credentials",
          latencyMs,
          message: "Authentication failed",
        });
      }
      if (statusCode === 403) {
        return createFailedConnectionTest({
          detail:
            "Cloudflare credentials do not have access to this R2 SQL warehouse",
          latencyMs,
          message: "Access denied",
        });
      }

      return null;
    },
  });
}

function classifyCloudflareR2SqlError(
  error: unknown
): QueryErrorClassification | null {
  const statusCode = readCloudflareR2SqlStatusCode(error);
  if (statusCode === null) {
    return null;
  }

  return {
    retryable: TRANSIENT_CLOUDFLARE_R2_SQL_STATUS_CODES.has(statusCode),
    timedOut: statusCode === 504,
  };
}

function readCloudflareR2SqlStatusCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /Cloudflare R2 SQL query failed: (\d{3})\b/u.exec(message);
  if (!match) {
    return null;
  }

  const statusCode = Number(match[1]);
  return Number.isInteger(statusCode) ? statusCode : null;
}
