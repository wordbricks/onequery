import { afterEach, describe, expect, it, vi } from "vitest";

import type { SourceApiActorContext, PreparedSourceConnection } from "../types";
import { airtableSourceApiAdapter } from "./airtable";
import { calSourceApiAdapter } from "./cal";
import { discordSourceApiAdapter } from "./discord";
import { granolaSourceApiAdapter } from "./granola";

const originalFetch = globalThis.fetch;

const actor: SourceApiActorContext = {
  capabilities: ["source_api.execute"],
  membershipRoles: ["owner"],
  organizationId: "org_1",
  organizationSlug: "acme",
  userId: "user_1",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("simple REST source API providers", () => {
  it("normalizes Airtable selectors against the configured base", async () => {
    const source: PreparedSourceConnection = {
      credentials: {
        baseId: "app123",
        personalAccessToken: "pat123",
        type: "airtable",
      },
      displayName: "Airtable Ops",
      id: "source_1",
      provider: "airtable",
      sourceKey: "airtable-ops",
    };
    const descriptor = await airtableSourceApiAdapter.describe({
      actor,
      source,
    });

    const plan = await airtableSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: {
          params: {
            pageSize: 100,
          },
        },
        headers: [],
        operation: "fetch_api",
        selector: "/Deals",
      },
      source,
    });

    expect(plan.kind).toBe("http_request");
    if (plan.kind !== "http_request") {
      throw new Error("expected HTTP request plan");
    }
    expect(plan.url).toBe(
      "https://api.airtable.com/v0/app123/Deals?pageSize=100"
    );
    expect(plan.paginationPolicy).toBe("continuation_token");
  });

  it("executes Discord requests with bot authorization and guild channel expansion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "channel_1", name: "general" }]), {
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "42",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source: PreparedSourceConnection = {
      credentials: {
        authScheme: "bot",
        guildId: "123456789012345678",
        token: "discord_token",
        type: "discord",
      },
      displayName: "Discord",
      id: "source_2",
      provider: "discord",
      sourceKey: "discord-main",
    };

    const response = await discordSourceApiAdapter.execute({
      actor,
      prepared: {
        body: { kind: "none" },
        bodyKind: "none",
        bodyPaths: [],
        descriptorVersion: "discord.v1",
        headerNames: [],
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch_api",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "discord",
        selector: "/channels",
        selectorTemplate: "/{path}",
        sourceId: "source_2",
        sourceKey: "discord-main",
        url: "https://discord.com/api/v10/guilds/123456789012345678/channels",
      },
      source,
    });

    expect(response.status).toBe(200);
    expect(response.headers).toContainEqual({
      name: "x-ratelimit-remaining",
      value: "42",
    });
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://discord.com/api/v10/guilds/123456789012345678/channels"
    );
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bot discord_token",
    });
  });

  it("executes Cal requests with the configured API version and cursor continuation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: [],
          pagination: {
            hasMore: true,
            nextCursor: "cursor_2",
          },
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

    const source: PreparedSourceConnection = {
      credentials: {
        apiKey: "cal_123",
        apiVersion: "2026-05-01",
        type: "cal",
      },
      displayName: "Cal",
      id: "source_3",
      provider: "cal",
      sourceKey: "cal-main",
    };

    const response = await calSourceApiAdapter.execute({
      actor,
      prepared: {
        body: { kind: "none" },
        bodyKind: "none",
        bodyPaths: [],
        descriptorVersion: "cal.v1",
        headerNames: [],
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch_api",
        paginationPolicy: "continuation_token",
        preparedBinding: "binding",
        provider: "cal",
        query: {
          status: "upcoming",
        },
        selector: "/bookings",
        selectorTemplate: "/{path}",
        sourceId: "source_3",
        sourceKey: "cal-main",
        url: "https://api.cal.com/v2/bookings?status=upcoming",
      },
      source,
    });

    expect(response.nextContinuationState).toEqual({
      params: {
        cursor: "cursor_2",
      },
    });
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://api.cal.com/v2/bookings?status=upcoming"
    );
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bearer cal_123",
      "cal-api-version": "2026-05-01",
    });
  });

  it("resumes Granola requests with continuation cursor params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ notes: [], hasMore: false }), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const source: PreparedSourceConnection = {
      credentials: {
        apiKey: "grn_123",
        type: "granola",
      },
      displayName: "Granola",
      id: "source_4",
      provider: "granola",
      sourceKey: "granola-main",
    };

    await granolaSourceApiAdapter.execute({
      actor,
      continuation: {
        params: {
          cursor: "cursor_2",
        },
      },
      prepared: {
        body: { kind: "none" },
        bodyKind: "none",
        bodyPaths: [],
        descriptorVersion: "granola.v1",
        headerNames: [],
        headers: [],
        kind: "http_request",
        method: "GET",
        operation: "fetch_api",
        paginationPolicy: "continuation_token",
        preparedBinding: "binding",
        provider: "granola",
        query: {
          created_after: "2026-05-01T00:00:00Z",
        },
        selector: "/notes",
        selectorTemplate: "/{path}",
        sourceId: "source_4",
        sourceKey: "granola-main",
        url: "https://public-api.granola.ai/v1/notes?created_after=2026-05-01T00%3A00%3A00Z",
      },
      source,
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://public-api.granola.ai/v1/notes?created_after=2026-05-01T00%3A00%3A00Z&cursor=cursor_2"
    );
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bearer grn_123",
    });
  });
});
