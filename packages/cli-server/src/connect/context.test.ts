import { Result } from "better-result";
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
    const sessionResult = Result.ok(session);
    const resolveAuthenticatedCliSession = vi
      .fn()
      .mockResolvedValue(sessionResult);

    const c = {
      get: vi.fn().mockReturnValue("req_cli_123"),
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
      get: vi.fn().mockReturnValue("req_cli_123"),
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
      get: vi.fn().mockReturnValue("req_cli_123"),
    } as never;

    const requestContext = requireCliConnectRequestContext({
      values: createCliConnectContextValues(c),
    });

    expect(requestContext.honoContext).toBe(c);
    expect(requestContext.requestId).toBe("req_cli_123");
  });
});
