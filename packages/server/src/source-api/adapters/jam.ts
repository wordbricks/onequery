import type { JamCredentials } from "@onequery/db/server";

import { createJamMcpClient } from "../../services/jam-mcp-client";
import type { JamMcpClient } from "../../services/jam-mcp-client";
import type { PreparedSourceConnection, SourceApiAdapter } from "../types";
import { jamSourceApiContract } from "./jam-source-api-contract";

type CreateJamMcpClient = (accessToken: string) => Promise<JamMcpClient>;

export function createJamSourceApiAdapter(
  dependencies: { createClient?: CreateJamMcpClient } = {}
): SourceApiAdapter {
  const createClient = dependencies.createClient ?? createJamMcpClient;

  return {
    provider: "jam",
    async describe({ source }) {
      const credentials = requireJamCredentials(source);
      const result = await withJamMcpClient(
        createClient,
        credentials,
        (client) => client.listTools()
      );
      const operations = result.tools
        .filter(jamSourceApiContract.isReadTool)
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map(jamSourceApiContract.createOperation);

      return {
        descriptorVersion: jamSourceApiContract.descriptorVersion,
        examples: [],
        notes: [
          "Jam operations run through the official Jam MCP endpoint using the saved workspace token.",
          "Only approved read-only tools are exposed. Comment creation, Jam updates, and screenshot binary retrieval are unavailable.",
          "Pass MCP tool arguments as field patches using the input schema shown on each operation.",
        ],
        operations,
        source: {
          displayName: source.displayName,
          provider: source.provider,
          sourceKey: source.sourceKey,
        },
      };
    },
    async normalize({ descriptor, request, source }) {
      return jamSourceApiContract.normalize(descriptor, request, source);
    },
    async execute({ prepared, source }) {
      if (prepared.kind !== "structured_request") {
        throw new Error(
          `Jam operation "${prepared.operation}" requires a structured plan`
        );
      }
      const credentials = requireJamCredentials(source);
      const request = jamSourceApiContract.readPrepared(prepared.request);
      const result = await withJamMcpClient(
        createClient,
        credentials,
        (client) => client.callTool(request)
      );
      if (result.isError) {
        throw new Error(jamSourceApiContract.readToolError(result.content));
      }
      return jamSourceApiContract.buildExecutionResult({
        operation: prepared.operation,
        result,
        source,
      });
    },
  };
}

export const jamSourceApiAdapter = createJamSourceApiAdapter();

function requireJamCredentials(
  source: PreparedSourceConnection
): JamCredentials {
  if (source.provider === "jam" && source.credentials.type === "jam") {
    return source.credentials;
  }
  throw new Error("Jam source credentials are invalid");
}

async function withJamMcpClient<T>(
  createClient: CreateJamMcpClient,
  credentials: JamCredentials,
  execute: (client: JamMcpClient) => Promise<T>
): Promise<T> {
  const client = await createClient(credentials.accessToken);
  try {
    return await execute(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
