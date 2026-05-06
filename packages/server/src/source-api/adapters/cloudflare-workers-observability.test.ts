import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizePreparedSourceApi } from "../normalize";
import type { PreparedSourceConnection } from "../types";
import { cloudflareWorkersObservabilitySourceApiAdapter } from "./cloudflare-workers-observability";

const originalFetch = globalThis.fetch;

const source: PreparedSourceConnection = {
  credentials: {
    accountId: "023e105f4ecef8ad9ca31a8372d0c353",
    apiToken: "cf_test_token",
    scriptName: "api-production",
    type: "cloudflare_workers_observability",
  },
  displayName: "Cloudflare Workers",
  id: "source_1",
  provider: "cloudflare_workers_observability",
  sourceKey: "cloudflare-workers",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("cloudflare workers observability source api adapter", () => {
  it("describes telemetry operations", async () => {
    const descriptor =
      await cloudflareWorkersObservabilitySourceApiAdapter.describe({
        actor: {
          capabilities: ["source_api.describe"],
          membershipRoles: ["owner"],
          organizationId: "org_1",
          organizationSlug: "acme",
          userId: "user_1",
        },
        source,
      });

    expect(descriptor.operations.map((operation) => operation.name)).toEqual([
      "list_keys",
      "list_values",
      "run_query",
    ]);
  });

  it("normalizes telemetry query requests", async () => {
    const descriptor =
      await cloudflareWorkersObservabilitySourceApiAdapter.describe({
        actor: {
          capabilities: ["source_api.describe"],
          membershipRoles: ["owner"],
          organizationId: "org_1",
          organizationSlug: "acme",
          userId: "user_1",
        },
        source,
      });

    const plan = await cloudflareWorkersObservabilitySourceApiAdapter.normalize(
      {
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
              dry: true,
              limit: 25,
              queryId: "onequery-recent-events",
              timeframe: {
                from: 1_765_000_000_000,
                to: 1_765_003_600_000,
              },
              view: "events",
            },
          },
          fieldPatch: {
            parameters: {
              datasets: ["cloudflare-workers"],
            },
          },
          headers: [],
          operation: "run_query",
        },
        source,
      }
    );
    const finalizedPlan = finalizePreparedSourceApi(plan);

    expect(plan.kind).toBe("structured_request");
    if (plan.kind !== "structured_request") {
      throw new Error("expected structured request plan");
    }
    expect(finalizedPlan).toMatchObject({
      kind: "structured_request",
      method: "POST",
      operation: "run_query",
      provider: "cloudflare_workers_observability",
      request: {
        dry: true,
        parameters: {
          datasets: ["cloudflare-workers"],
        },
        queryId: "onequery-recent-events",
      },
      selectorTemplate:
        "/accounts/{accountId}/workers/observability/telemetry/query",
    });
  });

  it("executes telemetry requests with bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { events: { events: [] } } }), {
        headers: {
          "content-type": "application/json",
          "x-request-id": "rq_123",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response =
      await cloudflareWorkersObservabilitySourceApiAdapter.execute({
        actor: {
          capabilities: ["source_api.execute"],
          membershipRoles: ["owner"],
          organizationId: "org_1",
          organizationSlug: "acme",
          userId: "user_1",
        },
        prepared: {
          body: { kind: "none" },
          bodyKind: "json",
          bodyPaths: [],
          descriptorVersion: "cloudflare-workers-observability.v1",
          headerNames: [],
          headers: [],
          kind: "structured_request",
          method: "POST",
          operation: "run_query",
          paginationPolicy: "none",
          preparedBinding: "binding",
          provider: "cloudflare_workers_observability",
          request: {
            dry: true,
            queryId: "onequery-recent-events",
            timeframe: {
              from: 1_765_000_000_000,
              to: 1_765_003_600_000,
            },
            timeoutMs: 5_000,
            view: "events",
          },
          sourceId: "source_1",
          sourceKey: "cloudflare-workers",
        },
        source,
      });

    expect(response.status).toBe(200);
    expect(response.headers).toEqual([
      { name: "content-type", value: "application/json" },
    ]);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://api.cloudflare.com/client/v4/accounts/023e105f4ecef8ad9ca31a8372d0c353/workers/observability/telemetry/query"
    );
    expect(calledInit).toMatchObject({
      headers: {
        Authorization: "Bearer cf_test_token",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    expect(JSON.parse(String(calledInit?.body))).not.toHaveProperty(
      "timeoutMs"
    );
  });
});
