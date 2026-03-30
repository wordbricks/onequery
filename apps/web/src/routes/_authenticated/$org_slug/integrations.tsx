import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { IntegrationsPage } from "@/pages/integrations-page";
import { dataSourcesQueryOptions } from "@/queries/data-sources-queries";

const searchSchema = z.object({});

export const Route = createFileRoute("/_authenticated/$org_slug/integrations")({
  component: IntegrationsPage,
  loader: async ({ context: { queryClient, organizationId } }) => {
    await queryClient.ensureQueryData(dataSourcesQueryOptions(organizationId));
  },
  validateSearch: zodValidator(searchSchema),
});
