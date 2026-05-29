import fs from "node:fs/promises";
import path from "node:path";

import type { AstroIntegrationLogger } from "astro";

import { htmlToMarkdown } from "./html-to-markdown";

export type HtmlMarkdownPage = {
  pathname: string;
};

export type ExportHtmlMarkdownSidecarsOptions = {
  exclude?: readonly RegExp[];
  logger: AstroIntegrationLogger;
  outputDir: string;
  pages: readonly HtmlMarkdownPage[];
};

const MARKDOWN_ENDPOINT_PATH_PATTERN = /(?:^|\/)[^/]+\.md(?:\/|$)/u;

function normalizeGeneratedPathname(pathname: string) {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function getHtmlRoutePath(pathname: string) {
  const normalizedPathname = normalizeGeneratedPathname(pathname);

  if (normalizedPathname === "/") {
    return "/";
  }

  if (normalizedPathname.endsWith(".html")) {
    return `${normalizedPathname.slice(0, -".html".length)}/`;
  }

  return normalizedPathname.endsWith("/")
    ? normalizedPathname
    : `${normalizedPathname}/`;
}

export function shouldExportHtmlRoute(
  routePath: string,
  excludes: readonly RegExp[] = []
) {
  return excludes.every((pattern) => !pattern.test(routePath));
}

function getHtmlPathCandidates(input: { outputDir: string; pathname: string }) {
  const normalizedPathname = normalizeGeneratedPathname(input.pathname);
  const relativePath = normalizedPathname.replace(/^\/+/u, "");

  if (normalizedPathname === "/") {
    return [path.join(input.outputDir, "index.html")];
  }

  if (normalizedPathname.endsWith("/")) {
    return [path.join(input.outputDir, relativePath, "index.html")];
  }

  const candidates = [path.join(input.outputDir, relativePath)];

  if (!relativePath.endsWith(".html")) {
    candidates.push(
      path.join(input.outputDir, relativePath, "index.html"),
      path.join(input.outputDir, `${relativePath}.html`)
    );
  }

  return candidates;
}

async function findGeneratedHtmlPath(input: {
  outputDir: string;
  pathname: string;
}) {
  for (const candidate of getHtmlPathCandidates(input)) {
    try {
      const stat = await fs.stat(candidate);

      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next route-shape candidate.
    }
  }

  return undefined;
}

async function exportHtmlFile(input: {
  htmlPath: string;
  logger: AstroIntegrationLogger;
  routePath: string;
}) {
  const markdownPath = input.htmlPath.replace(/\.html$/u, ".md");

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

export async function exportHtmlMarkdownSidecars(
  options: ExportHtmlMarkdownSidecarsOptions
) {
  let exportedCount = 0;

  for (const page of options.pages) {
    if (MARKDOWN_ENDPOINT_PATH_PATTERN.test(page.pathname)) {
      continue;
    }

    const routePath = getHtmlRoutePath(page.pathname);

    if (!shouldExportHtmlRoute(routePath, options.exclude)) {
      continue;
    }

    const htmlPath = await findGeneratedHtmlPath({
      outputDir: options.outputDir,
      pathname: page.pathname,
    });

    if (!htmlPath) {
      options.logger.warn(`Skipping missing HTML output for ${routePath}`);
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
