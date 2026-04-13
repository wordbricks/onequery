import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import type {
  ConnectRouter,
  ConnectRouterOptions,
  ContextValues,
} from "@connectrpc/connect";
import {
  compressionBrotli,
  compressionGzip,
  universalRequestFromNodeRequest,
  universalResponseToNodeResponse,
} from "@connectrpc/connect-node";
import type { UniversalHandler } from "@connectrpc/connect/protocol";
import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { Context, Env } from "hono";
import { createMiddleware } from "hono/factory";

export type HonoNodeBindings = HttpBindings | Http2Bindings;

export interface HonoConnectMiddlewareOptions<
  E extends Env & { Bindings: HonoNodeBindings },
> extends ConnectRouterOptions {
  routes: (router: ConnectRouter) => void;
  requestPathPrefix?: string;
  contextValues?: (context: Context<E>) => ContextValues;
}

export function honoConnectMiddleware<
  E extends Env & { Bindings: HonoNodeBindings },
>(options: HonoConnectMiddlewareOptions<E>) {
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

    const { incoming, outgoing } = c.env;

    try {
      const request = universalRequestFromNodeRequest(
        incoming,
        outgoing,
        undefined,
        contextValues?.(c)
      );

      await universalResponseToNodeResponse(await handler(request), outgoing);
      return RESPONSE_ALREADY_SENT;
    } catch (reason) {
      if (ConnectError.from(reason).code === Code.Aborted) {
        return RESPONSE_ALREADY_SENT;
      }

      // eslint-disable-next-line no-console
      console.error(
        `handler for rpc ${handler.method.name} of ${handler.service.typeName} failed`,
        reason
      );
      return outgoing.headersSent
        ? RESPONSE_ALREADY_SENT
        : new Response(null, { status: 500 });
    }
  });
}
