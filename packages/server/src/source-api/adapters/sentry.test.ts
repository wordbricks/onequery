import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizeNormalizedExecutionPlan } from "../normalize";
import type { PreparedSourceConnection } from "../types";
import { sentrySourceApiAdapter } from "./sentry";

const originalFetch = globalThis.fetch;

const source: PreparedSourceConnection = {
  credentials: {
    authToken: "sntrys_test_token",
    organizationSlug: "acme",
    projectSlug: "web",
    type: "sentry",
  },
  displayName: "Sentry Prod",
  id: "source_1",
  provider: "sentry",
  sourceKey: "sentry-prod",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("sentry source api adapter", () => {
  it("describes the canonical fetch operation", async () => {
    const descriptor = await sentrySourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    expect(descriptor.defaultPathOperation).toBe("fetch_api");
    expect(descriptor.operations).toMatchObject([
      {
        kind: "http_request",
        name: "fetch_api",
        selectorKind: "path",
      },
    ]);
  });

  it("normalizes selectors into canonical Sentry URLs", async () => {
    const descriptor = await sentrySourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    const plan = await sentrySourceApiAdapter.normalize({
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
            query: "is:unresolved",
          },
        },
        headers: [],
        operation: "fetch_api",
        selector: "/organizations/{organizationSlug}/issues/",
      },
      source,
    });
    const finalizedPlan = finalizeNormalizedExecutionPlan(plan);

    expect(plan).toMatchObject({
      kind: "http_request",
      method: "GET",
      operation: "fetch_api",
      selector: "/organizations/{organizationSlug}/issues/",
      selectorTemplate: "/{path}",
      url: "https://sentry.io/api/0/organizations/acme/issues/?query=is%3Aunresolved",
    });
    expect(finalizedPlan.host).toBe("sentry.io");
    expect(finalizedPlan.bodyPaths).toEqual([]);
  });

  it("executes Sentry requests with upstream status and headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "1" }]), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await sentrySourceApiAdapter.execute({
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
        descriptorVersion: "sentry.v1",
        headerNames: [],
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch_api",
        provider: "sentry",
        query: {
          query: "is:unresolved",
        },
        requestFingerprint: "fingerprint",
        selector: "/organizations/{organizationSlug}/issues/",
        sourceId: "source_1",
        sourceKey: "sentry-prod",
        url: "https://sentry.io/api/0/organizations/acme/issues/?query=is%3Aunresolved",
      },
      source,
    });

    expect(response).toMatchObject({
      contentType: "application/json",
      operation: "fetch_api",
      selector: "/organizations/{organizationSlug}/issues/",
      status: 200,
    });
    expect(response.body).toEqual({
      kind: "json",
      value: [{ id: "1" }],
    });

    const [calledUrl] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://sentry.io/api/0/organizations/acme/issues/?query=is%3Aunresolved"
    );
  });
});
