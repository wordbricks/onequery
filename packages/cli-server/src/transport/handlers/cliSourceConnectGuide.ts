import { createFactory } from "hono/factory";

import type { CliSourceConnectGuideContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliSourceConnectGuideParams,
  CliSourceConnectGuideQueryParams,
  CliSourceConnectGuideResponse,
} from "../../../generated/cli.zod";
import type { CliOrgRouteVariables, CliRouteEnv } from "../../app";
import { cliSessionMiddleware } from "../../auth/middleware";
import { buildCliRequestLogDetails, logCliEvent } from "../../observability";
import {
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware,
} from "../../organization/middleware";
import { buildCliSourceConnectGuide } from "../../source/connect";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";

type CliSourceConnectGuideHandlerEnv = CliRouteEnv<CliOrgRouteVariables>;

const factory = createFactory();

export const cliSourceConnectGuideHandlers = factory.createHandlers(
  cliSessionMiddleware,
  zValidator(
    "param",
    CliSourceConnectGuideParams,
    createCliValidationHook({
      defaultStage: "resolve_org",
      fieldStages: {
        orgSlug: "resolve_org",
      },
      hint: "correct the request and retry",
    })
  ),
  zValidator(
    "query",
    CliSourceConnectGuideQueryParams,
    createCliValidationHook({
      defaultStage: "resolve_source",
      fieldStages: {
        source: "resolve_source",
      },
      hint: "correct the request and retry",
    })
  ),
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware("source.connect"),
  zValidator("response", CliSourceConnectGuideResponse),
  async (c: CliSourceConnectGuideContext<CliSourceConnectGuideHandlerEnv>) => {
    const query = c.req.valid("query");
    const guide = buildCliSourceConnectGuide(query.source);

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: c.var.authorizedOrg.org.slug,
        provider: query.source,
        roles: c.var.authorizedOrg.membershipRoles,
      }),
      event: "source.connect.guide_served",
      level: "info",
    });

    return c.json(
      buildCliSuccessEnvelope({
        data: guide,
        requestId: c.var.requestId,
      }),
      200
    );
  }
);
