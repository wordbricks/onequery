import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useLocation } from "@tanstack/react-router";
import type { MouseEvent } from "react";

import { hasOrganizationAdminAccess } from "@/lib/organization-role-access";
import { teamMembersQueryOptions } from "@/queries/team-queries";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/ui/sidebar";

import { isNavItemActive, navItems } from "./nav-items";
import type { NavItem } from "./nav-items";

const orgRouteApi = getRouteApi("/_authenticated/$org_slug");

type SidebarNavProps = {
  orgSlug: string;
};

export function SidebarNav({ orgSlug }: SidebarNavProps) {
  const location = useLocation();
  const routeContext = orgRouteApi.useRouteContext();
  const membersQuery = useQuery({
    ...teamMembersQueryOptions(
      routeContext.session.user.id,
      routeContext.organizationId
    ),
  });
  const currentUserRole = membersQuery.data?.find(
    (member) => member.userId === routeContext.session.user.id
  )?.rawRole;
  const canAccessOrganizationAdminNav = hasOrganizationAdminAccess({
    rawRole: currentUserRole,
  });

  const visibleNavItems = navItems.filter(
    (item) => !item.organizationAdminOnly || canAccessOrganizationAdminNav
  );

  return (
    <SidebarContent className="overflow-hidden">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {visibleNavItems.map((item) => (
              <NavMenuItem
                key={item.to}
                item={item}
                orgSlug={orgSlug}
                pathname={location.pathname}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  );
}

function NavMenuItem({
  item,
  orgSlug,
  pathname,
  onClick,
}: {
  item: NavItem;
  orgSlug: string;
  pathname: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const isActive = isNavItemActive(item.to, pathname);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        className={isActive ? "!bg-foreground/10 hover:!bg-foreground/10" : ""}
        onClick={onClick}
        render={<Link to={item.to} params={{ org_slug: orgSlug }} />}
      >
        <item.icon size={20} stroke={1.5} />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
