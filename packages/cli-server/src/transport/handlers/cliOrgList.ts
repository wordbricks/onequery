import type { Database } from "@onequery/db/server";
import { createFactory } from "hono/factory";

import type { CliOrgListContext } from "../../../generated/cli.context";
import type {
  CliOrgListResponse,
  CliOrgSummary,
} from "../../../generated/cli.schemas";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliOrgListQueryParams,
  CliOrgListResponse as CliOrgListResponseSchema,
} from "../../../generated/cli.zod";
import type { CliRouteEnv, CliSessionRouteVariables } from "../../app";
import { cliSessionMiddleware } from "../../auth/middleware";
import { runCliListVisibleOrgs } from "../../organization/effects";
import { cliDbMiddleware } from "../../organization/middleware";
import { createCliPaginatedReadControlsMiddleware } from "../../read-controls";
import type { CliPaginatedReadControls } from "../../read-controls";
import { paginateItems } from "../../read-controls-policy";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";

const factory = createFactory();

export const cliOrgListHandlers = factory.createHandlers(
  cliSessionMiddleware,
  zValidator(
    "query",
    CliOrgListQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid organization list request",
      defaultStage: "auth",
      hint: "correct the request query and retry",
    })
  ),
  createCliPaginatedReadControlsMiddleware({
    allowedFields: [
      "organizations",
      "organizations.slug",
      "organizations.name",
    ],
    defaultStage: "auth",
    hint: "correct the read controls and retry",
  }),
  cliDbMiddleware,
  zValidator("response", CliOrgListResponseSchema),
  async (
    c: CliOrgListContext<
      CliRouteEnv<
        CliSessionRouteVariables & {
          db: Database;
          readControls: CliPaginatedReadControls;
        }
      >
    >
  ) => {
    const readControls = c.var.readControls;
    const session = c.var.session;
    const organizations = await runCliListVisibleOrgs({
      db: c.var.db,
      userId: session.user.id,
    });

    const page = paginateItems(organizations, readControls);

    return c.json(
      buildCliSuccessEnvelope({
        data: buildOrgListResponse(page.items, readControls.selectedFields),
        page: page.page,
        requestId: c.var.requestId,
      }),
      200
    );
  }
);

function buildOrgListResponse(
  organizations: readonly CliOrgSummary[],
  selectedFields: CliPaginatedReadControls["selectedFields"]
): CliOrgListResponse {
  return {
    organizations: organizations.map((organization) =>
      projectOrganization(organization, selectedFields)
    ),
  };
}

function projectOrganization(
  organization: CliOrgSummary,
  selectedFields: CliPaginatedReadControls["selectedFields"]
): CliOrgSummary {
  if (!selectedFields || selectedFields.has("organizations")) {
    return organization;
  }

  const projected: CliOrgSummary = {};

  if (selectedFields.has("organizations.slug")) {
    projected.slug = organization.slug;
  }

  if (selectedFields.has("organizations.name")) {
    projected.name = organization.name;
  }

  return projected;
}
