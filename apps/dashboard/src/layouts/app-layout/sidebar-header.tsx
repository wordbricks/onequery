import {
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

import {
  getOrganizationInitial,
  resolveOrganizationSlug,
} from "@/features/organizations/organization-options";
import type { OrganizationOption } from "@/features/organizations/organization-options";
import { hasOrganizationPermission } from "@/lib/organization-role-access";
import { teamMembersQueryOptions } from "@/queries/team-queries";
import { buttonVariants } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { SidebarHeader } from "@/ui/sidebar";

const orgRouteApi = getRouteApi("/_authenticated/$org_slug");

interface AppSidebarHeaderProps {
  activeOrganization: OrganizationOption;
  organizations: OrganizationOption[];
  menuOrgSlug: string;
}

export function AppSidebarHeader({
  activeOrganization,
  organizations,
  menuOrgSlug,
}: AppSidebarHeaderProps) {
  const navigate = useNavigate();
  const routeContext = orgRouteApi.useRouteContext();
  const membersQuery = useQuery(
    teamMembersQueryOptions(
      routeContext.session.user.id,
      routeContext.organizationId
    )
  );
  const activeOrganizationName = activeOrganization.name;
  const activeOrganizationInitial = getOrganizationInitial(
    activeOrganization.name
  );
  const hasOrganizations = organizations.length > 0;
  const currentUserRole = membersQuery.data?.find(
    (member) => member.userId === routeContext.session.user.id
  )?.rawRole;
  const canManageOrganizationSettings = hasOrganizationPermission({
    permission: "organizationUpdate",
    rawRole: currentUserRole,
  });

  return (
    <SidebarHeader className="h-14 flex-row items-center border-b px-3">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={buttonVariants({
            className:
              "-mx-2 h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left",
            size: "sm",
            variant: "ghost",
          })}
        >
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded bg-primary text-xs font-semibold text-primary-foreground">
              {activeOrganizationInitial}
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-sm font-medium">
                  {activeOrganizationName}
                </span>
                <IconChevronDown
                  size={12}
                  stroke={2}
                  className="shrink-0 opacity-50"
                />
              </div>
              <div className="text-xs leading-none text-muted-foreground">
                Workspace
              </div>
            </div>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {canManageOrganizationSettings ? (
            <DropdownMenuItem
              onClick={async () =>
                navigate({
                  params: { org_slug: menuOrgSlug },
                  to: "/$org_slug/settings",
                })
              }
            >
              <IconSettings size={16} stroke={2} />
              Settings
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={async () =>
              navigate({
                params: { org_slug: menuOrgSlug },
                to: "/$org_slug/team",
              })
            }
          >
            <IconUsers size={16} stroke={2} />
            Invite and manage members
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Switch organization</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {hasOrganizations ? (
                organizations.map((org) => {
                  const isActive = activeOrganization.id === org.id;
                  const targetSlug = resolveOrganizationSlug(org);
                  return (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={async () =>
                        navigate({
                          params: { org_slug: targetSlug },
                          to: "/$org_slug/home",
                        })
                      }
                    >
                      <span className="truncate">{org.name}</span>
                      {isActive ? (
                        <DropdownMenuShortcut>
                          <IconCheck size={16} stroke={2} />
                        </DropdownMenuShortcut>
                      ) : null}
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <DropdownMenuItem disabled>No organizations</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => navigate({ to: "/onboarding/create-org" })}
              >
                <IconPlus size={16} stroke={2} />
                Create organization
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarHeader>
  );
}
