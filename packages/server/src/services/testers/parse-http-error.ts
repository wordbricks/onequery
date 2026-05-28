import { createFailedConnectionTest } from "@onequery/query/connection-test";

const HTTP_ERROR_PATTERN =
  /^[A-Za-z0-9 _-]+ API error \((\d{3})\):\s*([\s\S]*)$/u;
const TIMEOUT_PATTERN = /^[A-Za-z0-9 _-]+ request timeout after \d+ms$/u;

interface HttpStatusErrorHints {
  accessDeniedError?: string;
  authenticationError?: string;
  notFoundError?: string;
  notFoundMessage?: string;
}

function createFailureResult(input: {
  error: string;
  latencyMs: number;
  message?: string;
}) {
  return createFailedConnectionTest({
    detail: input.error,
    latencyMs: input.latencyMs,
    message: input.message,
  });
}

export function parseHttpStatusError(
  err: Error,
  latencyMs: number,
  timeoutSeconds: number,
  hints: HttpStatusErrorHints = {}
) {
  if (TIMEOUT_PATTERN.test(err.message)) {
    return createFailedConnectionTest({
      detail: `Connection timed out after ${timeoutSeconds} seconds`,
      latencyMs,
      message: "Connection timed out",
    });
  }

  const matched = HTTP_ERROR_PATTERN.exec(err.message);
  if (!matched) {
    return createFailureResult({ error: err.message, latencyMs });
  }

  const statusCode = Number.parseInt(matched[1] ?? "", 10);
  const detail = matched[2]?.trim() || "Unknown error";

  if (statusCode === 401) {
    return createFailureResult({
      error: hints.authenticationError ?? "Invalid credentials",
      latencyMs,
      message: "Authentication failed",
    });
  }

  if (statusCode === 403) {
    return createFailureResult({
      error:
        hints.accessDeniedError ??
        "Credentials do not have the required permissions",
      latencyMs,
      message: "Access denied",
    });
  }

  if (statusCode === 404) {
    return createFailureResult({
      error:
        hints.notFoundError ?? hints.notFoundMessage ?? "Resource not found",
      latencyMs,
      message: hints.notFoundMessage ?? "Resource not found",
    });
  }

  return createFailureResult({
    error: `HTTP ${statusCode}: ${detail}`,
    latencyMs,
  });
}
