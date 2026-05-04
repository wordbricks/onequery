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
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    installFetchMock(fetchSpy);
    const payload = {
      text: "New product updates signup: test@example.com",
      blocks: [],
    };

    const result = await deliverLandingNotification({
      delivery: {
        kind: "local-dev-null-sink",
      },
      notificationType: "product_updates",
      payload,
    });

    expect(result.isOk()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays unavailable outside local loopback when the webhook is missing", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    installFetchMock(fetchSpy);

    const result = await deliverLandingNotification({
      delivery: {
        kind: "unconfigured",
      },
      notificationType: "product_updates",
      payload: {
        text: "New product updates signup: test@example.com",
        blocks: [],
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("Landing ingest is not configured");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("delivers to the configured webhook when present", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    installFetchMock(fetchSpy);
    const payload = {
      text: "New product updates signup: test@example.com",
      blocks: [],
    };

    const result = await deliverLandingNotification({
      delivery: {
        kind: "slack-webhook",
        webhookUrl: "https://example.com/hooks/landing",
      },
      notificationType: "product_updates",
      payload,
    });

    expect(result.isOk()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/hooks/landing", {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("returns request failures as request errors", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockRejectedValue(new Error("boom"));
    installFetchMock(fetchSpy);

    const result = await deliverLandingNotification({
      delivery: {
        kind: "slack-webhook",
        webhookUrl: "https://example.com/hooks/landing",
      },
      notificationType: "product_updates",
      payload: {
        text: "New product updates signup: test@example.com",
        blocks: [],
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe(
        "Failed to send landing notification: boom"
      );
    }
  });

  it("returns webhook rejections as response errors", async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>();
    fetchSpy.mockResolvedValue(
      new Response("invalid payload", { status: 400 })
    );
    installFetchMock(fetchSpy);

    const result = await deliverLandingNotification({
      delivery: {
        kind: "slack-webhook",
        webhookUrl: "https://example.com/hooks/landing",
      },
      notificationType: "contact",
      payload: {
        text: "New contact request from Jane Doe (team@example.com)",
        blocks: [],
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("Failed to deliver notification");
    }
  });
});
