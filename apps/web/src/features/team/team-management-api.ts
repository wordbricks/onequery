import { z } from "zod";

import { getApiBaseUrl } from "@/lib/api-base-url";
import { buildTeamOrganizationApiPath } from "@/lib/api-paths";
import type { OrganizationRoleName } from "@/lib/organization-role-access";

const InvitationSchema = z.object({
  expiresAt: z.coerce.date().optional(),
  id: z.string(),
  role: z.string().optional(),
});

const TeamMemberSchema = z.object({
  id: z.string(),
  role: z.string(),
});

const RemoveMemberResponseSchema = z.object({
  member: TeamMemberSchema,
});
async function parseApiError(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => null);
    const parsed = z
      .object({
        code: z.string().optional(),
        error: z.string().optional(),
        message: z.string().optional(),
      })
      .safeParse(body);

    if (parsed.success) {
      // Comment: app-owned routes return `{ error }`, while Better Auth errors
      // come back as `{ code, message }`. Normalize both shapes before falling
      // back to raw response text so invite failures stay readable in the UI.
      return parsed.data.error ?? parsed.data.message ?? fallbackMessage;
    }
  }

  const text = await response.text().catch(() => "");
  return text || fallbackMessage;
}

async function requestTeamApi<T>(input: {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  successSchema: z.ZodType<T>;
  errorMessage: string;
}): Promise<T> {
  // Comment: Team writes always target an explicit route organization. Avoid
  // Better Auth's active-org inference here so writes stay pinned to the
  // route-selected organization.
  const response = await fetch(`${getApiBaseUrl()}${input.path}`, {
    body: input.body ? JSON.stringify(input.body) : undefined,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: input.method,
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response, input.errorMessage));
  }

  const payload = await response.json().catch(() => null);
  const parsed = input.successSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error(input.errorMessage);
  }

  return parsed.data;
}

export async function inviteTeamMember(input: {
  organizationId: string;
  email: string;
  roleNames: readonly OrganizationRoleName[];
}) {
  return requestTeamApi({
    body: {
      email: input.email,
      role:
        input.roleNames.length === 1
          ? input.roleNames[0]
          : [...input.roleNames],
    },
    errorMessage: "Failed to create invitation link",
    method: "POST",
    path: buildTeamOrganizationApiPath(input.organizationId, "invitations"),
    successSchema: InvitationSchema,
  });
}

export async function cancelTeamInvitation(input: {
  organizationId: string;
  invitationId: string;
}) {
  return requestTeamApi({
    errorMessage: "Failed to cancel invitation",
    method: "DELETE",
    path: buildTeamOrganizationApiPath(
      input.organizationId,
      "invitations",
      input.invitationId
    ),
    successSchema: InvitationSchema,
  });
}

export async function updateTeamMemberRole(input: {
  organizationId: string;
  memberId: string;
  roleNames: readonly OrganizationRoleName[];
}) {
  return requestTeamApi({
    body: {
      role:
        input.roleNames.length === 1
          ? input.roleNames[0]
          : [...input.roleNames],
    },
    errorMessage: "Failed to update role",
    method: "PATCH",
    path: buildTeamOrganizationApiPath(
      input.organizationId,
      "members",
      input.memberId,
      "role"
    ),
    successSchema: TeamMemberSchema,
  });
}

export async function removeTeamMember(input: {
  organizationId: string;
  memberId: string;
}) {
  return requestTeamApi({
    errorMessage: "Failed to remove member",
    method: "DELETE",
    path: buildTeamOrganizationApiPath(
      input.organizationId,
      "members",
      input.memberId
    ),
    successSchema: RemoveMemberResponseSchema,
  });
}
