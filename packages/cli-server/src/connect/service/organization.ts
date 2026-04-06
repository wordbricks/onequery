import type { MessageInitShape } from "@bufbuild/protobuf";

import type { AuthorizedCliOrgContext } from "../../authorization";
import { runCliListVisibleOrgs } from "../../organization/effects";
import type { CliSelectedFields } from "../../read-controls-policy";
import { paginateItems } from "../../read-controls-policy";
import { requireCliConnectHonoContext } from "../context";
import {
  CliOrganizationSummarySchema,
  GetOrganizationResponseSchema,
} from "../gen/onequery/cli/v1/org_pb";
import {
  requireAuthenticatedCliSession,
  requireAuthorizedCliOrg,
} from "./access";
import { toCliOrgCapability } from "./conversions";
import {
  buildCliPage,
  parseCliFieldsReadControls,
  parseCliPaginatedReadControls,
} from "./read-controls";
import type { CliServiceMethod } from "./types";

const ORG_LIST_FIELDS = [
  "organizations",
  "organizations.slug",
  "organizations.name",
] as const;

const ORG_FIELDS = ["slug", "name", "roles", "capabilities"] as const;

type CliOrganizationSummaryInit = MessageInitShape<
  typeof CliOrganizationSummarySchema
>;
type GetOrganizationResponseInit = MessageInitShape<
  typeof GetOrganizationResponseSchema
>;

export const handleListOrganizations: CliServiceMethod<
  "listOrganizations"
> = async (request, context) => {
  const c = requireCliConnectHonoContext(context);
  const readControls = parseCliPaginatedReadControls(request, {
    allowedFields: ORG_LIST_FIELDS,
    defaultStage: "auth",
    hint: "correct the read controls and retry",
  });
  const session = await requireAuthenticatedCliSession(c);
  const organizations = await runCliListVisibleOrgs({
    db: c.var.storage.db,
    userId: session.user.id,
  });
  const page = paginateItems(organizations, readControls);

  return {
    organizations: page.items.map((organization) =>
      projectCliOrganizationSummary(organization, readControls.selectedFields)
    ),
    page: buildCliPage(page.page),
  };
};

export const handleGetOrganization: CliServiceMethod<
  "getOrganization"
> = async (request, context) => {
  const c = requireCliConnectHonoContext(context);
  const readControls = parseCliFieldsReadControls(request, {
    allowedFields: ORG_FIELDS,
    defaultStage: "resolve_org",
    hint: "correct the read controls and retry",
  });
  const session = await requireAuthenticatedCliSession(c);
  const authorizedOrg = await requireAuthorizedCliOrg({
    action: "org.read",
    c,
    orgSlug: request.orgSlug,
    session,
  });

  return projectCliOrganizationDetails(
    authorizedOrg,
    readControls.selectedFields
  );
};

function projectCliOrganizationSummary(
  organization: { slug: string; name: string },
  selectedFields: CliSelectedFields
): CliOrganizationSummaryInit {
  if (!selectedFields || selectedFields.has("organizations")) {
    return {
      slug: organization.slug,
      name: organization.name,
    };
  }

  const projected: CliOrganizationSummaryInit = {};
  if (selectedFields.has("organizations.slug")) {
    projected.slug = organization.slug;
  }
  if (selectedFields.has("organizations.name")) {
    projected.name = organization.name;
  }

  return projected;
}

function projectCliOrganizationDetails(
  authorizedOrg: AuthorizedCliOrgContext,
  selectedFields: CliSelectedFields
): GetOrganizationResponseInit {
  const response = {
    slug: authorizedOrg.org.slug,
    name: authorizedOrg.org.name,
    roles: authorizedOrg.membershipRoles.map((role) => role),
    capabilities: authorizedOrg.capabilities.map(toCliOrgCapability),
  } satisfies GetOrganizationResponseInit;

  if (!selectedFields) {
    return response;
  }

  const projected: GetOrganizationResponseInit = {};
  if (selectedFields.has("slug")) {
    projected.slug = response.slug;
  }
  if (selectedFields.has("name")) {
    projected.name = response.name;
  }
  if (selectedFields.has("roles")) {
    projected.roles = response.roles;
  }
  if (selectedFields.has("capabilities")) {
    projected.capabilities = response.capabilities;
  }

  return projected;
}
