import { useState } from "react";

import { REPOSITORY_URL } from "../config/landing-config";
import { BRAND_ICON_PATHS } from "../content/brand-icon-paths";
import {
  blogCategories,
  blogPostSummaries,
  comparePostDates,
} from "./blog-posts";
import type { BlogCategory } from "./blog-posts";
import { BlogThumbnail } from "./blog-thumbnail";

function SiteHeader() {
  return (
    <header className="site-header">
      <a href="/" className="brand-mark" aria-label="OneQuery landing homepage">
        <img
          src="/onequery-icon.png"
          alt=""
          aria-hidden="true"
          className="brand-mark-icon"
        />
        <span>OneQuery</span>
      </a>

      <nav className="site-nav" aria-label="Primary">
        <a href="/">Product</a>
        <a href="/blog">Blog</a>
      </nav>

      <div className="header-actions">
        <a
          className="header-github-link"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open OneQuery GitHub repository"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="header-github-link-icon"
          >
            <path d={BRAND_ICON_PATHS.github} fill="currentColor" />
          </svg>
        </a>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>OneQuery</p>
      <div className="footer-links">
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
    </footer>
  );
}

export function BlogPage() {
  const [activeCategory, setActiveCategory] = useState<BlogCategory>("All");
  const [sortDirection, setSortDirection] = useState<"Latest" | "Oldest">(
    "Latest"
  );
  const filteredPosts = blogPostSummaries
    .filter(
      (post) => activeCategory === "All" || post.category === activeCategory
    )
    .toSorted((left, right) =>
      sortDirection === "Latest"
        ? comparePostDates(left, right)
        : comparePostDates(right, left)
    );

  return (
    <div className="page-shell blog-shell">
      <SiteHeader />

      <main className="blog-main">
        <section className="blog-index-hero">
          <p className="eyebrow">OneQuery</p>
          <h1>Blog</h1>
          <nav aria-label="Blog categories" className="blog-categories">
            {blogCategories.map((category) => (
              <button
                key={category}
                type="button"
                className={
                  activeCategory === category
                    ? "blog-category blog-category-active"
                    : "blog-category"
                }
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </nav>
        </section>

        <section className="blog-toolbar" aria-label="Blog filters">
          <button type="button" className="blog-toolbar-button">
            Filter
          </button>
          <label className="blog-toolbar-button">
            <span>Sort</span>
            <select
              value={sortDirection}
              onChange={(event) =>
                setSortDirection(
                  event.currentTarget.value as typeof sortDirection
                )
              }
            >
              <option>Latest</option>
              <option>Oldest</option>
            </select>
          </label>
        </section>

        <section>
          <div className="blog-grid">
            {filteredPosts.map((post) => (
              <article key={post.slug} className="blog-card">
                <a href={`/blog/${post.slug}`}>
                  <BlogThumbnail post={post} />
                  <div className="blog-card-meta">
                    <span>{post.category}</span>
                    <span aria-hidden="true">/</span>
                    <span>{post.date}</span>
                  </div>
                  <h2>{post.title}</h2>
                  <p>{post.description}</p>
                  <span className="blog-card-read-more">
                    {post.readTime}
                    <span aria-hidden="true">→</span>
                  </span>
                </a>
              </article>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

export { SiteFooter, SiteHeader };
