import {
  doOrganizationRolesGrantPermission,
  organizationPermissionChecks,
  resolveOrganizationRoleNames,
} from "@onequery/server/auth/organization-permissions";
import type { OrganizationRoleName } from "@onequery/server/auth/organization-permissions";

import type { AccessibleCliOrg } from "./domain/workflows";

export const CLI_ACTIONS = [
  "org.list",
  "org.read",
  "source.connect",
  "source.list",
  "source.read",
  "query.execute",
] as const;

export type CliAction = (typeof CLI_ACTIONS)[number];

const CLI_ACTION_SET = new Set<string>(CLI_ACTIONS);

const CLI_ACTION_PERMISSIONS = {
  "org.list": organizationPermissionChecks.cliOrgList,
  "org.read": organizationPermissionChecks.cliOrgRead,
  "query.execute": organizationPermissionChecks.cliQueryExecute,
  "source.connect": organizationPermissionChecks.cliSourceConnect,
  "source.list": organizationPermissionChecks.cliSourceList,
  "source.read": organizationPermissionChecks.cliSourceRead,
} as const;

type CliActorAuthorization = {
  capabilities: readonly CliAction[];
  isKnownAction: boolean;
  membershipRoles: readonly OrganizationRoleName[];
};

export type AuthorizedCliOrgContext = {
  action: CliAction;
  capabilities: readonly CliAction[];
  isKnownAction: true;
  membershipRoles: readonly OrganizationRoleName[];
  org: AccessibleCliOrg;
};

function isCliAction(action: string): action is CliAction {
  return CLI_ACTION_SET.has(action);
}

export function resolveCliActorAuthorization(input: {
  action: string;
  rawMembershipRole: string | null | undefined;
}): CliActorAuthorization {
  const membershipRoles = resolveOrganizationRoleNames(input.rawMembershipRole);

  const capabilities = CLI_ACTIONS.filter((action) =>
    doOrganizationRolesGrantPermission({
      permission: CLI_ACTION_PERMISSIONS[action],
      roleNames: membershipRoles,
    })
  );

  return {
    capabilities,
    isKnownAction: isCliAction(input.action),
    membershipRoles,
  };
}

export function canCliActorAccessAction(input: {
  action: string;
  rawMembershipRole: string | null | undefined;
}): boolean {
  if (!isCliAction(input.action)) {
    return false;
  }

  const authorization = resolveCliActorAuthorization(input);
  return authorization.capabilities.includes(input.action);
}

export function authorizeCliOrgAccess(input: {
  action: string;
  rawMembershipRole: string | null | undefined;
  org: AccessibleCliOrg;
}):
  | {
      kind: "allowed";
      context: AuthorizedCliOrgContext;
    }
  | {
      kind: "forbidden";
      reason: "unknown_action" | "no_known_roles" | "missing_capability";
      authorization: CliActorAuthorization;
    } {
  if (!isCliAction(input.action)) {
    return {
      authorization: resolveCliActorAuthorization(input),
      kind: "forbidden",
      reason: "unknown_action",
    };
  }

  const action = input.action;
  const authorization = resolveCliActorAuthorization(input);
  if (authorization.membershipRoles.length === 0) {
    return {
      authorization,
      kind: "forbidden",
      reason: "no_known_roles",
    };
  }

  if (!authorization.capabilities.includes(action)) {
    return {
      authorization,
      kind: "forbidden",
      reason: "missing_capability",
    };
  }

  return {
    context: {
      action,
      capabilities: authorization.capabilities,
      isKnownAction: true,
      membershipRoles: authorization.membershipRoles,
      org: input.org,
    },
    kind: "allowed",
  };
}
