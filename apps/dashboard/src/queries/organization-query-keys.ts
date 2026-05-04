import type { AuditListParams } from "@onequery/audit-contracts/audit";

export type UserScope = string | undefined;

export function resolveUserScope(userId: UserScope): string {
  return userId ?? "anonymous";
}

export const organizationQueryKeys = {
  all: (userId: UserScope) =>
    ["organization", resolveUserScope(userId)] as const,
  auditList: (userId: UserScope, slug: string, params: AuditListParams) =>
    [
      ...organizationQueryKeys.all(userId),
      "audit",
      slug,
      "list",
      params,
    ] as const,
  auditDetail: (
    userId: UserScope,
    slug: string,
    family: string,
    actionId: string
  ) =>
    [
      ...organizationQueryKeys.all(userId),
      "audit",
      slug,
      "detail",
      family,
      actionId,
    ] as const,
  bySlug: (userId: UserScope, slug: string) =>
    [...organizationQueryKeys.all(userId), "bySlug", slug] as const,
  list: (userId: UserScope) =>
    [...organizationQueryKeys.all(userId), "list"] as const,
  pendingInvitations: (userId: UserScope) =>
    [...organizationQueryKeys.all(userId), "pendingInvitations"] as const,
};
