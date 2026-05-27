import { isRecord } from "@onequery/base";
import type { CloudflareD1Credentials } from "@onequery/query";
import {
  createFailedConnectionTest,
  runProviderConnectionTest,
} from "@onequery/query/connection-test";
import type { ProviderQueryDriver } from "@onequery/query/driver";
import type { QueryErrorClassification } from "@onequery/query/errors";
import {
  ProviderResponseFailure,
  QueryInputFailure,
  toErrorMessage,
  toQueryFailure,
} from "@onequery/query/errors";
import { normalizeRecordRows } from "@onequery/query/rows";
import {
  hasControlCharacters,
  sanitizeProviderErrorText,
} from "@onequery/query/security";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "@onequery/query/timeout";
import type { QueryDeadline } from "@onequery/query/timeout";
import type { DatabaseQueryResult } from "@onequery/query/types";
import { Result } from "better-result";

const DEFAULT_CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const TRANSIENT_CLOUDFLARE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

export async function executeCloudflareD1Query(
  creds: CloudflareD1Credentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  return Result.gen(async function* executeCloudflareD1QueryFlow() {
    const apiToken = yield* normalizeCloudflareApiToken(creds.apiToken);
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          fetch(resolveCloudflareD1QueryUrl(creds), {
            body: JSON.stringify({ sql: query }),
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            signal: createQueryDeadline(timeoutMs).createAbortSignal(),
          }),
        catch: (error) =>
          toQueryFailure({
            classifier: classifyCloudflareD1Error,
            error,
            provider: "cloudflare_d1",
          }),
      })
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return Result.err(
        new ProviderResponseFailure({
          message: `Cloudflare D1 query failed: ${response.status} ${sanitizeCloudflareErrorText(errorText, apiToken)}`,
          provider: "cloudflare_d1",
          retryable: TRANSIENT_CLOUDFLARE_STATUS_CODES.has(response.status),
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
            message: `Cloudflare D1 query returned invalid JSON: ${toErrorMessage(cause)}`,
            provider: "cloudflare_d1",
            retryable: false,
            timedOut: false,
          }),
      })
    );
    const rows = yield* extractCloudflareD1Rows(payload, apiToken);
    return Result.ok(rows);
  });
}

export const cloudflareD1QueryDriver = {
  provider: "cloudflare_d1",
  capabilities: {
    cancellation: "best_effort",
    connectionTest: true,
    dryRun: false,
    stats: false,
  },
  execute: async ({ credentials, deadline, sql }) =>
    (await executeCloudflareD1Query(credentials, sql, deadline.timeoutMs)).map(
      (rows) => ({ rows })
    ),
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

function normalizeCloudflareApiToken(
  apiToken: string
): DatabaseQueryResult<string> {
  const normalized = apiToken.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    return Result.err(
      new QueryInputFailure({
        message: "Cloudflare API token is required",
        provider: "cloudflare_d1",
      })
    );
  }
  return Result.ok(normalized);
}

function extractCloudflareD1Rows(
  payload: unknown,
  apiToken: string
): DatabaseQueryResult<Record<string, unknown>[]> {
  if (!isRecord(payload)) {
    return Result.err(
      new ProviderResponseFailure({
        message: "Cloudflare D1 query response was not an object.",
        provider: "cloudflare_d1",
        retryable: false,
        timedOut: false,
      })
    );
  }

  if (payload.success === false) {
    return Result.err(
      new ProviderResponseFailure({
        message: `Cloudflare D1 query failed: ${sanitizeCloudflareErrorText(readCloudflareErrorText(payload), apiToken)}`,
        provider: "cloudflare_d1",
        retryable: false,
        timedOut: false,
      })
    );
  }

  const result = Array.isArray(payload.result)
    ? payload.result[0]
    : payload.result;

  if (!isRecord(result)) {
    return Result.err(
      new ProviderResponseFailure({
        message: "Cloudflare D1 query response did not include a result.",
        provider: "cloudflare_d1",
        retryable: false,
        timedOut: false,
      })
    );
  }

  if (result.success === false) {
    return Result.err(
      new ProviderResponseFailure({
        message: `Cloudflare D1 query failed: ${sanitizeCloudflareErrorText(readCloudflareErrorText(result), apiToken)}`,
        provider: "cloudflare_d1",
        retryable: false,
        timedOut: false,
      })
    );
  }

  return Result.try({
    try: () => normalizeRecordRows("Cloudflare D1", result.results),
    catch: (cause) =>
      new ProviderResponseFailure({
        cause,
        message: toErrorMessage(cause),
        provider: "cloudflare_d1",
        retryable: false,
        timedOut: false,
      }),
  });
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
    execute: () =>
      executeCloudflareD1Query(
        credentials,
        CONNECTION_TEST_QUERY,
        deadline.timeoutMs
      ),
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
