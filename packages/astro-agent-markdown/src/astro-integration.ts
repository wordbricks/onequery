import fs from "node:fs/promises";

import type { AstroIntegration } from "astro";

import { exportAgentMarkdownBundles } from "./bundle";
import type {
  AgentMarkdownBundleOptions,
  AgentMarkdownDocumentSet,
} from "./bundle";
import { exportHtmlMarkdownSidecars } from "./html-sidecars";

export type AgentMarkdownContentCollection = {
  collection: string;
  routePrefix: string;
};

export type AgentMarkdownHtmlOptions = {
  exclude?: readonly RegExp[];
};

export type AgentMarkdownOptions = {
  bundle?: false | AgentMarkdownBundleOptions;
  content?: readonly AgentMarkdownContentCollection[];
  html?: false | AgentMarkdownHtmlOptions;
  exclude?: readonly RegExp[];
};

type InjectRoute = (route: {
  entrypoint: URL;
  pattern: string;
  prerender?: boolean;
}) => void;

const DEFAULT_EXCLUDES = [/^\/404(?:\/|$)/u, /^\/_astro(?:\/|$)/u];
const CONTENT_ROUTE_PARAM = "agentMarkdownSlug";
const DEFAULT_BUNDLE_INDEX_URL = "/llms.txt";

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

function normalizeBundleRouteUrl(url: string) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(url)) {
    throw new Error(`Agent Markdown bundle URLs must be site-relative: ${url}`);
  }

  const routeUrl = url.startsWith("/") ? url : `/${url}`;

  if (/(?:^|\/)\.\.(?:\/|$)/u.test(routeUrl)) {
    throw new Error(`Invalid agent Markdown bundle URL: ${url}`);
  }

  return routeUrl;
}

function getBundleEndpointFilename(url: string, index: number) {
  const safeName = normalizeBundleRouteUrl(url)
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();

  return `bundle-${index}-${safeName || "agent-markdown"}.ts`;
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

function buildBundleIndexPreview(input: {
  bundle: AgentMarkdownBundleOptions;
}) {
  const index =
    input.bundle.index === false
      ? undefined
      : (input.bundle.index ?? {
          title: "Agent Markdown",
        });
  const title = index?.title ?? "Agent Markdown";
  const description = index?.description ? `\n\n> ${index.description}` : "";
  const documentLinks = input.bundle.documents
    .map(
      (document) =>
        `- [${document.title}](${normalizeBundleRouteUrl(document.url)}): ${document.description}`
    )
    .join("\n");

  return `# ${title}${description}

This is a development placeholder. Agent Markdown bundle files are generated from the built site.

Use a production preview to inspect the exact generated files.

## Generated Markdown

${documentLinks}
`;
}

function buildBundleDocumentPreview(document: AgentMarkdownDocumentSet) {
  return `# ${document.title}

> ${document.description}

This is a development placeholder. The full Agent Markdown document is generated from the built site.

Use a production preview to inspect the exact generated file.
`;
}

function getBundleIndexUrl(bundle: AgentMarkdownBundleOptions) {
  if (bundle.index === false) {
    return undefined;
  }

  return normalizeBundleRouteUrl(bundle.index?.url ?? DEFAULT_BUNDLE_INDEX_URL);
}

async function writeBundleEndpointEntrypoint(input: {
  entrypoint: URL;
  markdown: string;
}) {
  const code = `import type { APIRoute } from "astro";

export const prerender = false;

const markdown = ${JSON.stringify(input.markdown)};

export const GET: APIRoute = () =>
  new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });

export const HEAD: APIRoute = () =>
  new Response(null, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
`;

  await fs.writeFile(input.entrypoint, code);
}

async function writeBundleDevEndpoints(input: {
  bundle: AgentMarkdownBundleOptions;
  codegenDir: URL;
  injectRoute: InjectRoute;
}) {
  const indexUrl = getBundleIndexUrl(input.bundle);
  const routes = [
    ...(indexUrl === undefined
      ? []
      : [
          {
            markdown: buildBundleIndexPreview({
              bundle: input.bundle,
            }),
            url: indexUrl,
          },
        ]),
    ...input.bundle.documents.map((document) => ({
      markdown: buildBundleDocumentPreview(document),
      url: normalizeBundleRouteUrl(document.url),
    })),
  ];

  await Promise.all(
    routes.map(async (route, index) => {
      const entrypoint = new URL(
        getBundleEndpointFilename(route.url, index),
        input.codegenDir
      );

      await writeBundleEndpointEntrypoint({
        entrypoint,
        markdown: route.markdown,
      });

      input.injectRoute({
        entrypoint,
        pattern: route.url,
        prerender: false,
      });
    })
  );
}

export function agentMarkdown(
  options: AgentMarkdownOptions = {}
): AstroIntegration {
  const content = options.content ?? [];
  let site: string | undefined;

  return {
    name: "onequery-agent-markdown",
    hooks: {
      "astro:config:setup": async ({
        addMiddleware,
        command,
        createCodegenDir,
        injectRoute,
        config,
      }) => {
        site = config.site;
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

        if (options.bundle !== false && options.bundle !== undefined) {
          await writeBundleDevEndpoints({
            bundle: options.bundle,
            codegenDir,
            injectRoute,
          });
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

        if (options.bundle !== false && options.bundle !== undefined) {
          const bundleResult = await exportAgentMarkdownBundles({
            bundle: options.bundle,
            dir,
            exclude: options.exclude,
            logger,
            site,
          });

          logger.info(
            `Exported ${bundleResult.documentCount} agent Markdown bundle documents from ${bundleResult.pageCount} pages`
          );
        }
      },
    },
  };
}
