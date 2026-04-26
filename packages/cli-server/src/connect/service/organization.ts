import type { MessageInitShape } from "@bufbuild/protobuf";
import { Result } from "better-result";

import type { AuthorizedCliOrgContext } from "../../authorization";
import { runCliListVisibleOrgs } from "../../organization/effects";
import { paginateItems } from "../../read-controls-policy";
import { requireCliConnectRequestContext } from "../context";
import {
  OrgCapability,
  GetOrganizationResponseSchema,
  OrganizationRole,
} from "../gen/onequery/cli/v1/org_pb";
import { buildCliPage, parseCliPageRequest } from "./read-controls";
import type { CliResultServiceMethod } from "./result";
import { liftCliServiceMethod } from "./result";

type GetOrganizationResponseInit = MessageInitShape<
  typeof GetOrganizationResponseSchema
>;

function toCliOrgCapability(
  value: AuthorizedCliOrgContext["capabilities"][number]
) {
  switch (value) {
    case "org.list":
      return OrgCapability.ORG_LIST;
    case "org.read":
      return OrgCapability.ORG_READ;
    case "source.connect":
      return OrgCapability.SOURCE_CONNECT;
    case "source.list":
      return OrgCapability.SOURCE_LIST;
    case "source.read":
      return OrgCapability.SOURCE_READ;
    case "source_api.describe":
      return OrgCapability.SOURCE_API_DESCRIBE;
    case "source_api.execute":
      return OrgCapability.SOURCE_API_EXECUTE;
    case "query.execute":
      return OrgCapability.QUERY_EXECUTE;
  }
}

function toCliOrganizationRole(
  value: AuthorizedCliOrgContext["membershipRoles"][number]
) {
  switch (value) {
    case "owner":
      return OrganizationRole.OWNER;
    case "admin":
      return OrganizationRole.ADMIN;
    case "member":
      return OrganizationRole.MEMBER;
  }
}

const handleListOrganizationsImpl: CliResultServiceMethod<
  "listOrganizations"
> = async (request, context) =>
  Result.gen(async function* handleListOrganizationsFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const readControls = yield* parseCliPageRequest({
      invalidRequestKey: "ORG_REQUEST_INVALID",
      page: request.page,
    });
    const session = yield* Result.await(requestContext.resolveSession());
    const organizations = await runCliListVisibleOrgs({
      db: c.var.storage.db,
      userId: session.user.id,
    });
    const page = paginateItems(organizations, readControls);

    return Result.ok({
      organizations: page.items.map((organization) => ({
        slug: organization.slug,
        name: organization.name,
      })),
      page: buildCliPage(page.page),
    });
  });

const handleGetOrganizationImpl: CliResultServiceMethod<
  "getOrganization"
> = async (request, context) =>
  Result.gen(async function* handleGetOrganizationFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action: "org.read",
        orgSlug: request.orgSlug,
      })
    );

    return Result.ok(buildCliOrganizationDetails(authorizedOrg));
  });

export const handleListOrganizations = liftCliServiceMethod(
  handleListOrganizationsImpl
);

export const handleGetOrganization = liftCliServiceMethod(
  handleGetOrganizationImpl
);

function buildCliOrganizationDetails(
  authorizedOrg: AuthorizedCliOrgContext
): GetOrganizationResponseInit {
  return {
    slug: authorizedOrg.org.slug,
    name: authorizedOrg.org.name,
    roles: authorizedOrg.membershipRoles.map(toCliOrganizationRole),
    capabilities: authorizedOrg.capabilities.map(toCliOrgCapability),
  } satisfies GetOrganizationResponseInit;
}
