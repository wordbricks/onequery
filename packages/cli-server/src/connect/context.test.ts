import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthenticatedCliConnectRequestContext,
  createCliConnectContextValues,
  createCliConnectRequestContext,
  requireCliConnectRequestContext,
} from "./context";
import type { CliConnectRequestContext } from "./context";

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
    const sessionResult = Result.ok(session);
    const resolveAuthenticatedCliSession = vi
      .fn()
      .mockResolvedValue(sessionResult);

    const c = {
      var: {
        requestId: "req_cli_123",
      },
    } as never;
    const requestContext = createCliConnectRequestContext(c, {
      resolveAuthenticatedCliSession,
    });

    await expect(requestContext.resolveSession()).resolves.toBe(sessionResult);
    await expect(requestContext.resolveSession()).resolves.toBe(sessionResult);

    expect(requestContext.requestId).toBe("req_cli_123");
    expect(resolveAuthenticatedCliSession).toHaveBeenCalledTimes(1);
    expect(resolveAuthenticatedCliSession).toHaveBeenCalledWith(c);
  });

  it("resolves active org slug only for opt-in session requests", async () => {
    const sessionResult = Result.ok({ activeOrg: null } as never);
    const sessionWithActiveOrgResult = Result.ok({
      activeOrg: "acme",
    } as never);
    const resolveAuthenticatedCliSession = vi
      .fn()
      .mockResolvedValueOnce(sessionResult)
      .mockResolvedValueOnce(sessionWithActiveOrgResult);

    const c = {
      var: {
        requestId: "req_cli_123",
      },
    } as never;
    const requestContext = createCliConnectRequestContext(c, {
      resolveAuthenticatedCliSession,
    });

    await expect(requestContext.resolveSession()).resolves.toBe(sessionResult);
    await expect(
      requestContext.resolveSession({ includeActiveOrgSlug: true })
    ).resolves.toBe(sessionWithActiveOrgResult);
    await expect(
      requestContext.resolveSession({ includeActiveOrgSlug: true })
    ).resolves.toBe(sessionWithActiveOrgResult);

    expect(resolveAuthenticatedCliSession).toHaveBeenCalledTimes(2);
    expect(resolveAuthenticatedCliSession).toHaveBeenNthCalledWith(1, c);
    expect(resolveAuthenticatedCliSession).toHaveBeenNthCalledWith(2, c, {
      includeActiveOrgSlug: true,
    });
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
    const sessionResult = Result.ok(session);
    const resolveAuthenticatedCliSession = vi
      .fn()
      .mockResolvedValue(sessionResult);
    const sourceListOrgResult = Result.ok(sourceListOrg);
    const sourceReadOrgResult = Result.ok(sourceReadOrg);
    const resolveAuthorizedCliOrg = vi
      .fn()
      .mockResolvedValueOnce(sourceListOrgResult)
      .mockResolvedValueOnce(sourceReadOrgResult);

    const c = {
      var: {
        requestId: "req_cli_123",
      },
    } as never;
    const requestContext = createCliConnectRequestContext(c, {
      resolveAuthenticatedCliSession,
      resolveAuthorizedCliOrg,
    });

    await expect(
      requestContext.resolveAuthorizedOrg({
        action: "source.list",
        orgSlug: "acme",
      })
    ).resolves.toBe(sourceListOrgResult);
    await expect(
      requestContext.resolveAuthorizedOrg({
        action: "source.list",
        orgSlug: "acme",
      })
    ).resolves.toBe(sourceListOrgResult);
    await expect(
      requestContext.resolveAuthorizedOrg({
        action: "source.read",
        orgSlug: "acme",
      })
    ).resolves.toBe(sourceReadOrgResult);

    expect(resolveAuthenticatedCliSession).toHaveBeenCalledTimes(1);
    expect(resolveAuthorizedCliOrg).toHaveBeenCalledTimes(2);
    expect(resolveAuthorizedCliOrg).toHaveBeenNthCalledWith(1, {
      action: "source.list",
      c,
      orgSlug: "acme",
      session,
    });
    expect(resolveAuthorizedCliOrg).toHaveBeenNthCalledWith(2, {
      action: "source.read",
      c,
      orgSlug: "acme",
      session,
    });
  });

  it("stores the request context in connect context values", () => {
    const c = {
      var: {
        requestId: "req_cli_123",
      },
    } as never;

    const requestContext = requireCliConnectRequestContext({
      values: createCliConnectContextValues(c),
    });

    expect(requestContext.honoContext).toBe(c);
    expect(requestContext.requestId).toBe("req_cli_123");
  });

  it("binds org authorization to the authenticated session", async () => {
    const session = {
      user: {
        id: "user-1",
      },
    } as never;
    const authorizedOrg = {
      org: {
        slug: "acme",
      },
    } as never;
    const resolveAuthorizedOrg = vi
      .fn()
      .mockResolvedValue(Result.ok(authorizedOrg));
    const requestContext: CliConnectRequestContext = {
      honoContext: { get: vi.fn() } as never,
      requestId: "req_cli_123",
      resolveAuthorizedOrg,
      resolveSession: vi.fn(),
    };

    const authenticatedContext = createAuthenticatedCliConnectRequestContext(
      requestContext,
      session
    );

    await expect(
      authenticatedContext.resolveAuthorizedOrg({
        action: "source.read",
        orgSlug: "acme",
      })
    ).resolves.toEqual(Result.ok(authorizedOrg));
    expect(authenticatedContext.session).toBe(session);
    expect(resolveAuthorizedOrg).toHaveBeenCalledWith({
      action: "source.read",
      orgSlug: "acme",
      session,
    });
  });
});
