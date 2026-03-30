import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { organization } from "@/lib/auth-client";
import { DEFAULT_QUERY_STALE_TIME_MS } from "@/lib/query-timing";
import { organizationQueryKeys } from "@/queries/organization-query-keys";
import type { UserScope } from "@/queries/organization-query-keys";

const pendingUserInvitationSchema = z.object({
  createdAt: z.coerce.date(),
  email: z.string(),
  expiresAt: z.coerce.date(),
  id: z.string(),
  inviterId: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  role: z.string().nullable().optional(),
  status: z.string(),
  teamId: z.string().nullable().optional(),
});

const pendingUserInvitationsSchema = z.array(pendingUserInvitationSchema);

export type PendingUserInvitation = z.infer<typeof pendingUserInvitationSchema>;

async function fetchPendingUserInvitations(): Promise<PendingUserInvitation[]> {
  const result = await organization.listUserInvitations();
  if (!result.data) {
    throw new Error("Failed to fetch pending invitations");
  }

  return pendingUserInvitationsSchema.parse(result.data);
}

export function pendingUserInvitationsQueryOptions(userId: UserScope) {
  return queryOptions({
    queryFn: fetchPendingUserInvitations,
    // Comment: received invitations are persisted client-side and scoped to the
    // authenticated email/session, so the cache cannot be shared across users.
    queryKey: organizationQueryKeys.pendingInvitations(userId),
    staleTime: DEFAULT_QUERY_STALE_TIME_MS,
  });
}
