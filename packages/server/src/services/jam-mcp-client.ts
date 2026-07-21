import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const JAM_MCP_ENDPOINT = "https://mcp.jam.dev/mcp";

export type JamMcpTool = {
  description?: string;
  inputSchema: Record<string, unknown>;
  name: string;
  title?: string;
};

export type JamMcpToolCallResult = {
  content: unknown[];
  isError?: boolean;
  structuredContent?: unknown;
};

export type JamMcpClient = {
  callTool(input: {
    arguments?: Record<string, unknown>;
    name: string;
  }): Promise<JamMcpToolCallResult>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: JamMcpTool[] }>;
};

export async function createJamMcpClient(
  accessToken: string,
  timeoutMs = 30_000
): Promise<JamMcpClient> {
  const transport = new StreamableHTTPClientTransport(
    new URL(JAM_MCP_ENDPOINT),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
    }
  );
  const client = new Client({
    name: "onequery-jam-provider",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw sanitizeJamMcpError(error, accessToken);
  }

  return {
    async callTool(input) {
      try {
        const result = await client.callTool(input);
        if (!("content" in result) || !Array.isArray(result.content)) {
          throw new Error("Jam MCP returned an unsupported task result");
        }
        return {
          content: result.content,
          ...(typeof result.isError === "boolean"
            ? { isError: result.isError }
            : {}),
          ...(result.structuredContent &&
          typeof result.structuredContent === "object" &&
          !Array.isArray(result.structuredContent)
            ? { structuredContent: result.structuredContent }
            : {}),
        };
      } catch (error) {
        throw sanitizeJamMcpError(error, accessToken);
      }
    },
    close: () => client.close(),
    async listTools() {
      try {
        const result = await client.listTools();
        return {
          tools: result.tools.map((tool) => ({
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema,
            name: tool.name,
            ...(tool.title ? { title: tool.title } : {}),
          })),
        };
      } catch (error) {
        throw sanitizeJamMcpError(error, accessToken);
      }
    },
  };
}

function sanitizeJamMcpError(error: unknown, accessToken: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.split(accessToken).join("***"));
}
