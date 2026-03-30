import { queryOptions } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api-client";
import { LONG_QUERY_STALE_TIME_MS } from "@/lib/query-timing";

interface Stats {
  dataSourcesCount: number;
}

const client = createApiClient();

async function fetchStats(organizationId: string): Promise<Stats> {
  const response = await client.api.stats.$get({
    query: { organizationId },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch stats");
  }

  return response.json();
}

export function statsQueryOptions(organizationId: string) {
  return queryOptions({
    queryFn: async () => fetchStats(organizationId),
    queryKey: ["stats", organizationId] as const,
    staleTime: LONG_QUERY_STALE_TIME_MS,
  });
}
