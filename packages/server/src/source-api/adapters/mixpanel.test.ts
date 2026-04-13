import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizePreparedSourceApi } from "../normalize";
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
      {
        kind: "structured_request",
        name: "query_engage",
        paginationPolicy: "opaque_token",
      },
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
    const finalizedPlan = finalizePreparedSourceApi(plan);

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

  it("binds query_engage continuation state to Mixpanel session paging", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          page: 1,
          page_size: 1,
          results: [{ distinct_id: "user-2" }],
          session_id: "session_1",
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
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
      continuation: {
        page: 1,
        sessionId: "session_1",
      },
      prepared: {
        body: {
          kind: "json",
          value: {
            pageSize: 1,
          },
        },
        bodyKind: "json",
        bodyPaths: [],
        descriptorVersion: "mixpanel.v1",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        method: "POST",
        operation: "query_engage",
        paginationPolicy: "opaque_token",
        preparedBinding: "binding",
        provider: "mixpanel",
        request: {
          pageSize: 1,
        },
        sourceId: "source_1",
        sourceKey: "mixpanel-prod",
      },
      source,
    });

    expect(response.body).toEqual({
      kind: "json",
      value: {
        page: 1,
        page_size: 1,
        results: [{ distinct_id: "user-2" }],
        session_id: "session_1",
      },
    });
    expect(response.nextContinuationState).toEqual({
      page: 2,
      sessionId: "session_1",
    });

    const [, calledInit] = fetchMock.mock.calls[0] ?? [];
    const requestBody = calledInit?.body;
    expect(typeof requestBody).toBe("string");
    expect(requestBody).toContain("page=1");
    expect(requestBody).toContain("page_size=1");
    expect(requestBody).toContain("session_id=session_1");
  });
});
