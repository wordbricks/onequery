import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection } from "../types";
import { googleAnalyticsSourceApiAdapter } from "./ga";

const originalFetch = globalThis.fetch;

const source: PreparedSourceConnection = {
  credentials: {
    accessToken: "ya29.test-token",
    authType: "oauth",
    expiresAt: 1_900_000_000,
    propertyId: "123456789",
    refreshToken: "refresh-token",
    type: "ga",
  },
  displayName: "Google Analytics Prod",
  id: "source_1",
  provider: "ga",
  sourceKey: "ga-prod",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("google analytics source api adapter", () => {
  it("describes report and realtime operations", async () => {
    const descriptor = await googleAnalyticsSourceApiAdapter.describe({
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
        name: "run_report",
        selectorKind: "none",
      },
      {
        kind: "structured_request",
        name: "run_realtime_report",
        selectorKind: "none",
      },
    ]);
  });

  it("normalizes structured requests and resolves the connected property", async () => {
    const descriptor = await googleAnalyticsSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    const plan = await googleAnalyticsSourceApiAdapter.normalize({
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
            dateRanges: [{ endDate: "today", startDate: "7daysAgo" }],
            dimensions: [{ name: "date" }],
          },
        },
        fieldPatch: {
          limit: 100,
          metrics: [{ name: "activeUsers" }],
        },
        headers: [],
        operation: "run_report",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "structured_request",
      operation: "run_report",
      provider: "ga",
      selector: "properties/123456789",
      sourceId: "source_1",
      sourceKey: "ga-prod",
    });
    expect(plan.kind).toBe("structured_request");
    if (plan.kind !== "structured_request") {
      throw new Error("expected structured request plan");
    }
    expect(plan.request).toEqual({
      dateRanges: [{ endDate: "today", startDate: "7daysAgo" }],
      dimensions: [{ name: "date" }],
      limit: 100,
      metrics: [{ name: "activeUsers" }],
      property: "properties/123456789",
    });
  });

  it("executes Google Analytics requests with upstream status and headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rows: [] }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await googleAnalyticsSourceApiAdapter.execute({
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
            limit: 25,
            property: "properties/123456789",
          },
        },
        bodyKind: "json",
        descriptorVersion: "ga.v1",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        operation: "run_report",
        provider: "ga",
        request: {
          limit: 25,
          property: "properties/123456789",
        },
        requestFingerprint: "fingerprint",
        selector: "properties/123456789",
        sourceId: "source_1",
        sourceKey: "ga-prod",
      },
      source,
    });

    expect(response).toMatchObject({
      contentType: "application/json; charset=utf-8",
      operation: "run_report",
      status: 200,
    });
    expect(response.body).toEqual({
      kind: "json",
      value: { rows: [] },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport"
    );
    expect(calledInit).toMatchObject({
      method: "POST",
    });
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bearer ya29.test-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      limit: 25,
    });
  });

  it("normalizes missing Google Analytics response content types to octet-stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await googleAnalyticsSourceApiAdapter.execute({
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
            limit: 25,
            property: "properties/123456789",
          },
        },
        bodyKind: "json",
        descriptorVersion: "ga.v1",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        operation: "run_report",
        provider: "ga",
        request: {
          limit: 25,
          property: "properties/123456789",
        },
        requestFingerprint: "fingerprint",
        selector: "properties/123456789",
        sourceId: "source_1",
        sourceKey: "ga-prod",
      },
      source,
    });

    expect(response).toMatchObject({
      contentType: "application/octet-stream",
      operation: "run_report",
      status: 200,
    });
    expect(response.body).toEqual({
      kind: "binary",
      value: new Uint8Array([1, 2, 3]),
    });
  });
});
