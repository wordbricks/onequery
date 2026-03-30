import {
  IconCoins,
  IconHome,
  IconHistory,
  IconPlugConnected,
  IconUsers,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

export interface NavItem {
  to:
    | "/$org_slug/home"
    | "/$org_slug/audit"
    | "/$org_slug/budget"
    | "/$org_slug/integrations"
    | "/$org_slug/team";
  label: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
  organizationAdminOnly?: boolean;
}

export const navItems: NavItem[] = [
  { icon: IconHome, label: "Home", to: "/$org_slug/home" },
  { icon: IconHistory, label: "Audit", to: "/$org_slug/audit" },
  {
    icon: IconCoins,
    label: "Budget",
    to: "/$org_slug/budget",
  },
  {
    icon: IconPlugConnected,
    label: "Integrations",
    to: "/$org_slug/integrations",
  },
  { icon: IconUsers, label: "Team", to: "/$org_slug/team" },
];

export function isNavItemActive(to: string, pathname: string): boolean {
  const path = to.replace("/$org_slug/", "");
  // Exact match for home
  if (path === "home") {
    return pathname.endsWith("/home");
  }
  return pathname.includes(`/${path}`);
}
