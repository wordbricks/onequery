import { testClient } from "hono/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { landingApp } from "./app";
import type {
  LandingServiceUnavailableErrorResponse,
  LandingValidationErrorResponse,
  LandingWorkerBindings,
} from "./app";
import {
  createContactNotification,
  createProductUpdatesNotification,
} from "./landing/landing-notifications";

const originalFetch = globalThis.fetch;

function installFetchMock(fetchMock: typeof globalThis.fetch) {
  globalThis.fetch = fetchMock;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("landingApp", () => {
  it("assigns a request id to successful API responses", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    installFetchMock(fetchSpy);

    const response = await testClient(landingApp, {
      LANDING_SLACK_WEBHOOK_URL: "https://example.com/hooks/landing",
    } satisfies LandingWorkerBindings).api["product-updates"].$post({
      json: { email: "team@example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toEqual(expect.any(String));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts product updates submissions with trimmed email input", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    installFetchMock(fetchSpy);

    const response = await testClient(landingApp, {
      LANDING_SLACK_WEBHOOK_URL: "https://example.com/hooks/landing",
    } satisfies LandingWorkerBindings).api["product-updates"].$post({
      json: { email: " TEST@Example.COM " },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: "test@example.com",
    });
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/hooks/landing", {
      body: JSON.stringify(
        createProductUpdatesNotification("test@example.com")
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("normalizes contact submissions before delivery", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    installFetchMock(fetchSpy);

    const response = await testClient(landingApp, {
      LANDING_SLACK_WEBHOOK_URL: "https://example.com/hooks/landing",
    } satisfies LandingWorkerBindings).api.contact.$post({
      json: {
        email: " TEAM@Example.COM ",
        message: " Need pricing details ",
        name: " Jane Doe ",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/hooks/landing", {
      body: JSON.stringify(
        createContactNotification({
          email: "team@example.com",
          message: "Need pricing details",
          name: "Jane Doe",
        })
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("rejects contact submissions that become empty after trimming", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    installFetchMock(fetchSpy);

    const response = await testClient(landingApp).api.contact.$post({
      json: {
        email: "team@example.com",
        message: "   ",
        name: "   ",
      },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as LandingValidationErrorResponse;
    expect(body).toEqual({
      code: "validation_error",
      fieldErrors: {
        message: ["message is required"],
        name: ["name is required"],
      },
      message: "name is required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a typed 503 error response when delivery is unconfigured", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    installFetchMock(fetchSpy);

    const response = await landingApp.request(
      "https://landing.onequery.dev/api/product-updates",
      {
        body: JSON.stringify({ email: "team@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      {}
    );

    expect(response.status).toBe(503);
    const body =
      (await response.json()) as LandingServiceUnavailableErrorResponse;
    expect(body).toEqual({
      code: "service_unavailable",
      message: "Landing ingest is not configured",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
