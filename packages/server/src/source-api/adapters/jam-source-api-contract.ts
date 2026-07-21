import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { z } from "zod";

import type { JamMcpClient, JamMcpTool } from "../../services/jam-mcp-client";
import {
  SourceApiInvalidRequestError,
  SourceApiUnsupportedOperationError,
} from "../errors";
import type {
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExecutionResult,
  SourceApiOperation,
} from "../types";

const JAM_READ_TOOL_NAMES = [
  "analyzeVideo",
  "getConsoleLogs",
  "getDetails",
  "getMetadata",
  "getNetworkRequests",
  "getUserEvents",
  "getVideoTranscript",
  "listFolders",
  "listJams",
  "listMembers",
] as const;
const jamReadToolNames = new Set<string>(JAM_READ_TOOL_NAMES);
const jsonValueSchema = z.json();

class JamInvalidRequestError extends SourceApiInvalidRequestError {}

function createOperation(tool: JamMcpTool): SourceApiOperation {
  return {
    description: tool.description ?? `Call Jam MCP tool ${tool.name}.`,
    examples: [],
    fieldPolicy: {
      acceptsInput: true,
      allowsRawFields: true,
      allowsTypedFields: true,
      inputMode: "request_object",
      mergePatches: true,
      supportsArrayPaths: true,
      supportsNestedPaths: true,
    },
    headerPolicy: {
      allowedRequestHeaders: [],
      allowedResponseHeaders: ["content-type"],
    },
    kind: "structured_request",
    methodPolicy: { allowedMethods: ["POST"], defaultMethod: "POST" },
    name: tool.name,
    notes: [`Input schema: ${JSON.stringify(tool.inputSchema)}`],
    paginationPolicy: "none",
    selectorKind: "none",
    summary: tool.title ?? tool.description ?? `Call ${tool.name}.`,
  };
}

function normalize(
  descriptor: SourceApiDescriptor,
  request: Parameters<SourceApiAdapter["normalize"]>[0]["request"],
  source: PreparedSourceConnection
) {
  const operation = descriptor.operations.find(
    (candidate) => candidate.name === request.operation.trim()
  );
  if (!operation || !jamReadToolNames.has(operation.name)) {
    throw new SourceApiUnsupportedOperationError(request.operation);
  }
  if (request.selector?.trim() || request.methodOverride?.trim()) {
    throw new JamInvalidRequestError(
      "Jam MCP operations do not accept selectors or method overrides"
    );
  }
  if (request.headers.length > 0 || request.body.kind !== "none") {
    throw new JamInvalidRequestError(
      "Jam MCP operations accept field patches only"
    );
  }

  return {
    body: { kind: "none" } as const,
    descriptorVersion: descriptor.descriptorVersion,
    headers: [],
    kind: "structured_request" as const,
    method: "POST",
    operation: operation.name,
    paginationPolicy: "none" as const,
    provider: source.provider,
    request: {
      arguments: request.fieldPatch ?? {},
      toolName: operation.name,
    },
    selectorTemplate: "mcp/tools/{toolName}",
    sourceId: source.id,
    sourceKey: source.sourceKey,
  };
}

function readPrepared(request: JsonObject): {
  arguments: JsonObject;
  name: string;
} {
  const toolName = request.toolName;
  const args = request.arguments;
  if (typeof toolName !== "string" || !jamReadToolNames.has(toolName)) {
    throw new JamInvalidRequestError(
      "Prepared Jam request has no allowed tool"
    );
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new JamInvalidRequestError(
      "Prepared Jam request has invalid arguments"
    );
  }
  return { arguments: args, name: toolName };
}

function buildExecutionResult(input: {
  operation: string;
  result: Awaited<ReturnType<JamMcpClient["callTool"]>>;
  source: PreparedSourceConnection;
}): SourceApiExecutionResult {
  const value = toJsonValue({
    content: input.result.content,
    ...(input.result.structuredContent
      ? { structuredContent: input.result.structuredContent }
      : {}),
  });
  return {
    body: { kind: "json", value },
    contentType: "application/json",
    headers: [{ name: "content-type", value: "application/json" }],
    operation: input.operation,
    source: {
      displayName: input.source.displayName,
      provider: input.source.provider,
      sourceKey: input.source.sourceKey,
    },
    status: 200,
  };
}

function toJsonValue(value: unknown): JsonValue {
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

function readToolError(content: unknown): string {
  if (Array.isArray(content)) {
    const text = content.find(
      (item) =>
        item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string"
    );
    if (text && typeof text === "object" && "text" in text) {
      return String(text.text);
    }
  }
  return "Jam MCP tool call failed";
}

export const jamSourceApiContract = {
  buildExecutionResult,
  createOperation,
  descriptorVersion: "jam.mcp.v1",
  isReadTool: (tool: JamMcpTool) => jamReadToolNames.has(tool.name),
  normalize,
  readPrepared,
  readToolError,
};
