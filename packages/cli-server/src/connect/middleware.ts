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

export function honoConnectMiddleware<E extends CliRouteEnv>(
  options: HonoConnectMiddlewareOptions
) {
  const router = createConnectRouter(options);
  options.routes(router);

  const prefix = options.requestPathPrefix ?? "";
  const exactPaths = new Map<string, UniversalHandler>(
    router.handlers.map((handler) => [prefix + handler.requestPath, handler])
  );

  return createMiddleware<{ Variables: E["Variables"] }>(async (c, next) => {
    const handler = exactPaths.get(c.req.path);
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
