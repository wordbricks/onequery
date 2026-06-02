import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createProductUpdatesNotification,
  deliverNotification,
} from "./notifications";
import {
  createSlackEmulatorHarness,
  findAvailablePort,
} from "./test/slack-emulator";
import type { SlackEmulatorHarness } from "./test/slack-emulator";

let slack: SlackEmulatorHarness;

beforeAll(async () => {
  slack = await createSlackEmulatorHarness();
});

afterEach(() => {
  slack.reset();
});

afterAll(async () => {
  await slack.close();
});

describe("deliverNotification", () => {
  it("accepts local loopback requests without a configured webhook", async () => {
    const payload = {
      text: "New product updates signup: test@example.com",
      blocks: [],
    };

    const result = await deliverNotification({
      delivery: {
        kind: "local-dev-null-sink",
      },
      notificationType: "product_updates",
      payload,
    });

    expect(result.isOk()).toBe(true);
    expect(await slack.readMessages()).toHaveLength(0);
  });

  it("stays unavailable outside local loopback when the webhook is missing", async () => {
    const result = await deliverNotification({
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
    expect(await slack.readMessages()).toHaveLength(0);
  });

  it("delivers to the configured webhook when present", async () => {
    const payload = createProductUpdatesNotification("test@example.com");

    const result = await deliverNotification({
      delivery: {
        kind: "slack-webhook",
        webhookUrl: slack.webhookUrl,
      },
      notificationType: "product_updates",
      payload,
    });

    expect(result.isOk()).toBe(true);
    const [message] = await slack.readMessages();
    expect(message).toMatchObject({
      blocks: payload.blocks,
      text: payload.text,
    });
  });

  it("returns request failures as request errors", async () => {
    const port = await findAvailablePort();

    const result = await deliverNotification({
      delivery: {
        kind: "slack-webhook",
        webhookUrl: `http://127.0.0.1:${port}/hooks/landing`,
      },
      notificationType: "product_updates",
      payload: {
        text: "New product updates signup: test@example.com",
        blocks: [],
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toMatch(
        /^Failed to send landing notification:/
      );
    }
  });

  it("returns webhook rejections as response errors", async () => {
    const result = await deliverNotification({
      delivery: {
        kind: "slack-webhook",
        webhookUrl: slack.webhookUrl,
      },
      notificationType: "contact",
      payload: {
        text: "",
        blocks: [],
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("Failed to deliver notification");
    }
  });
});
