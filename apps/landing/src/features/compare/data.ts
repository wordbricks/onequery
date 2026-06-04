import type { CollectionEntry } from "astro:content";
import { getCollection } from "astro:content";

import { ONEQUERY } from "@/shared/seo/constants";

import type { ComparisonPage } from "./types";
export type {
  ComparisonCriterion,
  ComparisonFaq,
  ComparisonPage,
  ComparisonReference,
} from "./types";

type ComparisonEntry = CollectionEntry<"compare">;

export function toComparisonPage(entry: ComparisonEntry): ComparisonPage {
  return {
    ...entry.data,
    slug: entry.id,
  };
}

export async function getComparisonEntries(): Promise<ComparisonEntry[]> {
  return (await getCollection("compare")).toSorted(
    (left, right) => left.data.order - right.data.order
  );
}

export async function getComparisonPages(): Promise<ComparisonPage[]> {
  return (await getComparisonEntries()).map(toComparisonPage);
}

export function getComparisonPath(
  comparison: Pick<ComparisonPage, "slug">
): string {
  return `/compare/${comparison.slug}/`;
}

export function getComparisonKeywords(comparison: ComparisonPage): string {
  return [
    ...comparison.keywords,
    ONEQUERY.NAME,
    "AI agent access control",
    "production context without production keys",
    "agent data access audit logs",
  ].join(", ");
}

export function getRelatedComparisons(
  comparison: Pick<ComparisonPage, "slug">,
  comparisons: readonly ComparisonPage[]
): ComparisonPage[] {
  return comparisons
    .filter((candidate) => candidate.slug !== comparison.slug)
    .slice(0, 3);
}
