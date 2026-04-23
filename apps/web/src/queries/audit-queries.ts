import {
  auditListResponseSchema,
  auditSearchSchema,
  sanitizeAuditSearch,
} from "@onequery/contracts/audit";
import type {
  AuditListItem,
  AuditListResponse,
  AuditSearch,
} from "@onequery/contracts/audit";
import { queryOptions } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api-client";
import { getApiErrorMessage } from "@/queries/api-error";
import { organizationQueryKeys } from "@/queries/organization-query-keys";
import type { UserScope } from "@/queries/organization-query-keys";

export { auditSearchSchema };
export type { AuditListItem, AuditSearch };

const client = createApiClient();

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
    staleTime: 30 * 1000,
  });
}
