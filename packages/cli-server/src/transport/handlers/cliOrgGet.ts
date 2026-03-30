import { createFactory } from "hono/factory";

import type { CliOrgGetContext } from "../../../generated/cli.context";
import type { CliOrgReadResponse } from "../../../generated/cli.schemas";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliOrgGetParams,
  CliOrgGetQueryParams,
  CliOrgGetResponse,
} from "../../../generated/cli.zod";
import type { CliOrgRouteVariables, CliRouteEnv } from "../../app";
import { cliSessionMiddleware } from "../../auth/middleware";
import type { CliAction } from "../../authorization";
import {
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware,
} from "../../organization/middleware";
import { createCliFieldsReadControlsMiddleware } from "../../read-controls";
import type { CliFieldsReadControls } from "../../read-controls";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";

const factory = createFactory();

export const cliOrgGetHandlers = factory.createHandlers(
  cliSessionMiddleware,
  zValidator(
    "param",
    CliOrgGetParams,
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
    CliOrgGetQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid organization read request",
      defaultStage: "resolve_org",
      hint: "correct the request query and retry",
    })
  ),
  createCliFieldsReadControlsMiddleware({
    allowedFields: ["slug", "name", "roles", "capabilities"],
    defaultStage: "resolve_org",
    hint: "correct the read controls and retry",
  }),
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware("org.read"),
  zValidator("response", CliOrgGetResponse),
  async (
    c: CliOrgGetContext<
      CliRouteEnv<
        CliOrgRouteVariables & { readControls: CliFieldsReadControls }
      >
    >
  ) => {
    const response = buildOrgReadResponse({
      slug: c.var.authorizedOrg.org.slug,
      name: c.var.authorizedOrg.org.name,
      // Comment: org membership storage can encode multiple role names, so the
      // CLI surface returns the normalized role list instead of one ambiguous label.
      roles: c.var.authorizedOrg.membershipRoles.map((role) => role),
      capabilities: c.var.authorizedOrg.capabilities.map(
        (capability) => capability
      ),
    });

    return c.json(
      buildCliSuccessEnvelope({
        data: projectOrg(response, c.var.readControls.selectedFields),
        requestId: c.var.requestId,
      }),
      200
    );
  }
);

function buildOrgReadResponse(input: {
  slug: string;
  name: string;
  roles: readonly string[];
  capabilities: readonly CliAction[];
}): CliOrgReadResponse {
  return {
    capabilities: [...input.capabilities],
    name: input.name,
    roles: [...input.roles],
    slug: input.slug,
  };
}

function projectOrg(
  org: CliOrgReadResponse,
  selectedFields: CliFieldsReadControls["selectedFields"]
): CliOrgReadResponse {
  if (!selectedFields) {
    return org;
  }

  const projected: CliOrgReadResponse = {};

  if (selectedFields.has("slug")) {
    projected.slug = org.slug;
  }

  if (selectedFields.has("name")) {
    projected.name = org.name;
  }

  if (selectedFields.has("roles")) {
    projected.roles = org.roles ? [...org.roles] : [];
  }

  if (selectedFields.has("capabilities")) {
    projected.capabilities = org.capabilities ? [...org.capabilities] : [];
  }

  return projected;
}
