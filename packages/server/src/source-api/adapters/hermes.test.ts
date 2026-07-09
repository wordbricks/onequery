import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import { HermesInvalidRequestError, hermesSourceApiAdapter } from "./hermes";

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
    workspaceId: "workspace_123",
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
  it("describes the Hermes run_task operation", async () => {
    const descriptor = await hermesSourceApiAdapter.describe({
      actor,
      source,
    });

    expect(descriptor).toMatchObject({
      descriptorVersion: "hermes.v1",
      operations: [
        {
          name: "run_task",
          kind: "structured_request",
          selectorKind: "none",
        },
      ],
      source: {
        provider: "hermes",
        sourceKey: "hermes-main",
      },
    });
    expect(descriptor.examples[0]?.command).toContain("--op run_task");
  });

  it("normalizes task payloads and applies the default workspace", async () => {
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
            task: "Investigate API errors",
          },
        },
        fieldPatch: {
          priority: "high",
          timeoutMs: 60_000,
        },
        headers: [],
        operation: "run_task",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "structured_request",
      method: "POST",
      operation: "run_task",
      request: {
        priority: "high",
        task: "Investigate API errors",
        timeoutMs: 60_000,
        workspaceId: "workspace_123",
      },
      selectorTemplate: "/api/tasks",
    });
  });

  it("rejects requests without a task payload field", async () => {
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
          fieldPatch: {
            timeoutMs: 60_000,
          },
          headers: [],
          operation: "run_task",
        },
        source,
      })
    ).rejects.toBeInstanceOf(HermesInvalidRequestError);
  });

  it("executes Hermes tasks without forwarding local timeoutMs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ taskId: "task_123", status: "queued" }), {
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_123",
        },
        status: 202,
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await hermesSourceApiAdapter.execute({
      actor,
      prepared: {
        body: { kind: "none" },
        bodyKind: "json",
        bodyPaths: ["task"],
        descriptorVersion: "hermes.v1",
        headerNames: ["Idempotency-Key"],
        headers: [{ name: "Idempotency-Key", value: "idem_123" }],
        kind: "structured_request",
        method: "POST",
        operation: "run_task",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "hermes",
        request: {
          task: "Fix the failing endpoint",
          timeoutMs: 45_000,
        },
        selectorTemplate: "/api/tasks",
        sourceId: "source_1",
        sourceKey: "hermes-main",
      },
      source,
    });

    expect(response.status).toBe(202);
    expect(response.headers).toContainEqual({
      name: "x-request-id",
      value: "req_123",
    });
    expect(response.body).toEqual({
      kind: "json",
      value: {
        status: "queued",
        taskId: "task_123",
      },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toBe("https://hermes.example.com/api/tasks");
    expect(calledInit?.headers).toMatchObject({
      Authorization: "Bearer hermes_secret",
      "Content-Type": "application/json",
      "Idempotency-Key": "idem_123",
    });
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      task: "Fix the failing endpoint",
      workspaceId: "workspace_123",
    });
  });

  it("rejects absolute task endpoints", async () => {
    await expect(
      hermesSourceApiAdapter.execute({
        actor,
        prepared: {
          body: { kind: "none" },
          bodyKind: "json",
          bodyPaths: [],
          descriptorVersion: "hermes.v1",
          headerNames: [],
          headers: [],
          kind: "structured_request",
          method: "POST",
          operation: "run_task",
          paginationPolicy: "none",
          preparedBinding: "binding",
          provider: "hermes",
          request: {
            task: "Do work",
          },
          selectorTemplate: "/api/tasks",
          sourceId: "source_1",
          sourceKey: "hermes-main",
        },
        source: {
          ...source,
          credentials: {
            apiBaseUrl: "https://hermes.example.com",
            apiKey: "hermes_secret",
            taskEndpoint: "https://other.example.com/tasks",
            type: "hermes",
            workspaceId: "workspace_123",
          },
        },
      })
    ).rejects.toBeInstanceOf(HermesInvalidRequestError);
  });
});
