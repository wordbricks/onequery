import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getApiBaseUrl } from "@/lib/api-base-url";

const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
  plugins: [organizationClient()],
});

export const { useSession } = authClient;

export const { signIn } = authClient;

export const { signOut } = authClient;

export const { signUp } = authClient;

export const { organization } = authClient;

export const getSession = authClient.getSession;
