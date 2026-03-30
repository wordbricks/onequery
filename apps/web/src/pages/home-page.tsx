import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { statsQueryOptions } from "@/queries/stats-queries";

const routeApi = getRouteApi("/_authenticated/$org_slug/home");

export function HomePage() {
  const { organizationId } = routeApi.useRouteContext();
  const { data: stats } = useSuspenseQuery(statsQueryOptions(organizationId));

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Welcome to OneQuery</h1>
        <p className="text-muted-foreground mt-2">
          Your workspace is ready to connect data sources and explore usage.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-1">
        <Card>
          <CardHeader>
            <CardTitle>Data Sources</CardTitle>
            <CardDescription>
              Manage the systems OneQuery can query on your behalf
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.dataSourcesCount}</p>
            <p className="text-sm text-muted-foreground">Active data sources</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
