import { ONEQUERY } from "@/shared/seo/constants";
import {
  createBlogIndexStructuredData,
  createCanonicalUrl,
} from "@/shared/seo/schema";

import { comparePostDates, getBlogPostSummaries } from "./collection";
import { getBlogShareImagesBySlug } from "./images";
import { getBlogCategoryFilters, getBlogIndexPath } from "./taxonomy";
import type { BlogCategoryFilter } from "./taxonomy";

const BLOG_INDEX_TITLE = `${ONEQUERY.BLOG_NAME} | Governed Data Access for AI Agents`;
const BLOG_INDEX_DESCRIPTION =
  "Notes from the OneQuery team on production data access, AI agent safety, telemetry, and operational workflows.";
const BLOG_INDEX_KEYWORDS = `${ONEQUERY.NAME} blog, AI agent safety, governed data access, production data access, LLM telemetry, data agent workflows`;

function getCategorySeoLabel(category: BlogCategoryFilter) {
  return category === "Usecase" ? "use case" : category.toLowerCase();
}

function getBlogIndexTitle(category: BlogCategoryFilter) {
  if (category === "All") {
    return BLOG_INDEX_TITLE;
  }

  return `${category} Articles | ${ONEQUERY.BLOG_NAME}`;
}

function getBlogIndexDescription(category: BlogCategoryFilter) {
  if (category === "All") {
    return BLOG_INDEX_DESCRIPTION;
  }

  const categoryLabel = getCategorySeoLabel(category);

  return `Read ${ONEQUERY.NAME} ${categoryLabel} articles on governed data access for AI agents, production context, telemetry, and operational workflows.`;
}

function getBlogIndexKeywords(category: BlogCategoryFilter) {
  return category === "All"
    ? BLOG_INDEX_KEYWORDS
    : `${BLOG_INDEX_KEYWORDS}, ${category}, ${ONEQUERY.NAME} ${getCategorySeoLabel(category)} articles`;
}

function getBlogIndexBreadcrumbName(category: BlogCategoryFilter) {
  if (category === "All") {
    return "Blog";
  }

  return category;
}

export async function getBlogIndexPage(input: {
  category: BlogCategoryFilter;
  site?: string | URL | null;
}) {
  const allPosts = await getBlogPostSummaries();
  const posts = allPosts
    .filter(
      (post) => input.category === "All" || post.category === input.category
    )
    .toSorted(comparePostDates);
  const pagePath = getBlogIndexPath(input);
  const title = getBlogIndexTitle(input.category);
  const description = getBlogIndexDescription(input.category);
  const postImages = await getBlogShareImagesBySlug(posts, input.site);

  return {
    activeCategory: input.category,
    canonicalUrl: createCanonicalUrl(pagePath, input.site),
    categories: getBlogCategoryFilters(allPosts),
    description,
    keywords: getBlogIndexKeywords(input.category),
    posts,
    structuredData: createBlogIndexStructuredData({
      breadcrumbName: getBlogIndexBreadcrumbName(input.category),
      description,
      itemListName:
        input.category === "All"
          ? ONEQUERY.BLOG_POSTS_ITEM_LIST_NAME
          : `${ONEQUERY.NAME} ${input.category} articles`,
      pathname: pagePath,
      postImages,
      posts,
      site: input.site,
      title,
    }),
    title,
  };
}
