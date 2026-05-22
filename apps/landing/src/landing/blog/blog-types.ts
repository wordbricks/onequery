import type { z } from "astro/zod";

import type { createBlogPostContentSchema } from "./blog-content-schema";

export type BlogPostContent = z.infer<
  ReturnType<typeof createBlogPostContentSchema>
>;
export type BlogPostSection = BlogPostContent["sections"][number];

export type BlogPost = BlogPostContent & {
  date: string;
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
