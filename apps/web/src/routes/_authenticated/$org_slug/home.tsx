import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/pages/home-page";
import { statsQueryOptions } from "@/queries/stats-queries";

export const Route = createFileRoute("/_authenticated/$org_slug/home")({
  component: HomePage,
  loader: async ({ context: { queryClient, organizationId } }) => {
    await queryClient.ensureQueryData(statsQueryOptions(organizationId));
  },
});
