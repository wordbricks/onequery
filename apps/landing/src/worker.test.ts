import { describe, expect, it, vi } from "vitest";

import type { LandingServiceUnavailableErrorResponse } from "./server/app";
import worker from "./worker";

type WorkerFetchHandler = NonNullable<(typeof worker)["fetch"]>;
type WorkerEnv = Parameters<WorkerFetchHandler>[1];
type WorkerExecutionContext = Parameters<WorkerFetchHandler>[2];
type WorkerRequest = Parameters<WorkerFetchHandler>[0];

function createExecutionContext(): WorkerExecutionContext {
  return {
    exports: {} as WorkerExecutionContext["exports"],
    passThroughOnException: vi.fn(),
    props: {},
    waitUntil: vi.fn(),
  };
}

function createAssetsBinding() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const connect = vi.fn();

  return {
    assets: { connect, fetch } as unknown as WorkerEnv["ASSETS"],
    connect,
    fetch,
  };
}

function createWorkerRequest(
  input: ConstructorParameters<typeof Request>[0],
  init?: ConstructorParameters<typeof Request>[1]
): WorkerRequest {
  return new Request(input, init) as WorkerRequest;
}

describe("landing worker", () => {
  const fetchHandler = worker.fetch;

  if (!fetchHandler) {
    throw new Error("landing worker must export a fetch handler");
  }

  it("routes API requests to the Hono app instead of static assets", async () => {
    const assets = createAssetsBinding();
    const response = await fetchHandler(
      createWorkerRequest("https://landing.onequery.dev/api/product-updates", {
        body: JSON.stringify({ email: "team@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      {
        ASSETS: assets.assets,
      } as WorkerEnv,
      createExecutionContext()
    );
    const body: LandingServiceUnavailableErrorResponse = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      code: "service_unavailable",
      message: "Landing ingest is not configured",
    });
    expect(response.headers.get("x-request-id")).toEqual(expect.any(String));
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("forwards non-API requests to the Cloudflare assets binding", async () => {
    const assets = createAssetsBinding();
    assets.fetch.mockResolvedValue(
      new Response("<html>asset payload</html>", {
        headers: { "content-type": "text/html" },
        status: 200,
      })
    );

    const request = createWorkerRequest("https://landing.onequery.dev/");
    const response = await fetchHandler(
      request,
      {
        ASSETS: assets.assets,
      } as WorkerEnv,
      createExecutionContext()
    );

    expect(assets.fetch).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("<html>asset payload</html>");
  });
});
