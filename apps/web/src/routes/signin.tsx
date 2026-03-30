import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { SIGNIN_ROUTE } from "@/lib/app-routes";
import { sanitizeRedirectPath } from "@/lib/auth-redirect";
import { redirectAuthenticatedRoute } from "@/lib/route-auth";
import { SignInPage } from "@/pages/signin-page";

const searchSchema = z.object({
  redirect: z.string().optional().transform(sanitizeRedirectPath),
});

export const Route = createFileRoute(SIGNIN_ROUTE)({
  beforeLoad: ({ context, search }) => {
    redirectAuthenticatedRoute(context.auth, search.redirect);
  },
  component: SignInPage,
  validateSearch: zodValidator(searchSchema),
});
