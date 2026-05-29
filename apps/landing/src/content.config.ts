import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

import { createBlogPostContentSchema } from "./landing/blog/blog-content-schema";

const blog = defineCollection({
  loader: glob({
    base: "./src/content/blog",
    pattern: "**/*.mdx",
    retainBody: true,
  }),
  schema: createBlogPostContentSchema,
});

export const collections = { blog };
