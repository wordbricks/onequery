import {
  createFileRoute,
  notFound,
  Outlet,
  redirect,
} from "@tanstack/react-router";

import { organizationsQueryOptions } from "@/features/organizations/organization-options";
import { AppLayout } from "@/layouts/app-layout/layout";
import { ROOT_ROUTE, SIGNIN_ROUTE } from "@/lib/app-routes";
import {
  isOrganizationBySlugError,
  organizationBySlugQueryOptions,
} from "@/queries/organization-queries";

export const Route = createFileRoute("/_authenticated/$org_slug")({
  beforeLoad: async ({ context, params, location }) => {
    const { auth, queryClient } = context;
    const userId = auth.session?.user.id;

    // Fetch organizations list first - this data is also needed by AppLayout.
    await queryClient.ensureQueryData(organizationsQueryOptions(userId));

    // Use React Query's ensureQueryData for organization lookup.
    // This provides automatic request deduplication - if multiple route segments
    // or components trigger this simultaneously, only one request is made.
    const organizationBySlugQuery = organizationBySlugQueryOptions({
      queryClient,
      slug: params.org_slug,
      userId,
    });
    const result = await queryClient
      .ensureQueryData(organizationBySlugQuery)
      .catch((error: unknown) => {
        // Clear failed lookups so transient failures are retried on next navigation.
        queryClient.removeQueries({
          exact: true,
          queryKey: organizationBySlugQuery.queryKey,
        });

        const routeContextForLog = {
          hash: location.hash,
          orgSlug: params.org_slug,
          pathname: location.pathname,
          search: location.search,
        };

        if (isOrganizationBySlugError(error)) {
          console.error("[auth] organization lookup failed", {
            ...routeContextForLog,
            hasResponseBodySnippet: Boolean(error.responseBodySnippet),
            message: error.message,
            status: error.status,
          });

          if (error.status === 401) {
            const redirectTarget = `${location.pathname}${location.search}${location.hash}`;
            throw redirect({
              search: { redirect: redirectTarget },
              to: SIGNIN_ROUTE,
            });
          }

          if (error.status === 403) {
            throw redirect({ to: ROOT_ROUTE });
          }

          if (error.status === 404) {
            throw notFound();
          }
        }

        console.error("[auth] unexpected organization lookup error", {
          ...routeContextForLog,
          errorName: readErrorName(error),
        });
        throw error;
      });

    const organizationId = result.org.id;

    return {
      organizationId,
      organizationSlug: result.org.slug ?? params.org_slug,
      // Pass the route-resolved org itself as the authoritative current org.
      organization: result.org,
    };
  },
  component: OrgLayout,
});

function OrgLayout() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

function readErrorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}
