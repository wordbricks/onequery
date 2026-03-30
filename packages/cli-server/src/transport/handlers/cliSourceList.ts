import { createFactory } from "hono/factory";
import type { z } from "zod";

import type { CliSourceListContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliSourceListParams,
  CliSourceListQueryParams,
  CliSourceListResponse as CliSourceListResponseSchema,
} from "../../../generated/cli.zod";
import type { CliOrgRouteVariables, CliRouteEnv } from "../../app";
import { cliSessionMiddleware } from "../../auth/middleware";
import { buildCliRequestLogDetails, logCliEvent } from "../../observability";
import {
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware,
} from "../../organization/middleware";
import { createCliPaginatedReadControlsMiddleware } from "../../read-controls";
import type {
  CliPaginatedReadControls,
  CliSelectedFields,
} from "../../read-controls";
import { paginateItems } from "../../read-controls-policy";
import { runCliListSourcesEffect } from "../../source/effects";
import { buildCliSourceListResult } from "../../source/model";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";
import { projectCliSourceSummary } from "../source-response";

type CliSourceListResponse = z.infer<typeof CliSourceListResponseSchema>;
type CliSourceListData = CliSourceListResponse["data"];
type CliSourceSummary = CliSourceListData["sources"][number];

type CliSourceListHandlerEnv = CliRouteEnv<
  CliOrgRouteVariables & { readControls: CliPaginatedReadControls }
>;

const factory = createFactory();

export const cliSourceListHandlers = factory.createHandlers(
  cliSessionMiddleware,
  zValidator(
    "param",
    CliSourceListParams,
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
    CliSourceListQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid source list request",
      defaultStage: "resolve_org",
      hint: "correct the request query and retry",
    })
  ),
  createCliPaginatedReadControlsMiddleware({
    allowedFields: [
      "sources",
      "sources.name",
      "sources.displayName",
      "sources.provider",
      "sources.queryable",
      "sources.status",
    ],
    defaultStage: "resolve_org",
    hint: "correct the read controls and retry",
  }),
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware("source.list"),
  zValidator("response", CliSourceListResponseSchema),
  async (c: CliSourceListContext<CliSourceListHandlerEnv>) => {
    const readControls = c.var.readControls;
    const sources = await runCliListSourcesEffect({
      db: c.var.db,
      effect: {
        kind: "list_sources",
        organizationId: c.var.authorizedOrg.org.id,
      },
    });
    const response = buildCliSourceListResult(sources.sources).sources;
    const page = paginateItems(response, readControls);

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: c.var.authorizedOrg.org.slug,
        roles: c.var.authorizedOrg.membershipRoles,
        sourceCount: response.length,
      }),
      event: "source.list.resolved",
      level: "info",
    });

    return c.json(
      buildCliSuccessEnvelope({
        data: buildSourceListResponse(page.items, readControls.selectedFields),
        page: page.page,
        requestId: c.var.requestId,
      }),
      200
    );
  }
);

function buildSourceListResponse(
  sources: readonly CliSourceSummary[],
  selectedFields: CliSelectedFields
): CliSourceListData {
  return {
    sources: sources.map((source) =>
      projectCliSourceSummary(source, selectedFields, "sources")
    ),
  };
}
