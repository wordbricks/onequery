import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizePreparedSourceApi } from "../normalize";
import type { PreparedSourceConnection } from "../types";
import { amplitudeSourceApiAdapter } from "./amplitude";

const originalFetch = globalThis.fetch;

const source: PreparedSourceConnection = {
  credentials: {
    apiKey: "amp-api-key",
    region: "us",
    secretKey: "amp-secret-key",
    type: "amplitude",
  },
  displayName: "Amplitude Prod",
  id: "source_1",
  provider: "amplitude",
  sourceKey: "amplitude-prod",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("amplitude source api adapter", () => {
  it("describes the canonical fetch operation", async () => {
    const descriptor = await amplitudeSourceApiAdapter.describe({
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

  it("normalizes path selectors into canonical Amplitude URLs", async () => {
    const descriptor = await amplitudeSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    const plan = await amplitudeSourceApiAdapter.normalize({
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
            end: "2026-03-07",
            start: "2026-03-01",
          },
        },
        headers: [],
        operation: "fetch_api",
        selector: "/2/events/segmentation",
      },
      source,
    });
    const finalizedPlan = finalizePreparedSourceApi(plan);

    expect(plan).toMatchObject({
      kind: "http_request",
      method: "GET",
      operation: "fetch_api",
      selector: "/2/events/segmentation",
      selectorTemplate: "/{path}",
      url: "https://amplitude.com/2/events/segmentation?end=2026-03-07&start=2026-03-01",
    });
    expect(finalizedPlan.host).toBe("amplitude.com");
    expect(finalizedPlan.bodyPaths).toEqual([]);
  });

  it("executes Amplitude requests with upstream status and headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await amplitudeSourceApiAdapter.execute({
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
        descriptorVersion: "amplitude.v1",
        headerNames: [],
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch_api",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "amplitude",
        query: {
          start: "2026-03-01",
        },
        selector: "/2/events/segmentation",
        sourceId: "source_1",
        sourceKey: "amplitude-prod",
        url: "https://amplitude.com/2/events/segmentation?start=2026-03-01",
      },
      source,
    });

    expect(response).toMatchObject({
      contentType: "application/json",
      operation: "fetch_api",
      selector: "/2/events/segmentation",
      status: 200,
    });
    expect(response.body).toEqual({
      kind: "json",
      value: { data: [] },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://amplitude.com/2/events/segmentation?start=2026-03-01"
    );
    expect(calledInit?.headers).toMatchObject({
      Accept: "application/json",
    });
  });
});
