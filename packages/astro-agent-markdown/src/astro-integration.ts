import fs from "node:fs/promises";

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
  const collection = JSON.stringify(input.content.collection);
  const code = `import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, render } from "astro:content";
import type { CollectionEntry } from "astro:content";
import {
  createContentCollectionStaticPaths,
  createContentEntryMarkdownResponse,
} from "@onequery/astro-agent-markdown/content";

export const prerender = true;

const collection = ${collection};
type Entry = CollectionEntry<typeof collection>;
type Props = { entry: Entry };

function getRetainedBody(entry: Entry) {
  if (entry.body === undefined) {
    throw new Error(
      \`@onequery/astro-agent-markdown requires retained raw body for "\${entry.id}" in "\${collection}". Set retainBody: true on the Astro glob loader.\`
    );
  }

  return entry.body;
}

export const getStaticPaths = (async () => {
  return createContentCollectionStaticPaths(
    await getCollection(collection)
  );
}) satisfies GetStaticPaths;

const respond: APIRoute<Props> = async ({ props, request }) => {
  const { remarkPluginFrontmatter } = await render(props.entry);

  return createContentEntryMarkdownResponse({
    body: getRetainedBody(props.entry),
    frontmatter: remarkPluginFrontmatter,
    request,
  });
};

export const GET = respond;
export const HEAD = respond;
`;

  await fs.writeFile(input.entrypoint, code);
}

function getContentDevPrelude(
  content: readonly AgentMarkdownContentCollection[]
) {
  return content
    .map((contentCollection, index) => {
      const collectionName = JSON.stringify(contentCollection.collection);
      return `const collection${index} = ${collectionName};
type Entry${index} = CollectionEntry<typeof collection${index}>;

function getRetainedBody${index}(entry: Entry${index}) {
  if (entry.body === undefined) {
    throw new Error(
      \`@onequery/astro-agent-markdown requires retained raw body for "\${entry.id}" in "\${collection${index}}". Set retainBody: true on the Astro glob loader.\`
    );
  }

  return entry.body;
}
`;
    })
    .join("\n");
}

function getContentDevRouteDefinitions(
  content: readonly AgentMarkdownContentCollection[]
) {
  return content
    .map(
      (contentCollection, index) => `    {
      routePrefix: ${JSON.stringify(contentCollection.routePrefix)},
      getMarkdown: async (entryId: string) => {
        const entry = await getEntry(collection${index}, entryId);

        if (entry === undefined) {
          return undefined;
        }

        const { remarkPluginFrontmatter } = await render(entry);

        return contentEntryToMarkdown({
          body: getRetainedBody${index}(entry),
          frontmatter: remarkPluginFrontmatter,
        });
      },
    }`
    )
    .join(",\n");
}

async function writeDevMiddlewareEntrypoint(input: {
  content: readonly AgentMarkdownContentCollection[];
  entrypoint: URL;
  options: AgentMarkdownOptions;
}) {
  const exclude = JSON.stringify(
    (input.options.exclude ?? []).map((pattern) => [
      pattern.source,
      pattern.flags,
    ]),
    null,
    2
  );
  const code = `${input.content.length > 0 ? 'import { getEntry, render } from "astro:content";\nimport type { CollectionEntry } from "astro:content";\nimport { contentEntryToMarkdown } from "@onequery/astro-agent-markdown/content";\n' : ""}import { createDevMarkdownMiddleware } from "@onequery/astro-agent-markdown/dev-middleware";
import type { DevMarkdownMiddlewareOptions } from "@onequery/astro-agent-markdown/dev-middleware";

${getContentDevPrelude(input.content)}
const options = {
  contentRoutes: [
${getContentDevRouteDefinitions(input.content)}
  ],
  exclude: ${exclude},
} satisfies DevMarkdownMiddlewareOptions;

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

        const entrypoint = new URL("dev-middleware.ts", codegenDir);

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
      "astro:build:done": async ({ assets, dir, logger }) => {
        const htmlOptions =
          options.html === false ? undefined : (options.html ?? {});
        const exportedCount = htmlOptions
          ? await exportHtmlMarkdownSidecars({
              assets,
              dir,
              exclude: [
                ...DEFAULT_EXCLUDES,
                ...(options.exclude ?? []),
                ...(htmlOptions.exclude ?? []),
              ],
              logger,
            })
          : 0;

        logger.info(
          `Exported ${exportedCount} HTML-derived Markdown page sidecars`
        );
      },
    },
  };
}
