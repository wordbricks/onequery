import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import type {
  ConnectRouter,
  ConnectRouterOptions,
  ContextValues,
} from "@connectrpc/connect";
import { compressionBrotli, compressionGzip } from "@connectrpc/connect-node";
import type { UniversalHandler } from "@connectrpc/connect/protocol";
import {
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from "@connectrpc/connect/protocol";
import type { Context, Env } from "hono";
import { createMiddleware } from "hono/factory";

export interface HonoConnectMiddlewareOptions<
  E extends Env,
> extends ConnectRouterOptions {
  routes: (router: ConnectRouter) => void;
  requestPathPrefix?: string;
  contextValues?: (context: Context<E>) => ContextValues;
}

export function honoConnectMiddleware<E extends Env>(
  options: HonoConnectMiddlewareOptions<E>
) {
  const {
    acceptCompression = [compressionGzip, compressionBrotli],
    contextValues,
    requestPathPrefix = "",
    routes,
    ...connectOptions
  } = options;
  const router = createConnectRouter({
    ...connectOptions,
    acceptCompression,
  });
  routes(router);

  const exactPaths = new Map<string, UniversalHandler>(
    router.handlers.map((handler) => [
      requestPathPrefix + handler.requestPath,
      handler,
    ])
  );

  return createMiddleware<E>(async (c, next) => {
    const handler = exactPaths.get(c.req.path);
    if (!handler) {
      return next();
    }

    try {
      const request = {
        ...universalServerRequestFromFetch(c.req.raw, {
          httpVersion: "1.1",
        }),
        contextValues: contextValues?.(c),
      };

      return universalServerResponseToFetch(await handler(request));
    } catch (reason) {
      if (ConnectError.from(reason).code === Code.Aborted) {
        return;
      }

      // eslint-disable-next-line no-console
      console.error(
        `handler for rpc ${handler.method.name} of ${handler.service.typeName} failed`,
        reason
      );
      return new Response(null, { status: 500 });
    }
  });
}
