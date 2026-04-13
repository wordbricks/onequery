import type { MessageInitShape } from "@bufbuild/protobuf";

import type { AuthorizedCliOrgContext } from "../../authorization";
import { runCliListVisibleOrgs } from "../../organization/effects";
import { paginateItems } from "../../read-controls-policy";
import { requireCliConnectRequestContext } from "../context";
import {
  CliOrgCapability,
  GetOrganizationResponseSchema,
} from "../gen/onequery/cli/v1/org_pb";
import { buildCliPage, parseCliPaginatedReadControls } from "./read-controls";
import type { CliServiceMethod } from "./types";

type GetOrganizationResponseInit = MessageInitShape<
  typeof GetOrganizationResponseSchema
>;

function toCliOrgCapability(
  value: AuthorizedCliOrgContext["capabilities"][number]
) {
  switch (value) {
    case "org.list":
      return CliOrgCapability.ORG_LIST;
    case "org.read":
      return CliOrgCapability.ORG_READ;
    case "source.connect":
      return CliOrgCapability.SOURCE_CONNECT;
    case "source.list":
      return CliOrgCapability.SOURCE_LIST;
    case "source.read":
      return CliOrgCapability.SOURCE_READ;
    case "source_api.describe":
      return CliOrgCapability.SOURCE_API_DESCRIBE;
    case "source_api.execute":
      return CliOrgCapability.SOURCE_API_EXECUTE;
    case "query.execute":
      return CliOrgCapability.QUERY_EXECUTE;
  }
}

export const handleListOrganizations: CliServiceMethod<
  "listOrganizations"
> = async (request, context) => {
  const requestContext = requireCliConnectRequestContext(context);
  const c = requestContext.honoContext;
  const readControls = parseCliPaginatedReadControls(request);
  const session = await requestContext.requireSession();
  const organizations = await runCliListVisibleOrgs({
    db: c.var.storage.db,
    userId: session.user.id,
  });
  const page = paginateItems(organizations, readControls);

  return {
    organizations: page.items.map((organization) => ({
      slug: organization.slug,
      name: organization.name,
    })),
    page: buildCliPage(page.page),
  };
};

export const handleGetOrganization: CliServiceMethod<
  "getOrganization"
> = async (request, context) => {
  const requestContext = requireCliConnectRequestContext(context);
  const authorizedOrg = await requestContext.requireAuthorizedOrg({
    action: "org.read",
    orgSlug: request.orgSlug,
  });

  return buildCliOrganizationDetails(authorizedOrg);
};

function buildCliOrganizationDetails(
  authorizedOrg: AuthorizedCliOrgContext
): GetOrganizationResponseInit {
  return {
    slug: authorizedOrg.org.slug,
    name: authorizedOrg.org.name,
    roles: authorizedOrg.membershipRoles.map((role) => role),
    capabilities: authorizedOrg.capabilities.map(toCliOrgCapability),
  } satisfies GetOrganizationResponseInit;
}
