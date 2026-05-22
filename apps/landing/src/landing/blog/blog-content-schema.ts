import { z } from "astro/zod";
import type { SchemaContext } from "astro:content";

import { BLOG_POST_CATEGORIES } from "./blog-taxonomy";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SECTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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
const blogPostTableSchema = z
  .object({
    headers: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string()).min(1)).min(1),
  })
  .superRefine((table, context) => {
    for (const [rowIndex, row] of table.rows.entries()) {
      if (row.length !== table.headers.length) {
        context.addIssue({
          code: "custom",
          message: "Table rows must match header count.",
          path: ["rows", rowIndex],
        });
      }
    }
  });

function createBlogImageSchema({ image }: SchemaContext) {
  return z.object({
    alt: z.string().min(1),
    src: image(),
  });
}

function createBlogPostSectionSchema(context: SchemaContext) {
  const blogImageSchema = createBlogImageSchema(context);

  return z
    .object({
      id: z.string().regex(SECTION_ID_PATTERN),
      image: blogImageSchema.optional(),
      imagePlacement: z.enum(["after-title", "after-paragraphs"]).optional(),
      images: z.array(blogImageSchema).default([]),
      inlineImages: z
        .array(
          blogImageSchema.extend({
            beforeParagraphIndex: z.number().int().nonnegative(),
          })
        )
        .default([]),
      paragraphs: z.array(z.string()),
      table: blogPostTableSchema.optional(),
      title: z.string(),
    })
    .superRefine((section, context) => {
      if (section.imagePlacement && !section.image) {
        context.addIssue({
          code: "custom",
          message: "Image placement requires a section image.",
          path: ["imagePlacement"],
        });
      }

      if (
        section.paragraphs.length === 0 &&
        !section.table &&
        !section.image &&
        section.images.length === 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Sections need paragraphs, a table, or an image.",
          path: ["paragraphs"],
        });
      }
    });
}

export function createBlogPostContentSchema(context: SchemaContext) {
  const blogImageSchema = createBlogImageSchema(context);
  const blogPostSectionSchema = createBlogPostSectionSchema(context);

  return z.object({
    category: z.enum(BLOG_POST_CATEGORIES),
    coverImage: blogImageSchema,
    description: z.string().min(1),
    publishedAt: dateSchema,
    readTime: z.string().regex(/^\d+ min read$/u),
    sections: z.array(blogPostSectionSchema).min(1),
    title: z.string().min(1),
  });
}
