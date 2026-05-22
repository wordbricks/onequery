import type { z } from "astro/zod";

import type { blogPostContentSchema } from "./blog-content-schema";

export type BlogPostContent = z.infer<typeof blogPostContentSchema>;
export type BlogPostSection = BlogPostContent["sections"][number];

export type BlogPost = BlogPostContent & {
  date: string;
  slug: string;
};

export type BlogPostSummary = Pick<
  BlogPost,
  | "category"
  | "date"
  | "description"
  | "imageSrc"
  | "publishedAt"
  | "readTime"
  | "slug"
  | "title"
>;
