import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AstroConfig,
  AstroIntegration,
  AstroIntegrationLogger,
} from "astro";

import { htmlToMarkdown } from "./html-to-markdown";
import {
  collectMarkdownSourceContent,
  exportMarkdownSourceContent,
} from "./source-content";
import type { MarkdownSourceContentExport } from "./source-content";

export type AgentMarkdownOptions = {
  exclude?: readonly RegExp[];
  sourceContent?: readonly MarkdownSourceContentExport[];
};

const DEFAULT_EXCLUDES = [/^\/404(?:\/|$)/u, /^\/_astro(?:\/|$)/u];

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

function toRoutePath(input: { htmlPath: string; outputDir: string }) {
  const relativePath = path
    .relative(input.outputDir, input.htmlPath)
    .split(path.sep)
    .join("/");

  if (relativePath === "index.html") {
    return "/";
  }

  if (relativePath.endsWith("/index.html")) {
    return `/${relativePath.slice(0, -"index.html".length)}`;
  }

  return `/${relativePath.replace(/\.html$/u, "/")}`;
}

function shouldExportRoute(
  routePath: string,
  excludes: readonly RegExp[] = DEFAULT_EXCLUDES
) {
  return excludes.every((pattern) => !pattern.test(routePath));
}

async function exportHtmlFile(input: {
  htmlPath: string;
  logger: AstroIntegrationLogger;
  outputDir: string;
}) {
  const routePath = toRoutePath(input);

  if (!shouldExportRoute(routePath)) {
    return false;
  }

  const html = await fs.readFile(input.htmlPath, "utf8");
  const markdown = htmlToMarkdown(html);

  if (markdown.trim().length === 0) {
    input.logger.warn(`Skipping empty Markdown export for ${routePath}`);
    return false;
  }

  await fs.writeFile(input.htmlPath.replace(/\.html$/u, ".md"), markdown);
  return true;
}

async function writeDevMiddlewareEntrypoint(input: {
  addWatchFile: (path: string | URL) => void;
  config: AstroConfig;
  entrypoint: URL;
  logger: AstroIntegrationLogger;
  options: AgentMarkdownOptions;
}) {
  const sourceContentByAssetPath: Record<string, string> = {};

  for (const source of input.options.sourceContent ?? []) {
    const entries = await collectMarkdownSourceContent({
      config: input.config,
      logger: input.logger,
      source,
    });

    for (const entry of entries) {
      sourceContentByAssetPath[entry.assetPath] = entry.markdown;
      input.addWatchFile(entry.filePath);
    }
  }

  const middlewareOptions = {
    exclude: input.options.exclude?.map((pattern) => [
      pattern.source,
      pattern.flags,
    ]),
    sourceContentByAssetPath,
  };
  const code = `import { createDevMarkdownMiddleware } from "@onequery/astro-agent-markdown/dev-middleware";

export const onRequest = createDevMarkdownMiddleware(${JSON.stringify(
    middlewareOptions,
    null,
    2
  )});
`;

  await fs.writeFile(input.entrypoint, code);
}

export function agentMarkdown(
  options: AgentMarkdownOptions = {}
): AstroIntegration {
  let config: AstroConfig | undefined;

  return {
    name: "onequery-agent-markdown",
    hooks: {
      "astro:config:setup": async ({
        addMiddleware,
        addWatchFile,
        command,
        config: setupConfig,
        createCodegenDir,
        logger,
      }) => {
        if (command !== "dev") {
          return;
        }

        const entrypoint = new URL("dev-middleware.mjs", createCodegenDir());

        await writeDevMiddlewareEntrypoint({
          addWatchFile,
          config: setupConfig,
          entrypoint,
          logger,
          options,
        });

        addMiddleware({
          entrypoint,
          order: "pre",
        });
      },
      "astro:config:done": ({ config: resolvedConfig }) => {
        config = resolvedConfig;
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (!config) {
          throw new Error(
            "Astro config was not available during Markdown export."
          );
        }

        const outputDir = fileURLToPath(dir);
        let exportedCount = 0;

        for await (const htmlPath of walkFiles(outputDir)) {
          if (!htmlPath.endsWith(".html")) {
            continue;
          }

          const routePath = toRoutePath({ htmlPath, outputDir });
          if (
            !shouldExportRoute(routePath, [
              ...DEFAULT_EXCLUDES,
              ...(options.exclude ?? []),
            ])
          ) {
            continue;
          }

          try {
            const exported = await exportHtmlFile({
              htmlPath,
              logger,
              outputDir,
            });

            if (exported) {
              exportedCount += 1;
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            throw new Error(
              `Failed to export Markdown for ${routePath}: ${message}`,
              { cause: error }
            );
          }
        }

        if (options.sourceContent) {
          let sourceExportedCount = 0;

          for (const source of options.sourceContent) {
            try {
              sourceExportedCount += await exportMarkdownSourceContent({
                config,
                logger,
                outputDir,
                source,
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              throw new Error(
                `Failed to export Markdown source content from ${source.sourceDirectory}: ${message}`,
                { cause: error }
              );
            }
          }

          logger.info(
            `Exported ${sourceExportedCount} source Markdown page sidecars`
          );
        }

        logger.info(
          `Exported ${exportedCount} HTML-derived Markdown page sidecars`
        );
      },
    },
  };
}
