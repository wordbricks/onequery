export type UserScope = string | undefined;

export function resolveUserScope(userId: UserScope): string {
  return userId ?? "anonymous";
}

export const organizationQueryKeys = {
  all: (userId: UserScope) =>
    ["organization", resolveUserScope(userId)] as const,
  audit: (
    userId: UserScope,
    slug: string,
    search: Record<string, string | number | undefined>
  ) => [...organizationQueryKeys.all(userId), "audit", slug, search] as const,
  bySlug: (userId: UserScope, slug: string) =>
    [...organizationQueryKeys.all(userId), "bySlug", slug] as const,
  list: (userId: UserScope) =>
    [...organizationQueryKeys.all(userId), "list"] as const,
  pendingInvitations: (userId: UserScope) =>
    [...organizationQueryKeys.all(userId), "pendingInvitations"] as const,
};
