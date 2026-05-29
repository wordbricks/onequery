import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { AstroIntegration } from "astro";

import { exportHtmlMarkdownSidecars } from "./html-sidecars";

export type AgentMarkdownContentCollection = {
  collection: string;
  routePrefix: string;
};

export type AgentMarkdownHtmlOptions = {
  exclude?: readonly RegExp[];
};

export type AgentMarkdownOptions = {
  content?: readonly AgentMarkdownContentCollection[];
  html?: false | AgentMarkdownHtmlOptions;
  exclude?: readonly RegExp[];
};

const DEFAULT_EXCLUDES = [/^\/404(?:\/|$)/u, /^\/_astro(?:\/|$)/u];
const CONTENT_ROUTE_PARAM = "agentMarkdownSlug";

function normalizeRoutePrefix(routePrefix: string) {
  const prefixed = routePrefix.startsWith("/")
    ? routePrefix
    : `/${routePrefix}`;

  return prefixed === "/" ? "" : prefixed.replace(/\/+$/u, "");
}

function getContentRoutePattern(content: AgentMarkdownContentCollection) {
  const routePrefix = normalizeRoutePrefix(content.routePrefix);
  return `${routePrefix}/[...${CONTENT_ROUTE_PARAM}]/index.md`;
}

function getContentEndpointFilename(
  content: AgentMarkdownContentCollection,
  index: number
) {
  const safeName = `${content.collection}-${content.routePrefix}`
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();

  return `content-${index}-${safeName || "collection"}.ts`;
}

async function writeContentEndpointEntrypoint(input: {
  content: AgentMarkdownContentCollection;
  entrypoint: URL;
}) {
  const code = `import { getCollection, render } from "astro:content";
import {
  createContentCollectionStaticPaths,
  createContentEntryMarkdownResponse,
} from "@onequery/astro-agent-markdown/content";

export const prerender = true;

export async function getStaticPaths() {
  return createContentCollectionStaticPaths(
    await getCollection(${JSON.stringify(input.content.collection)})
  );
}

export async function GET({ props, request }) {
  const { remarkPluginFrontmatter } = await render(props.entry);

  return createContentEntryMarkdownResponse({
    entry: props.entry,
    frontmatter: remarkPluginFrontmatter,
    request,
  });
}

export async function HEAD({ props, request }) {
  const { remarkPluginFrontmatter } = await render(props.entry);

  return createContentEntryMarkdownResponse({
    entry: props.entry,
    frontmatter: remarkPluginFrontmatter,
    request,
  });
}
`;

  await fs.writeFile(input.entrypoint, code);
}

async function writeDevMiddlewareEntrypoint(input: {
  content: readonly AgentMarkdownContentCollection[];
  entrypoint: URL;
  options: AgentMarkdownOptions;
}) {
  const contentCollections = input.content
    .map(
      (content) => `    {
      routePrefix: ${JSON.stringify(content.routePrefix)},
      getEntries: () => getCollection(${JSON.stringify(content.collection)}),
      getMarkdown: async (entry) => {
        const { remarkPluginFrontmatter } = await render(entry);
        return contentEntryToMarkdown(entry, {
          frontmatter: remarkPluginFrontmatter,
        });
      },
    }`
    )
    .join(",\n");

  const middlewareOptions = {
    exclude: input.options.exclude?.map((pattern) => [
      pattern.source,
      pattern.flags,
    ]),
  };
  const code = `${input.content.length > 0 ? 'import { getCollection, render } from "astro:content";\nimport { contentEntryToMarkdown } from "@onequery/astro-agent-markdown/content";\n' : ""}import { createDevMarkdownMiddleware } from "@onequery/astro-agent-markdown/dev-middleware";

const options = ${JSON.stringify(middlewareOptions, null, 2)};
options.contentCollections = [
${contentCollections}
];

export const onRequest = createDevMarkdownMiddleware(options);
`;

  await fs.writeFile(input.entrypoint, code);
}

export function agentMarkdown(
  options: AgentMarkdownOptions = {}
): AstroIntegration {
  const content = options.content ?? [];

  return {
    name: "onequery-agent-markdown",
    hooks: {
      "astro:config:setup": async ({
        addMiddleware,
        command,
        createCodegenDir,
        injectRoute,
      }) => {
        const codegenDir = createCodegenDir();

        await Promise.all(
          content.map(async (contentCollection, index) => {
            const entrypoint = new URL(
              getContentEndpointFilename(contentCollection, index),
              codegenDir
            );

            await writeContentEndpointEntrypoint({
              content: contentCollection,
              entrypoint,
            });

            injectRoute({
              entrypoint,
              pattern: getContentRoutePattern(contentCollection),
              prerender: true,
            });
          })
        );

        if (command !== "dev") {
          return;
        }

        const entrypoint = new URL("dev-middleware.mjs", codegenDir);

        await writeDevMiddlewareEntrypoint({
          content,
          entrypoint,
          options,
        });

        addMiddleware({
          entrypoint,
          order: "pre",
        });
      },
      "astro:build:done": async ({ dir, logger, pages }) => {
        const outputDir = fileURLToPath(dir);
        const htmlOptions =
          options.html === false ? undefined : (options.html ?? {});
        const exportedCount = htmlOptions
          ? await exportHtmlMarkdownSidecars({
              exclude: [
                ...DEFAULT_EXCLUDES,
                ...(options.exclude ?? []),
                ...(htmlOptions.exclude ?? []),
              ],
              logger,
              outputDir,
              pages,
            })
          : 0;

        logger.info(
          `Exported ${exportedCount} HTML-derived Markdown page sidecars`
        );
      },
    },
  };
}
