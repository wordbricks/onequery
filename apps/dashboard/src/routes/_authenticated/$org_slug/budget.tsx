import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import {
  budgetWindowDaysSchema,
  DEFAULT_BUDGET_WINDOW_DAYS,
} from "@/features/budget/budget-dashboard";
import { BudgetDashboardPage } from "@/pages/budget-dashboard-page";
import { budgetDashboardQueryOptions } from "@/queries/budget-queries";
import { organizationSettingsQueryOptions } from "@/queries/organization-queries";

const searchSchema = z.object({
  days: fallback(budgetWindowDaysSchema, DEFAULT_BUDGET_WINDOW_DAYS).default(
    DEFAULT_BUDGET_WINDOW_DAYS
  ),
});

export const Route = createFileRoute("/_authenticated/$org_slug/budget")({
  component: BudgetDashboardPage,
  validateSearch: zodValidator(searchSchema),
  loaderDeps: ({ search }) => ({
    days: search.days,
  }),
  loader: async ({
    context: { queryClient, organizationId, organizationSlug },
    deps,
  }) => {
    await Promise.all([
      queryClient.ensureQueryData(
        budgetDashboardQueryOptions(organizationId, deps.days)
      ),
      queryClient.ensureQueryData(
        organizationSettingsQueryOptions(organizationSlug)
      ),
    ]);
  },
});
