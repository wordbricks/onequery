import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AstroIntegrationLogger } from "astro";

export type AgentMarkdownLink = {
  description?: string;
  label: string;
  url: string;
};

export type AgentMarkdownDocumentSet = {
  demote?: readonly RegExp[];
  description: string;
  exclude?: readonly RegExp[];
  include: readonly RegExp[];
  promote?: readonly RegExp[];
  title: string;
  url: string;
};

export type AgentMarkdownIndexOptions = {
  description?: string;
  details?: string;
  notes?: string;
  optionalLinks?: readonly AgentMarkdownLink[];
  title: string;
  url?: string;
};

export type AgentMarkdownBundleOptions = {
  documents: readonly AgentMarkdownDocumentSet[];
  index?: false | AgentMarkdownIndexOptions;
  pageSeparator?: string;
};

type MarkdownRoute = {
  filePath: string;
  routePath: string;
};

export type ExportAgentMarkdownBundlesOptions = {
  bundle: AgentMarkdownBundleOptions;
  dir: URL;
  exclude?: readonly RegExp[];
  logger: AstroIntegrationLogger;
  site?: string;
};

export type ExportAgentMarkdownBundlesResult = {
  documentCount: number;
  pageCount: number;
};

const DEFAULT_INDEX_URL = "/llms.txt";
const DEFAULT_PAGE_SEPARATOR = "\n\n---\n\n";
const DEFAULT_EXCLUDES = [/^\/404(?:\/|$)/u, /^\/_astro(?:\/|$)/u];
const MARKDOWN_INDEX_FILENAME = "index.md";

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function normalizeOutputUrl(url: string) {
  const pathname = url.startsWith("/") ? url.slice(1) : url;
  const normalized = path.posix.normalize(pathname);

  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Invalid agent Markdown output URL: ${url}`);
  }

  return normalized;
}

function getOutputFilePath(outputDir: string, url: string) {
  return path.join(outputDir, normalizeOutputUrl(url));
}

function matchAny(routePath: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(routePath));
}

function getPriority(routePath: string, set: AgentMarkdownDocumentSet) {
  const demoted = set.demote?.findIndex((pattern) => pattern.test(routePath));

  if (demoted !== undefined && demoted > -1) {
    return -1000 - demoted;
  }

  const promoted = set.promote?.findIndex((pattern) => pattern.test(routePath));

  if (promoted !== undefined && promoted > -1) {
    return 1000 - promoted;
  }

  return 0;
}

function toAbsoluteUrl(url: string, site?: string) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(url) || !site) {
    return url;
  }

  return new URL(url, site).toString();
}

function getRouteUrl(routePath: string, site?: string) {
  return toAbsoluteUrl(routePath, site);
}

function formatLink(link: AgentMarkdownLink, site?: string) {
  const url = toAbsoluteUrl(link.url, site);
  const description = link.description ? `: ${link.description}` : "";

  return `- [${link.label}](${url})${description}`;
}

function buildIndex(input: {
  documentLinks: readonly AgentMarkdownLink[];
  index: AgentMarkdownIndexOptions;
  site?: string;
}) {
  const lines = [
    `# ${input.index.title}`,
    input.index.description ? `> ${input.index.description}` : "",
    input.index.details ?? "",
  ];

  if (input.documentLinks.length > 0) {
    lines.push(
      `## Generated Markdown\n\n${input.documentLinks
        .map((link) => formatLink(link, input.site))
        .join("\n")}`
    );
  }

  if (input.index.notes) {
    lines.push(`## Notes\n\n${input.index.notes}`);
  }

  if (input.index.optionalLinks?.length) {
    lines.push(
      `## Optional\n\n${input.index.optionalLinks
        .map((link) => formatLink(link, input.site))
        .join("\n")}`
    );
  }

  return `${lines.filter((line) => line.length > 0).join("\n\n")}\n`;
}

function buildDocument(input: {
  pageSeparator: string;
  routes: readonly MarkdownRoute[];
  set: AgentMarkdownDocumentSet;
  site?: string;
  sourceByRoutePath: ReadonlyMap<string, string>;
}) {
  const entries = input.routes.map((route) => {
    const sourceUrl = getRouteUrl(route.routePath, input.site);
    const markdown = input.sourceByRoutePath.get(route.routePath)?.trim();

    return [`## Source: ${sourceUrl}`, markdown].filter(Boolean).join("\n\n");
  });
  const header = [`# ${input.set.title}`, `> ${input.set.description}`].join(
    "\n\n"
  );

  return `${[header, ...entries].join(input.pageSeparator)}\n`;
}

async function collectMarkdownFiles(directory: string) {
  const markdownPaths: string[] = [];

  async function visit(currentDirectory: string) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(currentDirectory, entry.name);

        if (entry.isDirectory()) {
          await visit(entryPath);
          return;
        }

        if (entry.isFile() && entry.name.endsWith(".md")) {
          markdownPaths.push(entryPath);
        }
      })
    );
  }

  await visit(directory);

  return markdownPaths;
}

export function getMarkdownFileRoutePath(markdownRelativePath: string) {
  const relativePath = toPosixPath(markdownRelativePath);

  if (relativePath === MARKDOWN_INDEX_FILENAME) {
    return "/";
  }

  if (relativePath.endsWith(`/${MARKDOWN_INDEX_FILENAME}`)) {
    return `/${relativePath.slice(0, -`/${MARKDOWN_INDEX_FILENAME}`.length)}/`;
  }

  return undefined;
}

async function collectMarkdownRoutes(outputDir: string) {
  const routes: MarkdownRoute[] = [];

  for (const filePath of await collectMarkdownFiles(outputDir)) {
    const routePath = getMarkdownFileRoutePath(
      path.relative(outputDir, filePath)
    );

    if (routePath) {
      routes.push({ filePath, routePath });
    }
  }

  return routes;
}

function selectRoutes(input: {
  collator: Intl.Collator;
  exclude: readonly RegExp[];
  routes: readonly MarkdownRoute[];
  set: AgentMarkdownDocumentSet;
}) {
  return input.routes
    .filter((route) => {
      if (!matchAny(route.routePath, input.set.include)) {
        return false;
      }

      return !matchAny(route.routePath, [
        ...input.exclude,
        ...(input.set.exclude ?? []),
      ]);
    })
    .sort((a, b) => {
      const priority =
        getPriority(b.routePath, input.set) -
        getPriority(a.routePath, input.set);

      if (priority !== 0) {
        return priority;
      }

      return input.collator.compare(a.routePath, b.routePath);
    });
}

async function readMarkdownSources(routes: readonly MarkdownRoute[]) {
  const sourceByRoutePath = new Map<string, string>();

  await Promise.all(
    routes.map(async (route) => {
      sourceByRoutePath.set(
        route.routePath,
        await fs.readFile(route.filePath, "utf8")
      );
    })
  );

  return sourceByRoutePath;
}

export async function exportAgentMarkdownBundles(
  options: ExportAgentMarkdownBundlesOptions
): Promise<ExportAgentMarkdownBundlesResult> {
  const outputDir = fileURLToPath(options.dir);
  const routes = await collectMarkdownRoutes(outputDir);
  const collator = new Intl.Collator("en");
  const exclude = [...DEFAULT_EXCLUDES, ...(options.exclude ?? [])];
  const pageSeparator = options.bundle.pageSeparator ?? DEFAULT_PAGE_SEPARATOR;
  const documentLinks: AgentMarkdownLink[] = [];
  let pageCount = 0;

  for (const set of options.bundle.documents) {
    const selectedRoutes = selectRoutes({
      collator,
      exclude,
      routes,
      set,
    });

    if (selectedRoutes.length === 0) {
      options.logger.warn(
        `Agent Markdown document "${set.title}" matched no generated Markdown pages`
      );
    }

    const sourceByRoutePath = await readMarkdownSources(selectedRoutes);
    const document = buildDocument({
      pageSeparator,
      routes: selectedRoutes,
      set,
      site: options.site,
      sourceByRoutePath,
    });
    const outputPath = getOutputFilePath(outputDir, set.url);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, document);

    pageCount += selectedRoutes.length;
    documentLinks.push({
      description: set.description,
      label: set.title,
      url: set.url,
    });
  }

  if (options.bundle.index !== false) {
    const index = options.bundle.index ?? {
      title: "Agent Markdown",
      url: DEFAULT_INDEX_URL,
    };
    const outputPath = getOutputFilePath(
      outputDir,
      index.url ?? DEFAULT_INDEX_URL
    );

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      buildIndex({
        documentLinks,
        index,
        site: options.site,
      })
    );
  }

  return {
    documentCount: options.bundle.documents.length,
    pageCount,
  };
}
