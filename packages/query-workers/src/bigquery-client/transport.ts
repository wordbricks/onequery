import { MAX_PROVIDER_ERROR_DETAIL_LENGTH } from "../provider-http";
import { readBigQueryErrorMessage } from "./schemas";
import {
  normalizeBigQueryAccessToken,
  normalizeBigQueryPath,
  normalizeBigQueryProjectId,
  normalizeBigQueryQueryPart,
} from "./security";
import { BIGQUERY_API_BASE_URL, BigQueryApiError } from "./types";
import type { BigQueryApiRequest, BigQueryRunnerContext } from "./types";

export async function requestBigQueryJson(
  input: BigQueryRunnerContext & BigQueryApiRequest
): Promise<unknown> {
  const accessToken = normalizeBigQueryAccessToken(
    await input.accessTokenPromise
  );
  const url = new URL(
    `${BIGQUERY_API_BASE_URL}/projects/${encodeURIComponent(normalizeBigQueryProjectId(input.projectId))}${normalizeBigQueryPath(input.path)}`
  );
  Object.entries(input.query ?? {}).forEach(([key, value]) => {
    url.searchParams.set(
      normalizeBigQueryQueryPart(key, "query parameter name"),
      normalizeBigQueryQueryPart(value, `query parameter "${key}"`)
    );
  });

  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
  });

  let body: string | undefined;
  if (input.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(input.body);
  }

  const response = await fetch(url.toString(), {
    method: input.method ?? (body ? "POST" : "GET"),
    headers,
    ...(body ? { body } : {}),
    signal: createTimeoutSignal(input.timeoutMs),
  }).catch((error: unknown) => {
    if (isAbortError(error)) {
      const timeoutError = new Error("BigQuery request timed out.");
      Object.assign(timeoutError, { code: "ETIMEDOUT" });
      throw timeoutError;
    }

    throw error;
  });

  const responseText = await response.text();
  const parsedBody = parseJsonText(responseText);

  if (!response.ok) {
    throw new BigQueryApiError(
      response.status,
      buildBigQueryErrorMessage(response, parsedBody, responseText)
    );
  }

  if (parsedBody !== null) {
    return parsedBody;
  }

  throw new Error("BigQuery API returned an empty response body.");
}

export function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}`;
}

function createTimeoutSignal(
  timeoutMs: number | undefined
): AbortSignal | undefined {
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return undefined;
  }

  if (typeof AbortSignal === "undefined") {
    return undefined;
  }

  if (typeof AbortSignal.timeout !== "function") {
    return undefined;
  }

  return AbortSignal.timeout(timeoutMs);
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.name === "TimeoutError";
}

function parseJsonText(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function buildBigQueryErrorMessage(
  response: Response,
  body: unknown,
  fallbackText: string
): string {
  const message =
    readBigQueryErrorMessage(body) ??
    (fallbackText.trim().length > 0
      ? fallbackText.trim()
      : response.statusText);

  return `BigQuery API request failed: ${response.status} ${message
    .trim()
    .slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH)}`;
}
