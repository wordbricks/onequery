import type { JamCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import {
  createFailedConnectionTest,
  createSuccessfulConnectionTest,
} from "../data-source-query/core/connection-test";
import type { ConnectionTestOutcome } from "../data-source-query/core/connection-test";
import { createJamMcpClient } from "../jam-mcp-client";
import type { JamMcpClient } from "../jam-mcp-client";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

type CreateJamMcpClient = (
  accessToken: string,
  timeoutMs?: number
) => Promise<JamMcpClient>;

const REQUIRED_JAM_TOOLS = ["getDetails", "listJams"] as const;

export async function testJamConnection(
  credentials: JamCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS,
  createClient: CreateJamMcpClient = createJamMcpClient
): Promise<ConnectionTestOutcome> {
  const startedAt = Date.now();
  let client: JamMcpClient | undefined;

  try {
    client = await createClient(
      credentials.accessToken,
      Math.max(1, timeoutSeconds) * 1000
    );
    const { tools } = await client.listTools();
    const toolNames = new Set(tools.map((tool) => tool.name));
    const missingTools = REQUIRED_JAM_TOOLS.filter(
      (toolName) => !toolNames.has(toolName)
    );
    if (missingTools.length > 0) {
      return Result.err(
        createFailedConnectionTest({
          detail: `Jam MCP did not expose required tools: ${missingTools.join(", ")}`,
          latencyMs: Date.now() - startedAt,
        })
      );
    }

    return Result.ok(createSuccessfulConnectionTest(Date.now() - startedAt));
  } catch (error) {
    return Result.err(
      createFailedConnectionTest({
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      })
    );
  } finally {
    await client?.close().catch(() => undefined);
  }
}
