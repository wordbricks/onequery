import { isRecord } from "@onequery/base";
import { TaggedError } from "better-result";

import type { DatabaseCredentials } from "./credentials";

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

export type QueryFailureProvider = DatabaseCredentials["type"];

type QueryFailureProps = {
  cause?: unknown;
  message: string;
  provider: QueryFailureProvider;
};

export class QueryInputFailure extends TaggedError(
  "QueryInputFailure"
)<QueryFailureProps>() {}

export class QueryValidationFailure extends TaggedError(
  "QueryValidationFailure"
)<QueryFailureProps>() {}

export class ProviderTransportFailure extends TaggedError(
  "ProviderTransportFailure"
)<
  QueryFailureProps & {
    retryable: boolean;
  }
>() {}

export class ProviderResponseFailure extends TaggedError(
  "ProviderResponseFailure"
)<
  QueryFailureProps & {
    retryable: boolean;
    timedOut: boolean;
  }
>() {}

export class QueryTimeoutFailure extends TaggedError("QueryTimeoutFailure")<
  QueryFailureProps & {
    retryable: true;
    timedOut: true;
  }
>() {}

export class QueryCancelledFailure extends TaggedError("QueryCancelledFailure")<
  QueryFailureProps & {
    retryable: boolean;
  }
>() {}

export class UnsupportedProviderFailure extends TaggedError(
  "UnsupportedProviderFailure"
)<QueryFailureProps>() {}

export type DataSourceQueryFailure =
  | QueryInputFailure
  | QueryValidationFailure
  | ProviderTransportFailure
  | ProviderResponseFailure
  | QueryTimeoutFailure
  | QueryCancelledFailure
  | UnsupportedProviderFailure;

export function toQueryFailure(input: {
  classifier?: QueryErrorClassifier;
  error: unknown;
  provider: QueryFailureProvider;
}): DataSourceQueryFailure {
  if (isDataSourceQueryFailure(input.error)) {
    return input.error;
  }

  const providerClassification = input.classifier?.(input.error);
  const message =
    providerClassification?.message ?? toErrorMessage(input.error);
  const errorCode = readErrorCode(input.error);
  const httpStatusCode = readHttpStatusCode(input.error);
  const timedOut =
    providerClassification?.timedOut ??
    (errorCode === "ETIMEDOUT" ||
      errorCode === "PROTOCOL_SEQUENCE_TIMEOUT" ||
      message.toLowerCase().includes("timeout"));
  const retryable =
    providerClassification?.retryable ??
    (timedOut || (errorCode !== null && TRANSIENT_ERROR_CODES.has(errorCode)));

  if (timedOut) {
    return new QueryTimeoutFailure({
      cause: input.error,
      message,
      provider: input.provider,
      retryable: true,
      timedOut: true,
    });
  }

  if (httpStatusCode !== null) {
    return new ProviderResponseFailure({
      cause: input.error,
      message,
      provider: input.provider,
      retryable,
      timedOut: false,
    });
  }

  return new ProviderTransportFailure({
    cause: input.error,
    message,
    provider: input.provider,
    retryable,
  });
}

export function getQueryFailureFlags(failure: DataSourceQueryFailure): {
  retryable: boolean;
  timedOut: boolean;
} {
  switch (failure._tag) {
    case "ProviderResponseFailure":
      return {
        retryable: failure.retryable,
        timedOut: failure.timedOut,
      };
    case "ProviderTransportFailure":
    case "QueryCancelledFailure":
      return {
        retryable: failure.retryable,
        timedOut: false,
      };
    case "QueryTimeoutFailure":
      return {
        retryable: true,
        timedOut: true,
      };
    case "QueryInputFailure":
    case "QueryValidationFailure":
    case "UnsupportedProviderFailure":
      return {
        retryable: false,
        timedOut: false,
      };
    default:
      return assertNever(failure);
  }
}

export function isDataSourceQueryFailure(
  error: unknown
): error is DataSourceQueryFailure {
  return (
    QueryInputFailure.is(error) ||
    QueryValidationFailure.is(error) ||
    ProviderTransportFailure.is(error) ||
    ProviderResponseFailure.is(error) ||
    QueryTimeoutFailure.is(error) ||
    QueryCancelledFailure.is(error) ||
    UnsupportedProviderFailure.is(error)
  );
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

function assertNever(value: never): never {
  throw new Error(`Unhandled query failure: ${String(value)}`);
}
