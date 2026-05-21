import { isRecord } from "@onequery/base";
import type { LaminarCredentials } from "@onequery/db/server";

import { runProviderConnectionTest } from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import { DataSourceQueryExecutionError } from "../../core/errors";
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
import { classifyLaminarError } from "./errors";

const DEFAULT_LAMINAR_API_BASE_URL = "https://api.lmnr.ai";
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

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

export const laminarQueryDriver = {
  provider: "laminar",
  capabilities: {
    cancellation: "best_effort",
    connectionTest: true,
    dryRun: false,
    stats: false,
  },
  validateSql: async ({ sql }) =>
    validateReadOnlySql({
      provider: "laminar",
      sql,
    }),
  execute: async ({ credentials, deadline, sql }) => ({
    rows: await executeLaminarQuery(credentials, sql, deadline.timeoutMs),
  }),
  classifyError: classifyLaminarError,
  testConnection: async ({ credentials, deadline }) =>
    runLaminarConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<LaminarCredentials>;

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

async function runLaminarConnectionTest(
  credentials: LaminarCredentials,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  return runProviderConnectionTest({
    deadline,
    execute: async () => {
      await executeLaminarQuery(
        credentials,
        CONNECTION_TEST_QUERY,
        deadline.timeoutMs
      );
    },
  });
}
