import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizePreparedSourceApi } from "../normalize";
import type { PreparedSourceConnection } from "../types";
import { amplitudeSourceApiAdapter, buildAmplitudeUrl } from "./amplitude";

const originalFetch = globalThis.fetch;

const amplitudeCredentials = {
  apiKey: "amp-api-key",
  region: "us",
  secretKey: "amp-secret-key",
  type: "amplitude",
} as const;

const source: PreparedSourceConnection = {
  credentials: amplitudeCredentials,
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
    expect(descriptor.examples[0]?.command).toContain(
      `-f 'params[e]={"event_type":"Signup"}'`
    );
    expect(descriptor.examples[0]?.command).toContain(
      "-f params[start]=20260301"
    );
    expect(descriptor.examples[0]?.command).not.toContain("params[e]=[");
    expect(descriptor).toMatchSnapshot();
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

    expect(finalizedPlan.host).toBe("amplitude.com");
    expect(finalizedPlan).toMatchSnapshot();
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
        url: "https://amplitude.com/api/2/events/segmentation?start=2026-03-01",
      },
      source,
    });

    expect(response).toMatchSnapshot();

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://amplitude.com/api/2/events/segmentation?start=2026-03-01"
    );
    expect(calledInit?.headers).toMatchObject({
      Accept: "application/json",
    });
  });

  it("does not rewrite selectors that include the Amplitude API mount", () => {
    expect(
      buildAmplitudeUrl({
        credentials: amplitudeCredentials,
        endpoint: "/api/2/events/segmentation",
      })
    ).toBe("https://amplitude.com/api/api/2/events/segmentation");
  });
});
