import type { UserScope } from "@/queries/organization-query-keys";
import { resolveUserScope } from "@/queries/organization-query-keys";

export const teamQueryKeys = {
  all: (userId: UserScope, organizationId: string) =>
    ["team", resolveUserScope(userId), organizationId] as const,
  invitations: (userId: UserScope, organizationId: string) =>
    [...teamQueryKeys.all(userId, organizationId), "invitations"] as const,
  members: (userId: UserScope, organizationId: string) =>
    [...teamQueryKeys.all(userId, organizationId), "members"] as const,
};
