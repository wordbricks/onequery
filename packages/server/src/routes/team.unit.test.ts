import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { SessionData, SessionVariables } from "../middleware/session";
import type { StorageVariables } from "../storage";
import { teamRoute } from "./team";

function createMockStorage(input: {
  createInvitation: (options: unknown) => Promise<Response>;
  findMembership: () => Promise<{ id: string; role: string } | null>;
}): StorageVariables["storage"] {
  return {
    auth: {
      api: {
        createInvitation: input.createInvitation,
      },
    },
    db: {
      query: {
        member: {
          findFirst: input.findMembership,
        },
      },
    },
  } as unknown as StorageVariables["storage"];
}

function createSession(): SessionData {
  return {
    session: {
      activeOrganizationId: "org_1",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      id: "session_1",
      token: "token_1",
      userId: "user_1",
    },
    user: {
      email: "owner@example.com",
      id: "user_1",
      image: null,
      name: "Owner",
    },
  };
}

describe("team route", () => {
  it("uses request-scoped storage for invitation creation", async () => {
    const createInvitation = vi.fn(
      async (_options: unknown) =>
        new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        })
    );
    const findMembership = vi.fn(async () => ({
      id: "member_1",
      role: "owner",
    }));
    const app = new Hono<{
      Variables: SessionVariables;
    }>()
      .use("*", async (c, next) => {
        (
          c as typeof c & {
            set: (
              key: "storage" | "session",
              value: StorageVariables["storage"] | SessionData
            ) => void;
          }
        ).set(
          "storage",
          createMockStorage({
            createInvitation,
            findMembership,
          })
        );
        (
          c as typeof c & {
            set: (key: "session", value: SessionData) => void;
          }
        ).set("session", createSession());
        await next();
      })
      .route("/", teamRoute);

    const response = await app.request(
      "http://localhost/organizations/org_1/invitations",
      {
        body: JSON.stringify({
          email: "invitee@example.com",
          role: "member",
        }),
        headers: {
          "content-type": "application/json",
          cookie: "session=test",
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(200);
    expect(findMembership).toHaveBeenCalledOnce();
    expect(createInvitation).toHaveBeenCalledOnce();
    expect(createInvitation.mock.calls[0]?.[0]).toMatchObject({
      asResponse: true,
      body: {
        email: "invitee@example.com",
        organizationId: "org_1",
        resend: true,
        role: "member",
      },
    });
  });
});
