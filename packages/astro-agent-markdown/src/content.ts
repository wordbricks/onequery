import { stringify } from "yaml";

import { createMarkdownResponse, getMarkdownAssetPath } from "./negotiation";

export const CONTENT_COLLECTION_ROUTE_PARAM = "agentMarkdownSlug";

export type ContentMarkdownEntry = {
  body?: string;
  data?: Readonly<Record<string, unknown>>;
  id: string;
  rendered?: {
    html?: string;
    metadata?: {
      frontmatter?: Readonly<Record<string, unknown>>;
    };
  };
};

export type ContentMarkdownCollection = {
  getEntries: () => Promise<readonly ContentMarkdownEntry[]>;
  getMarkdown?: (entry: ContentMarkdownEntry) => Promise<string>;
  routePrefix: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyRecord(value: Readonly<Record<string, unknown>>) {
  return Object.keys(value).length === 0;
}

function normalizeBody(body: string) {
  return body.endsWith("\n") ? body : `${body}\n`;
}

async function getEntryMarkdownBody(entry: ContentMarkdownEntry) {
  if (entry.body !== undefined) {
    return normalizeBody(entry.body);
  }

  if (entry.rendered?.html) {
    const { htmlToMarkdown } = await import("./html-to-markdown");
    return htmlToMarkdown(entry.rendered.html);
  }

  return "";
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
  entry: Pick<ContentMarkdownEntry, "id">;
  routePrefix: string;
}) {
  const routePrefix = normalizeRoutePrefix(input.routePrefix);
  const entryId = normalizeEntryId(input.entry.id);

  return `${routePrefix}/${entryId}/`.replace(/\/{2,}/gu, "/");
}

function getEntryFrontmatter(entry: ContentMarkdownEntry) {
  const rawFrontmatter = entry.rendered?.metadata?.frontmatter;

  if (isRecord(rawFrontmatter) && !isEmptyRecord(rawFrontmatter)) {
    return rawFrontmatter;
  }

  if (isRecord(entry.data) && !isEmptyRecord(entry.data)) {
    return entry.data;
  }

  return undefined;
}

export async function contentEntryToMarkdown(
  entry: ContentMarkdownEntry,
  options: {
    frontmatter?: Readonly<Record<string, unknown>>;
  } = {}
) {
  const body = await getEntryMarkdownBody(entry);
  const frontmatter = isRecord(options.frontmatter)
    ? options.frontmatter
    : getEntryFrontmatter(entry);

  if (!frontmatter) {
    return body;
  }

  const frontmatterYaml = stringify(frontmatter, {
    lineWidth: 0,
  }).trimEnd();

  return `---\n${frontmatterYaml}\n---\n\n${body}`;
}

export function createContentCollectionStaticPaths<
  Entry extends ContentMarkdownEntry,
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
  entry: Pick<ContentMarkdownEntry, "id">;
  routePrefix: string;
}) {
  return getMarkdownAssetPath(getContentEntryRoutePath(input));
}

export async function getContentMarkdownForPath(input: {
  contentCollections: readonly ContentMarkdownCollection[];
  pathname: string;
}) {
  const markdownPath = getMarkdownAssetPath(input.pathname);

  if (!markdownPath) {
    return undefined;
  }

  for (const collection of input.contentCollections) {
    const entries = await collection.getEntries();

    for (const entry of entries) {
      if (
        getContentEntryMarkdownAssetPath({
          entry,
          routePrefix: collection.routePrefix,
        }) === markdownPath
      ) {
        return collection.getMarkdown
          ? await collection.getMarkdown(entry)
          : await contentEntryToMarkdown(entry);
      }
    }
  }

  return undefined;
}

export async function createContentEntryMarkdownResponse(input: {
  entry: ContentMarkdownEntry;
  frontmatter?: Readonly<Record<string, unknown>>;
  request: Request;
}) {
  return createMarkdownResponse({
    markdown: await contentEntryToMarkdown(input.entry, {
      frontmatter: input.frontmatter,
    }),
    request: input.request,
  });
}
