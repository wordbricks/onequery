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
