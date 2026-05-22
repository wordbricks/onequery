export const BLOG_POST_CATEGORIES = [
  "Product",
  "Engineering",
  "Safety",
  "Usecase",
  "Research",
] as const;

export const BLOG_CATEGORY_FILTERS = ["All", ...BLOG_POST_CATEGORIES] as const;

export type BlogPostCategory = (typeof BLOG_POST_CATEGORIES)[number];
export type BlogCategoryFilter = (typeof BLOG_CATEGORY_FILTERS)[number];

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

export function getBlogIndexPath(input: { category: BlogCategoryFilter }) {
  if (input.category === "All") {
    return "/blog";
  }

  return `/blog/category/${getBlogCategorySlug(input.category)}`;
}

export function getPopulatedBlogPostCategories(
  posts: readonly { readonly category: BlogPostCategory }[]
) {
  const categories = new Set(posts.map((post) => post.category));

  return BLOG_POST_CATEGORIES.filter((category) => categories.has(category));
}

export function getBlogCategoryFilters(
  posts: readonly { readonly category: BlogPostCategory }[]
): BlogCategoryFilter[] {
  return ["All", ...getPopulatedBlogPostCategories(posts)];
}
