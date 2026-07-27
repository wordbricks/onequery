import type { FigmaCredentials } from "@onequery/db/server";

import type { SourceApiAdapter, SourceApiExample } from "../types";
import {
  FIGMA_DESIGN_CONTEXT_OPERATION,
  createFigmaDesignContextOperation,
  executeFigmaDesignContext,
  normalizeFigmaDesignContext,
} from "./figma-design-context";
import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const FIGMA_API_BASE_URL = "https://api.figma.com";
const FIGMA_DESCRIPTOR_VERSION = "figma.v1";
const FIGMA_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "retry-after",
  "x-figma-plan-tier",
  "x-figma-rate-limit-type",
  "x-figma-upgrade-link",
] as const;

const rawFigmaSourceApiAdapter =
  createSimpleRestSourceApiAdapter<FigmaCredentials>({
    allowedMethods: ["GET"],
    allowedResponseHeaders: FIGMA_ALLOWED_RESPONSE_HEADERS,
    apiBaseUrl: () => FIGMA_API_BASE_URL,
    auth: (credentials) => ({
      type: "raw",
      value: credentials.personalAccessToken,
    }),
    authHeaderName: "X-Figma-Token",
    buildExamples: buildFigmaRawExamples,
    descriptorVersion: FIGMA_DESCRIPTOR_VERSION,
    notes: [
      "Figma personal access tokens are sent only to https://api.figma.com.",
      "This adapter exposes read-only Figma REST API requests.",
    ],
    operationNotes: [
      "Selectors should use Figma REST paths under /v1.",
      "Use prepare_design_context to bundle implementation context for one or more frames.",
    ],
    provider: "figma",
    providerLabel: "Figma",
  });

export const figmaSourceApiAdapter: SourceApiAdapter = {
  provider: "figma",
  async describe(input) {
    const rawDescriptor = await rawFigmaSourceApiAdapter.describe(input);
    const groupedExamples = buildFigmaDesignContextExamples(
      input.source.sourceKey
    );

    return {
      ...rawDescriptor,
      examples: [...rawDescriptor.examples, ...groupedExamples],
      operations: [
        ...rawDescriptor.operations,
        createFigmaDesignContextOperation(groupedExamples),
      ],
    };
  },
  async normalize(input) {
    if (input.request.operation !== FIGMA_DESIGN_CONTEXT_OPERATION) {
      return rawFigmaSourceApiAdapter.normalize(input);
    }

    return normalizeFigmaDesignContext({
      body: input.request.body,
      descriptor: input.descriptor,
      fieldPatch: input.request.fieldPatch,
      headers: input.request.headers,
      methodOverride: input.request.methodOverride,
      operationName: input.request.operation,
      selector: input.request.selector,
      source: input.source,
    });
  },
  async execute(input) {
    if (input.prepared.operation !== FIGMA_DESIGN_CONTEXT_OPERATION) {
      return rawFigmaSourceApiAdapter.execute(input);
    }

    return executeFigmaDesignContext({
      prepared: input.prepared,
      source: input.source,
    });
  },
};

function buildFigmaRawExamples(sourceKey: string): SourceApiExample[] {
  return [
    {
      command: `onequery api --source ${sourceKey} /v1/files/<file-key>/nodes -f params[ids]=2578:39032`,
      description: "Read selected nodes and their component metadata.",
      label: "Get file nodes",
    },
    {
      command: `onequery api --source ${sourceKey} /v1/images/<file-key> -f params[ids]=2578:39032 -f params[format]=png`,
      description: "Render selected nodes as reference images.",
      label: "Render nodes",
    },
  ];
}

function buildFigmaDesignContextExamples(
  sourceKey: string
): SourceApiExample[] {
  return [
    {
      command: `onequery api --source ${sourceKey} --op prepare_design_context --input '{"url":"https://www.figma.com/design/<file-key>/<name>?node-id=2578-39032"}'`,
      description:
        "Bundle nodes, renders, and image fills for a Figma frame URL.",
      label: "Prepare design context",
    },
  ];
}
