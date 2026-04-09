import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection } from "../types";
import { githubSourceApiAdapter } from "./github";

const originalFetch = globalThis.fetch;

const source: PreparedSourceConnection = {
  credentials: {
    accessToken: "ghp_test-token",
    repositories: ["openai/example"],
    type: "github",
  },
  displayName: "GitHub Prod",
  id: "source_1",
  provider: "github",
  sourceKey: "github-prod",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("github source api adapter", () => {
  it("describes the canonical fetch operation", async () => {
    const descriptor = await githubSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    expect(descriptor.defaultPathOperation).toBe("fetch");
    expect(descriptor.operations).toMatchObject([
      {
        kind: "http_request",
        name: "fetch",
        selectorKind: "path",
        summary: "Execute one GitHub REST request.",
      },
    ]);
  });

  it("normalizes repo-scoped selectors into canonical GitHub URLs", async () => {
    const descriptor = await githubSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    const plan = await githubSourceApiAdapter.normalize({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: {
          params: {
            state: "open",
          },
        },
        headers: [],
        operation: "fetch",
        selector: "/issues",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "http_request",
      method: "GET",
      operation: "fetch",
      selector: "/issues",
      url: "https://api.github.com/repos/openai/example/issues?state=open",
    });
  });

  it("executes GitHub requests with upstream status and headers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          etag: '"abc123"',
          server: "github.com",
        },
        status: 201,
      })
    ) as unknown as typeof fetch;

    const response = await githubSourceApiAdapter.execute({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      plan: {
        body: { kind: "none" },
        bodyKind: "none",
        descriptorVersion: "github.v1",
        headerNames: [],
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch",
        provider: "github",
        requestFingerprint: "fingerprint",
        selector: "/issues",
        sourceId: "source_1",
        sourceKey: "github-prod",
        url: "https://api.github.com/repos/openai/example/issues",
      },
      source,
    });

    expect(response).toMatchObject({
      contentType: "application/json",
      operation: "fetch",
      selector: "/issues",
      status: 201,
    });
    expect(response.body).toEqual({
      kind: "json",
      value: { ok: true },
    });
    expect(response.headers).toContainEqual({
      name: "content-type",
      value: "application/json",
    });
    expect(response.headers).toContainEqual({
      name: "etag",
      value: '"abc123"',
    });
    expect(response.headers).not.toContainEqual({
      name: "server",
      value: "github.com",
    });
  });

  it("normalizes missing GitHub response content types to octet-stream", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          etag: '"abc123"',
        },
        status: 200,
      })
    ) as unknown as typeof fetch;

    const response = await githubSourceApiAdapter.execute({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      plan: {
        body: { kind: "none" },
        bodyKind: "none",
        descriptorVersion: "github.v1",
        headerNames: [],
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch",
        provider: "github",
        requestFingerprint: "fingerprint",
        selector: "/issues",
        sourceId: "source_1",
        sourceKey: "github-prod",
        url: "https://api.github.com/repos/openai/example/issues",
      },
      source,
    });

    expect(response).toMatchObject({
      contentType: "application/octet-stream",
      operation: "fetch",
      selector: "/issues",
      status: 200,
    });
    expect(response.body).toEqual({
      kind: "binary",
      value: new Uint8Array([1, 2, 3]),
    });
  });
});
