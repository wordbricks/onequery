import {
  createBlogIndexStructuredData,
  createCanonicalUrl,
} from "../seo/structured-data";
import { comparePostDates, getBlogPostSummaries } from "./blog-collection";
import { getBlogShareImageMetadataBySlug } from "./blog-images";
import { getBlogIndexPath } from "./blog-taxonomy";
import type { BlogCategoryFilter, BlogSortDirection } from "./blog-taxonomy";

const BLOG_INDEX_TITLE = "OneQuery Blog | Governed Data Access for AI Agents";
const BLOG_INDEX_DESCRIPTION =
  "Notes from the OneQuery team on production data access, AI agent safety, telemetry, and operational workflows.";
const BLOG_INDEX_KEYWORDS =
  "OneQuery blog, AI agent safety, governed data access, production data access, LLM telemetry, data agent workflows";

function getCategorySeoLabel(category: BlogCategoryFilter) {
  return category === "Usecase" ? "use case" : category.toLowerCase();
}

function getBlogIndexTitle(
  category: BlogCategoryFilter,
  sortDirection: BlogSortDirection
) {
  if (category === "All") {
    return sortDirection === "Latest"
      ? BLOG_INDEX_TITLE
      : "OneQuery Blog Archive | Governed Data Access for AI Agents";
  }

  return sortDirection === "Latest"
    ? `${category} Articles | OneQuery Blog`
    : `${category} Article Archive | OneQuery Blog`;
}

function getBlogIndexDescription(
  category: BlogCategoryFilter,
  sortDirection: BlogSortDirection
) {
  if (category === "All") {
    return sortDirection === "Latest"
      ? BLOG_INDEX_DESCRIPTION
      : "Browse the OneQuery blog archive from oldest to newest across production data access, AI agent safety, telemetry, and operations.";
  }

  const categoryLabel = getCategorySeoLabel(category);

  return sortDirection === "Latest"
    ? `Read OneQuery ${categoryLabel} articles on governed data access for AI agents, production context, telemetry, and operational workflows.`
    : `Browse archived OneQuery ${categoryLabel} articles from oldest to newest.`;
}

function getBlogIndexKeywords(category: BlogCategoryFilter) {
  return category === "All"
    ? BLOG_INDEX_KEYWORDS
    : `${BLOG_INDEX_KEYWORDS}, ${category}, OneQuery ${getCategorySeoLabel(category)} articles`;
}

function getBlogIndexBreadcrumbName(
  category: BlogCategoryFilter,
  sortDirection: BlogSortDirection
) {
  if (category === "All") {
    return sortDirection === "Latest" ? "Blog" : "Archive";
  }

  return sortDirection === "Latest" ? category : `${category} Archive`;
}

export async function getBlogIndexPage(input: {
  category: BlogCategoryFilter;
  site?: string | URL | null;
  sortDirection: BlogSortDirection;
}) {
  const posts = (await getBlogPostSummaries())
    .filter(
      (post) => input.category === "All" || post.category === input.category
    )
    .toSorted((left, right) =>
      input.sortDirection === "Latest"
        ? comparePostDates(left, right)
        : comparePostDates(right, left)
    );
  const pagePath = getBlogIndexPath(input);
  const canonicalPath =
    input.sortDirection === "Latest"
      ? pagePath
      : getBlogIndexPath({
          category: input.category,
          sortDirection: "Latest",
        });
  const title = getBlogIndexTitle(input.category, input.sortDirection);
  const description = getBlogIndexDescription(
    input.category,
    input.sortDirection
  );
  const postImages = await getBlogShareImageMetadataBySlug(posts, input.site);

  return {
    activeCategory: input.category,
    canonicalUrl: createCanonicalUrl(canonicalPath, input.site),
    description,
    keywords: getBlogIndexKeywords(input.category),
    posts,
    robots:
      input.sortDirection === "Latest"
        ? undefined
        : "noindex, follow, max-image-preview:large",
    sortDirection: input.sortDirection,
    structuredData: createBlogIndexStructuredData({
      breadcrumbName: getBlogIndexBreadcrumbName(
        input.category,
        input.sortDirection
      ),
      description,
      itemListName:
        input.category === "All"
          ? "OneQuery Blog posts"
          : `OneQuery ${input.category} articles`,
      pathname: pagePath,
      postImages,
      posts,
      site: input.site,
      title,
    }),
    title,
  };
}
