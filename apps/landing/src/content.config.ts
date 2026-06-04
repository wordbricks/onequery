import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

import { createBlogPostContentSchema } from "@/features/blog/schema";
import { createComparisonContentSchema } from "@/features/compare/schema";

const blog = defineCollection({
  loader: glob({
    base: "./src/content/blog",
    pattern: "**/*.mdx",
    retainBody: true,
  }),
  schema: createBlogPostContentSchema,
});

const compare = defineCollection({
  loader: glob({
    base: "./src/content/compare",
    pattern: "**/*.mdx",
    retainBody: true,
  }),
  schema: createComparisonContentSchema,
});

const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema(),
});

export const collections = { blog, compare, docs };
