import {
  Code,
  ConnectError,
  createContextKey,
  createContextValues,
} from "@connectrpc/connect";
import type { ContextValues, HandlerContext } from "@connectrpc/connect";
import { Result } from "better-result";
import type { Context } from "hono";

import type { CliRouteEnv } from "../app";
import type { ResolveCliSessionIdentityOptions } from "../auth/session-identity";
import type { AuthorizedCliOrgContext, CliAction } from "../authorization";
import type { CliSessionIdentity } from "../domain/workflows";
import { getCliRequestId } from "../request-context";
import {
  resolveAuthenticatedCliSession,
  resolveAuthorizedCliOrg,
} from "./service/access";
import type { CliServiceResult } from "./service/result";

type CliConnectRequestContextDependencies = {
  resolveAuthenticatedCliSession?: typeof resolveAuthenticatedCliSession;
  resolveAuthorizedCliOrg?: typeof resolveAuthorizedCliOrg;
};

export type CliConnectRequestContext = {
  honoContext: Context<CliRouteEnv>;
  requestId: string;
  resolveSession(
    options?: ResolveCliSessionIdentityOptions
  ): Promise<CliServiceResult<CliSessionIdentity>>;
  resolveAuthorizedOrg(input: {
    action: CliAction;
    orgSlug: string;
    session?: CliSessionIdentity;
  }): Promise<CliServiceResult<AuthorizedCliOrgContext>>;
};

export type AuthenticatedCliConnectRequestContext = {
  honoContext: Context<CliRouteEnv>;
  requestId: string;
  session: CliSessionIdentity;
  resolveAuthorizedOrg(input: {
    action: CliAction;
    orgSlug: string;
  }): Promise<CliServiceResult<AuthorizedCliOrgContext>>;
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
  const resolveAuthenticatedCliSessionImpl =
    dependencies.resolveAuthenticatedCliSession ??
    resolveAuthenticatedCliSession;
  const resolveAuthorizedCliOrgImpl =
    dependencies.resolveAuthorizedCliOrg ?? resolveAuthorizedCliOrg;
  let sessionPromise: Promise<CliServiceResult<CliSessionIdentity>> | undefined;
  let sessionWithActiveOrgSlugPromise:
    | Promise<CliServiceResult<CliSessionIdentity>>
    | undefined;
  const authorizedOrgPromises = new Map<
    string,
    Promise<CliServiceResult<AuthorizedCliOrgContext>>
  >();

  const requestContext: CliConnectRequestContext = {
    honoContext: c,
    requestId: getCliRequestId(c),
    resolveSession(options) {
      if (options?.includeActiveOrgSlug === true) {
        sessionWithActiveOrgSlugPromise ??= resolveAuthenticatedCliSessionImpl(
          c,
          options
        );
        return sessionWithActiveOrgSlugPromise;
      }

      if (sessionWithActiveOrgSlugPromise !== undefined) {
        return sessionWithActiveOrgSlugPromise;
      }

      sessionPromise ??= resolveAuthenticatedCliSessionImpl(c);
      return sessionPromise;
    },
    resolveAuthorizedOrg(input) {
      const cacheKey = `${input.action}:${input.orgSlug}`;
      let authorizedOrgPromise = authorizedOrgPromises.get(cacheKey);
      if (!authorizedOrgPromise) {
        authorizedOrgPromise = (async () => {
          const sessionResult = input.session
            ? Result.ok(input.session)
            : await requestContext.resolveSession();
          if (sessionResult.isErr()) {
            return Result.err(sessionResult.error);
          }

          return resolveAuthorizedCliOrgImpl({
            action: input.action,
            c,
            orgSlug: input.orgSlug,
            session: sessionResult.value,
          });
        })();
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
  return createContextValues().set(
    cliConnectRequestContextKey,
    createCliConnectRequestContext(c)
  );
}

export function createAuthenticatedCliConnectRequestContext(
  requestContext: CliConnectRequestContext,
  session: CliSessionIdentity
): AuthenticatedCliConnectRequestContext {
  return {
    honoContext: requestContext.honoContext,
    requestId: requestContext.requestId,
    session,
    resolveAuthorizedOrg(input) {
      return requestContext.resolveAuthorizedOrg({
        ...input,
        session,
      });
    },
  };
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
