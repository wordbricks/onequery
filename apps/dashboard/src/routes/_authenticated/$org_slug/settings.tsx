import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { getTeamAccessState } from "@/features/team/team-access";
import { ORGANIZATION_HOME_ROUTE } from "@/lib/app-routes";
import { teamMembersQueryOptions } from "@/queries/team-queries";

function SettingsPage() {
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-muted-foreground mt-2">
        Manage your organization settings
      </p>

      <div className="mt-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
            <CardDescription>
              Additional organization settings will be available soon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Organization settings now focus on billing, access, and data
              source controls.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization deletion</CardTitle>
            <CardDescription>
              Self-serve organization deletion is disabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Owners cannot delete organizations in-app. If an organization
              needs to be removed, contact your deployment operator for a
              reviewed hard-delete request.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              This protects memberships, connectors, data sources, and other
              org-owned records from accidental cascade deletion.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/$org_slug/settings")({
  component: SettingsPage,
  loader: async ({
    context: { organizationId, queryClient, session },
    params,
  }) => {
    const members = await queryClient.ensureQueryData(
      teamMembersQueryOptions(session.user.id, organizationId)
    );
    const access = getTeamAccessState({
      currentUserId: session.user.id,
      members,
    });

    if (!access.canUpdateOrganizationSettings) {
      throw redirect({
        params: { org_slug: params.org_slug },
        to: ORGANIZATION_HOME_ROUTE,
      });
    }
  },
});
