import { Result } from "better-result";

import {
  createAuthenticatedCliConnectRequestContext,
  requireCliConnectRequestContext,
} from "../context";
import type { AuthenticatedCliConnectRequestContext } from "../context";
import type { CliResultServiceMethod, CliServiceResult } from "./result";
import { liftCliServiceMethod } from "./result";
import type {
  CliServiceMethod,
  CliServiceMethodName,
  CliServiceResponse,
} from "./types";

export type AuthenticatedCliResultServiceMethod<
  Name extends CliServiceMethodName,
> = (
  request: Parameters<CliServiceMethod<Name>>[0],
  context: AuthenticatedCliConnectRequestContext
) => Promise<CliServiceResult<CliServiceResponse<Name>>>;

export function liftAuthenticatedCliServiceMethod<
  Name extends CliServiceMethodName,
>(handler: AuthenticatedCliResultServiceMethod<Name>): CliServiceMethod<Name> {
  const authenticatedHandler: CliResultServiceMethod<Name> = async (
    request,
    context
  ) =>
    Result.gen(async function* liftAuthenticatedCliServiceMethodFlow() {
      const requestContext = requireCliConnectRequestContext(context);
      const session = yield* Result.await(requestContext.resolveSession());
      const authenticatedContext = createAuthenticatedCliConnectRequestContext(
        requestContext,
        session
      );
      const response = yield* Result.await(
        handler(request, authenticatedContext)
      );

      return Result.ok(response);
    });

  return liftCliServiceMethod(authenticatedHandler);
}
