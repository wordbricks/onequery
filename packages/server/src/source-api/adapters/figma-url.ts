import { z } from "zod";

const FIGMA_FILE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/u;
const FIGMA_NODE_ID_PATTERN = /^\d+:\d+$/u;
const FIGMA_FILE_PATH_TYPES = new Set([
  "board",
  "design",
  "file",
  "make",
  "proto",
  "slides",
]);

export const figmaFileKeySchema = z
  .string()
  .trim()
  .min(1)
  .regex(FIGMA_FILE_KEY_PATTERN, "Invalid Figma file key");

export const figmaNodeIdSchema = z
  .string()
  .trim()
  .transform(normalizeFigmaNodeId)
  .pipe(z.string().regex(FIGMA_NODE_ID_PATTERN, "Invalid Figma node ID"));

type FigmaDesignReference = {
  fileKey: string;
  nodeId: string;
};

export function parseFigmaDesignUrl(value: string): FigmaDesignReference {
  const url = new URL(value);
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") {
    throw new Error("Figma design URLs must use figma.com");
  }

  const [fileType, rawFileKey] = url.pathname.split("/").filter(Boolean);
  if (!fileType || !FIGMA_FILE_PATH_TYPES.has(fileType) || !rawFileKey) {
    throw new Error("Figma design URL does not contain a file key");
  }

  const rawNodeId = url.searchParams.get("node-id");
  if (!rawNodeId) {
    throw new Error("Figma design URL does not contain a node-id");
  }

  return {
    fileKey: figmaFileKeySchema.parse(rawFileKey),
    nodeId: figmaNodeIdSchema.parse(rawNodeId),
  };
}

function normalizeFigmaNodeId(value: string): string {
  if (value.includes(":")) {
    return value;
  }

  const separatorIndex = value.indexOf("-");
  if (separatorIndex < 0) {
    return value;
  }

  return `${value.slice(0, separatorIndex)}:${value.slice(separatorIndex + 1)}`;
}
