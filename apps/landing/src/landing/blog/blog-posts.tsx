import { blogCategories, thumbnailCells } from "./blog-constants";
import { blogPostSummaries } from "./blog-post-summaries";
import type {
  BlogCategory,
  BlogPost,
  BlogPostSection,
  BlogPostSummary,
} from "./blog-types";

export type { BlogCategory, BlogPost, BlogPostSection, BlogPostSummary };
export { blogCategories, blogPostSummaries, thumbnailCells };

const blogPostLoaders = {
  "context-enrichment-with-onequery": () =>
    import("./posts/context-enrichment-with-onequery").then(
      (module) => module.contextEnrichmentWithOneQueryPost
    ),
  "do-not-give-agents-production-keys": () =>
    import("./posts/do-not-give-agents-production-keys").then(
      (module) => module.doNotGiveAgentsProductionKeysPost
    ),
  "how-startups-can-build-an-in-house-data-agent": () =>
    import("./posts/how-startups-can-build-an-in-house-data-agent").then(
      (module) => module.howStartupsCanBuildAnInHouseDataAgentPost
    ),
  "llm-safe-data-access-layer": () =>
    import("./posts/llm-safe-data-access-layer").then(
      (module) => module.llmSafeDataAccessLayerPost
    ),
  "making-data-source-setup-boring": () =>
    import("./posts/making-data-source-setup-boring").then(
      (module) => module.makingDataSourceSetupBoringPost
    ),
  "using-llm-telemetry-to-improve-prompts-with-gepa": () =>
    import("./posts/using-llm-telemetry-to-improve-prompts-with-gepa").then(
      (module) => module.usingLlmTelemetryToImprovePromptsWithGepaPost
    ),
} satisfies Record<string, () => Promise<BlogPost>>;

type BlogPostSlug = keyof typeof blogPostLoaders;

function isBlogPostSlug(slug: string): slug is BlogPostSlug {
  return slug in blogPostLoaders;
}

export function comparePostDates(
  left: Pick<BlogPostSummary, "date">,
  right: Pick<BlogPostSummary, "date">
) {
  return Date.parse(right.date) - Date.parse(left.date);
}

export function getBlogPostSummaryBySlug(slug: string) {
  return blogPostSummaries.find((post) => post.slug === slug);
}

export async function loadBlogPostBySlug(slug: string) {
  if (!isBlogPostSlug(slug)) {
    return undefined;
  }

  return blogPostLoaders[slug]();
}
