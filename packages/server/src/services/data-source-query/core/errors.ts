import { isRecord } from "@onequery/base";

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
]);

export type QueryErrorClassification = {
  retryable?: boolean;
  timedOut?: boolean;
  message?: string;
};

export type QueryErrorClassifier = (
  error: unknown
) => QueryErrorClassification | null;

export class DataSourceQueryExecutionError extends Error {
  readonly retryable: boolean;
  readonly timedOut: boolean;

  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      timedOut?: boolean;
    }
  ) {
    super(message);
    this.name = "DataSourceQueryExecutionError";
    this.retryable = options?.retryable ?? false;
    this.timedOut = options?.timedOut ?? false;
  }
}

export function toExecutionError(
  error: unknown,
  classifier?: QueryErrorClassifier
): DataSourceQueryExecutionError {
  if (error instanceof DataSourceQueryExecutionError) {
    return error;
  }

  const providerClassification = classifier?.(error);
  const message = providerClassification?.message ?? toErrorMessage(error);
  const errorCode = readErrorCode(error);
  const timedOut =
    providerClassification?.timedOut ??
    (errorCode === "ETIMEDOUT" ||
      errorCode === "PROTOCOL_SEQUENCE_TIMEOUT" ||
      message.toLowerCase().includes("timeout"));
  const retryable =
    providerClassification?.retryable ??
    (timedOut || (errorCode !== null && TRANSIENT_ERROR_CODES.has(errorCode)));

  return new DataSourceQueryExecutionError(message, {
    retryable,
    timedOut,
  });
}

export function readErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }

  const code = error.code;
  return typeof code === "string" ? code : null;
}

export function readHttpStatusCode(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }

  const statusCode = error.statusCode ?? error.code;
  return typeof statusCode === "number" ? statusCode : null;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
