import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCliConnectContextValues,
  createCliConnectRequestContext,
  requireCliConnectRequestContext,
} from "./context";

describe("cli connect request context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("caches authenticated session resolution per request", async () => {
    const session = {
      activeOrg: "acme",
      user: {
        id: "user-1",
      },
    } as never;
    const requireAuthenticatedCliSession = vi.fn().mockResolvedValue(session);

    const c = {
      get: vi.fn().mockReturnValue("req_cli_123"),
    } as never;
    const requestContext = createCliConnectRequestContext(c, {
      requireAuthenticatedCliSession,
    });

    await expect(requestContext.requireSession()).resolves.toBe(session);
    await expect(requestContext.requireSession()).resolves.toBe(session);

    expect(requestContext.requestId).toBe("req_cli_123");
    expect(requireAuthenticatedCliSession).toHaveBeenCalledTimes(1);
    expect(requireAuthenticatedCliSession).toHaveBeenCalledWith(c);
  });

  it("caches org authorization by action and org slug", async () => {
    const session = {
      user: {
        id: "user-1",
      },
    } as never;
    const sourceListOrg = {
      action: "source.list",
      org: {
        slug: "acme",
      },
    } as never;
    const sourceReadOrg = {
      action: "source.read",
      org: {
        slug: "acme",
      },
    } as never;
    const requireAuthenticatedCliSession = vi.fn().mockResolvedValue(session);
    const requireAuthorizedCliOrg = vi
      .fn()
      .mockResolvedValueOnce(sourceListOrg)
      .mockResolvedValueOnce(sourceReadOrg);

    const c = {
      get: vi.fn().mockReturnValue("req_cli_123"),
    } as never;
    const requestContext = createCliConnectRequestContext(c, {
      requireAuthenticatedCliSession,
      requireAuthorizedCliOrg,
    });

    await expect(
      requestContext.requireAuthorizedOrg({
        action: "source.list",
        orgSlug: "acme",
      })
    ).resolves.toBe(sourceListOrg);
    await expect(
      requestContext.requireAuthorizedOrg({
        action: "source.list",
        orgSlug: "acme",
      })
    ).resolves.toBe(sourceListOrg);
    await expect(
      requestContext.requireAuthorizedOrg({
        action: "source.read",
        orgSlug: "acme",
      })
    ).resolves.toBe(sourceReadOrg);

    expect(requireAuthenticatedCliSession).toHaveBeenCalledTimes(1);
    expect(requireAuthorizedCliOrg).toHaveBeenCalledTimes(2);
    expect(requireAuthorizedCliOrg).toHaveBeenNthCalledWith(1, {
      action: "source.list",
      c,
      orgSlug: "acme",
      session,
    });
    expect(requireAuthorizedCliOrg).toHaveBeenNthCalledWith(2, {
      action: "source.read",
      c,
      orgSlug: "acme",
      session,
    });
  });

  it("stores the request context in connect context values", () => {
    const c = {
      get: vi.fn().mockReturnValue("req_cli_123"),
    } as never;

    const requestContext = requireCliConnectRequestContext({
      values: createCliConnectContextValues(c),
    });

    expect(requestContext.honoContext).toBe(c);
    expect(requestContext.requestId).toBe("req_cli_123");
  });
});
