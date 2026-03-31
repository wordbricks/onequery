import { createMiddleware } from "hono/factory";

import type { ServerRuntimeConfig } from "./runtime";

export interface ServerRuntimeVariables {
  runtime: ServerRuntimeConfig;
}

export function serverRuntimeMiddleware<
  Variables extends Record<string, unknown> = Record<string, never>,
>(runtime: ServerRuntimeConfig) {
  return createMiddleware<{
    Variables: ServerRuntimeVariables & Variables;
  }>(async (c, next) => {
    (
      c as typeof c & {
        set: (key: "runtime", value: ServerRuntimeConfig) => void;
      }
    ).set("runtime", runtime);
    await next();
  });
}
