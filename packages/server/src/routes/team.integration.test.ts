import { ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS } from "@onequery/base";
import { and, eq, invitation as invitationTable } from "@onequery/db/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createRouteIntegrationHarness,
  createRunId,
} from "../test/integration-helpers";

const TeamInvitationResponseSchema = z.object({
  createdAt: z.coerce.date(),
  email: z.string(),
  expiresAt: z.coerce.date(),
  id: z.string(),
  inviterId: z.string(),
  organizationId: z.string(),
  role: z.string().nullable().optional(),
  status: z.string(),
});

function expectExpiryToMatchPolicy(expiresAt: Date, createdAtMs: number) {
  const expectedExpiryMs =
    createdAtMs + ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS * 1000;

  expect(
    Math.abs(expiresAt.getTime() - expectedExpiryMs),
    "Invitation expiry should stay aligned with the configured 7-day lifetime"
  ).toBeLessThan(60_000);
}

describe("team invitation expiry alignment", () => {
  it("returns 7-day expirations, rejects expired invites, and reuses pending invites on re-invite", async () => {
    const { app, auth, db, env, test } = await createRouteIntegrationHarness();

    const runId = createRunId();
    const adminUser = test.createUser({
      email: `team-admin-${runId}@example.com`,
    });
    const acceptedInvitee = test.createUser({
      email: `team-accepted-${runId}@example.com`,
    });
    const expiredInvitee = test.createUser({
      email: `team-expired-${runId}@example.com`,
    });
    const reinvitedInvitee = test.createUser({
      email: `team-reinvited-${runId}@example.com`,
    });
    const organization = test.createOrganization({
      name: `Team Invitation Alignment ${runId}`,
      slug: `team-invitation-alignment-${runId}`,
    });

    await test.saveUser(adminUser);
    await test.saveUser(acceptedInvitee);
    await test.saveUser(expiredInvitee);
    await test.saveUser(reinvitedInvitee);

    try {
      await test.saveOrganization(organization);
      await test.addMember({
        organizationId: organization.id as string,
        role: "owner",
        userId: adminUser.id,
      });

      const adminLogin = await test.login({ userId: adminUser.id });
      const adminCookie = adminLogin.headers.get("cookie");

      if (!adminCookie) {
        throw new Error("Admin login must expose a cookie header");
      }

      const createInvitation = async (email: string) => {
        const requestedAt = Date.now();
        const response = await app.request(
          `http://localhost/api/team/organizations/${organization.id}/invitations`,
          {
            body: JSON.stringify({
              email,
              role: "member",
            }),
            headers: {
              "content-type": "application/json",
              cookie: adminCookie,
            },
            method: "POST",
          },
          env
        );

        expect(response.status).toBe(200);

        const payload = TeamInvitationResponseSchema.parse(
          await response.json()
        );

        return {
          invitation: payload,
          requestedAt,
        };
      };

      const acceptedInvitationResult = await createInvitation(
        acceptedInvitee.email
      );
      expectExpiryToMatchPolicy(
        acceptedInvitationResult.invitation.expiresAt,
        acceptedInvitationResult.requestedAt
      );

      const acceptedInviteeLogin = await test.login({
        userId: acceptedInvitee.id,
      });
      const acceptedInvitation = await auth.api.acceptInvitation({
        body: {
          invitationId: acceptedInvitationResult.invitation.id,
        },
        headers: acceptedInviteeLogin.headers,
      });

      expect(acceptedInvitation.invitation.id).toBe(
        acceptedInvitationResult.invitation.id
      );
      expect(acceptedInvitation.member.organizationId).toBe(organization.id);

      const expiredInvitationResult = await createInvitation(
        expiredInvitee.email
      );

      await db
        .update(invitationTable)
        .set({
          expiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(invitationTable.id, expiredInvitationResult.invitation.id));

      const expiredInviteeLogin = await test.login({
        userId: expiredInvitee.id,
      });

      await expect(
        auth.api.acceptInvitation({
          body: {
            invitationId: expiredInvitationResult.invitation.id,
          },
          headers: expiredInviteeLogin.headers,
        })
      ).rejects.toThrow("Invitation not found");

      const originalReinviteResult = await createInvitation(
        reinvitedInvitee.email
      );
      const shortenedExpiry = new Date(Date.now() + 60 * 60 * 1000);

      await db
        .update(invitationTable)
        .set({
          expiresAt: shortenedExpiry,
        })
        .where(eq(invitationTable.id, originalReinviteResult.invitation.id));

      const refreshedReinviteResult = await createInvitation(
        reinvitedInvitee.email
      );

      expect(refreshedReinviteResult.invitation.id).toBe(
        originalReinviteResult.invitation.id
      );
      expect(
        refreshedReinviteResult.invitation.expiresAt.getTime()
      ).toBeGreaterThan(shortenedExpiry.getTime());
      expectExpiryToMatchPolicy(
        refreshedReinviteResult.invitation.expiresAt,
        refreshedReinviteResult.requestedAt
      );

      const pendingReinvites = await db.query.invitation.findMany({
        where: and(
          eq(invitationTable.email, reinvitedInvitee.email.toLowerCase()),
          eq(invitationTable.organizationId, organization.id as string)
        ),
      });

      expect(pendingReinvites).toHaveLength(1);
      expect(pendingReinvites[0]?.status).toBe("pending");
    } finally {
      await test.deleteOrganization?.(organization.id as string);
      await test.deleteUser(reinvitedInvitee.id);
      await test.deleteUser(expiredInvitee.id);
      await test.deleteUser(acceptedInvitee.id);
      await test.deleteUser(adminUser.id);
    }
  });
});
