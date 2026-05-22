export const BLOG_POST_CATEGORIES = [
  "Product",
  "Engineering",
  "Safety",
  "Usecase",
  "Research",
] as const;

export const BLOG_CATEGORY_FILTERS = ["All", ...BLOG_POST_CATEGORIES] as const;
export const BLOG_SORT_DIRECTIONS = ["Latest", "Oldest"] as const;

export type BlogPostCategory = (typeof BLOG_POST_CATEGORIES)[number];
export type BlogCategoryFilter = (typeof BLOG_CATEGORY_FILTERS)[number];
export type BlogSortDirection = (typeof BLOG_SORT_DIRECTIONS)[number];

const BLOG_CATEGORY_SLUGS = {
  Engineering: "engineering",
  Product: "product",
  Research: "research",
  Safety: "safety",
  Usecase: "usecase",
} as const satisfies Record<BlogPostCategory, string>;

export function getBlogCategorySlug(category: BlogPostCategory) {
  return BLOG_CATEGORY_SLUGS[category];
}

export function getBlogIndexPath(input: {
  category: BlogCategoryFilter;
  sortDirection?: BlogSortDirection;
}) {
  const sortDirection = input.sortDirection ?? "Latest";

  if (input.category === "All") {
    return sortDirection === "Latest" ? "/blog" : "/blog/archive";
  }

  const categoryPath = `/blog/category/${getBlogCategorySlug(input.category)}`;

  return sortDirection === "Latest" ? categoryPath : `${categoryPath}/archive`;
}
