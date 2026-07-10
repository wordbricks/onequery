import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceApiUnsupportedOperationError } from "../errors";
import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import { hermesSourceApiAdapter } from "./hermes";

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
    apiBaseUrl: "https://hermes.example.com",
    apiKey: "hermes_secret",
    type: "hermes",
  },
  displayName: "Hermes",
  id: "source_1",
  provider: "hermes",
  sourceKey: "hermes-main",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("hermesSourceApiAdapter", () => {
  it("describes a native Hermes HTTP API operation", async () => {
    const descriptor = await hermesSourceApiAdapter.describe({
      actor,
      source,
    });

    expect(descriptor).toMatchObject({
      defaultPathOperation: "fetch_api",
      descriptorVersion: "hermes.v2",
      operations: [
        {
          kind: "http_request",
          methodPolicy: {
            allowedMethods: ["DELETE", "GET", "PATCH", "POST"],
            defaultMethod: "GET",
          },
          name: "fetch_api",
          selectorKind: "path",
        },
      ],
      source: {
        provider: "hermes",
        sourceKey: "hermes-main",
      },
    });
    expect(descriptor.examples.map((example) => example.command)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/v1/responses --method POST"),
        expect.stringContaining("/v1/runs --method POST"),
        expect.stringContaining("/api/sessions"),
      ])
    );
  });

  it("normalizes native paths, methods, headers, bodies, and query params", async () => {
    const descriptor = await hermesSourceApiAdapter.describe({
      actor,
      source,
    });

    const plan = await hermesSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: {
          kind: "json",
          value: {
            input: "Inspect the checkout",
            model: "hermes-agent",
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
          { name: "X-Hermes-Session-Key", value: "agent:main" },
        ],
        methodOverride: "POST",
        operation: "fetch_api",
        selector: "/v1/responses",
      },
      source,
    });

    expect(plan).toMatchObject({
      body: {
        kind: "json",
        value: {
          input: "Inspect the checkout",
          model: "hermes-agent",
        },
      },
      descriptorVersion: "hermes.v2",
      headers: [
        { name: "Idempotency-Key", value: "idem_123" },
        { name: "X-Hermes-Session-Key", value: "agent:main" },
      ],
      kind: "http_request",
      method: "POST",
      operation: "fetch_api",
      query: {
        trace: "full",
      },
      selector: "/v1/responses",
      timeoutMs: 60_000,
      url: "https://hermes.example.com/v1/responses?trace=full",
    });
  });

  it("executes native Hermes API requests without rewriting their payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ run_id: "run_123", status: "accepted" }), {
        headers: {
          "content-type": "application/json",
          "x-hermes-session-id": "session_123",
        },
        status: 202,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await hermesSourceApiAdapter.execute({
      actor,
      prepared: {
        body: {
          kind: "json",
          value: {
            input: "Fix the failing endpoint",
            session_id: "session_123",
          },
        },
        bodyKind: "json",
        bodyPaths: ["input", "session_id"],
        descriptorVersion: "hermes.v2",
        headerNames: ["Idempotency-Key"],
        headers: [{ name: "Idempotency-Key", value: "idem_123" }],
        kind: "http_request",
        method: "POST",
        operation: "fetch_api",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "hermes",
        selector: "/v1/runs",
        selectorTemplate: "/{path}",
        sourceId: "source_1",
        sourceKey: "hermes-main",
        url: "https://hermes.example.com/v1/runs",
      },
      source,
    });

    expect(response).toMatchObject({
      body: {
        kind: "json",
        value: { run_id: "run_123", status: "accepted" },
      },
      operation: "fetch_api",
      selector: "/v1/runs",
      status: 202,
    });
    expect(response.headers).toContainEqual({
      name: "x-hermes-session-id",
      value: "session_123",
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe("https://hermes.example.com/v1/runs");
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bearer hermes_secret",
      "Idempotency-Key": "idem_123",
    });
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      input: "Fix the failing endpoint",
      session_id: "session_123",
    });
  });

  it("supports native session mutation and deletion methods", async () => {
    const descriptor = await hermesSourceApiAdapter.describe({
      actor,
      source,
    });

    const patchPlan = await hermesSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "json", value: { title: "Production incident" } },
        headers: [],
        methodOverride: "PATCH",
        operation: "fetch_api",
        selector: "/api/sessions/session_123",
      },
      source,
    });
    const deletePlan = await hermesSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        headers: [],
        methodOverride: "DELETE",
        operation: "fetch_api",
        selector: "/api/sessions/session_123",
      },
      source,
    });

    expect(patchPlan).toMatchObject({
      method: "PATCH",
      url: "https://hermes.example.com/api/sessions/session_123",
    });
    expect(deletePlan).toMatchObject({
      method: "DELETE",
      url: "https://hermes.example.com/api/sessions/session_123",
    });
  });

  it("no longer accepts the custom run_task operation", async () => {
    const descriptor = await hermesSourceApiAdapter.describe({
      actor,
      source,
    });

    await expect(
      hermesSourceApiAdapter.normalize({
        actor,
        descriptor,
        request: {
          body: { kind: "json", value: { input: "Do work" } },
          headers: [],
          operation: "run_task",
          selector: "/v1/runs",
        },
        source,
      })
    ).rejects.toBeInstanceOf(SourceApiUnsupportedOperationError);
  });

  it("rejects absolute URLs so requests stay on the configured Hermes origin", async () => {
    const descriptor = await hermesSourceApiAdapter.describe({
      actor,
      source,
    });

    await expect(
      hermesSourceApiAdapter.normalize({
        actor,
        descriptor,
        request: {
          body: { kind: "none" },
          headers: [],
          operation: "fetch_api",
          selector: "https://other.example.com/v1/models",
        },
        source,
      })
    ).rejects.toThrow("relative paths");
  });
});
