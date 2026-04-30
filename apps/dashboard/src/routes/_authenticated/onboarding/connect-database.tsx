import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { sanitizeOnboardingOrganizationId } from "@/lib/onboarding-organization-id";
import { ConnectDatabasePage } from "@/pages/onboarding/connect-database-page";

const searchSchema = z.object({
  orgId: z
    .string()
    .optional()
    .transform((value) => sanitizeOnboardingOrganizationId(value)),
});

export const Route = createFileRoute(
  "/_authenticated/onboarding/connect-database"
)({
  component: ConnectDatabasePage,
  validateSearch: zodValidator(searchSchema),
});
