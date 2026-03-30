import { createFactory } from "hono/factory";

import type { CliSessionRefreshContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import { CliSessionRefreshResponse } from "../../../generated/cli.zod";
import type { CliRouteEnv } from "../../app";
import { refreshCliSessionIdentity } from "../../auth/session-identity";
import { buildCliSuccessEnvelope } from "../envelope";
import {
  buildCliAuthSessionRefreshResult,
  requireCliSessionIdentity,
} from "../session-response";

const factory = createFactory();

export const cliSessionRefreshHandlers = factory.createHandlers(
  zValidator("response", CliSessionRefreshResponse),
  async (c: CliSessionRefreshContext<CliRouteEnv>) => {
    const session = requireCliSessionIdentity(
      await refreshCliSessionIdentity(c.var.storage, c.req.raw.headers)
    );

    return c.json(
      buildCliSuccessEnvelope({
        data: buildCliAuthSessionRefreshResult(session),
        requestId: c.var.requestId,
      }),
      200
    );
  }
);
