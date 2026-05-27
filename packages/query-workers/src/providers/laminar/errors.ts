import type { QueryErrorClassification } from "@onequery/query/errors";

export function classifyLaminarError(
  error: unknown
): QueryErrorClassification | null {
  const statusCode = readLaminarStatusCode(error);
  if (statusCode === null) {
    return null;
  }

  return {
    retryable: statusCode === 429 || statusCode >= 500,
    timedOut: statusCode === 504,
  };
}

function readLaminarStatusCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /Laminar query failed: (\d{3})\b/u.exec(message);
  if (!match) {
    return null;
  }

  const statusCode = Number(match[1]);
  return Number.isInteger(statusCode) ? statusCode : null;
}
