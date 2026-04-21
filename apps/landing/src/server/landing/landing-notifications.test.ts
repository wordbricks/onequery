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
        notificationType: "product_updates",
        payload,
      },
      logger
    );

    expect(result.isOk()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      {
        delivery: "local-dev-null-sink",
        event: "landing.notification.delivered_local",
        notificationType: "product_updates",
      },
      "landing notification routed to local sink"
    );
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
        notificationType: "product_updates",
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
    expect(logger.error).toHaveBeenCalledWith(
      {
        delivery: "unconfigured",
        event: "landing.notification.delivery_unconfigured",
        notificationType: "product_updates",
      },
      "landing notification delivery is unconfigured"
    );
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
        notificationType: "product_updates",
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
        notificationType: "product_updates",
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
        delivery: "slack-webhook",
        errorMessage: "Failed to send landing notification: boom",
        event: "landing.notification.webhook_request_failed",
        notificationType: "product_updates",
      }),
      "landing notification webhook request failed"
    );
  });

  it("logs webhook rejections with a bounded upstream preview", async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockResolvedValue(
      new Response("invalid payload", { status: 400 })
    );
    installFetchMock(fetchSpy);

    const result = await deliverLandingNotification(
      {
        delivery: {
          kind: "slack-webhook",
          webhookUrl: "https://example.com/hooks/landing",
        },
        notificationType: "contact",
        payload: {
          text: "New contact request from Jane Doe (team@example.com)",
          blocks: [],
        },
      },
      logger
    );

    expect(result.isErr()).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: "slack-webhook",
        event: "landing.notification.webhook_rejected",
        notificationType: "contact",
        status: 400,
        upstreamBodyPreview: "invalid payload",
      }),
      "landing notification webhook rejected"
    );
  });
});
