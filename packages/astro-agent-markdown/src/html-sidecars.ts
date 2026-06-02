import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AstroIntegrationLogger } from "astro";

import { htmlToMarkdown } from "./html-to-markdown";

export type ExportHtmlMarkdownSidecarsOptions = {
  assets: ReadonlyMap<string, readonly URL[]>;
  dir: URL;
  exclude?: readonly RegExp[];
  logger: AstroIntegrationLogger;
};

const HTML_EXTENSION = ".html";

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

export function getHtmlRoutePath(htmlRelativePath: string) {
  const relativePath = toPosixPath(htmlRelativePath);

  if (relativePath === "index.html") {
    return "/";
  }

  if (relativePath.endsWith(`/index${HTML_EXTENSION}`)) {
    return `/${relativePath.slice(0, -`/index${HTML_EXTENSION}`.length)}/`;
  }

  return `/${relativePath.slice(0, -HTML_EXTENSION.length)}/`;
}

export function shouldExportHtmlRoute(
  routePath: string,
  excludes: readonly RegExp[] = []
) {
  return excludes.every((pattern) => !pattern.test(routePath));
}

async function exportHtmlFile(input: {
  htmlPath: string;
  logger: AstroIntegrationLogger;
  routePath: string;
}) {
  const markdownPath = `${input.htmlPath.slice(0, -HTML_EXTENSION.length)}.md`;

  try {
    await fs.access(markdownPath);
    return false;
  } catch {
    // A content collection endpoint may already have produced this sidecar.
  }

  const html = await fs.readFile(input.htmlPath, "utf8");
  const markdown = htmlToMarkdown(html);

  if (markdown.trim().length === 0) {
    input.logger.warn(`Skipping empty Markdown export for ${input.routePath}`);
    return false;
  }

  await fs.writeFile(markdownPath, markdown);
  return true;
}

async function collectHtmlFiles(directory: string) {
  const htmlPaths: string[] = [];

  async function visit(currentDirectory: string) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(currentDirectory, entry.name);

        if (entry.isDirectory()) {
          await visit(entryPath);
          return;
        }

        if (entry.isFile() && entry.name.endsWith(HTML_EXTENSION)) {
          htmlPaths.push(entryPath);
        }
      })
    );
  }

  await visit(directory);

  return htmlPaths;
}

export async function exportHtmlMarkdownSidecars(
  options: ExportHtmlMarkdownSidecarsOptions
) {
  let exportedCount = 0;
  const outputDir = fileURLToPath(options.dir);
  const htmlAssetPaths = new Set<string>();

  for (const assetUrls of options.assets.values()) {
    for (const assetUrl of assetUrls) {
      if (assetUrl.pathname.endsWith(HTML_EXTENSION)) {
        htmlAssetPaths.add(fileURLToPath(assetUrl));
      }
    }
  }

  // Workerd prerender builds can omit static HTML pages from the hook's assets
  // map, so scan the emitted client directory as the source of truth.
  for (const htmlPath of await collectHtmlFiles(outputDir)) {
    htmlAssetPaths.add(htmlPath);
  }

  for (const htmlPath of htmlAssetPaths) {
    const routePath = getHtmlRoutePath(path.relative(outputDir, htmlPath));

    if (!shouldExportHtmlRoute(routePath, options.exclude)) {
      continue;
    }

    try {
      const exported = await exportHtmlFile({
        htmlPath,
        logger: options.logger,
        routePath,
      });

      if (exported) {
        exportedCount += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to export Markdown for ${routePath}: ${message}`,
        {
          cause: error,
        }
      );
    }
  }

  return exportedCount;
}
