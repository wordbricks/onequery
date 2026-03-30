import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import {
  OrganizationOptionSchema,
  organizationsQueryOptions,
} from "@/features/organizations/organization-options";
import type { OrganizationOption } from "@/features/organizations/organization-options";
import { createApiClient } from "@/lib/api-client";
import { organization } from "@/lib/auth-client";
import {
  DEFAULT_QUERY_STALE_TIME_MS,
  SHORT_QUERY_RETRY_DELAY_MS,
} from "@/lib/query-timing";
import { getApiErrorMessage } from "@/queries/api-error";
import { organizationQueryKeys } from "@/queries/organization-query-keys";
import type { UserScope } from "@/queries/organization-query-keys";

// Module-level API client following codebase pattern
const client = createApiClient();

export type OrganizationSettings = {
  monthlyBudgetUsd: number | null;
};

type UpdateOrganizationSettingsInput = {
  monthlyBudgetUsd?: number | null;
};

async function fetchOrganizationSettings(
  slug: string
): Promise<OrganizationSettings> {
  const response = await client.api.organizations[":slug"].settings.$get({
    param: { slug },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      getApiErrorMessage(error, "Failed to fetch organization settings")
    );
  }

  const data = await response.json();
  return data.settings;
}

export function organizationSettingsQueryOptions(slug: string) {
  return queryOptions({
    queryFn: async () => fetchOrganizationSettings(slug),
    queryKey: ["organization", "settings", slug] as const,
    staleTime: DEFAULT_QUERY_STALE_TIME_MS,
  });
}

export async function updateOrganizationSettings(
  slug: string,
  settings: UpdateOrganizationSettingsInput
): Promise<OrganizationSettings> {
  const response = await client.api.organizations[":slug"].settings.$patch({
    json: settings,
    param: { slug },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      getApiErrorMessage(error, "Failed to update organization settings")
    );
  }

  const data = await response.json();
  return data.settings;
}

type OrganizationBySlugResult = {
  org: OrganizationOption;
};

class OrganizationBySlugError extends Error {
  readonly status: number;
  readonly responseBodySnippet?: string;

  constructor(status: number, slug: string, responseBodySnippet?: string) {
    super(`Failed to fetch organization by slug "${slug}" (status ${status})`);
    this.name = "OrganizationBySlugError";
    this.status = status;
    this.responseBodySnippet = responseBodySnippet;
  }
}

export function isOrganizationBySlugError(
  error: unknown
): error is OrganizationBySlugError {
  return error instanceof OrganizationBySlugError;
}

/**
 * Fetches organization by slug, checking cached membership list first.
 * Uses React Query for automatic request deduplication.
 *
 * Flow:
 * 1. Check cached organizations list (no API call if found)
 * 2. If found, set it active
 * 3. If not found, try the API endpoint in case the org list cache is stale
 *
 * @param input - Organization lookup dependencies
 * @returns Organization data with membership status
 * @throws {OrganizationBySlugError} if lookup fails (401/403/404/5xx)
 */
async function fetchOrganizationBySlug(input: {
  queryClient: QueryClient;
  slug: string;
  userId: UserScope;
}): Promise<OrganizationBySlugResult> {
  const { queryClient, slug, userId } = input;

  const organizationsQuery = organizationsQueryOptions(userId);
  const cachedOrgs =
    queryClient.getQueryData<OrganizationOption[]>(
      organizationsQuery.queryKey
    ) ?? (await queryClient.ensureQueryData(organizationsQuery));

  // First, check the cached membership list (no API call needed)
  const found = cachedOrgs.find((org) => org.slug === slug);
  if (found) {
    // Set active organization in background - not awaited since org data
    // is already available from cache. Backend context update is non-blocking.
    organization.setActive({ organizationId: found.id }).catch((error) => {
      console.error("Failed to set active organization in background:", error);
    });
    return { org: found };
  }

  // Not in the cached membership list - fall back to the API in case the list
  // cache is stale after org creation, invitation acceptance, or role changes.
  const response = await client.api.organizations[":slug"].$get({
    param: { slug },
  });

  if (!response.ok) {
    const responseBodySnippet = await response
      .text()
      .then((text) => text.trim().slice(0, 500))
      .catch(() => undefined);
    throw new OrganizationBySlugError(
      response.status,
      slug,
      responseBodySnippet
    );
  }

  const data = await response.json();

  // Use existing Zod schema for consistent validation
  const parsed = OrganizationOptionSchema.safeParse(data.organization);
  if (!parsed.success) {
    throw new OrganizationBySlugError(
      500,
      slug,
      "Invalid organization response schema"
    );
  }

  const resolvedOrg = parsed.data;
  queryClient.setQueryData<OrganizationOption[]>(
    organizationsQuery.queryKey,
    (current) => {
      if (!current) {
        return [resolvedOrg];
      }
      return current.some((org) => org.id === resolvedOrg.id)
        ? current
        : [...current, resolvedOrg];
    }
  );
  organization.setActive({ organizationId: resolvedOrg.id }).catch((error) => {
    console.error("Failed to set active organization in background:", error);
  });
  return { org: resolvedOrg };
}

/**
 * Query options for fetching organization by slug.
 * Uses React Query's built-in request deduplication to prevent duplicate API calls
 * when multiple components or route loaders request the same organization.
 *
 * @param input - Organization lookup dependencies
 */
export function organizationBySlugQueryOptions(input: {
  queryClient: QueryClient;
  slug: string;
  userId: UserScope;
}) {
  const { queryClient, slug, userId } = input;

  return queryOptions({
    queryKey: organizationQueryKeys.bySlug(userId, slug),
    queryFn: async () =>
      fetchOrganizationBySlug({
        queryClient,
        slug,
        userId,
      }),
    // Cache for 1 minute - balance performance vs security
    // Shorter than org list cache to ensure permission changes are reflected quickly
    staleTime: DEFAULT_QUERY_STALE_TIME_MS,
    // Retry only transient failures once. Auth/access/not-found errors
    // should fail immediately so the route can redirect deterministically.
    retry: (failureCount, error) => {
      if (
        isOrganizationBySlugError(error) &&
        (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: SHORT_QUERY_RETRY_DELAY_MS,
  });
}
