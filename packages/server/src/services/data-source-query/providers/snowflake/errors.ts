import type { QueryErrorClassification } from "../../core/errors";
import { readHttpStatusCode } from "../../core/errors";

const TRANSIENT_SNOWFLAKE_ERROR_CODES = new Set(["ETIMEDOUT", "ECONNRESET"]);

export function classifySnowflakeError(
  error: unknown
): QueryErrorClassification | null {
  const code = readSnowflakeErrorCode(error);
  if (typeof code === "string" && TRANSIENT_SNOWFLAKE_ERROR_CODES.has(code)) {
    return {
      retryable: true,
    };
  }

  const statusCode = readHttpStatusCode(error);
  if (statusCode === null) {
    return null;
  }

  return {
    retryable: statusCode === 429 || statusCode >= 500,
  };
}

export function sanitizeSnowflakeErrorMessage(message: string): string {
  return message.replaceAll(/password[=:]\s*\S+/giu, "password=***");
}

export function readSnowflakeErrorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  return error.code;
}
