import type { CollectionEntry } from "astro:content";
import { getCollection, render } from "astro:content";

import type { BlogPost, BlogPostContent, BlogPostSummary } from "./types";

const READ_TIME_PATTERN = /^\d+ min read$/u;
const blogDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

type BlogPostRenderData = {
  headings?: BlogPost["headings"];
  remarkPluginFrontmatter: unknown;
};

function formatBlogPostDate(publishedAt: string) {
  return blogDateFormatter.format(new Date(`${publishedAt}T00:00:00.000Z`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBlogPostReadTime(
  entry: CollectionEntry<"blog">,
  remarkPluginFrontmatter: unknown
) {
  if (!isRecord(remarkPluginFrontmatter)) {
    throw new Error(
      `Blog post "${entry.id}" is missing remark plugin frontmatter.`
    );
  }

  const { readTime } = remarkPluginFrontmatter;

  if (typeof readTime === "string" && READ_TIME_PATTERN.test(readTime)) {
    return readTime;
  }

  throw new Error(
    `Blog post "${entry.id}" is missing a valid remark-generated readTime.`
  );
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
  { headings = [], remarkPluginFrontmatter }: BlogPostRenderData
): BlogPost {
  const data = entry.data as BlogPostContent;

  return {
    ...data,
    body: entry.body ?? "",
    date: formatBlogPostDate(data.publishedAt),
    headings,
    readTime: getBlogPostReadTime(entry, remarkPluginFrontmatter),
    slug: entry.id,
  };
}

export async function getBlogPostEntries(): Promise<CollectionEntry<"blog">[]> {
  return (await getCollection("blog")).toSorted((left, right) =>
    comparePostDates(left.data, right.data)
  );
}

export async function getBlogPosts(): Promise<BlogPost[]> {
  const entries = await getBlogPostEntries();

  return Promise.all(
    entries.map(async (entry) => {
      const { headings, remarkPluginFrontmatter } = await render(entry);

      return toBlogPost(entry, { headings, remarkPluginFrontmatter });
    })
  );
}

export async function getBlogPostSummaries(): Promise<BlogPostSummary[]> {
  return (await getBlogPosts()).map(toBlogPostSummary);
}
