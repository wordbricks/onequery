import type { MarkdownHeading } from "astro";
import type { z } from "astro/zod";

import type { createBlogPostContentSchema } from "./schema";

export type BlogPostContent = z.infer<
  ReturnType<typeof createBlogPostContentSchema>
>;

export type BlogPost = BlogPostContent & {
  body: string;
  date: string;
  headings: readonly MarkdownHeading[];
  readTime: string;
  slug: string;
};

export type BlogPostSummary = Pick<
  BlogPost,
  | "category"
  | "coverImage"
  | "date"
  | "description"
  | "publishedAt"
  | "readTime"
  | "slug"
  | "title"
>;
