import { isRecord } from "@onequery/base";
import type { LaminarCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { runProviderConnectionTest } from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
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
import { classifyLaminarError } from "./errors";

const DEFAULT_LAMINAR_API_BASE_URL = "https://api.lmnr.ai";
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

export async function executeLaminarQuery(
  creds: LaminarCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  return Result.gen(async function* executeLaminarQueryFlow() {
    const apiKey = yield* normalizeLaminarApiKey(creds.apiKey);
    const queryUrl = yield* resolveLaminarQueryUrl(creds);
    const response = yield* Result.await(
      Result.tryPromise({
        try: () =>
          fetch(queryUrl, {
            body: JSON.stringify({ query }),
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            signal: createQueryDeadline(timeoutMs).createAbortSignal(),
          }),
        catch: (error) =>
          toQueryFailure({
            classifier: classifyLaminarError,
            error,
            provider: "laminar",
          }),
      })
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return Result.err(
        new ProviderResponseFailure({
          message: `Laminar query failed: ${response.status} ${sanitizeProviderErrorText(errorText, apiKey)}`,
          provider: "laminar",
          retryable: response.status === 429 || response.status >= 500,
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
            message: `Laminar query returned invalid JSON: ${toErrorMessage(cause)}`,
            provider: "laminar",
            retryable: false,
            timedOut: false,
          }),
      })
    );

    return extractLaminarRows(payload);
  });
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
  execute: async ({ credentials, deadline, sql }) =>
    (await executeLaminarQuery(credentials, sql, deadline.timeoutMs)).map(
      (rows) => ({ rows })
    ),
  classifyError: classifyLaminarError,
  testConnection: async ({ credentials, deadline }) =>
    runLaminarConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<LaminarCredentials>;

function resolveLaminarQueryUrl(
  credentials: LaminarCredentials
): DatabaseQueryResult<string> {
  const trimmedBaseUrl = credentials.apiBaseUrl?.trim() ?? "";
  const configuredBaseUrl =
    trimmedBaseUrl.length > 0 ? trimmedBaseUrl : DEFAULT_LAMINAR_API_BASE_URL;
  const urlResult = Result.try({
    try: () => new URL(configuredBaseUrl),
    catch: (cause) =>
      new QueryInputFailure({
        cause,
        message: "Laminar API base URL is invalid",
        provider: "laminar",
      }),
  });
  if (urlResult.isErr()) {
    return Result.err(urlResult.error);
  }
  const url = urlResult.value;

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return Result.err(
      new QueryInputFailure({
        message: "Laminar API base URL must use http or https",
        provider: "laminar",
      })
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return Result.err(
      new QueryInputFailure({
        message: "Laminar API base URL must not include URL credentials",
        provider: "laminar",
      })
    );
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return Result.err(
      new QueryInputFailure({
        message:
          "Laminar API base URL must not include query params or fragments",
        provider: "laminar",
      })
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    // Comment: The relay only supports origin-level Laminar deployments because
    // it constructs a fixed root-relative `/v1/sql/query` path.
    return Result.err(
      new QueryInputFailure({
        message: "Laminar API base URL must not include a path",
        provider: "laminar",
      })
    );
  }

  return Result.ok(new URL("/v1/sql/query", `${url.origin}/`).toString());
}

function normalizeLaminarApiKey(apiKey: string): DatabaseQueryResult<string> {
  const normalized = apiKey.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    return Result.err(
      new QueryInputFailure({
        message: "Laminar API key is required",
        provider: "laminar",
      })
    );
  }
  return Result.ok(normalized);
}

function extractLaminarRows(
  payload: unknown
): DatabaseQueryResult<Record<string, unknown>[]> {
  if (!isRecord(payload)) {
    return Result.err(
      new ProviderResponseFailure({
        message: "Laminar query response was not an object.",
        provider: "laminar",
        retryable: false,
        timedOut: false,
      })
    );
  }

  return Result.try({
    try: () => normalizeRecordRows("Laminar", payload.data),
    catch: (cause) =>
      new ProviderResponseFailure({
        cause,
        message: toErrorMessage(cause),
        provider: "laminar",
        retryable: false,
        timedOut: false,
      }),
  });
}

async function runLaminarConnectionTest(
  credentials: LaminarCredentials,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  return runProviderConnectionTest({
    deadline,
    execute: () =>
      executeLaminarQuery(
        credentials,
        CONNECTION_TEST_QUERY,
        deadline.timeoutMs
      ),
  });
}
