import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

import { blogPostContentSchema } from "./landing/blog/blog-content-schema";

const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.json" }),
  schema: blogPostContentSchema,
});

export const collections = { blog };
