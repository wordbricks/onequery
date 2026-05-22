import { z } from "astro/zod";

import { BLOG_POST_CATEGORIES } from "./blog-taxonomy";

const BLOG_IMAGE_PATH_PATTERN =
  /^\/images\/blog\/[a-z0-9-]+\.(?:avif|jpeg|jpg|png|webp)$/u;
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
const blogImagePathSchema = z.string().regex(BLOG_IMAGE_PATH_PATTERN);
const blogImageSchema = z.object({
  alt: z.string(),
  src: blogImagePathSchema,
});
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

const blogPostSectionSchema = z
  .object({
    id: z.string().regex(SECTION_ID_PATTERN),
    imageAlt: z.string().optional(),
    imagePlacement: z.enum(["after-title", "after-paragraphs"]).optional(),
    imageSrc: blogImagePathSchema.optional(),
    inlineImages: z
      .array(
        blogImageSchema.extend({
          beforeParagraphIndex: z.number().int().nonnegative(),
        })
      )
      .optional(),
    images: z.array(blogImageSchema).optional(),
    paragraphs: z.array(z.string()),
    table: blogPostTableSchema.optional(),
    title: z.string(),
  })
  .superRefine((section, context) => {
    if (
      section.paragraphs.length === 0 &&
      !section.table &&
      !section.imageSrc &&
      !section.images?.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Sections need paragraphs, a table, or an image.",
        path: ["paragraphs"],
      });
    }
  });

export const blogPostContentSchema = z.object({
  category: z.enum(BLOG_POST_CATEGORIES),
  description: z.string().min(1),
  imageSrc: blogImagePathSchema,
  publishedAt: dateSchema,
  readTime: z.string().regex(/^\d+ min read$/u),
  sections: z.array(blogPostSectionSchema).min(1),
  title: z.string().min(1),
});
