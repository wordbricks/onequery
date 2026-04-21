import { describe, expect, it, vi } from "vitest";

import { createLandingApp } from "./landing-app";
import type {
  LandingServiceUnavailableProblemResponse,
  LandingValidationProblemResponse,
} from "./landing-app";
import {
  createContactNotification,
  createProductUpdatesNotification,
} from "./landing-notifications";

function createNotificationHarness() {
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
  };
  const transport = vi.fn<typeof fetch>();

  return {
    logger,
    runtime: {
      logger,
      transport,
    },
    transport,
  };
}

describe("createLandingApp", () => {
  it("accepts product updates submissions with trimmed email input", async () => {
    const harness = createNotificationHarness();
    harness.transport.mockResolvedValue(new Response(null, { status: 200 }));

    const app = createLandingApp({
      notificationRuntime: harness.runtime,
    });

    const response = await app.request(
      "https://landing.onequery.dev/api/product-updates",
      {
        body: JSON.stringify({ email: " TEST@Example.COM " }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      {
        LANDING_SLACK_WEBHOOK_URL: "https://example.com/hooks/landing",
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: "test@example.com",
    });
    expect(harness.transport).toHaveBeenCalledWith(
      "https://example.com/hooks/landing",
      {
        body: JSON.stringify(
          createProductUpdatesNotification("test@example.com")
        ),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
  });

  it("normalizes contact submissions before delivery", async () => {
    const harness = createNotificationHarness();
    harness.transport.mockResolvedValue(new Response(null, { status: 200 }));

    const app = createLandingApp({
      notificationRuntime: harness.runtime,
    });

    const response = await app.request(
      "https://landing.onequery.dev/api/contact",
      {
        body: JSON.stringify({
          email: " TEAM@Example.COM ",
          message: " Need pricing details ",
          name: " Jane Doe ",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      {
        LANDING_SLACK_WEBHOOK_URL: "https://example.com/hooks/landing",
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(harness.transport).toHaveBeenCalledWith(
      "https://example.com/hooks/landing",
      {
        body: JSON.stringify(
          createContactNotification({
            email: "team@example.com",
            message: "Need pricing details",
            name: "Jane Doe",
          })
        ),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
  });

  it("rejects contact submissions that become empty after trimming", async () => {
    const harness = createNotificationHarness();
    const app = createLandingApp({
      notificationRuntime: harness.runtime,
    });

    const response = await app.request("http://localhost/api/contact", {
      body: JSON.stringify({
        email: "team@example.com",
        message: "   ",
        name: "   ",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    const body: LandingValidationProblemResponse = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      detail: "Request validation failed",
      status: 422,
      title: "Validation Error",
      type: "about:blank",
    });
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "name",
          message: "name is required",
        }),
        expect.objectContaining({
          field: "message",
          message: "message is required",
        }),
      ])
    );
    expect(harness.transport).not.toHaveBeenCalled();
  });

  it("returns a typed 503 problem response when delivery is unconfigured", async () => {
    const harness = createNotificationHarness();
    const app = createLandingApp({
      notificationRuntime: harness.runtime,
    });

    const response = await app.request(
      "https://landing.onequery.dev/api/product-updates",
      {
        body: JSON.stringify({ email: "team@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      {}
    );

    const body: LandingServiceUnavailableProblemResponse =
      await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      detail: "Landing ingest is not configured",
      status: 503,
      title: "Service Unavailable",
      type: "about:blank",
    });
    expect(harness.transport).not.toHaveBeenCalled();
  });
});
