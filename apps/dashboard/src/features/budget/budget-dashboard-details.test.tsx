/// <reference types="@testing-library/jest-dom" />
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BudgetDashboardResponse } from "@/queries/budget-queries";

import { getBudgetLimitState } from "./budget-dashboard";
import { BudgetDashboardDetails } from "./budget-dashboard-details";

const singleAttributionData = {
  connectionBreakdown: [
    {
      connectionName: "bunk-bigquery",
      provider: "bigquery",
      totalCostUsd: 0.0309,
      queryCount: 1,
      totalDataVolumeBytes: "1024",
    },
  ],
  dailyCost: [
    {
      date: "2026-03-12",
      totalCostUsd: 0.0309,
      queryCount: 1,
      totalDataVolumeBytes: "1024",
    },
  ],
  dataAvailableFrom: "2026-03-06T00:00:00.000Z",
  generatedAt: "2026-03-12T06:00:00.000Z",
  overview: {
    totalCostUsd: 0.0309,
    queryCount: 1,
    totalDataVolumeBytes: "1024",
    activeConnectionCount: 1,
    activeProviderCount: 1,
    averageCostPerQueryUsd: 0.0309,
  },
  providerBreakdown: [
    {
      provider: "bigquery",
      totalCostUsd: 0.0309,
      queryCount: 1,
      totalDataVolumeBytes: "1024",
    },
  ],
  requestedWindowDays: 7,
  windowDays: 7,
  windowEnd: "2026-03-12T00:00:00.000Z",
  windowStart: "2026-03-06T00:00:00.000Z",
} satisfies BudgetDashboardResponse;

describe("BudgetDashboardDetails", () => {
  it("renders budget usage and daily spend details without attribution", () => {
    render(
      <BudgetDashboardDetails
        data={singleAttributionData}
        budgetLimitState={getBudgetLimitState({
          monthlyBudgetUsd: 300,
          totalSpendUsd: singleAttributionData.overview.totalCostUsd,
        })}
      />
    );

    expect(screen.getByText("Budget Usage")).toBeInTheDocument();
    expect(screen.getByText("Daily Spend")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Mar 12 budget usage 0\.0% \(\$0\.0309\)/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText("0.0% of budget")).toBeInTheDocument();
    expect(screen.queryByText("Spend Attribution")).not.toBeInTheDocument();
    expect(screen.getAllByText("$0.0309")).not.toHaveLength(0);
  });
});
