import { Code, ConnectError, createConnectRouter } from "@connectrpc/connect";
import type {
  ConnectRouter,
  ConnectRouterOptions,
  ContextValues,
} from "@connectrpc/connect";
import {
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from "@connectrpc/connect/protocol";
import type { UniversalHandler } from "@connectrpc/connect/protocol";

import { LANDING_CONNECT_PATH_PREFIX } from "../landing-api";

interface WorkerHandlerOptions<Env> extends ConnectRouterOptions {
  /**
   * Route definitions. We recommend the following pattern:
   *
   * Create a file `connect.ts` with a default export such as this:
   *
   * ```ts
   * import {ConnectRouter} from "@connectrpc/connect";
   *
   * export default (router: ConnectRouter) => {
   *   router.service(ElizaService, {});
   * }
   * ```
   *
   * Then pass this function here.
   */
  routes: (router: ConnectRouter) => void;
  /**
   * Context values to extract from the request. These values are passed to
   * the handlers.
   */
  contextValues: (
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) => ContextValues;
}

export interface WorkerHandler<Env> {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

function normalizeRequestPathPrefix(requestPathPrefix: string) {
  if (requestPathPrefix === "/") {
    return "";
  }

  if (!requestPathPrefix.startsWith("/")) {
    throw new Error("requestPathPrefix must start with '/'");
  }

  return requestPathPrefix.endsWith("/")
    ? requestPathPrefix.slice(0, -1)
    : requestPathPrefix;
}

const landingRequestPathPrefix = normalizeRequestPathPrefix(
  LANDING_CONNECT_PATH_PREFIX
);

export function createWorkerHandler<Env>(
  options: WorkerHandlerOptions<Env>
): WorkerHandler<Env> {
  const { contextValues, routes, ...routerOptions } = options;

  const router = createConnectRouter(routerOptions);
  routes(router);

  const paths = new Map<string, UniversalHandler>();
  for (const handler of router.handlers) {
    paths.set(landingRequestPathPrefix + handler.requestPath, handler);
  }

  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const handler = paths.get(new URL(request.url).pathname);
      if (!handler) {
        return new Response("Not found", { status: 404 });
      }

      const universalRequest = {
        ...universalServerRequestFromFetch(request, {}),
        contextValues: contextValues(request, env, ctx),
      };

      try {
        const universalResponse = await handler(universalRequest);
        return universalServerResponseToFetch(universalResponse);
      } catch (reason) {
        if (ConnectError.from(reason).code === Code.Aborted) {
          return new Response(null, { status: 499 });
        }
        throw reason;
      }
    },
  };
}
