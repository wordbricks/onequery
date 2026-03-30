import { Badge } from "@onequery/ui/components/badge";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@onequery/ui/components/toggle-group";

import { BUDGET_WINDOW_OPTIONS } from "@/features/budget/budget-dashboard";
import type { BudgetLimitState } from "@/features/budget/budget-dashboard";
import {
  formatCurrency,
  formatDateTimeLabel,
} from "@/features/budget/budget-dashboard-formatters";

interface BudgetDashboardHeaderProps {
  budgetLimitState: BudgetLimitState;
  generatedAt: string;
  isWindowChangePending: boolean;
  selectedDays: number;
  onWindowChange: (nextValues: string[]) => void;
}

function getBudgetBadgeLabel(state: BudgetLimitState): string {
  switch (state.kind) {
    case "unlimited": {
      return "No budget set";
    }
    case "blocked": {
      return "No spend allowed";
    }
    case "limited": {
      return `${formatCurrency(state.monthlyBudgetUsd)} / month`;
    }
  }

  const exhaustive: never = state;
  return exhaustive;
}

export function BudgetDashboardHeader({
  budgetLimitState,
  generatedAt,
  isWindowChangePending,
  selectedDays,
  onWindowChange,
}: BudgetDashboardHeaderProps) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">Budget</h1>
          <Badge variant="outline">
            {getBudgetBadgeLabel(budgetLimitState)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Updated {formatDateTimeLabel(generatedAt)}
          {isWindowChangePending ? " Refreshing selected window..." : ""}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Window
        </p>
        <ToggleGroup
          value={[String(selectedDays)]}
          onValueChange={onWindowChange}
          variant="outline"
          size="sm"
          aria-label="Budget window"
        >
          {BUDGET_WINDOW_OPTIONS.map((windowDays) => (
            <ToggleGroupItem
              key={windowDays}
              value={String(windowDays)}
              className="min-w-20 justify-center"
            >
              {windowDays} days
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
