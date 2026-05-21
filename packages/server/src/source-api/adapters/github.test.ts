import type { GitHubCredentials } from "@onequery/db/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizePreparedSourceApi } from "../normalize";
import type { PreparedSourceConnection } from "../types";
import { buildGitHubUrl, githubSourceApiAdapter } from "./github";

const originalFetch = globalThis.fetch;

const githubCredentials = {
  accessToken: "ghp_test-token",
  repositories: ["openai/example"],
  type: "github",
} satisfies GitHubCredentials;

const source: PreparedSourceConnection = {
  credentials: githubCredentials,
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
    expect(descriptor).toMatchSnapshot();
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
    const finalizedPlan = finalizePreparedSourceApi(plan);

    expect(finalizedPlan.host).toBe("api.github.com");
    expect(finalizedPlan).toMatchSnapshot();
  });

  it("normalizes owner/repo shorthand into canonical GitHub URLs", () => {
    expect(
      buildGitHubUrl({
        credentials: githubCredentials,
        endpoint: "openai/example",
      })
    ).toBe("https://api.github.com/repos/openai/example");

    expect(
      buildGitHubUrl({
        credentials: githubCredentials,
        endpoint: "openai/example/pulls",
        params: { state: "all" },
      })
    ).toBe("https://api.github.com/repos/openai/example/pulls?state=all");
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
      prepared: {
        body: { kind: "none" },
        bodyKind: "none",
        bodyPaths: [],
        descriptorVersion: "github.v1",
        headerNames: [],
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "github",
        selector: "/issues",
        sourceId: "source_1",
        sourceKey: "github-prod",
        url: "https://api.github.com/repos/openai/example/issues",
      },
      source,
    });

    expect(response).toMatchSnapshot();
    expect(response.headers).not.toContainEqual({
      name: "server",
      value: "github.com",
    });
  });
});
