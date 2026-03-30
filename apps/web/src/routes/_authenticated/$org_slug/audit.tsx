import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";

import { AuditPage } from "@/pages/audit-page";
import {
  auditListQueryOptions,
  auditSearchSchema,
} from "@/queries/audit-queries";

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
  validateSearch: zodValidator(auditSearchSchema),
});
