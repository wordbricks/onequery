import { Avatar, AvatarFallback } from "@onequery/ui/components/avatar";
import { IconLogout } from "@tabler/icons-react";
import {
  getRouteApi,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import { ThemeToggle } from "@/features/theme/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { buttonVariants } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Separator } from "@/ui/separator";
import { SidebarTrigger } from "@/ui/sidebar";

import { isNavItemActive, navItems } from "./nav-items";

const orgRouteApi = getRouteApi("/_authenticated/$org_slug");

function getInitials(name: string | undefined): string {
  const trimmedName = name?.trim();
  if (!trimmedName) {
    return "?";
  }
  const parts = trimmedName.split(/\s+/);
  const firstPart = parts.at(0);
  if (!firstPart) {
    return "?";
  }
  const firstInitial = firstPart.at(0);
  if (!firstInitial) {
    return "?";
  }
  if (parts.length === 1) {
    return firstInitial.toUpperCase();
  }
  const lastPart = parts.at(-1);
  if (!lastPart) {
    return firstInitial.toUpperCase();
  }
  const lastInitial = lastPart.at(0);
  if (!lastInitial) {
    return firstInitial.toUpperCase();
  }
  return `${firstInitial}${lastInitial}`.toUpperCase();
}

function getCurrentLabel(pathname: string): string {
  for (const item of navItems) {
    if (isNavItemActive(item.to, pathname)) {
      return item.label;
    }
  }
  return "OneQuery";
}

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeContext = orgRouteApi.useRouteContext();
  const router = useRouter();

  const user = routeContext.session.user;
  const userName = user?.name;
  const userEmail = user?.email;
  const userInitials = getInitials(userName);
  const baseLabel = getCurrentLabel(location.pathname);

  async function handleSignOut() {
    await signOut();
    await router.invalidate();
    await navigate({ to: "/" });
  }

  return (
    <header className="sticky top-0 z-10 bg-background flex h-[var(--app-header-height)] shrink-0 items-center justify-between gap-2 border-b px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <span className="font-medium truncate max-w-[70vw]">{baseLabel}</span>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={buttonVariants({
                className: "gap-2",
                size: "sm",
                variant: "ghost",
              })}
            >
              <Avatar size="sm">
                <AvatarFallback>{userInitials}</AvatarFallback>
              </Avatar>
              <span className="text-sm">{userName}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <div className="flex items-center gap-3 px-2 py-2">
                <Avatar>
                  <AvatarFallback>{userInitials}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {userName}
                  </span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {userEmail}
                  </span>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <IconLogout size={16} stroke={2} />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
