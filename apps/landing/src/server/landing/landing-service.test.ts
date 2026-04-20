import { describe, expect, it, vi } from "vitest";

import { deliverLandingNotification } from "./landing-service";

describe("deliverLandingNotification", () => {
  it("accepts local loopback requests without a configured webhook", async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
    };
    const transport = vi.fn<typeof fetch>();
    const payload = { text: "New product updates signup: test@example.com" };

    const result = await deliverLandingNotification({
      allowLocalFallback: true,
      logger,
      payload,
      slackWebhookUrl: null,
      transport,
    });

    expect(result.isOk()).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({
      event: "landing_service.local_notification_fallback",
      payload,
    });
  });

  it("stays unavailable outside local loopback when the webhook is missing", async () => {
    const result = await deliverLandingNotification({
      allowLocalFallback: false,
      payload: { text: "New product updates signup: test@example.com" },
      slackWebhookUrl: null,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("Landing ingest is not configured");
    }
  });

  it("delivers to the configured webhook when present", async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const payload = { text: "New product updates signup: test@example.com" };

    const result = await deliverLandingNotification({
      allowLocalFallback: false,
      logger,
      payload,
      slackWebhookUrl: "https://example.com/hooks/landing",
      transport,
    });

    expect(result.isOk()).toBe(true);
    expect(transport).toHaveBeenCalledWith(
      "https://example.com/hooks/landing",
      {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
