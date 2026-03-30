import { createFactory } from "hono/factory";

import type { CliSourceShowContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliSourceShowParams,
  CliSourceShowQueryParams,
  CliSourceShowResponse,
} from "../../../generated/cli.zod";
import type { CliOrgRouteVariables, CliRouteEnv } from "../../app";
import { cliSessionMiddleware } from "../../auth/middleware";
import { buildCliRequestLogDetails, logCliEvent } from "../../observability";
import {
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware,
} from "../../organization/middleware";
import { createCliFieldsReadControlsMiddleware } from "../../read-controls";
import type { CliFieldsReadControls } from "../../read-controls";
import { runCliLoadSourceEffect } from "../../source/effects";
import {
  buildCliSourceSummary,
  sourceNotFoundProblem,
} from "../../source/model";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";
import { projectCliSourceSummary } from "../source-response";

type CliSourceShowHandlerEnv = CliRouteEnv<
  CliOrgRouteVariables & { readControls: CliFieldsReadControls }
>;

const factory = createFactory();

export const cliSourceShowHandlers = factory.createHandlers(
  cliSessionMiddleware,
  zValidator(
    "param",
    CliSourceShowParams,
    createCliValidationHook({
      defaultStage: "resolve_source",
      fieldStages: {
        orgSlug: "resolve_org",
        sourceKey: "resolve_source",
      },
      hint: "correct the request and retry",
    })
  ),
  zValidator(
    "query",
    CliSourceShowQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid source lookup request",
      defaultStage: "resolve_source",
      hint: "correct the request query and retry",
    })
  ),
  createCliFieldsReadControlsMiddleware({
    allowedFields: ["name", "displayName", "provider", "queryable", "status"],
    defaultStage: "resolve_source",
    hint: "correct the read controls and retry",
  }),
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware("source.read"),
  zValidator("response", CliSourceShowResponse),
  async (c: CliSourceShowContext<CliSourceShowHandlerEnv>) => {
    const { sourceKey } = c.req.valid("param");
    const source = await runCliLoadSourceEffect({
      db: c.var.db,
      effect: {
        kind: "load_source",
        organizationId: c.var.authorizedOrg.org.id,
        sourceKey,
      },
    });

    if (source.kind === "not_found") {
      logCliEvent({
        details: buildCliRequestLogDetails(c, {
          orgSlug: c.var.authorizedOrg.org.slug,
          roles: c.var.authorizedOrg.membershipRoles,
          sourceKey,
        }),
        event: "source.lookup.not_found",
        level: "warn",
      });
      throw sourceNotFoundProblem(c.var.authorizedOrg.org.slug, sourceKey);
    }

    const response = buildCliSourceSummary(source.source);

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: c.var.authorizedOrg.org.slug,
        roles: c.var.authorizedOrg.membershipRoles,
        sourceKey,
        provider: response.provider,
        queryable: response.queryable,
      }),
      event: "source.lookup.resolved",
      level: "info",
    });

    return c.json(
      buildCliSuccessEnvelope({
        data: projectCliSourceSummary(
          response,
          c.var.readControls.selectedFields
        ),
        requestId: c.var.requestId,
      }),
      200
    );
  }
);
