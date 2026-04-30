import { Button } from "@onequery/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@onequery/ui/components/input-group";
import { Label } from "@onequery/ui/components/label";

import { SaveStatusIndicator } from "@/components/save-status-indicator";
import type { BudgetLimitState } from "@/features/budget/budget-dashboard";
import type { SaveStatus } from "@/lib/use-auto-save";

import {
  formatCurrency,
  formatSharePercent,
  sanitizeBudgetInput,
} from "./budget-dashboard-formatters";

interface BudgetSettingsCardProps {
  budgetInput: string;
  onBudgetInputChange: (value: string) => void;
  onBudgetSave: () => void;
  onBudgetClear: () => void;
  canEditBudget: boolean;
  saveStatus: SaveStatus;
  isSavePending: boolean;
  isSaveDisabled: boolean;
  hasBudgetConfigured: boolean;
  isBudgetInputInvalid: boolean;
  budgetLimitState: BudgetLimitState;
  totalSpendUsd: number;
}

export function BudgetSettingsCard(input: BudgetSettingsCardProps) {
  const budgetStatusContent = (() => {
    switch (input.budgetLimitState.kind) {
      case "unlimited": {
        return (
          <div className="rounded-lg border border-dashed bg-muted/10 p-4 text-sm text-muted-foreground">
            Set a limit to track usage.
          </div>
        );
      }
      case "blocked": {
        return (
          <div className="rounded-lg border border-dashed bg-muted/10 p-4 text-sm text-muted-foreground">
            Monthly budget is{" "}
            {formatCurrency(input.budgetLimitState.monthlyBudgetUsd)}. Agent
            runs are blocked until you raise the limit.
          </div>
        );
      }
      case "limited": {
        const progressWidth = Math.min(
          input.budgetLimitState.budgetUsedPercent,
          100
        );

        return (
          <div className="space-y-3 rounded-lg border bg-muted/15 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Spend vs. limit</p>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums">
                  {formatCurrency(input.totalSpendUsd)} /{" "}
                  {formatCurrency(input.budgetLimitState.monthlyBudgetUsd)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {input.budgetLimitState.isOverBudget
                    ? `${formatCurrency(Math.abs(input.budgetLimitState.remainingBudgetUsd))} over`
                    : `${formatCurrency(input.budgetLimitState.remainingBudgetUsd)} remaining`}
                </p>
              </div>
            </div>
            <div className="h-2 rounded-full bg-muted/60">
              <div
                className={`h-2 rounded-full transition-all ${
                  input.budgetLimitState.isOverBudget
                    ? "bg-destructive"
                    : "bg-primary"
                }`}
                style={{ width: `${progressWidth}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Using{" "}
              {formatSharePercent(input.budgetLimitState.budgetUsedPercent)} of
              the limit.
            </p>
          </div>
        );
      }
    }

    const exhaustive: never = input.budgetLimitState;
    return exhaustive;
  })();

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle>Spend Limit</CardTitle>
            <CardDescription>Cap monthly spend.</CardDescription>
          </div>
          <SaveStatusIndicator status={input.saveStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="budget-target">Limit (USD)</Label>
          {/* Keep actions aligned with the input row instead of the helper copy. */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <InputGroup className="flex-1">
              <InputGroupAddon align="inline-start">
                <InputGroupText>$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="budget-target"
                inputMode="decimal"
                placeholder="2500"
                value={input.budgetInput}
                disabled={!input.canEditBudget}
                onChange={(event) =>
                  input.onBudgetInputChange(
                    sanitizeBudgetInput(event.target.value)
                  )
                }
              />
            </InputGroup>

            <div className="flex flex-wrap gap-2 xl:shrink-0">
              <Button
                type="button"
                onClick={input.onBudgetSave}
                disabled={!input.canEditBudget || input.isSaveDisabled}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={input.onBudgetClear}
                disabled={
                  !input.canEditBudget ||
                  input.isSavePending ||
                  (!input.hasBudgetConfigured && input.budgetInput.length === 0)
                }
              >
                Clear
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {!input.canEditBudget
              ? "Only admins and owners can update the monthly spend limit."
              : input.isBudgetInputInvalid
                ? "Enter a valid non-negative USD amount."
                : "Leave blank to clear the limit."}
          </p>
        </div>

        {budgetStatusContent}
      </CardContent>
    </Card>
  );
}
