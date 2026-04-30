import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@onequery/ui/components/empty";
import { IconCoins } from "@tabler/icons-react";
import type { ReactNode } from "react";

import type { BudgetDashboardResponse } from "@/queries/budget-queries";

import {
  buildBudgetUsageSeries,
  calculateSpendShare,
  getRecentDailySpendRows,
} from "./budget-dashboard";
import type { BudgetLimitState } from "./budget-dashboard";
import {
  buildSvgPath,
  formatCurrency,
  formatDateLabel,
  formatSharePercent,
} from "./budget-dashboard-formatters";

interface BudgetDashboardDetailsProps {
  data: BudgetDashboardResponse;
  budgetLimitState: BudgetLimitState;
}

function BudgetSectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DailySpendBars({
  dailyCost,
  totalSpendUsd,
}: {
  dailyCost: BudgetDashboardResponse["dailyCost"];
  totalSpendUsd: number;
}) {
  const visibleDays = getRecentDailySpendRows(dailyCost);
  const maxCost = visibleDays.reduce(
    (max, entry) => Math.max(max, entry.totalCostUsd),
    0
  );

  return (
    <div className="space-y-3">
      {visibleDays.map((entry) => {
        const width =
          maxCost <= 0 ? 0 : Math.max((entry.totalCostUsd / maxCost) * 100, 2);

        return (
          <div key={entry.date} className="space-y-1.5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <p className="min-w-0 font-medium">
                {formatDateLabel(entry.date)}
              </p>
              <div className="text-right">
                <p className="font-medium tabular-nums">
                  {formatCurrency(entry.totalCostUsd)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSharePercent(
                    calculateSpendShare(entry.totalCostUsd, totalSpendUsd)
                  )}{" "}
                  of spend
                </p>
              </div>
            </div>
            <div className="h-2 rounded-full bg-muted/60">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BudgetUsageChart({
  dailyCost,
  monthlyBudgetUsd,
  totalSpendUsd,
}: {
  dailyCost: BudgetDashboardResponse["dailyCost"];
  monthlyBudgetUsd: number;
  totalSpendUsd: number;
}) {
  const rows = buildBudgetUsageSeries({
    dailyCost,
    monthlyBudgetUsd,
  });
  const maxUsagePercent = rows.reduce(
    (max, row) => Math.max(max, row.usagePercent),
    100
  );
  const yAxisMax = Math.max(100, Math.ceil(maxUsagePercent / 25) * 25);
  const points = rows.map((row, index) => {
    const x =
      rows.length === 1 ? 50 : (index / Math.max(rows.length - 1, 1)) * 100;
    const y = 100 - (row.usagePercent / yAxisMax) * 100;

    return {
      date: row.date,
      x,
      y,
    };
  });
  const linePath = points.length === 0 ? "" : buildSvgPath(points);
  const areaPath =
    points.length === 0
      ? ""
      : `${linePath} L${points.at(-1)?.x ?? 0},100 L${points[0]?.x ?? 0},100 Z`;
  const targetLineY = 100 - (100 / yAxisMax) * 100;
  const gridValues = Array.from(
    { length: 4 },
    (_, index) => (yAxisMax / 4) * (index + 1)
  );
  const axisLabelRows =
    rows.length <= 3
      ? rows
      : [rows[0], rows[Math.floor((rows.length - 1) / 2)], rows.at(-1)].filter(
          (row) => row !== undefined
        );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/10 p-4">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>0%</span>
          <span>100% target</span>
          <span>{Math.round(yAxisMax)}% scale</span>
        </div>
        <div className="h-64 w-full">
          <svg
            viewBox="0 0 100 100"
            className="h-full w-full overflow-visible"
            role="img"
            aria-label="Budget usage percentage graph"
            preserveAspectRatio="none"
          >
            {gridValues.map((value) => {
              const y = 100 - (value / yAxisMax) * 100;
              return (
                <line
                  key={value}
                  x1="0"
                  y1={y}
                  x2="100"
                  y2={y}
                  stroke="var(--color-border)"
                  strokeDasharray="2 3"
                  strokeWidth="0.5"
                />
              );
            })}
            <line
              x1="0"
              y1={targetLineY}
              x2="100"
              y2={targetLineY}
              stroke="var(--color-border)"
              strokeDasharray="4 3"
              strokeWidth="0.8"
            />
            {areaPath.length > 0 ? (
              <path d={areaPath} fill="var(--color-chart-2)" opacity="0.18" />
            ) : null}
            {linePath.length > 0 ? (
              <path
                d={linePath}
                fill="none"
                stroke="var(--color-chart-2)"
                strokeWidth="1.8"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {points.map((point) => (
              <circle
                key={point.date}
                cx={point.x}
                cy={point.y}
                r="1.6"
                fill="var(--color-chart-2)"
              />
            ))}
          </svg>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          {axisLabelRows.map((row) => (
            <span key={row.date}>{formatDateLabel(row.date)}</span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/15 p-3 text-sm">
        <div>
          <p className="text-muted-foreground">Cumulative spend</p>
          <p className="font-medium tabular-nums">
            {formatCurrency(totalSpendUsd)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground">Limit</p>
          <p className="font-medium tabular-nums">
            {formatCurrency(monthlyBudgetUsd)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function BudgetDashboardDetails({
  data,
  budgetLimitState,
}: BudgetDashboardDetailsProps) {
  if (data.overview.queryCount === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconCoins size={18} stroke={1.75} />
          </EmptyMedia>
          <EmptyTitle>No query-cost data yet</EmptyTitle>
          <EmptyDescription>
            Run an agent workflow that executes database queries with stats
            enabled, then this dashboard will populate from
            `data_source_query_costs`.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <BudgetSectionCard
          title="Budget Usage"
          description="Cumulative spend as a percentage of your monthly budget."
        >
          {budgetLimitState.kind === "unlimited" ? (
            <div className="flex h-72 items-center justify-center rounded-lg border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
              Set a monthly budget above to see how quickly the current window
              is consuming your monthly budget.
            </div>
          ) : budgetLimitState.kind === "blocked" ? (
            <div className="flex h-72 items-center justify-center rounded-lg border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
              Monthly budget is{" "}
              {formatCurrency(budgetLimitState.monthlyBudgetUsd)}. Increase the
              limit to chart usage against an available budget.
            </div>
          ) : (
            <BudgetUsageChart
              dailyCost={data.dailyCost}
              monthlyBudgetUsd={budgetLimitState.monthlyBudgetUsd}
              totalSpendUsd={data.overview.totalCostUsd}
            />
          )}
        </BudgetSectionCard>

        <BudgetSectionCard
          title="Daily Spend"
          description="Latest daily costs inside the selected reporting window."
        >
          <DailySpendBars
            dailyCost={data.dailyCost}
            totalSpendUsd={data.overview.totalCostUsd}
          />
        </BudgetSectionCard>
      </div>
    </div>
  );
}
