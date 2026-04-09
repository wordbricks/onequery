import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection } from "../types";
import { postHogSourceApiAdapter } from "./posthog";

const originalFetch = globalThis.fetch;

const source: PreparedSourceConnection = {
  credentials: {
    hostUrl: "https://app.posthog.com",
    personalApiKey: "phc_test_key",
    projectId: "12345",
    type: "posthog",
  },
  displayName: "PostHog Prod",
  id: "source_1",
  provider: "posthog",
  sourceKey: "posthog-prod",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("posthog source api adapter", () => {
  it("describes the run_query operation", async () => {
    const descriptor = await postHogSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    expect(descriptor.defaultPathOperation).toBeUndefined();
    expect(descriptor.operations).toMatchObject([
      {
        kind: "structured_request",
        name: "run_query",
        selectorKind: "none",
      },
    ]);
  });

  it("normalizes structured run_query requests", async () => {
    const descriptor = await postHogSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    const plan = await postHogSourceApiAdapter.normalize({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      descriptor,
      request: {
        body: {
          kind: "json",
          value: {
            query: {
              kind: "TrendsQuery",
            },
          },
        },
        fieldPatch: {
          refresh: "force_async",
        },
        headers: [],
        operation: "run_query",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "structured_request",
      operation: "run_query",
      provider: "posthog",
      sourceId: "source_1",
      sourceKey: "posthog-prod",
    });
    expect(plan.kind).toBe("structured_request");
    if (plan.kind !== "structured_request") {
      throw new Error("expected structured request plan");
    }
    expect(plan.request).toEqual({
      query: {
        kind: "TrendsQuery",
      },
      refresh: "force_async",
    });
  });

  it("executes PostHog requests with upstream status and headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        headers: {
          "content-type": "application/json",
          "x-request-id": "rq_123",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await postHogSourceApiAdapter.execute({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      plan: {
        body: {
          kind: "json",
          value: {
            query: {
              kind: "TrendsQuery",
            },
          },
        },
        bodyKind: "json",
        descriptorVersion: "posthog.v1",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        operation: "run_query",
        provider: "posthog",
        request: {
          query: {
            kind: "TrendsQuery",
          },
        },
        requestFingerprint: "fingerprint",
        sourceId: "source_1",
        sourceKey: "posthog-prod",
      },
      source,
    });

    expect(response).toMatchObject({
      contentType: "application/json",
      operation: "run_query",
      status: 200,
    });
    expect(response.body).toEqual({
      kind: "json",
      value: { results: [] },
    });
    expect(response.headers).toEqual([
      {
        name: "content-type",
        value: "application/json",
      },
    ]);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://app.posthog.com/api/projects/12345/query/"
    );
    expect(calledInit?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer phc_test_key",
    });
  });
});
