import { z } from "astro/zod";
import type { SchemaContext } from "astro:content";

import { BLOG_POST_CATEGORIES } from "./taxonomy";

function createBlogImageSchema({ image }: SchemaContext) {
  return z.object({
    alt: z.string().min(1),
    src: image(),
  });
}

export function createBlogPostContentSchema(context: SchemaContext) {
  const blogImageSchema = createBlogImageSchema(context);

  return z.object({
    category: z.enum(BLOG_POST_CATEGORIES),
    coverImage: blogImageSchema,
    description: z.string().min(1),
    publishedAt: z.iso.date(),
    readTime: z.string().regex(/^\d+ min read$/u),
    title: z.string().min(1),
  });
}
