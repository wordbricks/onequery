import { describe, expect, it } from "vitest";

import { resolvePostAuthLandingTarget } from "./post-auth-landing";

describe("resolvePostAuthLandingTarget", () => {
  it("prefers the first organization when memberships exist", () => {
    expect(
      resolvePostAuthLandingTarget({
        organizations: [
          {
            createdAt: new Date("2026-03-26T00:00:00.000Z"),
            id: "org_1",
            logo: null,
            name: "Acme",
            slug: "acme",
          },
        ],
        pendingInvitations: [],
        signupMode: "invite-only",
      })
    ).toEqual({
      kind: "organizationHome",
      organizationSlug: "acme",
    });
  });

  it("prefers a pending invitation before zero-org onboarding", () => {
    expect(
      resolvePostAuthLandingTarget({
        organizations: [],
        pendingInvitations: [
          {
            createdAt: new Date("2026-03-26T00:00:00.000Z"),
            email: "invitee@example.com",
            expiresAt: new Date("2026-03-27T00:00:00.000Z"),
            id: "invite_1",
            inviterId: "user_1",
            organizationId: "org_1",
            organizationName: "Acme",
            role: "member",
            status: "pending",
            teamId: null,
          },
        ],
        signupMode: "invite-only",
      })
    ).toEqual({
      invitationId: "invite_1",
      kind: "invite",
    });
  });

  it("stops zero-org invite-only users from falling back to create-org", () => {
    expect(
      resolvePostAuthLandingTarget({
        organizations: [],
        pendingInvitations: [],
        signupMode: "invite-only",
      })
    ).toEqual({
      kind: "inviteOnlyPendingAccess",
    });
  });

  it("keeps zero-org onboarding available outside invite-only mode", () => {
    expect(
      resolvePostAuthLandingTarget({
        organizations: [],
        pendingInvitations: [],
        signupMode: "first-user",
      })
    ).toEqual({
      kind: "onboardingCreateOrg",
    });
  });
});
