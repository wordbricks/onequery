import { z } from "zod";

import type { BudgetDashboardDailyRow } from "@/queries/budget-queries";

export const BUDGET_WINDOW_OPTIONS = [7, 30, 90] as const;
type BudgetWindowDays = (typeof BUDGET_WINDOW_OPTIONS)[number];
export const DEFAULT_BUDGET_WINDOW_DAYS: BudgetWindowDays = 30;

export const budgetWindowDaysSchema = z.union([
  z.literal(7),
  z.literal(30),
  z.literal(90),
]);

interface BudgetUsageSeriesRow {
  date: string;
  cumulativeSpendUsd: number;
  usagePercent: number;
}

export type BudgetLimitState =
  | {
      kind: "unlimited";
    }
  | {
      kind: "blocked";
      monthlyBudgetUsd: number;
    }
  | {
      kind: "limited";
      monthlyBudgetUsd: number;
      budgetUsedPercent: number;
      remainingBudgetUsd: number;
      isOverBudget: boolean;
    };

function roundUsd(value: number): number {
  return Number(value.toFixed(4));
}

export function calculateSpendShare(
  itemSpendUsd: number,
  totalSpendUsd: number
): number {
  return totalSpendUsd > 0 ? (itemSpendUsd / totalSpendUsd) * 100 : 0;
}

function calculateBudgetUsagePercent(
  spendUsd: number,
  monthlyBudgetUsd: number
): number {
  return monthlyBudgetUsd > 0
    ? Number(((spendUsd / monthlyBudgetUsd) * 100).toFixed(4))
    : 0;
}

export function getBudgetLimitState(input: {
  monthlyBudgetUsd: number | null;
  totalSpendUsd: number;
}): BudgetLimitState {
  // Comment: `null` means "no limit", while `$0` is an explicit hard stop. Keep
  // those as separate variants so callers cannot accidentally merge them.
  if (input.monthlyBudgetUsd === null) {
    return { kind: "unlimited" };
  }
  if (input.monthlyBudgetUsd <= 0) {
    return {
      kind: "blocked",
      monthlyBudgetUsd: input.monthlyBudgetUsd,
    };
  }

  return {
    budgetUsedPercent: calculateBudgetUsagePercent(
      input.totalSpendUsd,
      input.monthlyBudgetUsd
    ),
    isOverBudget: input.totalSpendUsd > input.monthlyBudgetUsd,
    kind: "limited",
    monthlyBudgetUsd: input.monthlyBudgetUsd,
    remainingBudgetUsd: roundUsd(input.monthlyBudgetUsd - input.totalSpendUsd),
  };
}

export function getRecentDailySpendRows(
  dailyCost: BudgetDashboardDailyRow[],
  limit = 14
): BudgetDashboardDailyRow[] {
  return [...dailyCost]
    .toSorted((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
}

export function getPeakSpendDay(
  dailyCost: BudgetDashboardDailyRow[]
): BudgetDashboardDailyRow | null {
  const nonZeroDays = dailyCost.filter(
    (row) => row.totalCostUsd > 0 || row.queryCount > 0
  );

  if (nonZeroDays.length === 0) {
    return null;
  }

  return nonZeroDays.reduce((peak, row) => {
    if (row.totalCostUsd > peak.totalCostUsd) {
      return row;
    }
    if (row.totalCostUsd === peak.totalCostUsd && row.date > peak.date) {
      return row;
    }
    return peak;
  });
}

export function buildBudgetUsageSeries(input: {
  dailyCost: BudgetDashboardDailyRow[];
  monthlyBudgetUsd: number;
}): BudgetUsageSeriesRow[] {
  const orderedRows = [...input.dailyCost].toSorted((left, right) =>
    left.date.localeCompare(right.date)
  );
  let cumulativeSpendUsd = 0;

  return orderedRows.map((row) => {
    cumulativeSpendUsd += row.totalCostUsd;

    return {
      cumulativeSpendUsd,
      date: row.date,
      usagePercent: calculateBudgetUsagePercent(
        cumulativeSpendUsd,
        input.monthlyBudgetUsd
      ),
    };
  });
}
