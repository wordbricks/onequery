import { describe, expect, it, vi } from "vitest";

import type { JamMcpClient } from "../../services/jam-mcp-client";
import { finalizePreparedSourceApi } from "../normalize";
import { createJamSourceApiAdapter } from "./jam";

const actor = {
  capabilities: ["source_api.describe", "source_api.execute"],
  membershipRoles: ["owner"],
  organizationId: "org-1",
  organizationSlug: "acme",
  userId: "user-1",
} as const;

const source = {
  credentials: { accessToken: "jam_pat_secret", type: "jam" },
  displayName: "Jam workspace",
  id: "source-1",
  provider: "jam",
  sourceKey: "jam_workspace",
} as const;

function createClient(): JamMcpClient {
  return {
    callTool: vi.fn(async ({ arguments: args, name }) => ({
      content: [{ text: JSON.stringify(args), type: "text" }],
      isError: false,
      structuredContent: { name },
    })),
    close: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: [
        {
          description: "List Jams visible to the workspace.",
          inputSchema: {
            properties: { limit: { type: "number" } },
            type: "object",
          },
          name: "listJams",
        },
        {
          description: "Read console logs.",
          inputSchema: {
            properties: { jamUrl: { type: "string" } },
            required: ["jamUrl"],
            type: "object",
          },
          name: "getConsoleLogs",
        },
        {
          description: "Return screenshot bytes.",
          inputSchema: { type: "object" },
          name: "getScreenshot",
        },
        {
          description: "Add a comment.",
          inputSchema: { type: "object" },
          name: "createComment",
        },
      ],
    })),
  };
}

describe("Jam Source API adapter", () => {
  it("describes only approved read-only Jam tools", async () => {
    const client = createClient();
    const adapter = createJamSourceApiAdapter({
      createClient: vi.fn(async () => client),
    });

    const descriptor = await adapter.describe({ actor, source });

    expect(descriptor.operations.map((operation) => operation.name)).toEqual([
      "getConsoleLogs",
      "listJams",
    ]);
    expect(descriptor.operations[0]?.notes.join("\n")).toContain("jamUrl");
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("forwards field patches as MCP tool arguments", async () => {
    const client = createClient();
    const adapter = createJamSourceApiAdapter({
      createClient: vi.fn(async () => client),
    });
    const descriptor = await adapter.describe({ actor, source });
    const prepared = await adapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: { jamUrl: "https://jam.dev/c/abc", limit: 25 },
        headers: [],
        operation: "getConsoleLogs",
      },
      source,
    });

    expect(prepared).toMatchObject({
      kind: "structured_request",
      method: "POST",
      operation: "getConsoleLogs",
      request: {
        arguments: { jamUrl: "https://jam.dev/c/abc", limit: 25 },
        toolName: "getConsoleLogs",
      },
    });
  });

  it("executes the prepared MCP tool call and closes the client", async () => {
    const client = createClient();
    const adapter = createJamSourceApiAdapter({
      createClient: vi.fn(async () => client),
    });
    const descriptor = await adapter.describe({ actor, source });
    const prepared = await adapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: { query: "checkout" },
        headers: [],
        operation: "listJams",
      },
      source,
    });

    const result = await adapter.execute({
      actor,
      prepared: finalizePreparedSourceApi(prepared),
      source,
    });

    expect(client.callTool).toHaveBeenCalledWith({
      arguments: { query: "checkout" },
      name: "listJams",
    });
    expect(result.body).toMatchObject({
      kind: "json",
      value: { structuredContent: { name: "listJams" } },
    });
    expect(client.close).toHaveBeenCalledTimes(2);
  });
});
