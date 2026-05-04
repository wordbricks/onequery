import { auditListParamsSchema } from "@onequery/audit-contracts/audit";
import { createFileRoute } from "@tanstack/react-router";

import { AuditPage } from "@/pages/audit-page";
import { auditListQueryOptions } from "@/queries/audit-queries";

export const Route = createFileRoute("/_authenticated/$org_slug/audit")({
  component: AuditPage,
  loaderDeps: ({ search }) => search,
  loader: async ({
    context: { organizationSlug, queryClient, session },
    deps,
  }) => {
    await queryClient.ensureQueryData(
      auditListQueryOptions(session.user.id, organizationSlug, deps)
    );
  },
  validateSearch: auditListParamsSchema,
});
