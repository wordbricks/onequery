import { describe, expect, it, vi } from "vitest";

import {
  refreshCliSessionIdentity,
  resolveCliSessionIdentity,
} from "./session-identity";

describe("cli session identity", () => {
  it("rejects sessions with blank stored tokens", async () => {
    const storage = {
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            session: {
              token: "   ",
              activeOrganizationId: null,
              createdAt: null,
              expiresAt: null,
            },
            user: {
              id: "user-1",
              email: "alice@example.com",
            },
          }),
        },
      },
      db: {},
    } as never;

    await expect(
      resolveCliSessionIdentity(storage, new Headers())
    ).resolves.toBeNull();
  });

  it("ignores blank refresh-token overrides and falls back to the session token", async () => {
    const storage = {
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            response: {
              session: {
                token: "session_token",
                activeOrganizationId: null,
                createdAt: "2026-03-10T00:00:00.000Z",
                expiresAt: "2026-03-17T00:00:00.000Z",
              },
              user: {
                id: "user-1",
                email: "alice@example.com",
              },
            },
            headers: new Headers({
              "set-auth-token": "   ",
            }),
          }),
        },
      },
      db: {},
    } as never;

    await expect(
      refreshCliSessionIdentity(storage, new Headers())
    ).resolves.toMatchObject({
      accessToken: "session_token",
      authMode: "browser_session",
      user: {
        id: "user-1",
        email: "alice@example.com",
        displayName: "alice@example.com",
      },
    });
  });

  it("normalizes Date timestamp objects returned by the auth layer", async () => {
    const storage = {
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            session: {
              token: "session_token",
              activeOrganizationId: null,
              createdAt: new Date("2026-04-20T09:00:00.000Z"),
              expiresAt: new Date("2026-04-20T10:00:00.000Z"),
            },
            user: {
              id: "user-1",
              email: "alice@example.com",
              name: "Alice",
            },
          }),
        },
      },
      db: {},
    } as never;

    await expect(
      resolveCliSessionIdentity(storage, new Headers())
    ).resolves.toMatchObject({
      issuedAt: "2026-04-20T09:00:00.000Z",
      expiresAt: "2026-04-20T10:00:00.000Z",
      user: {
        displayName: "Alice",
      },
    });
  });

  it("defers active org slug lookup by default", async () => {
    const select = vi.fn();
    const storage = {
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            session: {
              token: "session_token",
              activeOrganizationId: "org_1",
              createdAt: null,
              expiresAt: null,
            },
            user: {
              id: "user-1",
              email: "alice@example.com",
            },
          }),
        },
      },
      db: {
        select,
      },
    } as never;

    await expect(
      resolveCliSessionIdentity(storage, new Headers())
    ).resolves.toMatchObject({
      activeOrg: null,
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("resolves active org slug when requested", async () => {
    const limit = vi.fn().mockResolvedValue([{ slug: "acme" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const storage = {
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            session: {
              token: "session_token",
              activeOrganizationId: "org_1",
              createdAt: null,
              expiresAt: null,
            },
            user: {
              id: "user-1",
              email: "alice@example.com",
            },
          }),
        },
      },
      db: {
        select,
      },
    } as never;

    await expect(
      resolveCliSessionIdentity(storage, new Headers(), {
        includeActiveOrgSlug: true,
      })
    ).resolves.toMatchObject({
      activeOrg: "acme",
    });
    expect(select).toHaveBeenCalledTimes(1);
  });
});
