import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { createApiClient } from "@/lib/api-client";
import { DEFAULT_QUERY_STALE_TIME_MS } from "@/lib/query-timing";

const client = createApiClient();

export type BudgetDashboardResponse = InferResponseType<
  typeof client.api.budget.$get,
  200
>;
export type BudgetDashboardOverview = BudgetDashboardResponse["overview"];
export type BudgetDashboardDailyRow =
  BudgetDashboardResponse["dailyCost"][number];

async function fetchBudgetDashboard(
  organizationId: string,
  days: number
): Promise<BudgetDashboardResponse> {
  const response = await client.api.budget.$get({
    query: { days: String(days), organizationId },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch budget dashboard");
  }

  return response.json();
}

export function budgetDashboardQueryOptions(
  organizationId: string,
  days: number
) {
  return queryOptions({
    queryFn: async () => fetchBudgetDashboard(organizationId, days),
    queryKey: ["budget", "dashboard", organizationId, days] as const,
    staleTime: DEFAULT_QUERY_STALE_TIME_MS,
  });
}
