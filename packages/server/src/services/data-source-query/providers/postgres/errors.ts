import type { QueryErrorClassification } from "../../core/errors";
import { readErrorCode } from "../../core/errors";

export function classifyPostgresError(
  error: unknown
): QueryErrorClassification | null {
  const code = readErrorCode(error);
  if (code === "57014") {
    return {
      retryable: true,
      timedOut: true,
    };
  }

  return null;
}

export function sanitizePostgresErrorMessage(message: string): string {
  return message.replaceAll(/password[=:]\s*\S+/giu, "password=***");
}
