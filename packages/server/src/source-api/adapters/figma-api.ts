import type { JsonValue } from "@bufbuild/protobuf";
import type { FigmaCredentials } from "@onequery/db/server";
import { z } from "zod";

import { MAX_PROVIDER_ERROR_DETAIL_LENGTH } from "../../services/provider-http";
import { ProviderHttpClient } from "../../services/provider-http-client";

const FIGMA_API_BASE_URL = "https://api.figma.com";

type FigmaDesignContextApiRequest = {
  depth?: number;
  fileKey: string;
  includeImageFills: boolean;
  includeVariables: boolean;
  nodeIds: readonly string[];
  renderFormat: "jpg" | "png" | "svg";
  renderScale: number;
  timeoutMs?: number;
};

export async function requestFigmaDesignContext(
  credentials: FigmaCredentials,
  request: FigmaDesignContextApiRequest
): Promise<JsonValue> {
  const client = createFigmaHttpClient(credentials);
  const fileKey = encodeURIComponent(request.fileKey);
  const ids = request.nodeIds.join(",");
  const commonParams = {
    ...(request.depth === undefined ? {} : { depth: request.depth }),
    ids,
  };
  const [nodes, renders, imageFillsResult, variablesResult] = await Promise.all(
    [
      client.get(`/v1/files/${fileKey}/nodes`, commonParams, request.timeoutMs),
      client.get(
        `/v1/images/${fileKey}`,
        {
          format: request.renderFormat,
          ids,
          scale: request.renderScale,
        },
        request.timeoutMs
      ),
      request.includeImageFills
        ? requestOptionalFigmaJson(
            client.get(
              `/v1/files/${fileKey}/images`,
              undefined,
              request.timeoutMs
            ),
            "Figma image fills are unavailable"
          )
        : Promise.resolve({ value: null, warning: null }),
      request.includeVariables
        ? requestOptionalFigmaJson(
            client.get(
              `/v1/files/${fileKey}/variables/local`,
              undefined,
              request.timeoutMs
            ),
            "Figma local variables are unavailable"
          )
        : Promise.resolve({ value: null, warning: null }),
    ]
  );
  const warnings = [imageFillsResult.warning, variablesResult.warning].filter(
    (warning): warning is string => warning !== null
  );

  return z.json().parse({
    fileKey: request.fileKey,
    imageFills: imageFillsResult.value,
    localVariables: variablesResult.value,
    nodeIds: request.nodeIds,
    nodes,
    renders,
    warnings,
  });
}

function createFigmaHttpClient(
  credentials: FigmaCredentials
): ProviderHttpClient {
  return new ProviderHttpClient({
    auth: {
      type: "raw",
      value: credentials.personalAccessToken,
    },
    authHeaderName: "X-Figma-Token",
    baseUrl: FIGMA_API_BASE_URL,
    defaultHeaders: { Accept: "application/json" },
    providerName: "Figma",
    sanitize: (text) =>
      text
        .split(credentials.personalAccessToken)
        .join("***")
        .slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH),
  });
}

async function requestOptionalFigmaJson(
  request: Promise<unknown>,
  warningPrefix: string
): Promise<{ value: unknown; warning: string | null }> {
  try {
    return { value: await request, warning: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      value: null,
      warning: `${warningPrefix}: ${detail}`,
    };
  }
}
