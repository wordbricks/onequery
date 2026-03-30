import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { getApiBaseUrl } from "@/lib/api-base-url";
import { AUTH_BOOTSTRAP_STATE_API_PATH } from "@/lib/api-paths";
import { SHORT_QUERY_STALE_TIME_MS } from "@/lib/query-timing";

const authBootstrapStateSchema = z.object({
  emailDeliveryMode: z.enum(["manual-link", "smtp"]),
  hasUsers: z.boolean(),
  publicSignupAllowed: z.boolean(),
  signupMode: z.enum(["first-user", "invite-only"]),
});

export type AuthBootstrapState = z.infer<typeof authBootstrapStateSchema>;

async function fetchAuthBootstrapState(): Promise<AuthBootstrapState> {
  const response = await fetch(
    `${getApiBaseUrl()}${AUTH_BOOTSTRAP_STATE_API_PATH}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to load auth bootstrap state");
  }

  const payload = await response.json().catch(() => null);
  return authBootstrapStateSchema.parse(payload);
}

export function authBootstrapStateQueryOptions() {
  return queryOptions({
    queryFn: fetchAuthBootstrapState,
    queryKey: ["auth", "bootstrap-state"],
    staleTime: SHORT_QUERY_STALE_TIME_MS,
  });
}
