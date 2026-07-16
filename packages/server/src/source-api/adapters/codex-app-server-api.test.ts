import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import { codexAppServerApiSourceApiAdapter } from "./codex-app-server-api";

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
    apiBaseUrl: "https://codex-app-server-api.example.com",
    apiKey: "sk-codex-secret",
    type: "codex_app_server_api",
  },
  displayName: "Codex App Server API",
  id: "source_1",
  provider: "codex_app_server_api",
  sourceKey: "codex-main",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("codexAppServerApiSourceApiAdapter", () => {
  it("describes native Codex App Server API operations", async () => {
    const descriptor = await codexAppServerApiSourceApiAdapter.describe({
      actor,
      source,
    });

    expect(descriptor).toMatchObject({
      defaultPathOperation: "fetch_api",
      descriptorVersion: "codex-app-server-api.v1",
      operations: [
        {
          kind: "http_request",
          methodPolicy: {
            allowedMethods: ["GET", "POST"],
            defaultMethod: "GET",
          },
          name: "fetch_api",
          selectorKind: "path",
        },
      ],
      source: {
        provider: "codex_app_server_api",
        sourceKey: "codex-main",
      },
    });
    expect(descriptor.examples.map((example) => example.command)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/v1/responses --method POST"),
        expect.stringContaining("/v1/chat/completions --method POST"),
      ])
    );
  });

  it("normalizes workspace headers, bodies, and query params", async () => {
    const descriptor = await codexAppServerApiSourceApiAdapter.describe({
      actor,
      source,
    });

    const plan = await codexAppServerApiSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: {
          kind: "json",
          value: {
            input: "Summarize the repository",
            model: "gpt-5.4",
          },
        },
        fieldPatch: {
          params: {
            trace: "full",
          },
          timeoutMs: 60_000,
        },
        headers: [
          { name: "Idempotency-Key", value: "idem_123" },
          { name: "X-Workspace-Path", value: "/Users/dev/git/velen" },
        ],
        methodOverride: "POST",
        operation: "fetch_api",
        selector: "/v1/responses",
      },
      source,
    });

    expect(plan).toMatchObject({
      descriptorVersion: "codex-app-server-api.v1",
      headers: [
        { name: "Idempotency-Key", value: "idem_123" },
        { name: "X-Workspace-Path", value: "/Users/dev/git/velen" },
      ],
      kind: "http_request",
      method: "POST",
      operation: "fetch_api",
      query: {
        trace: "full",
      },
      selector: "/v1/responses",
      timeoutMs: 60_000,
      url: "https://codex-app-server-api.example.com/v1/responses?trace=full",
    });
  });

  it("executes native Codex requests without rewriting their payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "resp_123", output_text: "OK" }), {
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_123",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await codexAppServerApiSourceApiAdapter.execute({
      actor,
      prepared: {
        body: {
          kind: "json",
          value: {
            input: "Say OK",
            model: "gpt-5.4",
          },
        },
        bodyKind: "json",
        bodyPaths: ["input", "model"],
        descriptorVersion: "codex-app-server-api.v1",
        headerNames: ["X-Workspace-Path"],
        headers: [{ name: "X-Workspace-Path", value: "/Users/dev/git/velen" }],
        kind: "http_request",
        method: "POST",
        operation: "fetch_api",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "codex_app_server_api",
        selector: "/v1/responses",
        selectorTemplate: "/{path}",
        sourceId: "source_1",
        sourceKey: "codex-main",
        url: "https://codex-app-server-api.example.com/v1/responses",
      },
      source,
    });

    expect(response).toMatchObject({
      body: {
        kind: "json",
        value: { id: "resp_123", output_text: "OK" },
      },
      operation: "fetch_api",
      selector: "/v1/responses",
      status: 200,
    });
    expect(response.headers).toContainEqual({
      name: "x-request-id",
      value: "req_123",
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe(
      "https://codex-app-server-api.example.com/v1/responses"
    );
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bearer sk-codex-secret",
      "X-Workspace-Path": "/Users/dev/git/velen",
    });
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      input: "Say OK",
      model: "gpt-5.4",
    });
  });
});
