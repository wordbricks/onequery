import { isRecord } from "@onequery/base";
import type { CloudflareD1Credentials } from "@onequery/db/server";

import {
  createFailedConnectionTest,
  runProviderConnectionTest,
} from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import { DataSourceQueryExecutionError } from "../../core/errors";
import type { QueryErrorClassification } from "../../core/errors";
import { normalizeRecordRows } from "../../core/rows";
import {
  hasControlCharacters,
  sanitizeProviderErrorText,
} from "../../core/security";
import {
  QUERY_TIMEOUT_MS,
  createQueryDeadline,
  createTimeoutSignal,
} from "../../core/timeout";
import type { QueryDeadline } from "../../core/timeout";
import { validateReadOnlySql } from "../../core/validation";

const DEFAULT_CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const TRANSIENT_CLOUDFLARE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

export async function executeCloudflareD1Query(
  creds: CloudflareD1Credentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<Record<string, unknown>[]> {
  const responseOutcome = await fetch(resolveCloudflareD1QueryUrl(creds), {
    body: JSON.stringify({ sql: query }),
    headers: {
      Authorization: `Bearer ${normalizeCloudflareApiToken(creds.apiToken)}`,
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
      `Cloudflare D1 query failed: ${response.status} ${sanitizeCloudflareErrorText(errorText, creds.apiToken)}`,
      {
        retryable: TRANSIENT_CLOUDFLARE_STATUS_CODES.has(response.status),
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

  return extractCloudflareD1Rows(jsonOutcome.data, creds.apiToken);
}

export const cloudflareD1QueryDriver = {
  provider: "cloudflare_d1",
  capabilities: {
    cancellation: "best_effort",
    connectionTest: true,
    dryRun: false,
    stats: false,
  },
  validateSql: async ({ sql }) =>
    validateReadOnlySql({
      provider: "cloudflare_d1",
      sql,
    }),
  execute: async ({ credentials, deadline, sql }) => ({
    rows: await executeCloudflareD1Query(credentials, sql, deadline.timeoutMs),
  }),
  classifyError: classifyCloudflareD1Error,
  testConnection: async ({ credentials, deadline }) =>
    runCloudflareD1ConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<CloudflareD1Credentials>;

function resolveCloudflareD1QueryUrl(credentials: CloudflareD1Credentials) {
  const trimmedBaseUrl = credentials.apiBaseUrl?.trim() ?? "";
  const configuredBaseUrl =
    trimmedBaseUrl.length > 0
      ? trimmedBaseUrl
      : DEFAULT_CLOUDFLARE_API_BASE_URL;
  const baseUrl = configuredBaseUrl.replace(/\/+$/, "");
  const accountId = encodeURIComponent(credentials.accountId.trim());
  const databaseId = encodeURIComponent(credentials.databaseId.trim());

  return `${baseUrl}/accounts/${accountId}/d1/database/${databaseId}/query`;
}

function normalizeCloudflareApiToken(apiToken: string): string {
  const normalized = apiToken.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new DataSourceQueryExecutionError("Cloudflare API token is required");
  }
  return normalized;
}

function extractCloudflareD1Rows(
  payload: unknown,
  apiToken: string
): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    throw new Error("Cloudflare D1 query response was not an object.");
  }

  if (payload.success === false) {
    throw new DataSourceQueryExecutionError(
      `Cloudflare D1 query failed: ${sanitizeCloudflareErrorText(readCloudflareErrorText(payload), apiToken)}`,
      {
        retryable: false,
        timedOut: false,
      }
    );
  }

  const result = Array.isArray(payload.result)
    ? payload.result[0]
    : payload.result;

  if (!isRecord(result)) {
    throw new Error("Cloudflare D1 query response did not include a result.");
  }

  if (result.success === false) {
    throw new DataSourceQueryExecutionError(
      `Cloudflare D1 query failed: ${sanitizeCloudflareErrorText(readCloudflareErrorText(result), apiToken)}`,
      {
        retryable: false,
        timedOut: false,
      }
    );
  }

  return normalizeRecordRows("Cloudflare D1", result.results);
}

function readCloudflareErrorText(payload: Record<string, unknown>): string {
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

function sanitizeCloudflareErrorText(text: string, apiToken: string): string {
  return sanitizeProviderErrorText(
    text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]"),
    apiToken
  );
}

async function runCloudflareD1ConnectionTest(
  credentials: CloudflareD1Credentials,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  return runProviderConnectionTest({
    deadline,
    execute: async () => {
      await executeCloudflareD1Query(
        credentials,
        CONNECTION_TEST_QUERY,
        deadline.timeoutMs
      );
    },
    mapError: (error, latencyMs) => {
      const statusCode = readCloudflareD1StatusCode(error);
      if (statusCode === 401) {
        return createFailedConnectionTest({
          detail: "Invalid or expired Cloudflare credentials",
          latencyMs,
          message: "Authentication failed",
        });
      }
      if (statusCode === 403) {
        return createFailedConnectionTest({
          detail:
            "Cloudflare credentials do not have access to this D1 database",
          latencyMs,
          message: "Access denied",
        });
      }

      return null;
    },
  });
}

function classifyCloudflareD1Error(
  error: unknown
): QueryErrorClassification | null {
  const statusCode = readCloudflareD1StatusCode(error);
  if (statusCode === null) {
    return null;
  }

  return {
    retryable: TRANSIENT_CLOUDFLARE_STATUS_CODES.has(statusCode),
    timedOut: statusCode === 504,
  };
}

function readCloudflareD1StatusCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /Cloudflare D1 query failed: (\d{3})\b/u.exec(message);
  if (!match) {
    return null;
  }

  const statusCode = Number(match[1]);
  return Number.isInteger(statusCode) ? statusCode : null;
}
