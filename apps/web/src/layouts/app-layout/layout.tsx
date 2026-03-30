import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { organizationsQueryOptions } from "@/features/organizations/organization-options";
import type { OrganizationOption } from "@/features/organizations/organization-options";
import { Sidebar, SidebarInset, SidebarProvider } from "@/ui/sidebar";

import { AppHeader } from "./app-header";
import { AppSidebarHeader } from "./sidebar-header";
import { SidebarNav } from "./sidebar-nav";

const routeApi = getRouteApi("/_authenticated/$org_slug");

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const params = useParams({ from: "/_authenticated/$org_slug" });
  const routeContext = routeApi.useRouteContext();
  const orgSlug = params.org_slug ?? "";
  const organizationsQuery = useSuspenseQuery(
    organizationsQueryOptions(routeContext.session.user.id)
  );
  const organizations = organizationsQuery.data;
  const activeOrganization: OrganizationOption = routeContext.organization;
  const menuOrgSlug = routeContext.organizationSlug;

  return (
    <SidebarProvider className="!h-svh">
      <Sidebar>
        <AppSidebarHeader
          activeOrganization={activeOrganization}
          organizations={organizations}
          menuOrgSlug={menuOrgSlug}
        />
        <SidebarNav orgSlug={orgSlug} />
      </Sidebar>
      <SidebarInset className="flex min-h-0 overflow-y-auto [--app-header-height:3.5rem]">
        <AppHeader />
        <main className="h-[calc(100%-var(--app-header-height))]">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
