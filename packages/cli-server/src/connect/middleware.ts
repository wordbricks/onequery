import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import type { ConnectRouter, ConnectRouterOptions } from "@connectrpc/connect";
import type { UniversalHandler } from "@connectrpc/connect/protocol";
import {
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from "@connectrpc/connect/protocol";
import { createMiddleware } from "hono/factory";

import type { CliRouteEnv } from "../app";
import { createCliConnectContextValues } from "./context";

type HonoConnectMiddlewareOptions = ConnectRouterOptions & {
  routes: (router: ConnectRouter) => void;
  requestPathPrefix?: string;
};

type RoutedHandler = {
  requestPath: string;
  handler: UniversalHandler;
};

export function honoConnectMiddleware<E extends CliRouteEnv>(
  options: HonoConnectMiddlewareOptions
) {
  const router = createConnectRouter(options);
  options.routes(router);

  const prefix = options.requestPathPrefix ?? "";
  const routedHandlers: RoutedHandler[] = [];
  const exactPaths = new Map<string, UniversalHandler>();

  for (const handler of router.handlers) {
    const requestPath = prefix + handler.requestPath;
    routedHandlers.push({ requestPath, handler });
    exactPaths.set(requestPath, handler);
  }

  return createMiddleware<{ Variables: E["Variables"] }>(async (c, next) => {
    const handler = resolveConnectHandler(
      c.req.path,
      exactPaths,
      routedHandlers
    );
    if (!handler) {
      return next();
    }

    const request = {
      ...universalServerRequestFromFetch(c.req.raw, {
        httpVersion: "1.1",
      }),
      contextValues: createCliConnectContextValues(c),
    };

    try {
      return universalServerResponseToFetch(await handler(request));
    } catch (reason) {
      if (ConnectError.from(reason).code === Code.Aborted) {
        return;
      }

      // eslint-disable-next-line no-console
      console.error(
        `handler for matched connect route ${c.req.path} failed`,
        reason
      );
      throw reason;
    }
  });
}

function resolveConnectHandler(
  requestPath: string,
  exactPaths: ReadonlyMap<string, UniversalHandler>,
  routedHandlers: readonly RoutedHandler[]
) {
  const exactMatch = exactPaths.get(requestPath);
  if (exactMatch) {
    return exactMatch;
  }

  // Comment: mounted Hono sub-apps still see the full request path, so a
  // Connect app mounted under `/api/...` needs suffix matching unless the
  // caller passes an explicit requestPathPrefix.
  return routedHandlers.find(({ requestPath: candidatePath }) =>
    requestPath.endsWith(candidatePath)
  )?.handler;
}
