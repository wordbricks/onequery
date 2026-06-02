import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { handleContactRequest, handleProductUpdatesRequest } from "./api";
import type {
  ServiceUnavailableErrorResponse,
  ValidationErrorResponse,
} from "./api";
import {
  createContactNotification,
  createProductUpdatesNotification,
} from "./notifications";
import {
  createSlackEmulatorHarness,
  SLACK_EMULATOR_BOT_ID,
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

describe("landing API handlers", () => {
  it("assigns a request id to successful API responses", async () => {
    const response = await handleProductUpdatesRequest({
      request: new Request("https://landing.onequery.dev/api/product-updates", {
        body: JSON.stringify({ email: "team@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      slackWebhookUrl: slack.webhookUrl,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toEqual(expect.any(String));
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(await slack.readMessages()).toHaveLength(1);
  });

  it("accepts product updates submissions with trimmed email input", async () => {
    const response = await handleProductUpdatesRequest({
      request: new Request("https://landing.onequery.dev/api/product-updates", {
        body: JSON.stringify({ email: " TEST@Example.COM " }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      slackWebhookUrl: slack.webhookUrl,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: "test@example.com",
    });
    const [message] = await slack.readMessages();
    expect(message).toMatchObject({
      bot_id: SLACK_EMULATOR_BOT_ID,
      blocks: createProductUpdatesNotification("test@example.com").blocks,
      text: "New product updates signup: test@example.com",
    });
  });

  it("accepts product updates form submissions for the HTML fallback", async () => {
    const response = await handleProductUpdatesRequest({
      request: new Request("https://landing.onequery.dev/api/product-updates", {
        body: new URLSearchParams({
          email: " FORM@Example.COM ",
        }),
        method: "POST",
      }),
      slackWebhookUrl: slack.webhookUrl,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: "form@example.com",
    });
    const [message] = await slack.readMessages();
    expect(message).toMatchObject({
      blocks: createProductUpdatesNotification("form@example.com").blocks,
      text: "New product updates signup: form@example.com",
    });
  });

  it("normalizes contact submissions before delivery", async () => {
    const response = await handleContactRequest({
      request: new Request("https://landing.onequery.dev/api/contact", {
        body: JSON.stringify({
          email: " TEAM@Example.COM ",
          message: " Need pricing details ",
          name: " Jane Doe ",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      slackWebhookUrl: slack.webhookUrl,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    const [message] = await slack.readMessages();
    expect(message).toMatchObject({
      blocks: createContactNotification({
        email: "team@example.com",
        message: "Need pricing details",
        name: "Jane Doe",
      }).blocks,
      text: "New contact request from Jane Doe (team@example.com)",
    });
  });

  it("rejects contact submissions that become empty after trimming", async () => {
    const response = await handleContactRequest({
      request: new Request("https://landing.onequery.dev/api/contact", {
        body: JSON.stringify({
          email: "team@example.com",
          message: "   ",
          name: "   ",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    });

    expect(response.status).toBe(400);
    const body: ValidationErrorResponse = await response.json();
    expect(body).toEqual({
      code: "validation_error",
      fieldErrors: {
        message: ["message is required"],
        name: ["name is required"],
      },
      message: "name is required",
    });
    expect(await slack.readMessages()).toHaveLength(0);
  });

  it("returns a typed 503 error response when delivery is unconfigured", async () => {
    const response = await handleProductUpdatesRequest({
      request: new Request("https://landing.onequery.dev/api/product-updates", {
        body: JSON.stringify({ email: "team@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    });

    expect(response.status).toBe(503);
    const body: ServiceUnavailableErrorResponse = await response.json();
    expect(body).toEqual({
      code: "service_unavailable",
      message: "Landing ingest is not configured",
    });
    expect(await slack.readMessages()).toHaveLength(0);
  });
});
