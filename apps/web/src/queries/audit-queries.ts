import {
  auditListResponseSchema,
  auditSearchSchema,
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
export type { AuditListItem, AuditListResponse, AuditSearch };

const client = createApiClient();

async function fetchAuditList(
  slug: string,
  search: AuditSearch
): Promise<AuditListResponse> {
  const query = {
    ...(search.actionType ? { actionType: search.actionType } : {}),
    ...(search.cursor ? { cursor: search.cursor } : {}),
    limit: `${search.limit}`,
    ...(search.q ? { q: search.q } : {}),
    ...(search.sourceKey ? { sourceKey: search.sourceKey } : {}),
    ...(search.status ? { status: search.status } : {}),
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
  return queryOptions({
    queryFn: async () => fetchAuditList(slug, search),
    queryKey: organizationQueryKeys.audit(userId, slug, search),
    staleTime: 30 * 1000,
  });
}
