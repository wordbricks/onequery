import type { JsonObject } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import { z } from "zod";

import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
import { SourceApiInvalidRequestError } from "../errors";
import type { SourceApiRequestBody } from "../types";
import {
  figmaFileKeySchema,
  figmaNodeIdSchema,
  parseFigmaDesignUrl,
} from "./figma-url";

const figmaDesignContextInputSchema = z
  .object({
    depth: z.number().int().min(1).max(20).optional(),
    fileKey: figmaFileKeySchema.optional(),
    includeImageFills: z.boolean().default(true),
    includeVariables: z.boolean().default(false),
    nodeIds: z.array(figmaNodeIdSchema).min(1).max(20).optional(),
    renderFormat: z.enum(["jpg", "png", "svg"]).default("png"),
    renderScale: z.number().min(0.01).max(4).default(2),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
      .optional(),
    url: z.url().optional(),
  })
  .strict();

type FigmaDesignContextInput = z.infer<typeof figmaDesignContextInputSchema>;

export class FigmaDesignContextInvalidRequestError extends SourceApiInvalidRequestError {}

export function parseFigmaDesignContextRequest(value: JsonObject): JsonObject &
  Omit<FigmaDesignContextInput, "url"> & {
    fileKey: string;
    nodeIds: string[];
  } {
  const parsed = figmaDesignContextInputSchema.safeParse(value);
  if (!parsed.success) {
    throwInvalidRequest();
  }

  const reference = parsed.data.url
    ? parseFigmaReference(parsed.data.url)
    : null;
  const fileKey = parsed.data.fileKey ?? reference?.fileKey;
  const nodeIds = parsed.data.nodeIds ?? (reference ? [reference.nodeId] : []);
  if (!fileKey || nodeIds.length === 0) {
    throwInvalidRequest();
  }

  return {
    ...(parsed.data.depth === undefined ? {} : { depth: parsed.data.depth }),
    fileKey,
    includeImageFills: parsed.data.includeImageFills,
    includeVariables: parsed.data.includeVariables,
    nodeIds,
    renderFormat: parsed.data.renderFormat,
    renderScale: parsed.data.renderScale,
    ...(parsed.data.timeoutMs === undefined
      ? {}
      : { timeoutMs: parsed.data.timeoutMs }),
  };
}

export function parseFigmaDesignContextBody(
  body: SourceApiRequestBody
): JsonObject {
  if (body.kind === "none") {
    return {};
  }
  if (body.kind === "json" && isRecord(body.value)) {
    return body.value;
  }
  throw new FigmaDesignContextInvalidRequestError(
    "Figma design context requests must be JSON objects"
  );
}

function parseFigmaReference(url: string) {
  try {
    return parseFigmaDesignUrl(url);
  } catch {
    throwInvalidRequest();
  }
}

function throwInvalidRequest(): never {
  throw new FigmaDesignContextInvalidRequestError(
    "Invalid Figma design context request"
  );
}
