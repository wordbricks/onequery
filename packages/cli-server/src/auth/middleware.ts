import { createMiddleware } from "hono/factory";

import type { CliRouteEnv, CliSessionRouteVariables } from "../app";
import { throwCliProblem } from "../error";
import { buildCliRequestLogDetails, logCliEvent } from "../observability";
import { resolveCliSessionIdentity } from "./session-identity";

export const cliSessionMiddleware = createMiddleware<
  CliRouteEnv<CliSessionRouteVariables>
>(async (c, next) => {
  const session = await resolveCliSessionIdentity(
    c.var.storage,
    c.req.raw.headers
  );
  if (!session) {
    logCliEvent({
      details: buildCliRequestLogDetails(c),
      event: "auth.session_missing",
      level: "warn",
    });
    throwCliProblem({
      detail: "no authenticated session was found",
      key: "NOT_LOGGED_IN",
    });
  }

  c.set("session", session);
  await next();
});
