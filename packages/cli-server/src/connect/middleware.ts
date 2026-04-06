import {
  Code,
  ConnectError,
  createConnectRouter,
  createContextValues,
} from "@connectrpc/connect";
import type {
  ConnectRouter,
  ConnectRouterOptions,
  ContextKey,
} from "@connectrpc/connect";
import type { UniversalHandler } from "@connectrpc/connect/protocol";
import {
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from "@connectrpc/connect/protocol";
import type { Context, Env } from "hono";
import { createMiddleware } from "hono/factory";

type HonoConnectMiddlewareOptions<E extends Env> = ConnectRouterOptions & {
  routes: (router: ConnectRouter) => void;
  requestPathPrefix?: string;
  honoContextKey: ContextKey<Context<E> | undefined>;
};

type RoutedHandler = {
  requestPath: string;
  handler: UniversalHandler;
};

export function honoConnectMiddleware<E extends Env>(
  options: HonoConnectMiddlewareOptions<E>
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

  return createMiddleware<E>(async (c, next) => {
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
      contextValues: createContextValues().set(options.honoContextKey, c),
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
