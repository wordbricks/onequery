import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@onequery/ui/components/tooltip";
import {
  IconCoins,
  IconInfoCircle,
  IconReceipt2,
  IconStack2,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import type {
  BudgetDashboardDailyRow,
  BudgetDashboardOverview,
} from "@/queries/budget-queries";

import type { BudgetLimitState } from "./budget-dashboard";
import {
  formatCount,
  formatCurrency,
  formatDateLabel,
  formatSharePercent,
} from "./budget-dashboard-formatters";

function MetricTitle({
  children,
  tooltip,
}: {
  children: string;
  tooltip?: string;
}) {
  if (!tooltip) {
    return children;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{children}</span>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`More information about ${children}`}
        >
          <IconInfoCircle size={14} stroke={1.75} />
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </span>
  );
}

function BudgetMetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: ReactNode;
  value: string;
  description: ReactNode;
  icon: typeof IconCoins;
}) {
  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="w-fit rounded-lg border bg-muted/30 p-2">
          <Icon size={18} stroke={1.75} />
        </div>
        <div className="space-y-1">
          <CardDescription>{title}</CardDescription>
          <CardTitle className="text-2xl">{value}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">
        {description}
      </CardContent>
    </Card>
  );
}

interface BudgetMetricsGridProps {
  budgetLimitState: BudgetLimitState;
  overview: BudgetDashboardOverview;
  peakSpendDay: BudgetDashboardDailyRow | null;
}

export function BudgetMetricsGrid({
  budgetLimitState,
  overview,
  peakSpendDay,
}: BudgetMetricsGridProps) {
  const budgetUsedValue =
    budgetLimitState.kind === "unlimited"
      ? "Not set"
      : budgetLimitState.kind === "blocked"
        ? "Blocked"
        : formatSharePercent(budgetLimitState.budgetUsedPercent);
  const budgetUsedDescription =
    budgetLimitState.kind === "unlimited"
      ? "Set a monthly budget to track percentage use."
      : budgetLimitState.kind === "blocked"
        ? `${formatCurrency(budgetLimitState.monthlyBudgetUsd)} monthly budget blocks new agent runs.`
        : `${formatCurrency(overview.totalCostUsd)} of ${formatCurrency(budgetLimitState.monthlyBudgetUsd)} monthly budget used`;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <BudgetMetricCard
        title={
          <MetricTitle tooltip="Uses actualCostUsd when available, and falls back to estimatedCostUsd when only estimated spend is recorded.">
            Observed Spend
          </MetricTitle>
        }
        value={formatCurrency(overview.totalCostUsd)}
        description={`${formatCount(overview.activeConnectionCount)} connections across ${formatCount(overview.activeProviderCount)} providers`}
        icon={IconCoins}
      />
      <BudgetMetricCard
        title="Budget Used"
        value={budgetUsedValue}
        description={budgetUsedDescription}
        icon={IconReceipt2}
      />
      <BudgetMetricCard
        title="Peak Spend Day"
        value={
          peakSpendDay ? formatCurrency(peakSpendDay.totalCostUsd) : "No spend"
        }
        description={
          peakSpendDay
            ? `${formatDateLabel(peakSpendDay.date)} recorded the highest spend.`
            : "No observed query spend in this window"
        }
        icon={IconStack2}
      />
    </div>
  );
}
