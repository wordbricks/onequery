import { createFileRoute, Outlet } from "@tanstack/react-router";

import { requireAuthenticatedRoute } from "@/lib/route-auth";

function AuthenticatedLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) => {
    const session = requireAuthenticatedRoute(context.auth, location);
    return { session };
  },
  component: AuthenticatedLayout,
});
