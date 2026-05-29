import { getCollection } from "astro:content";
import type { CollectionEntry } from "astro:content";

import type { BlogPost, BlogPostContent, BlogPostSummary } from "./blog-types";

const blogDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function formatBlogPostDate(publishedAt: string) {
  return blogDateFormatter.format(new Date(`${publishedAt}T00:00:00.000Z`));
}

export function comparePostDates(
  left: Pick<BlogPostSummary, "publishedAt">,
  right: Pick<BlogPostSummary, "publishedAt">
) {
  return right.publishedAt.localeCompare(left.publishedAt);
}

function toBlogPostSummary(post: BlogPost): BlogPostSummary {
  return {
    category: post.category,
    coverImage: post.coverImage,
    date: post.date,
    description: post.description,
    publishedAt: post.publishedAt,
    readTime: post.readTime,
    slug: post.slug,
    title: post.title,
  };
}

export function toBlogPost(
  entry: CollectionEntry<"blog">,
  headings: BlogPost["headings"] = []
): BlogPost {
  const data = entry.data as BlogPostContent;

  return {
    ...data,
    body: entry.body ?? "",
    date: formatBlogPostDate(data.publishedAt),
    headings,
    slug: entry.id,
  };
}

export async function getBlogPostEntries(): Promise<CollectionEntry<"blog">[]> {
  return (await getCollection("blog")).toSorted((left, right) =>
    comparePostDates(left.data, right.data)
  );
}

export async function getBlogPosts(): Promise<BlogPost[]> {
  return (await getBlogPostEntries()).map((entry) => toBlogPost(entry));
}

export async function getBlogPostSummaries(): Promise<BlogPostSummary[]> {
  return (await getBlogPosts()).map(toBlogPostSummary);
}
