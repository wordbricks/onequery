import type { QueryErrorClassification } from "@onequery/query/errors";
import { readErrorCode } from "@onequery/query/errors";

export function classifyMySQLError(
  error: unknown
): QueryErrorClassification | null {
  const code = readErrorCode(error);
  if (code === "PROTOCOL_SEQUENCE_TIMEOUT") {
    return {
      retryable: true,
      timedOut: true,
    };
  }

  return null;
}

export function sanitizeMySQLErrorMessage(message: string): string {
  return message.replaceAll(/password[=:]\s*\S+/giu, "password=***");
}
