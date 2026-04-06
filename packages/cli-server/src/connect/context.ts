import {
  Code,
  ConnectError,
  createContextKey,
  createContextValues,
} from "@connectrpc/connect";
import type { ContextValues, HandlerContext } from "@connectrpc/connect";
import type { Context } from "hono";

import type { CliRouteEnv } from "../app";

export const cliHonoContextKey = createContextKey<
  Context<CliRouteEnv> | undefined
>(undefined, {
  description: "onequery-cli-hono-context",
});

export function createCliConnectContextValues(
  c: Context<CliRouteEnv>
): ContextValues {
  return createContextValues().set(cliHonoContextKey, c);
}

export function requireCliConnectHonoContext(
  context: Pick<HandlerContext, "values">
): Context<CliRouteEnv> {
  const honoContext = context.values.get(cliHonoContextKey);
  if (!honoContext) {
    throw new ConnectError("missing cli hono context", Code.Internal);
  }

  return honoContext;
}
