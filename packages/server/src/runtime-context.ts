import { createMiddleware } from "hono/factory";

import type { ServerRuntimeConfig } from "./runtime";

export interface ServerRuntimeVariables {
  runtime: ServerRuntimeConfig;
}

export function serverRuntimeMiddleware(runtime: ServerRuntimeConfig) {
  return createMiddleware<{
    Variables: ServerRuntimeVariables;
  }>(async (c, next) => {
    c.set("runtime", runtime);
    await next();
  });
}
