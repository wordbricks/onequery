import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import type { StarlightRouteData } from "@astrojs/starlight/route-data";
import type { SeoHeadEntry } from "@onequery/astro-seo";

import { createDocsIndexHeadEntries } from "@/shared/seo/docs";

type StarlightHead = StarlightRouteData["head"];
type StarlightHeadEntry = StarlightHead[number];
type HeadIdentity = string | undefined;

const DOCS_INDEX_PATHNAME = "/docs/";
const UNIQUE_LINK_RELS = new Set(["canonical", "sitemap"]);
const META_IDENTITY_KEYS = ["name", "property", "http-equiv"] as const;

export const onRequest = defineRouteMiddleware((context) => {
  if (context.url.pathname !== DOCS_INDEX_PATHNAME) {
    return;
  }

  const route = context.locals.starlightRoute;

  route.head = mergeHeadEntries(
    route.head,
    createDocsIndexHeadEntries(context.site)
  );
});

function toStarlightHeadEntry(entry: SeoHeadEntry): StarlightHeadEntry {
  return entry;
}

function mergeHeadEntries(
  current: StarlightHead,
  next: readonly SeoHeadEntry[]
): StarlightHead {
  const nextEntries = next.map(toStarlightHeadEntry);
  const nextIdentities = new Set(
    nextEntries
      .map(getHeadIdentity)
      .filter((identity): identity is string => identity !== undefined)
  );

  return [
    ...current.filter((entry) => {
      const identity = getHeadIdentity(entry);

      return identity === undefined || !nextIdentities.has(identity);
    }),
    ...nextEntries,
  ];
}

function getHeadIdentity(entry: StarlightHeadEntry): HeadIdentity {
  switch (entry.tag) {
    case "title":
      return "title";
    case "meta":
      return getMetaIdentity(entry);
    case "link":
      return getLinkIdentity(entry);
    case "script":
      return getScriptIdentity(entry);
    default:
      return undefined;
  }
}

function getMetaIdentity(entry: StarlightHeadEntry): HeadIdentity {
  for (const key of META_IDENTITY_KEYS) {
    const value = getAttributeValue(entry, key);

    if (value) {
      return `meta:${key}:${value}`;
    }
  }

  return undefined;
}

function getLinkIdentity(entry: StarlightHeadEntry): HeadIdentity {
  const rel = getAttributeValue(entry, "rel");

  if (rel && UNIQUE_LINK_RELS.has(rel)) {
    return `link:${rel}`;
  }

  return undefined;
}

function getScriptIdentity(entry: StarlightHeadEntry): HeadIdentity {
  const type = getAttributeValue(entry, "type");

  return type === "application/ld+json" ? `script:${type}` : undefined;
}

function getAttributeValue(entry: StarlightHeadEntry, key: string) {
  const value = entry.attrs?.[key];

  return typeof value === "string" ? value : undefined;
}
