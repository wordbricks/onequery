import {
  auditListResponseSchema,
  auditSearchSchema,
  sanitizeAuditSearch,
} from "@onequery/audit-contracts/audit";
import type {
  AuditListItem,
  AuditListResponse,
  AuditSearch,
} from "@onequery/audit-contracts/audit";
import { queryOptions } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api-client";
import { getApiErrorMessage } from "@/queries/api-error";
import { organizationQueryKeys } from "@/queries/organization-query-keys";
import type { UserScope } from "@/queries/organization-query-keys";

export { auditSearchSchema };
export type { AuditListItem, AuditSearch };

const client = createApiClient();
export const AUDIT_LIVE_REFETCH_INTERVAL_MS = 5 * 1000;
export const AUDIT_PROJECTION_CATCH_UP_REFETCH_INTERVAL_MS = 1000;

function hasAuditProjectionLag(
  projectionLag: AuditListResponse["projectionLag"]
) {
  return projectionLag.queryAction || projectionLag.sourceApiAction;
}

export function resolveAuditListRefetchInterval(input: {
  data: Pick<AuditListResponse, "projectionLag"> | undefined;
  search: Pick<AuditSearch, "cursor">;
}): number | false {
  if (input.search.cursor) {
    return false;
  }

  if (input.data && hasAuditProjectionLag(input.data.projectionLag)) {
    return AUDIT_PROJECTION_CATCH_UP_REFETCH_INTERVAL_MS;
  }

  // Comment: CLI activity changes this feed outside the browser, so the newest
  // page keeps a low-frequency heartbeat even when the last projection caught up.
  return AUDIT_LIVE_REFETCH_INTERVAL_MS;
}

async function fetchAuditList(
  slug: string,
  search: AuditSearch
): Promise<AuditListResponse> {
  const normalizedSearch = sanitizeAuditSearch(search);
  const query = {
    ...(normalizedSearch.actionName
      ? { actionName: normalizedSearch.actionName }
      : {}),
    ...(normalizedSearch.cursor ? { cursor: normalizedSearch.cursor } : {}),
    ...(normalizedSearch.family ? { family: normalizedSearch.family } : {}),
    limit: `${normalizedSearch.limit}`,
    ...(normalizedSearch.outcome ? { outcome: normalizedSearch.outcome } : {}),
    ...(normalizedSearch.q ? { q: normalizedSearch.q } : {}),
    ...(normalizedSearch.sourceKey
      ? { sourceKey: normalizedSearch.sourceKey }
      : {}),
  };

  const response = await client.api.organizations[":slug"].audit.$get({
    param: { slug },
    query,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(error, "Failed to fetch audit history"));
  }

  return auditListResponseSchema.parse(await response.json());
}

export function auditListQueryOptions(
  userId: UserScope,
  slug: string,
  search: AuditSearch
) {
  const normalizedSearch = sanitizeAuditSearch(search);

  return queryOptions({
    queryFn: async () => fetchAuditList(slug, normalizedSearch),
    queryKey: organizationQueryKeys.audit(userId, slug, normalizedSearch),
    refetchInterval: (query) =>
      resolveAuditListRefetchInterval({
        data: query.state.data,
        search: normalizedSearch,
      }),
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });
}
