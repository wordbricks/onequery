import { afterEach, describe, expect, it, vi } from "vitest";

import { deliverLandingNotification } from "./landing-notifications";

const originalFetch = globalThis.fetch;

function installFetchMock(fetchMock: typeof globalThis.fetch) {
  globalThis.fetch = fetchMock;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("deliverLandingNotification", () => {
  it("accepts local loopback requests without a configured webhook", async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    installFetchMock(fetchSpy);
    const payload = {
      text: "New product updates signup: test@example.com",
      blocks: [],
    };

    const result = await deliverLandingNotification(
      {
        delivery: {
          kind: "local-dev-null-sink",
        },
        payload,
      },
      logger
    );

    expect(result.isOk()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({
      event: "landing_service.local_notification_fallback",
      payload,
    });
  });

  it("stays unavailable outside local loopback when the webhook is missing", async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    installFetchMock(fetchSpy);

    const result = await deliverLandingNotification(
      {
        delivery: {
          kind: "unconfigured",
        },
        payload: {
          text: "New product updates signup: test@example.com",
          blocks: [],
        },
      },
      logger
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("Landing ingest is not configured");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({
      event: "landing_service.notification_unconfigured",
    });
  });

  it("delivers to the configured webhook when present", async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    installFetchMock(fetchSpy);
    const payload = {
      text: "New product updates signup: test@example.com",
      blocks: [],
    };

    const result = await deliverLandingNotification(
      {
        delivery: {
          kind: "slack-webhook",
          webhookUrl: "https://example.com/hooks/landing",
        },
        payload,
      },
      logger
    );

    expect(result.isOk()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/hooks/landing", {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs request failures before returning the request error", async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockRejectedValue(new Error("boom"));
    installFetchMock(fetchSpy);

    const result = await deliverLandingNotification(
      {
        delivery: {
          kind: "slack-webhook",
          webhookUrl: "https://example.com/hooks/landing",
        },
        payload: {
          text: "New product updates signup: test@example.com",
          blocks: [],
        },
      },
      logger
    );

    expect(result.isErr()).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: expect.any(Error),
        event: "landing_service.slack_webhook_request_error",
        message: "Failed to send landing notification: boom",
      })
    );
  });
});
