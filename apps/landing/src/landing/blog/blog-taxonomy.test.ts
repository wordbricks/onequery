import { describe, expect, it } from "vitest";

import {
  getBlogCategoryFilters,
  getBlogIndexPath,
  getPopulatedBlogPostCategories,
} from "./blog-taxonomy";

describe("blog taxonomy", () => {
  const posts = [
    { category: "Safety" },
    { category: "Product" },
    { category: "Safety" },
    { category: "Usecase" },
  ] as const;

  it("builds category inventory from populated post categories only", () => {
    expect(getPopulatedBlogPostCategories(posts)).toEqual([
      "Product",
      "Safety",
      "Usecase",
    ]);
  });

  it("keeps the all-posts filter while excluding empty category filters", () => {
    expect(getBlogCategoryFilters(posts)).toEqual([
      "All",
      "Product",
      "Safety",
      "Usecase",
    ]);
  });

  it("returns only canonical blog index paths", () => {
    expect(getBlogIndexPath({ category: "All" })).toBe("/blog");
    expect(getBlogIndexPath({ category: "Product" })).toBe(
      "/blog/category/product"
    );
  });
});
