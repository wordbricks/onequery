import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { AUTH_CALLBACK_ROUTE } from "@/lib/app-routes";
import { sanitizeRedirectPath } from "@/lib/auth-redirect";
import { AuthCallbackPage } from "@/pages/auth-callback-page";

const searchSchema = z.object({
  redirect: z.string().optional().transform(sanitizeRedirectPath),
});

export const Route = createFileRoute(AUTH_CALLBACK_ROUTE)({
  component: AuthCallbackPage,
  validateSearch: zodValidator(searchSchema),
});
