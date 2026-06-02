import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createProductUpdatesNotification,
  deliverSlackNotification,
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

describe("deliverSlackNotification", () => {
  it("delivers to the configured webhook when present", async () => {
    const payload = createProductUpdatesNotification("test@example.com");

    await deliverSlackNotification({
      notificationType: "product_updates",
      payload,
      webhookUrl: slack.webhookUrl,
    });

    const [message] = await slack.readMessages();
    expect(message).toMatchObject({
      blocks: payload.blocks,
      text: payload.text,
    });
  });

  it("returns request failures as request errors", async () => {
    const port = await findAvailablePort();

    await expect(
      deliverSlackNotification({
        notificationType: "product_updates",
        payload: {
          blocks: [],
          text: "New product updates signup: test@example.com",
        },
        webhookUrl: `http://127.0.0.1:${port}/hooks/landing`,
      })
    ).rejects.toThrow(/^Failed to send landing notification:/);
  });

  it("returns webhook rejections as response errors", async () => {
    await expect(
      deliverSlackNotification({
        notificationType: "contact",
        payload: {
          blocks: [],
          text: "",
        },
        webhookUrl: slack.webhookUrl,
      })
    ).rejects.toThrow("Failed to deliver notification");
  });
});
