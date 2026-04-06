import { Code, ConnectError } from "@connectrpc/connect";

import { CLI_PROBLEM_CATALOG } from "../domain/problems";
import type { CliApiErrorStage, CliProblemKey } from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../error";

export const CLI_ERROR_CODE_HEADER = "x-onequery-error-code";
export const CLI_ERROR_STAGE_HEADER = "x-onequery-error-stage";
export const CLI_ERROR_HINT_HEADER = "x-onequery-error-hint";
export const CLI_ERROR_RETRYABLE_HEADER = "x-onequery-error-retryable";
export const CLI_ERROR_RETRY_AFTER_MS_HEADER = "x-onequery-retry-after-ms";

type CreateCliConnectErrorInput = {
  key: CliProblemKey;
  detail?: string;
  stage?: CliApiErrorStage;
  hint?: string;
  retryAfterMs?: number;
  cause?: unknown;
};

export function createCliConnectError(input: CreateCliConnectErrorInput) {
  const problem = CLI_PROBLEM_CATALOG[input.key];
  const metadata = new Headers();
  const stage = input.stage ?? ("stage" in problem ? problem.stage : undefined);
  const hint = input.hint ?? ("hint" in problem ? problem.hint : undefined);

  metadata.set(CLI_ERROR_CODE_HEADER, problem.code);
  metadata.set(CLI_ERROR_RETRYABLE_HEADER, String(problem.retryable));

  if (stage) {
    metadata.set(CLI_ERROR_STAGE_HEADER, stage);
  }
  if (hint) {
    metadata.set(CLI_ERROR_HINT_HEADER, hint);
  }
  if (typeof input.retryAfterMs === "number") {
    metadata.set(
      CLI_ERROR_RETRY_AFTER_MS_HEADER,
      String(Math.max(0, Math.trunc(input.retryAfterMs)))
    );
  }

  // Comment: the same catalog still backs both REST and Connect flows during
  // migration, but the Connect transport now emits only native code/message/
  // metadata instead of re-wrapping the REST problem document.
  return new ConnectError(
    input.detail ?? problem.title,
    httpStatusToCode(problem.status),
    metadata,
    [],
    input.cause
  );
}

export function throwCliConnectError(input: CreateCliConnectErrorInput): never {
  throw createCliConnectError(input);
}

export function withCliRequestId(error: ConnectError, requestId: string) {
  error.metadata.set(CLI_REQUEST_ID_HEADER, requestId);
  return error;
}

function httpStatusToCode(status: number) {
  switch (status) {
    case 400:
    case 422:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 409:
      return Code.AlreadyExists;
    case 410:
      return Code.FailedPrecondition;
    case 429:
      return Code.ResourceExhausted;
    case 503:
      return Code.Unavailable;
    case 504:
      return Code.DeadlineExceeded;
    default:
      return status >= 500 ? Code.Internal : Code.Unknown;
  }
}
