import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AstroConfig, AstroIntegrationLogger } from "astro";

export type MarkdownSourceContentExport = {
  extensions?: readonly string[];
  routePrefix: string;
  sourceDirectory: string;
};

const DEFAULT_MARKDOWN_SOURCE_EXTENSIONS = [".md", ".mdx"] as const;

async function* walkFiles(directory: string): AsyncGenerator<string> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
      continue;
    }

    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function normalizeRoutePrefix(routePrefix: string) {
  const prefixed = routePrefix.startsWith("/")
    ? routePrefix
    : `/${routePrefix}`;

  return prefixed.endsWith("/") ? prefixed : `${prefixed}/`;
}

function getSourceDirectory(input: {
  config: AstroConfig;
  sourceDirectory: string;
}) {
  if (path.isAbsolute(input.sourceDirectory)) {
    return input.sourceDirectory;
  }

  return path.resolve(fileURLToPath(input.config.root), input.sourceDirectory);
}

function getSourceRoutePath(input: {
  relativePath: string;
  routePrefix: string;
}) {
  const extension = path.extname(input.relativePath);
  const relativePathWithoutExtension = input.relativePath.slice(
    0,
    -extension.length
  );
  const routePrefix = normalizeRoutePrefix(input.routePrefix);

  if (relativePathWithoutExtension === "index") {
    return routePrefix;
  }

  if (relativePathWithoutExtension.endsWith("/index")) {
    return `${routePrefix}${relativePathWithoutExtension.slice(
      0,
      -"index".length
    )}`;
  }

  return `${routePrefix}${relativePathWithoutExtension}/`;
}

function getMarkdownOutputPath(input: {
  outputDir: string;
  routePath: string;
}) {
  const outputDir = path.resolve(input.outputDir);
  const outputPath = path.resolve(
    outputDir,
    input.routePath.replace(/^\/+/u, ""),
    "index.md"
  );

  if (!outputPath.startsWith(`${outputDir}${path.sep}`)) {
    throw new Error(
      `Markdown export path escapes output directory: ${input.routePath}`
    );
  }

  return outputPath;
}

export async function exportMarkdownSourceContent(input: {
  config: AstroConfig;
  logger: AstroIntegrationLogger;
  outputDir: string;
  source: MarkdownSourceContentExport;
}) {
  const sourceDirectory = getSourceDirectory({
    config: input.config,
    sourceDirectory: input.source.sourceDirectory,
  });
  const extensions =
    input.source.extensions ?? DEFAULT_MARKDOWN_SOURCE_EXTENSIONS;
  let exportedCount = 0;

  try {
    await fs.access(sourceDirectory);
  } catch {
    input.logger.warn(`Missing Markdown source directory: ${sourceDirectory}`);
    return exportedCount;
  }

  for await (const filePath of walkFiles(sourceDirectory)) {
    const extension = path.extname(filePath);

    if (!extensions.includes(extension)) {
      continue;
    }

    const relativePath = path
      .relative(sourceDirectory, filePath)
      .split(path.sep)
      .join("/");
    const routePath = getSourceRoutePath({
      relativePath,
      routePrefix: input.source.routePrefix,
    });
    const outputPath = getMarkdownOutputPath({
      outputDir: input.outputDir,
      routePath,
    });
    const markdown = await fs.readFile(filePath, "utf8");

    if (markdown.trim().length === 0) {
      input.logger.warn(`Skipping empty Markdown source: ${filePath}`);
      continue;
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      markdown.endsWith("\n") ? markdown : `${markdown}\n`
    );
    exportedCount += 1;
  }

  return exportedCount;
}
