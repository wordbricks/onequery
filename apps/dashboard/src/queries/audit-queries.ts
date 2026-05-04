import {
  auditActionDetailSchema,
  auditListParamsToHttpQuery,
  auditListResponseSchema,
} from "@onequery/audit-contracts/audit";
import type {
  AuditActionDetail,
  AuditFamily,
  AuditListParams,
  AuditListResponse,
} from "@onequery/audit-contracts/audit";
import { queryOptions } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api-client";
import { getApiErrorMessage } from "@/queries/api-error";
import { organizationQueryKeys } from "@/queries/organization-query-keys";
import type { UserScope } from "@/queries/organization-query-keys";

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
  params: Pick<AuditListParams, "cursor">;
}): number | false {
  if (input.params.cursor) {
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
  params: AuditListParams,
  signal?: AbortSignal
): Promise<AuditListResponse> {
  const response = await client.api.organizations[":slug"].audit.$get(
    {
      param: { slug },
      query: auditListParamsToHttpQuery(params),
    },
    { init: { signal } }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(error, "Failed to fetch audit history"));
  }

  return auditListResponseSchema.parse(await response.json());
}

export function auditListQueryOptions(
  userId: UserScope,
  slug: string,
  params: AuditListParams
) {
  return queryOptions({
    queryFn: async ({ signal }) => fetchAuditList(slug, params, signal),
    queryKey: organizationQueryKeys.auditList(userId, slug, params),
    refetchInterval: (query) =>
      resolveAuditListRefetchInterval({
        data: query.state.data,
        params,
      }),
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });
}

async function fetchAuditActionDetail(
  slug: string,
  family: AuditFamily,
  actionId: string,
  signal?: AbortSignal
): Promise<AuditActionDetail> {
  const response = await client.api.organizations[":slug"].audit[":family"][
    ":actionId"
  ].$get(
    {
      param: { actionId, family, slug },
    },
    { init: { signal } }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(error, "Failed to fetch audit trace"));
  }

  return auditActionDetailSchema.parse(await response.json());
}

export function auditActionDetailQueryOptions(
  userId: UserScope,
  slug: string,
  family: AuditFamily,
  actionId: string
) {
  return queryOptions({
    queryFn: async ({ signal }) =>
      fetchAuditActionDetail(slug, family, actionId, signal),
    queryKey: organizationQueryKeys.auditDetail(userId, slug, family, actionId),
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });
}
