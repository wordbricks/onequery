import type { BlogPostSummary } from "./blog-types";

export const blogPostSummaries: BlogPostSummary[] = [
  {
    category: "Engineering",
    date: "May 6, 2026",
    description:
      "How Codex can use OneQuery-connected Cloudflare logs to inspect production failures, separate evidence from guesses, and make targeted code changes.",
    imageSrc: "/images/blog/debug-production-agent-runs-with-onequery-icon.png",
    publishedAt: "2026-05-06",
    readTime: "7 min read",
    slug: "debug-production-agent-runs-with-onequery",
    thumbnail: "blog-thumbnail-teal",
    title: "Debugging production on Cloudflare with Codex.",
  },
  {
    category: "Engineering",
    date: "May 1, 2026",
    description:
      "A practical workflow for implementing the context enrichment layer described in OpenAI's in-house data agent writeup with schema facts, bounded SQL evidence, and code references.",
    imageSrc: "/images/blog/context-enrichment-with-onequery-icon.png",
    publishedAt: "2026-05-01",
    readTime: "10 min read",
    slug: "context-enrichment-with-onequery",
    thumbnail: "blog-thumbnail-teal",
    title: "Context Enrichment with OneQuery",
  },
  {
    category: "Safety",
    date: "Apr 30, 2026",
    description:
      "How OneQuery gives LLMs a safe, auditable data access layer without handing them raw production credentials.",
    imageSrc: "/images/blog/llm-safe-data-access-layer-icon.png",
    publishedAt: "2026-04-30",
    readTime: "8 min read",
    slug: "llm-safe-data-access-layer",
    thumbnail: "blog-thumbnail-teal",
    title: "A Safe Data Access Layer for LLMs",
  },
  {
    category: "Usecase",
    date: "Apr 30, 2026",
    description:
      "A practical workflow for using OneQuery to let a GEPA reflection agent inspect Laminar LLM telemetry while improving prompts.",
    imageSrc:
      "/images/blog/using-llm-telemetry-to-improve-prompts-with-gepa-icon.png",
    publishedAt: "2026-04-30",
    readTime: "9 min read",
    slug: "using-llm-telemetry-to-improve-prompts-with-gepa",
    thumbnail: "blog-thumbnail-emerald",
    title: "Using LLM telemetry to improve prompts with GEPA",
  },
  {
    category: "Safety",
    date: "Apr 29, 2026",
    description:
      "Why autonomous agents should never hold raw production access, and how OneQuery removes that class of risk from data workflows.",
    imageSrc: "/images/blog/do-not-give-agents-production-keys-icon.png",
    publishedAt: "2026-04-29",
    readTime: "9 min read",
    slug: "do-not-give-agents-production-keys",
    thumbnail: "blog-thumbnail-sage",
    title: "Do not give agents the keys to production",
  },
  {
    category: "Product",
    date: "Apr 28, 2026",
    description:
      "A practical startup playbook for turning an AI data agent from a risky demo into a safe, contextual, auditable workflow.",
    imageSrc:
      "/images/blog/how-startups-can-build-an-in-house-data-agent-icon.png",
    publishedAt: "2026-04-28",
    readTime: "10 min read",
    slug: "how-startups-can-build-an-in-house-data-agent",
    thumbnail: "blog-thumbnail-rose",
    title: "How startups can build an in-house data agent",
  },
  {
    category: "Product",
    date: "Apr 21, 2026",
    description:
      "Replacing one-off connector setup with a predictable path for every database and analytics source.",
    imageSrc: "/images/blog/making-data-source-setup-boring-icon.png",
    publishedAt: "2026-04-21",
    readTime: "7 min read",
    slug: "making-data-source-setup-boring",
    thumbnail: "blog-thumbnail-emerald",
    title: "Making data source setup boring",
  },
];
