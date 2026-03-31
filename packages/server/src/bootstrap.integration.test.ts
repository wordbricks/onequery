import { and, eq } from "@onequery/db/server";
import { afterEach, describe, expect, it } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../dev-config/src/master-encryption-key";
import { serverApiRoutes } from "./app";
import { getServerStorage } from "./storage";
import {
  closeDatabase,
  createPgliteDatabaseUrl,
} from "./test/integration-helpers";
import type { ClosableDatabase } from "./test/integration-helpers";

function getSetCookieValues(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = headersWithGetSetCookie.getSetCookie?.();

  if (Array.isArray(values) && values.length > 0) {
    return values;
  }

  const setCookie = headers.get("set-cookie");
  return setCookie ? [setCookie] : [];
}

function buildSessionHeaders(
  authResponseHeaders: Headers,
  origin = "http://localhost:4545"
): Headers {
  const headers = new Headers({
    origin,
  });
  const cookies = getSetCookieValues(authResponseHeaders)
    .map((setCookie) => setCookie.split(";")[0]?.trim())
    .filter((value): value is string => Boolean(value));

  if (cookies.length > 0) {
    headers.set("cookie", cookies.join("; "));
  }

  return headers;
}

async function createTestEnv() {
  return {
    BETTER_AUTH_SECRET: "test-better-auth-secret-1234567890",
    BETTER_AUTH_URL: "http://localhost:4545",
    DATABASE_URL: await createPgliteDatabaseUrl("onequery-bootstrap-test-"),
    DISABLE_RATE_LIMIT: true,
    MASTER_ENCRYPTION_KEY: SAMPLE_MASTER_ENCRYPTION_KEY,
    WEB_URL: "http://localhost:4545",
  };
}

function createBootstrapRequest() {
  return new Request("http://localhost:4545/bootstrap/complete", {
    body: JSON.stringify({
      email: "owner@example.com",
      name: "Owner",
      organizationName: "Owner Org",
      organizationSlug: "owner-org",
      password: "password123",
    }),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:4545",
    },
    method: "POST",
  });
}

describe("self-host bootstrap", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("completes the first-run bootstrap flow and creates the initial owner organization", async () => {
    const env = await createTestEnv();
    const storage = getServerStorage(env);
    openedDatabases.push(storage.db as ClosableDatabase);

    const initialStateResponse = await serverApiRoutes.fetch(
      new Request("http://localhost:4545/bootstrap"),
      env
    );
    expect(initialStateResponse.status).toBe(200);
    await expect(initialStateResponse.json()).resolves.toMatchObject({
      isBootstrapped: false,
      needsBootstrap: true,
    });

    const bootstrapResponse = await serverApiRoutes.fetch(
      createBootstrapRequest(),
      env
    );

    expect(bootstrapResponse.status).toBe(201);
    await expect(bootstrapResponse.json()).resolves.toMatchObject({
      bootstrap: {
        organizationSlug: "owner-org",
      },
    });

    const owner = await storage.db.query.user.findFirst({
      columns: {
        email: true,
        id: true,
      },
      where: eq(storage.schema.user.email, "owner@example.com"),
    });

    expect(owner).toMatchObject({
      email: "owner@example.com",
    });

    const ownerMember = await storage.db.query.member.findFirst({
      columns: {
        id: true,
        organizationId: true,
        role: true,
        userId: true,
      },
      where: eq(storage.schema.member.userId, owner?.id ?? ""),
    });

    expect(ownerMember?.role).toBe("owner");

    const finalStateResponse = await serverApiRoutes.fetch(
      new Request("http://localhost:4545/bootstrap"),
      env
    );
    await expect(finalStateResponse.json()).resolves.toMatchObject({
      isBootstrapped: true,
      needsBootstrap: false,
    });
  });

  it("blocks public signup after bootstrap but allows signup for pending invitation emails", async () => {
    const env = await createTestEnv();
    const storage = getServerStorage(env);
    openedDatabases.push(storage.db as ClosableDatabase);

    const bootstrapResponse = await serverApiRoutes.fetch(
      createBootstrapRequest(),
      env
    );

    expect(bootstrapResponse.status).toBe(201);

    const signupStateResponse = await serverApiRoutes.fetch(
      new Request("http://localhost:4545/auth/bootstrap-state"),
      env
    );
    await expect(signupStateResponse.json()).resolves.toMatchObject({
      emailDeliveryMode: "manual-link",
      publicSignupAllowed: false,
      signupMode: "invite-only",
    });

    const blockedSignupResponse = await storage.auth.handler(
      new Request("http://localhost:4545/api/auth/sign-up/email", {
        body: JSON.stringify({
          email: "outsider@example.com",
          name: "Outsider",
          password: "password123",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:4545",
        },
        method: "POST",
      })
    );

    expect(blockedSignupResponse.status).toBe(403);
    await expect(blockedSignupResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("Public signup is disabled"),
      signupMode: "invite-only",
    });

    const owner = await storage.db.query.user.findFirst({
      columns: {
        id: true,
      },
      where: eq(storage.schema.user.email, "owner@example.com"),
    });
    const ownerOrg = await storage.db.query.organization.findFirst({
      columns: {
        id: true,
      },
      where: eq(storage.schema.organization.slug, "owner-org"),
    });

    expect(owner?.id).toBeDefined();
    expect(ownerOrg?.id).toBeDefined();

    await storage.db.insert(storage.schema.invitation).values({
      email: "invitee@example.com",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      id: "invite_1",
      inviterId: owner?.id ?? "",
      organizationId: ownerOrg?.id ?? "",
      role: "member",
      status: "pending",
    });

    const allowedSignupResponse = await storage.auth.handler(
      new Request("http://localhost:4545/api/auth/sign-up/email", {
        body: JSON.stringify({
          email: "invitee@example.com",
          name: "Invitee",
          password: "password123",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:4545",
        },
        method: "POST",
      })
    );

    expect(allowedSignupResponse.status).toBe(200);

    const invitedUser = await storage.db.query.user.findFirst({
      columns: {
        id: true,
      },
      where: eq(storage.schema.user.email, "invitee@example.com"),
    });

    expect(invitedUser?.id).toBeDefined();

    const liveInvitation = await storage.db.query.invitation.findFirst({
      columns: {
        id: true,
      },
      where: and(
        eq(storage.schema.invitation.email, "invitee@example.com"),
        eq(storage.schema.invitation.status, "pending")
      ),
    });

    expect(liveInvitation?.id).toBe("invite_1");
  });

  it("cleans up partially created bootstrap organizations when the auth response is malformed", async () => {
    const env = await createTestEnv();
    const storage = getServerStorage(env);
    openedDatabases.push(storage.db as ClosableDatabase);

    const originalCreateOrganization = storage.auth.api.createOrganization;
    Object.defineProperty(storage.auth.api, "createOrganization", {
      configurable: true,
      value: async () => {
        await storage.db.insert(storage.schema.organization).values({
          id: "org_partial_bootstrap",
          name: "Owner Org",
          slug: "owner-org",
        });

        return new Response(JSON.stringify({ id: "org_partial_bootstrap" }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        });
      },
    });

    try {
      const bootstrapResponse = await serverApiRoutes.fetch(
        createBootstrapRequest(),
        env
      );

      expect(bootstrapResponse.status).toBe(500);
      await expect(bootstrapResponse.json()).resolves.toMatchObject({
        error: "Failed to create the initial organization",
      });

      const owner = await storage.db.query.user.findFirst({
        columns: {
          id: true,
        },
        where: eq(storage.schema.user.email, "owner@example.com"),
      });
      const partialOrganization = await storage.db.query.organization.findFirst(
        {
          columns: {
            id: true,
          },
          where: eq(storage.schema.organization.id, "org_partial_bootstrap"),
        }
      );

      expect(owner).toBeUndefined();
      expect(partialOrganization).toBeUndefined();
    } finally {
      Object.defineProperty(storage.auth.api, "createOrganization", {
        configurable: true,
        value: originalCreateOrganization,
      });
    }
  });

  it("allows zero-org users to create a new organization after invite-only signup", async () => {
    const env = await createTestEnv();
    const storage = getServerStorage(env);
    openedDatabases.push(storage.db as ClosableDatabase);

    const bootstrapResponse = await serverApiRoutes.fetch(
      createBootstrapRequest(),
      env
    );

    expect(bootstrapResponse.status).toBe(201);

    const owner = await storage.db.query.user.findFirst({
      columns: {
        id: true,
      },
      where: eq(storage.schema.user.email, "owner@example.com"),
    });
    const ownerOrg = await storage.db.query.organization.findFirst({
      columns: {
        id: true,
      },
      where: eq(storage.schema.organization.slug, "owner-org"),
    });

    expect(owner?.id).toBeDefined();
    expect(ownerOrg?.id).toBeDefined();

    await storage.db.insert(storage.schema.invitation).values({
      email: "invitee@example.com",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      id: "invite_2",
      inviterId: owner?.id ?? "",
      organizationId: ownerOrg?.id ?? "",
      role: "member",
      status: "pending",
    });

    const invitedSignupResponse = await storage.auth.handler(
      new Request("http://localhost:4545/api/auth/sign-up/email", {
        body: JSON.stringify({
          email: "invitee@example.com",
          name: "Invitee",
          password: "password123",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:4545",
        },
        method: "POST",
      })
    );

    expect(invitedSignupResponse.status).toBe(200);

    const createOrganizationResponse =
      await storage.auth.api.createOrganization({
        asResponse: true,
        body: {
          name: "Invitee Org",
          slug: "invitee-org",
        },
        headers: buildSessionHeaders(invitedSignupResponse.headers),
      });

    expect(createOrganizationResponse.status).toBe(200);
    await expect(createOrganizationResponse.json()).resolves.toMatchObject({
      slug: "invitee-org",
    });

    const inviteeOrg = await storage.db.query.organization.findFirst({
      columns: {
        id: true,
      },
      where: eq(storage.schema.organization.slug, "invitee-org"),
    });

    expect(inviteeOrg?.id).toBeDefined();
  });
});
