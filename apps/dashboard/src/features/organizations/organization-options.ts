import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { organization } from "@/lib/auth-client";
import { organizationQueryKeys } from "@/queries/organization-query-keys";
import type { UserScope } from "@/queries/organization-query-keys";

export const OrganizationOptionSchema = z.object({
  id: z.string(),
  logo: z.string().nullable(),
  name: z.string(),
  slug: z.string().nullable(),
});

export type OrganizationOption = z.infer<typeof OrganizationOptionSchema>;

async function fetchOrganizations(): Promise<OrganizationOption[]> {
  const result = await organization.list();
  if (!result.data || !Array.isArray(result.data)) {
    return [];
  }

  const organizations: OrganizationOption[] = [];

  for (const entry of result.data) {
    const parsed = OrganizationOptionSchema.safeParse(entry);
    if (parsed.success) {
      organizations.push(parsed.data);
    }
  }

  return organizations;
}

export function organizationsQueryOptions(userId: UserScope) {
  return queryOptions({
    queryFn: fetchOrganizations,
    // Comment: membership data is persisted client-side, so the cache must be
    // scoped by authenticated user instead of a single global organization key.
    queryKey: organizationQueryKeys.list(userId),
    staleTime: 5 * 60 * 1000,
  });
}

export function resolveOrganizationSlug(org: OrganizationOption): string {
  if (org.slug) {
    return org.slug;
  }
  return "default";
}

export function getOrganizationInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "O";
  }
  return trimmed.slice(0, 1).toUpperCase();
}
