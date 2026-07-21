import { describe, expect, it, vi } from "vitest";

import type { JamMcpClient } from "../jam-mcp-client";
import { testJamConnection } from "./jam-tester";

function createClient(toolNames: string[]): JamMcpClient {
  return {
    callTool: vi.fn(),
    close: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: toolNames.map((name) => ({
        inputSchema: { type: "object" },
        name,
      })),
    })),
  };
}

describe("testJamConnection", () => {
  it("accepts a workspace exposing the required read tools", async () => {
    const client = createClient(["getDetails", "listJams"]);

    const outcome = await testJamConnection(
      { accessToken: "jam_pat_secret", type: "jam" },
      5,
      vi.fn(async () => client)
    );

    expect(outcome.isOk()).toBe(true);
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("rejects a connection missing a core Jam tool", async () => {
    const client = createClient(["getDetails"]);

    const outcome = await testJamConnection(
      { accessToken: "jam_pat_secret", type: "jam" },
      5,
      vi.fn(async () => client)
    );

    expect(outcome.isErr()).toBe(true);
    if (outcome.isErr()) {
      expect(outcome.error.detail).toContain("listJams");
    }
    expect(client.close).toHaveBeenCalledOnce();
  });
});
