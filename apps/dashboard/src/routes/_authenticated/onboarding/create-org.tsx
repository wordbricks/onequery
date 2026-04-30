import { createFileRoute } from "@tanstack/react-router";

import { CreateOrgPage } from "@/pages/onboarding/create-org-page";

export const Route = createFileRoute("/_authenticated/onboarding/create-org")({
  component: CreateOrgPage,
});
