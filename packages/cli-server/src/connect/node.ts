import { ConnectError, createConnectRouter } from "@connectrpc/connect";
import type { ConnectRouterOptions, Interceptor } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { ConnectNodeAdapterOptions } from "@connectrpc/connect-node";
import { createValidateInterceptor } from "@connectrpc/validate";

import { cliConnectRequestContextKey } from "./context";
import { withCliRequestId } from "./error";
import { registerCliConnectRoutes } from "./routes";

const cliRequestIdInterceptor: Interceptor = (next) => async (request) => {
  try {
    return await next(request);
  } catch (reason) {
    const requestContext = request.contextValues.get(
      cliConnectRequestContextKey
    );
    const requestId = requestContext?.requestId ?? "unknown";
    throw withCliRequestId(ConnectError.from(reason), requestId);
  }
};

const cliConnectRouterOptions = {
  connect: true,
  grpc: false,
  grpcWeb: false,
  interceptors: [cliRequestIdInterceptor, createValidateInterceptor()],
} satisfies Pick<
  ConnectRouterOptions,
  "connect" | "grpc" | "grpcWeb" | "interceptors"
>;

export type CreateCliConnectHandlerOptions = Omit<
  ConnectNodeAdapterOptions,
  "routes"
>;

const cliConnectRequestPaths = (() => {
  const router = createConnectRouter(cliConnectRouterOptions);
  registerCliConnectRoutes(router);
  return Object.freeze(router.handlers.map((handler) => handler.requestPath));
})();

export function createCliConnectHandler(
  options: CreateCliConnectHandlerOptions = {}
) {
  return connectNodeAdapter({
    ...cliConnectRouterOptions,
    ...options,
    routes: registerCliConnectRoutes,
  });
}

export function listCliConnectRequestPaths() {
  return cliConnectRequestPaths;
}

export function listCliConnectMountedRequestPaths(
  input: Pick<CreateCliConnectHandlerOptions, "requestPathPrefix"> = {}
) {
  const requestPathPrefix = input.requestPathPrefix ?? "";
  return listCliConnectRequestPaths().map(
    (requestPath) => requestPathPrefix + requestPath
  );
}
