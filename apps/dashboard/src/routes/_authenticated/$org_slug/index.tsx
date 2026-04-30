import { createFileRoute, redirect } from "@tanstack/react-router";

import { ORGANIZATION_HOME_ROUTE } from "@/lib/app-routes";

export const Route = createFileRoute("/_authenticated/$org_slug/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      params: { org_slug: params.org_slug },
      to: ORGANIZATION_HOME_ROUTE,
    });
  },
});
