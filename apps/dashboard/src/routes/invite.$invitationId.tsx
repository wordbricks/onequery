import { createFileRoute } from "@tanstack/react-router";

import { INVITE_ROUTE } from "@/lib/app-routes";
import { requireAuthenticatedRoute } from "@/lib/route-auth";
import { InviteAcceptPage } from "@/pages/invite-accept-page";

export const Route = createFileRoute(INVITE_ROUTE)({
  beforeLoad: ({ context, location }) => {
    requireAuthenticatedRoute(context.auth, location);
  },
  component: InviteAcceptPage,
});
