import { ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { createValidateInterceptor } from "@connectrpc/validate";
import { honoConnectMiddleware } from "@onequery/hono-connect";

import { createCliApp } from "../app";
import type { CreateCliAppOptions } from "../app";
import { getCliRequestId } from "../error";
import { cliHonoContextKey, createCliConnectContextValues } from "./context";
import { withCliRequestId } from "./error";
import { registerCliConnectRoutes } from "./routes";

const cliRequestIdInterceptor: Interceptor = (next) => async (request) => {
  try {
    return await next(request);
  } catch (reason) {
    const honoContext = request.contextValues.get(cliHonoContextKey);
    const requestId = honoContext ? getCliRequestId(honoContext) : "unknown";
    throw withCliRequestId(ConnectError.from(reason), requestId);
  }
};

export interface CreateCliConnectRouteOptions extends CreateCliAppOptions {
  requestPathPrefix?: string;
}

export function createCliConnectRoute(input: CreateCliConnectRouteOptions) {
  const app = createCliApp(input);

  app.use(
    "*",
    honoConnectMiddleware({
      connect: true,
      grpc: false,
      grpcWeb: false,
      contextValues: createCliConnectContextValues,
      interceptors: [cliRequestIdInterceptor, createValidateInterceptor()],
      // Comment: the outer Bun app owns the `/api/cli` mount, so pass the
      // prefix explicitly instead of inferring it from Hono's full request path.
      requestPathPrefix: input.requestPathPrefix,
      routes: registerCliConnectRoutes,
    })
  );

  return app;
}
