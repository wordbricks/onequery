import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { startTransition, useCallback, useDeferredValue } from "react";

import {
  budgetWindowDaysSchema,
  getBudgetLimitState,
  getPeakSpendDay,
} from "@/features/budget/budget-dashboard";
import { BudgetDashboardDetails } from "@/features/budget/budget-dashboard-details";
import { BudgetDashboardHeader } from "@/features/budget/budget-dashboard-header";
import { BudgetMetricsGrid } from "@/features/budget/budget-dashboard-overview";
import { BudgetSettingsCard } from "@/features/budget/budget-dashboard-settings-card";
import { useBudgetSettingsController } from "@/features/budget/budget-settings-controller";
import { getTeamAccessState } from "@/features/team/team-access";
import { budgetDashboardQueryOptions } from "@/queries/budget-queries";
import {
  organizationSettingsQueryOptions,
  updateOrganizationSettings,
} from "@/queries/organization-queries";
import { teamMembersQueryOptions } from "@/queries/team-queries";

const routeApi = getRouteApi("/_authenticated/$org_slug/budget");

export function BudgetDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organizationId, organizationSlug, session } =
    routeApi.useRouteContext();
  const currentUserId = session.user.id;
  const { days: selectedDays } = routeApi.useSearch();
  const deferredSelectedDays = useDeferredValue(selectedDays);
  const isWindowChangePending = deferredSelectedDays !== selectedDays;
  const settingsQuery = organizationSettingsQueryOptions(organizationSlug);
  const { data: members } = useSuspenseQuery(
    teamMembersQueryOptions(currentUserId, organizationId)
  );
  const { data } = useSuspenseQuery(
    budgetDashboardQueryOptions(organizationId, deferredSelectedDays)
  );
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { canUpdateOrganizationSettings } = getTeamAccessState({
    currentUserId,
    members,
  });
  const peakSpendDay = getPeakSpendDay(data.dailyCost);
  const monthlyBudgetUsd = settings.monthlyBudgetUsd;
  const budgetLimitState = getBudgetLimitState({
    monthlyBudgetUsd,
    totalSpendUsd: data.overview.totalCostUsd,
  });
  const saveBudget = useCallback(
    async (nextBudgetUsd: number | null) => {
      const nextSettings = await updateOrganizationSettings(organizationSlug, {
        monthlyBudgetUsd: nextBudgetUsd,
      });
      queryClient.setQueryData(
        organizationSettingsQueryOptions(organizationSlug).queryKey,
        nextSettings
      );
      return nextSettings;
    },
    [organizationSlug, queryClient]
  );
  const budgetSettingsController = useBudgetSettingsController({
    errorMessage: "Failed to save monthly budget",
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
    saveBudget,
  });

  function handleWindowChange(nextValues: string[]) {
    const nextValue = nextValues[0];
    if (!nextValue) {
      return;
    }

    const parsedDays = Number(nextValue);
    const nextDaysResult = budgetWindowDaysSchema.safeParse(parsedDays);
    if (!nextDaysResult.success || nextDaysResult.data === selectedDays) {
      return;
    }

    startTransition(() => {
      void navigate({
        params: { org_slug: organizationSlug },
        replace: true,
        search: { days: nextDaysResult.data },
        to: "/$org_slug/budget",
      });
    });
  }

  return (
    <div className="space-y-8 p-8">
      <BudgetDashboardHeader
        budgetLimitState={budgetLimitState}
        generatedAt={data.generatedAt}
        isWindowChangePending={isWindowChangePending}
        selectedDays={selectedDays}
        onWindowChange={handleWindowChange}
      />

      <BudgetSettingsCard
        budgetInput={budgetSettingsController.budgetInput}
        onBudgetInputChange={budgetSettingsController.setBudgetInput}
        onBudgetSave={budgetSettingsController.save}
        onBudgetClear={budgetSettingsController.clear}
        canEditBudget={canUpdateOrganizationSettings}
        saveStatus={budgetSettingsController.saveStatus}
        isSavePending={budgetSettingsController.isSavePending}
        isSaveDisabled={budgetSettingsController.isSaveDisabled}
        hasBudgetConfigured={budgetSettingsController.hasBudgetConfigured}
        isBudgetInputInvalid={budgetSettingsController.isBudgetInputInvalid}
        budgetLimitState={budgetLimitState}
        totalSpendUsd={data.overview.totalCostUsd}
      />

      <BudgetMetricsGrid
        budgetLimitState={budgetLimitState}
        overview={data.overview}
        peakSpendDay={peakSpendDay}
      />

      <BudgetDashboardDetails data={data} budgetLimitState={budgetLimitState} />
    </div>
  );
}
