import { getRouteApi } from "@tanstack/react-router";

import { DataSourcesList } from "@/features/data-sources/data-sources-list";

const routeApi = getRouteApi("/_authenticated/$org_slug/integrations");

export function IntegrationsPage() {
  const { organizationId } = routeApi.useRouteContext();

  return (
    <div className="p-8 space-y-12">
      <section>
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Integrations</h1>
          <p className="text-muted-foreground mt-2">
            Manage the data sources connected to your workspace.
          </p>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Data Sources</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Connect databases, analytics platforms, and other services to
            provide data for your agents.
          </p>
        </div>
        <DataSourcesList organizationId={organizationId} />
      </section>
    </div>
  );
}
