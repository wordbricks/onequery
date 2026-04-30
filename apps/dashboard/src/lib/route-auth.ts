import { redirect } from "@tanstack/react-router";

import { SIGNIN_ROUTE } from "@/lib/app-routes";
import type { getSession } from "@/lib/auth-client";
import { resolvePostAuthRedirectPath } from "@/lib/auth-redirect";

type SessionResult = Awaited<ReturnType<typeof getSession>>;
type BetterAuthSession = NonNullable<SessionResult["data"]>;
type BetterAuthUser = BetterAuthSession["user"];

export interface RouteSession {
  user: Pick<BetterAuthUser, "id" | "email" | "name">;
}

export interface RouterAuthContext {
  isAuthenticated: boolean;
  session: RouteSession | null;
}

interface RouteLocationLike {
  href?: string;
  pathname: string;
  search?: unknown;
  hash: string;
}

const ROUTE_URL_PARSE_BASE = "https://route.invalid";

function buildRedirectTarget(location: RouteLocationLike): string {
  if (typeof location.href === "string") {
    const url = new URL(location.href, ROUTE_URL_PARSE_BASE);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  const search = typeof location.search === "string" ? location.search : "";
  return `${location.pathname}${search}${location.hash}`;
}

function createRouteSession(
  session: SessionResult["data"] | null | undefined
): RouteSession | null {
  if (!session?.user) {
    return null;
  }

  return { user: session.user };
}

export const defaultRouterAuth = {
  isAuthenticated: false,
  session: null,
} satisfies RouterAuthContext;

export function createRouterAuth(
  session: SessionResult["data"] | null | undefined
): RouterAuthContext {
  const routeSession = createRouteSession(session);
  return {
    isAuthenticated: routeSession !== null,
    session: routeSession,
  };
}

export function requireAuthenticatedRoute(
  auth: RouterAuthContext,
  location: RouteLocationLike
): RouteSession {
  if (!auth.session?.user) {
    throw redirect({
      search: { redirect: buildRedirectTarget(location) },
      to: SIGNIN_ROUTE,
    });
  }

  return auth.session;
}

export function redirectAuthenticatedRoute(
  auth: RouterAuthContext,
  redirectPath?: string
): void {
  if (!auth.session?.user) {
    return;
  }

  const redirectTarget = resolvePostAuthRedirectPath(redirectPath);
  throw redirect({ to: redirectTarget.path });
}
