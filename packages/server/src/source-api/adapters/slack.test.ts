import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import { slackSourceApiAdapter } from "./slack";

const originalFetch = globalThis.fetch;

const actor: SourceApiActorContext = {
  capabilities: ["source_api.execute"],
  membershipRoles: ["owner"],
  organizationId: "org_1",
  organizationSlug: "acme",
  userId: "user_1",
};

const source: PreparedSourceConnection = {
  credentials: {
    botScopes: ["channels:read", "channels:history", "chat:write"],
    botToken: "xoxb-token",
    botUserId: "U123",
    teamId: "T123",
    teamName: "Acme",
    type: "slack",
  },
  displayName: "Slack Workspace",
  id: "source_1",
  provider: "slack",
  sourceKey: "slack-workspace",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("slack source API adapter", () => {
  it("describes Slack structured operations", async () => {
    const descriptor = await slackSourceApiAdapter.describe({
      actor,
      source,
    });

    expect(descriptor.source.provider).toBe("slack");
    expect(descriptor.operations.map((operation) => operation.name)).toEqual([
      "list_channels",
      "fetch_channel_history",
      "fetch_thread_replies",
      "send_message",
    ]);
    expect(
      descriptor.operations.find(
        (operation) => operation.name === "send_message"
      )
    ).toMatchObject({
      fieldPolicy: {
        supportsArrayPaths: true,
        supportsNestedPaths: true,
      },
      selectorKind: "path",
      selectorLabel: "CHANNEL",
    });
    expect(
      descriptor.examples.find((example) => example.label === "Send message")
        ?.command
    ).toBe(
      `onequery api --source ${source.sourceKey} --op send_message "#general" --input '{"text":"Deployment finished."}'`
    );
  });

  it("keeps message sending disabled when the Slack connection lacks chat:write", async () => {
    const descriptor = await slackSourceApiAdapter.describe({
      actor,
      source: {
        ...source,
        credentials: {
          botScopes: ["channels:read", "channels:history"],
          botToken: "xoxb-token",
          botUserId: "U123",
          teamId: "T123",
          teamName: "Acme",
          type: "slack",
        },
      },
    });

    expect(descriptor.operations.map((operation) => operation.name)).toEqual([
      "list_channels",
      "fetch_channel_history",
      "fetch_thread_replies",
    ]);
    expect(descriptor.notes).toContain(
      "This Slack connection cannot send messages because it does not have the chat:write bot scope."
    );
  });

  it("normalizes channel history requests into a structured plan", async () => {
    const descriptor = await slackSourceApiAdapter.describe({
      actor,
      source,
    });

    const plan = await slackSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: {
          limit: 50,
        },
        headers: [],
        operation: "fetch_channel_history",
        selector: "#general",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "structured_request",
      method: "POST",
      operation: "fetch_channel_history",
      provider: "slack",
      request: {
        limit: 50,
      },
      selector: "#general",
      selectorTemplate: "channels/{channel}",
    });
  });

  it("executes Slack channel history with bot authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          messages: [{ text: "hello", ts: "1730000000.000000" }],
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await slackSourceApiAdapter.execute({
      actor,
      prepared: {
        body: { kind: "none" },
        bodyKind: "none",
        bodyPaths: ["limit"],
        descriptorVersion: "slack.v2",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        method: "POST",
        operation: "fetch_channel_history",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "slack",
        request: {
          limit: 25,
        },
        selector: "C1234567890",
        selectorTemplate: "channels/{channel}",
        sourceId: "source_1",
        sourceKey: "slack-workspace",
      },
      source,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      kind: "json",
      value: {
        messages: [{ text: "hello", ts: "1730000000.000000" }],
        ok: true,
      },
    });
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://slack.com/api/conversations.history"
    );
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bearer xoxb-token",
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    });
    expect(String(calledInit?.body)).toBe("channel=C1234567890&limit=25");
  });

  it("normalizes message input into a structured send plan", async () => {
    const descriptor = await slackSourceApiAdapter.describe({
      actor,
      source,
    });
    const blocks = [
      {
        text: { text: "*Deployment finished.*", type: "mrkdwn" },
        type: "section",
      },
    ];

    const plan = await slackSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: {
          kind: "json",
          value: {
            blocks,
            text: "Deployment finished.",
            thread_ts: "1730000000.000000",
          },
        },
        fieldPatch: {},
        headers: [],
        operation: "send_message",
        selector: "#general",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "structured_request",
      method: "POST",
      operation: "send_message",
      provider: "slack",
      request: {
        blocks,
        text: "Deployment finished.",
        thread_ts: "1730000000.000000",
      },
      selector: "#general",
      selectorTemplate: "channels/{channel}",
    });
  });

  it("rejects message sends without fallback text", async () => {
    const descriptor = await slackSourceApiAdapter.describe({
      actor,
      source,
    });

    await expect(
      slackSourceApiAdapter.normalize({
        actor,
        descriptor,
        request: {
          body: { kind: "json", value: { blocks: [] } },
          fieldPatch: {},
          headers: [],
          operation: "send_message",
          selector: "#general",
        },
        source,
      })
    ).rejects.toThrow("Invalid Slack send_message request");
  });

  it("sends a Slack message with bot authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          channel: "C1234567890",
          message: { text: "Deployment finished." },
          ok: true,
          ts: "1730000001.000000",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const blocks = [
      {
        text: { text: "*Deployment finished.*", type: "mrkdwn" },
        type: "section",
      },
    ];

    const response = await slackSourceApiAdapter.execute({
      actor,
      prepared: {
        body: { kind: "json", value: { blocks, text: "Deployment finished." } },
        bodyKind: "json",
        bodyPaths: [
          "blocks",
          "blocks[0].text.text",
          "blocks[0].text.type",
          "blocks[0].type",
          "text",
        ],
        descriptorVersion: "slack.v2",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        method: "POST",
        operation: "send_message",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "slack",
        request: {
          blocks,
          text: "Deployment finished.",
          thread_ts: "1730000000.000000",
        },
        selector: "C1234567890",
        selectorTemplate: "channels/{channel}",
        sourceId: "source_1",
        sourceKey: "slack-workspace",
      },
      source,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      kind: "json",
      value: {
        channel: "C1234567890",
        ok: true,
        ts: "1730000001.000000",
      },
    });
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe("https://slack.com/api/chat.postMessage");
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bearer xoxb-token",
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    });
    expect(
      Object.fromEntries(new URLSearchParams(String(calledInit?.body)))
    ).toEqual({
      blocks: JSON.stringify(blocks),
      channel: "C1234567890",
      text: "Deployment finished.",
      thread_ts: "1730000000.000000",
    });
  });

  it("rejects thread replies without a thread timestamp", async () => {
    const descriptor = await slackSourceApiAdapter.describe({
      actor,
      source,
    });

    await expect(
      slackSourceApiAdapter.normalize({
        actor,
        descriptor,
        request: {
          body: { kind: "none" },
          fieldPatch: {},
          headers: [],
          operation: "fetch_thread_replies",
          selector: "#general",
        },
        source,
      })
    ).resolves.toMatchObject({
      operation: "fetch_thread_replies",
    });

    await expect(
      slackSourceApiAdapter.execute({
        actor,
        prepared: {
          body: { kind: "none" },
          bodyKind: "none",
          bodyPaths: [],
          descriptorVersion: "slack.v2",
          headerNames: [],
          headers: [],
          kind: "structured_request",
          method: "POST",
          operation: "fetch_thread_replies",
          paginationPolicy: "none",
          preparedBinding: "binding",
          provider: "slack",
          request: {},
          selector: "C1234567890",
          selectorTemplate: "channels/{channel}",
          sourceId: "source_1",
          sourceKey: "slack-workspace",
        },
        source,
      })
    ).rejects.toThrow('Slack thread replies require request field "ts"');
  });
});
