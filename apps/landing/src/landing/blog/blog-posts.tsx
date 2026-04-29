import { blogCategories, thumbnailCells } from "./blog-constants";
import type { BlogCategory, BlogPost, BlogPostSection } from "./blog-types";
import { doNotGiveAgentsProductionKeysPost } from "./posts/do-not-give-agents-production-keys";
import { howStartupsCanBuildAnInHouseDataAgentPost } from "./posts/how-startups-can-build-an-in-house-data-agent";
import { makingDataSourceSetupBoringPost } from "./posts/making-data-source-setup-boring";

export type { BlogCategory, BlogPost, BlogPostSection };
export { blogCategories, thumbnailCells };

export const blogPosts: BlogPost[] = [
  doNotGiveAgentsProductionKeysPost,
  howStartupsCanBuildAnInHouseDataAgentPost,
  makingDataSourceSetupBoringPost,
];

export function comparePostDates(left: BlogPost, right: BlogPost) {
  return Date.parse(right.date) - Date.parse(left.date);
}

export function getBlogPostBySlug(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}
