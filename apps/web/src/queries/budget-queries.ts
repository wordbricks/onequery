import { queryOptions } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api-client";
import { DEFAULT_QUERY_STALE_TIME_MS } from "@/lib/query-timing";

const client = createApiClient();

export interface BudgetDashboardOverview {
  totalCostUsd: number;
  queryCount: number;
  totalDataVolumeBytes: string;
  activeConnectionCount: number;
  activeProviderCount: number;
  averageCostPerQueryUsd: number;
}

export interface BudgetDashboardProviderRow {
  provider: string;
  totalCostUsd: number;
  queryCount: number;
  totalDataVolumeBytes: string;
}

export interface BudgetDashboardConnectionRow {
  connectionName: string;
  provider: string;
  totalCostUsd: number;
  queryCount: number;
  totalDataVolumeBytes: string;
}

export interface BudgetDashboardDailyRow {
  date: string;
  totalCostUsd: number;
  queryCount: number;
  totalDataVolumeBytes: string;
}

export interface BudgetDashboardResponse {
  windowDays: number;
  requestedWindowDays: number;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  dataAvailableFrom: string;
  overview: BudgetDashboardOverview;
  providerBreakdown: BudgetDashboardProviderRow[];
  connectionBreakdown: BudgetDashboardConnectionRow[];
  dailyCost: BudgetDashboardDailyRow[];
}

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
