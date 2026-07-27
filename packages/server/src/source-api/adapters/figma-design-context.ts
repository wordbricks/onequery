import type { JsonObject } from "@bufbuild/protobuf";
import type { FigmaCredentials } from "@onequery/db/server";

import { SourceApiUnsupportedOperationError } from "../errors";
import { normalizeAllowedHeaders } from "../helpers/http-rest";
import {
  createStructuredRequestOperation,
  mergeStructuredFieldPatch,
} from "../helpers/structured";
import type {
  PreparedSourceApi,
  PreparedSourceConnection,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResult,
  SourceApiOperation,
  SourceApiRequestBody,
  UnboundPreparedSourceApi,
} from "../types";
import { requestFigmaDesignContext } from "./figma-api";
import {
  FigmaDesignContextInvalidRequestError,
  parseFigmaDesignContextBody,
  parseFigmaDesignContextRequest,
} from "./figma-design-context-request";

export const FIGMA_DESIGN_CONTEXT_OPERATION = "prepare_design_context";

export function createFigmaDesignContextOperation(
  examples: readonly SourceApiExample[]
): SourceApiOperation {
  return createStructuredRequestOperation({
    allowedResponseHeaders: ["content-type"],
    description:
      "Bundle selected Figma nodes, reference renders, image fills, and optional local variables for implementation.",
    examples,
    name: FIGMA_DESIGN_CONTEXT_OPERATION,
    notes: [
      "Pass either a Figma frame URL or a fileKey with nodeIds.",
      "Local variables require the Figma file_variables:read scope and may be unavailable on some plans.",
      "This Velen context bundle is not the Figma MCP get_design_context response format.",
    ],
    summary: "Prepare implementation context for selected Figma frames.",
  });
}

export function normalizeFigmaDesignContext(input: {
  body: SourceApiRequestBody;
  descriptor: SourceApiDescriptor;
  fieldPatch?: JsonObject;
  headers: readonly { name: string; value: string }[];
  methodOverride?: string;
  operationName: string;
  selector?: string;
  source: PreparedSourceConnection;
}): UnboundPreparedSourceApi & { paginationPolicy: "none" } {
  const operation = requireFigmaDesignContextOperation(input);
  rejectUnsupportedRequestControls(input);
  const headers = normalizeAllowedHeaders({
    allowedNames: operation.headerPolicy.allowedRequestHeaders,
    headers: input.headers,
  });
  const request = parseFigmaDesignContextRequest(
    mergeStructuredFieldPatch({
      base: parseFigmaDesignContextBody(input.body),
      patch: input.fieldPatch,
    })
  );

  return {
    body: input.body,
    descriptorVersion: input.descriptor.descriptorVersion,
    headers,
    kind: "structured_request",
    method: "GET",
    operation: operation.name,
    paginationPolicy: "none",
    provider: input.source.provider,
    request,
    selectorTemplate: "/v1/files/{fileKey}/nodes",
    sourceId: input.source.id,
    sourceKey: input.source.sourceKey,
  };
}

export async function executeFigmaDesignContext(input: {
  prepared: PreparedSourceApi;
  source: PreparedSourceConnection;
}): Promise<SourceApiExecutionResult> {
  if (input.prepared.kind !== "structured_request") {
    throw new Error(
      `Figma operation "${input.prepared.operation}" requires a structured plan`
    );
  }

  const request = parseFigmaDesignContextRequest(input.prepared.request);
  const value = await requestFigmaDesignContext(
    requireFigmaCredentials(input.source),
    request
  );

  return {
    body: { kind: "json", value },
    contentType: "application/json",
    headers: [{ name: "content-type", value: "application/json" }],
    operation: input.prepared.operation,
    source: {
      displayName: input.source.displayName,
      provider: input.source.provider,
      sourceKey: input.source.sourceKey,
    },
    status: 200,
  };
}

function requireFigmaDesignContextOperation(input: {
  descriptor: SourceApiDescriptor;
  operationName: string;
}): SourceApiOperation {
  const operation = input.descriptor.operations.find(
    (candidate) => candidate.name === input.operationName.trim()
  );
  if (operation?.name === FIGMA_DESIGN_CONTEXT_OPERATION) {
    return operation;
  }
  throw new SourceApiUnsupportedOperationError(input.operationName);
}

function rejectUnsupportedRequestControls(input: {
  methodOverride?: string;
  operationName: string;
  selector?: string;
}): void {
  if (input.selector?.trim() || input.methodOverride?.trim()) {
    throw new FigmaDesignContextInvalidRequestError(
      `Figma operation "${input.operationName}" does not accept selectors or method overrides`
    );
  }
}

function requireFigmaCredentials(
  source: PreparedSourceConnection
): FigmaCredentials {
  if (source.credentials.type === "figma") {
    return source.credentials;
  }
  throw new Error("Figma source credentials are invalid");
}
