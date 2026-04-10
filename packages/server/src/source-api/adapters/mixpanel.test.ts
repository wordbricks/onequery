import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizeNormalizedExecutionPlan } from "../normalize";
import type { PreparedSourceConnection } from "../types";
import { mixpanelSourceApiAdapter } from "./mixpanel";

const originalFetch = globalThis.fetch;

const source: PreparedSourceConnection = {
  credentials: {
    projectId: "123",
    region: "us",
    secret: "mixpanel-secret",
    type: "mixpanel",
    username: "mixpanel-user",
    workspaceId: "456",
  },
  displayName: "Mixpanel Prod",
  id: "source_1",
  provider: "mixpanel",
  sourceKey: "mixpanel-prod",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("mixpanel source api adapter", () => {
  it("describes structured and HTTP operations", async () => {
    const descriptor = await mixpanelSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    expect(descriptor.defaultPathOperation).toBe("fetch_query_api");
    expect(descriptor.operations).toMatchObject([
      { kind: "structured_request", name: "query_engage" },
      { kind: "structured_request", name: "query_segmentation" },
      { kind: "http_request", name: "fetch_query_api", selectorKind: "path" },
      { kind: "http_request", name: "export_events", selectorKind: "none" },
    ]);
  });

  it("normalizes raw query API requests into canonical Mixpanel URLs", async () => {
    const descriptor = await mixpanelSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    const plan = await mixpanelSourceApiAdapter.normalize({
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
            from_date: "2026-03-01",
            to_date: "2026-03-07",
            type: "general",
          },
        },
        headers: [],
        operation: "fetch_query_api",
        selector: "/query/events/top",
      },
      source,
    });
    const finalizedPlan = finalizeNormalizedExecutionPlan(plan);

    expect(plan).toMatchObject({
      kind: "http_request",
      method: "GET",
      operation: "fetch_query_api",
      selector: "/query/events/top",
      selectorTemplate: "/{path}",
      url: "https://mixpanel.com/api/query/events/top?from_date=2026-03-01&to_date=2026-03-07&type=general&project_id=123&workspace_id=456",
    });
    expect(finalizedPlan.host).toBe("mixpanel.com");
    expect(finalizedPlan.bodyPaths).toEqual([]);
  });

  it("executes structured segmentation requests through the shared transport", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await mixpanelSourceApiAdapter.execute({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      prepared: {
        body: {
          kind: "json",
          value: {
            event: "Signup",
            fromDate: "2026-03-01",
            toDate: "2026-03-07",
          },
        },
        bodyKind: "json",
        bodyPaths: [],
        descriptorVersion: "mixpanel.v1",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        method: "POST",
        operation: "query_segmentation",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "mixpanel",
        request: {
          event: "Signup",
          fromDate: "2026-03-01",
          toDate: "2026-03-07",
        },
        sourceId: "source_1",
        sourceKey: "mixpanel-prod",
      },
      source,
    });

    expect(response).toMatchObject({
      contentType: "application/json",
      operation: "query_segmentation",
      status: 200,
    });
    expect(response.body).toEqual({
      kind: "json",
      value: { results: [] },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://mixpanel.com/api/query/segmentation?event=%5B%22Signup%22%5D&from_date=2026-03-01&to_date=2026-03-07&project_id=123&workspace_id=456"
    );
    expect(calledInit).toMatchObject({
      method: "GET",
    });
  });
});
