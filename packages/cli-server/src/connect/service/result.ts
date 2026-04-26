import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import type { CliFailure, CreateCliFailureInput } from "../../domain/failures";
import { createCliFailure } from "../../domain/failures";
import { createCliConnectError } from "../error";
import type {
  CliServiceMethod,
  CliServiceMethodName,
  CliServiceResponse,
} from "./types";

export type CliServiceResult<T> = ResultType<T, CliFailure>;

export type CliResultServiceMethod<Name extends CliServiceMethodName> = (
  request: Parameters<CliServiceMethod<Name>>[0],
  context: Parameters<CliServiceMethod<Name>>[1]
) => Promise<CliServiceResult<CliServiceResponse<Name>>>;

export function createCliServiceFailure(input: CreateCliFailureInput) {
  return createCliFailure(input);
}

export function cliServiceErr<T = never>(
  input: CreateCliFailureInput
): CliServiceResult<T> {
  return Result.err(createCliFailure(input));
}

export function liftCliServiceMethod<Name extends CliServiceMethodName>(
  handler: CliResultServiceMethod<Name>
): CliServiceMethod<Name> {
  return (async (
    request: Parameters<CliServiceMethod<Name>>[0],
    context: Parameters<CliServiceMethod<Name>>[1]
  ) => {
    const result = await handler(request, context);
    if (result.isErr()) {
      throw createCliConnectError(result.error);
    }

    return result.value;
  }) as CliServiceMethod<Name>;
}
