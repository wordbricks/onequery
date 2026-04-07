import {
  Code,
  ConnectError,
  createContextKey,
  createContextValues,
} from "@connectrpc/connect";
import type { ContextValues, HandlerContext } from "@connectrpc/connect";
import type { Context } from "hono";

import type { CliRouteEnv } from "../app";
import type { AuthorizedCliOrgContext, CliAction } from "../authorization";
import type { CliSessionIdentity } from "../domain/workflows";
import { getCliRequestId } from "../error";
import {
  requireAuthenticatedCliSession,
  requireAuthorizedCliOrg,
} from "./service/access";

type CliConnectRequestContextDependencies = {
  requireAuthenticatedCliSession?: typeof requireAuthenticatedCliSession;
  requireAuthorizedCliOrg?: typeof requireAuthorizedCliOrg;
};

export const cliHonoContextKey = createContextKey<
  Context<CliRouteEnv> | undefined
>(undefined, {
  description: "onequery-cli-hono-context",
});

export type CliConnectRequestContext = {
  honoContext: Context<CliRouteEnv>;
  requestId: string;
  requireSession(): Promise<CliSessionIdentity>;
  requireAuthorizedOrg(input: {
    action: CliAction;
    orgSlug: string;
    session?: CliSessionIdentity;
  }): Promise<AuthorizedCliOrgContext>;
};

export const cliConnectRequestContextKey = createContextKey<
  CliConnectRequestContext | undefined
>(undefined, {
  description: "onequery-cli-connect-request-context",
});

export function createCliConnectRequestContext(
  c: Context<CliRouteEnv>,
  dependencies: CliConnectRequestContextDependencies = {}
): CliConnectRequestContext {
  const requireAuthenticatedCliSessionImpl =
    dependencies.requireAuthenticatedCliSession ??
    requireAuthenticatedCliSession;
  const requireAuthorizedCliOrgImpl =
    dependencies.requireAuthorizedCliOrg ?? requireAuthorizedCliOrg;
  let sessionPromise: Promise<CliSessionIdentity> | undefined;
  const authorizedOrgPromises = new Map<
    string,
    Promise<AuthorizedCliOrgContext>
  >();

  const requestContext: CliConnectRequestContext = {
    honoContext: c,
    requestId: getCliRequestId(c),
    requireSession() {
      sessionPromise ??= requireAuthenticatedCliSessionImpl(c);
      return sessionPromise;
    },
    requireAuthorizedOrg(input) {
      const cacheKey = `${input.action}:${input.orgSlug}`;
      let authorizedOrgPromise = authorizedOrgPromises.get(cacheKey);
      if (!authorizedOrgPromise) {
        authorizedOrgPromise = (async () =>
          requireAuthorizedCliOrgImpl({
            action: input.action,
            c,
            orgSlug: input.orgSlug,
            session: input.session ?? (await requestContext.requireSession()),
          }))();
        authorizedOrgPromises.set(cacheKey, authorizedOrgPromise);
      }

      return authorizedOrgPromise;
    },
  };

  return requestContext;
}

export function createCliConnectContextValues(
  c: Context<CliRouteEnv>
): ContextValues {
  return createContextValues()
    .set(cliHonoContextKey, c)
    .set(cliConnectRequestContextKey, createCliConnectRequestContext(c));
}

export function requireCliConnectHonoContext(
  context: Pick<HandlerContext, "values">
): Context<CliRouteEnv> {
  const honoContext = context.values.get(cliHonoContextKey);
  if (!honoContext) {
    throw new ConnectError("missing cli hono context", Code.Internal);
  }

  return honoContext;
}

export function requireCliConnectRequestContext(
  context: Pick<HandlerContext, "values">
): CliConnectRequestContext {
  const requestContext = context.values.get(cliConnectRequestContextKey);
  if (!requestContext) {
    throw new ConnectError(
      "missing cli connect request context",
      Code.Internal
    );
  }

  return requestContext;
}
