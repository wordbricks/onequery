import { stringify } from "yaml";

import { createMarkdownResponse, getMarkdownAssetPath } from "./negotiation";

export const CONTENT_COLLECTION_ROUTE_PARAM = "agentMarkdownSlug";

export type ContentMarkdownSource = {
  body: string;
  frontmatter?: Readonly<Record<string, unknown>>;
};

export type ContentMarkdownPathEntry = {
  id: string;
};

export type ContentMarkdownRoute = {
  getMarkdown: (entryId: string) => Promise<string | undefined>;
  routePrefix: string;
};

function isEmptyRecord(value: Readonly<Record<string, unknown>>) {
  return Object.keys(value).length === 0;
}

function normalizeBody(body: string) {
  return body.endsWith("\n") ? body : `${body}\n`;
}

function normalizeRoutePrefix(routePrefix: string) {
  const prefixed = routePrefix.startsWith("/")
    ? routePrefix
    : `/${routePrefix}`;
  return prefixed.replace(/\/+$/u, "");
}

function normalizeEntryId(id: string) {
  return id.replace(/^\/+/u, "").replace(/\/+$/u, "");
}

function getContentEntryRoutePath(input: {
  entry: ContentMarkdownPathEntry;
  routePrefix: string;
}) {
  const routePrefix = normalizeRoutePrefix(input.routePrefix);
  const entryId = normalizeEntryId(input.entry.id);

  return `${routePrefix}/${entryId}/`.replace(/\/{2,}/gu, "/");
}

export function contentEntryToMarkdown(source: ContentMarkdownSource) {
  const body = normalizeBody(source.body);
  const frontmatter = source.frontmatter;

  if (!frontmatter || isEmptyRecord(frontmatter)) {
    return body;
  }

  const frontmatterYaml = stringify(frontmatter, {
    lineWidth: 0,
  }).trimEnd();

  return `---\n${frontmatterYaml}\n---\n\n${body}`;
}

export function createContentCollectionStaticPaths<
  Entry extends ContentMarkdownPathEntry,
>(entries: readonly Entry[]) {
  return entries.map((entry) => ({
    params: {
      [CONTENT_COLLECTION_ROUTE_PARAM]: normalizeEntryId(entry.id),
    },
    props: {
      entry,
    },
  }));
}

export function getContentEntryMarkdownAssetPath(input: {
  entry: ContentMarkdownPathEntry;
  routePrefix: string;
}) {
  return getMarkdownAssetPath(getContentEntryRoutePath(input));
}

export function getContentEntryIdForMarkdownPath(input: {
  markdownPath: string;
  routePrefix: string;
}) {
  const routePrefix = normalizeRoutePrefix(input.routePrefix);
  const routeBase = `${routePrefix}/`.replace(/\/{2,}/gu, "/");
  const markdownSuffix = "/index.md";

  if (
    !input.markdownPath.startsWith(routeBase) ||
    !input.markdownPath.endsWith(markdownSuffix)
  ) {
    return undefined;
  }

  return input.markdownPath.slice(routeBase.length, -markdownSuffix.length);
}

export async function getContentMarkdownForPath(input: {
  contentRoutes: readonly ContentMarkdownRoute[];
  pathname: string;
}) {
  const markdownPath = getMarkdownAssetPath(input.pathname);

  if (!markdownPath) {
    return undefined;
  }

  for (const route of input.contentRoutes) {
    const entryId = getContentEntryIdForMarkdownPath({
      markdownPath,
      routePrefix: route.routePrefix,
    });

    if (entryId !== undefined) {
      return route.getMarkdown(entryId);
    }
  }

  return undefined;
}

export function createContentEntryMarkdownResponse(input: {
  body: string;
  frontmatter?: Readonly<Record<string, unknown>>;
  request: Request;
}) {
  return createMarkdownResponse({
    markdown: contentEntryToMarkdown({
      body: input.body,
      frontmatter: input.frontmatter,
    }),
    request: input.request,
  });
}
