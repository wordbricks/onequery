import { z } from "astro/zod";
import type { SchemaContext } from "astro:content";

import { BLOG_POST_CATEGORIES } from "./blog-taxonomy";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isValidIsoDate(value: string) {
  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().startsWith(value)
  );
}

const dateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN)
  .refine(isValidIsoDate, "Use a real YYYY-MM-DD calendar date.");

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
    publishedAt: dateSchema,
    readTime: z.string().regex(/^\d+ min read$/u),
    title: z.string().min(1),
  });
}
