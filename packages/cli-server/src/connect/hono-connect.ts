import { ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { createValidateInterceptor } from "@connectrpc/validate";

import { createCliApp } from "../app";
import type { CreateCliAppOptions } from "../app";
import { getCliRequestId } from "../error";
import { cliHonoContextKey } from "./context";
import { withCliRequestId } from "./error";
import { honoConnectMiddleware } from "./middleware";
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

export function createCliConnectRoute(input: CreateCliAppOptions) {
  const app = createCliApp(input);

  app.use(
    "*",
    honoConnectMiddleware({
      connect: true,
      grpc: false,
      grpcWeb: false,
      interceptors: [cliRequestIdInterceptor, createValidateInterceptor()],
      routes: registerCliConnectRoutes,
    })
  );

  return app;
}
