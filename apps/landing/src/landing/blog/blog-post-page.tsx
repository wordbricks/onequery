import { Link } from "@tanstack/react-router";

import { SiteFooter, SiteHeader } from "./blog-page";
import { blogPosts } from "./blog-posts";
import type { BlogPost } from "./blog-posts";

function getPostSections(post: BlogPost) {
  if (post.sections) {
    return post.sections;
  }

  return [
    {
      id: "why-it-matters",
      paragraphs: [post.body[0]],
      title: "Why it matters",
    },
    {
      id: "how-it-works",
      paragraphs: [post.body[1]],
      title: "How it works",
    },
    {
      id: "what-comes-next",
      paragraphs: [
        "The next step is making these workflows easier to inspect while they are running. Teams should be able to see the current state, the pending decision, and the artifact that will be reviewed before anything changes.",
      ],
      title: "What comes next",
    },
  ];
}

export function BlogPostPage({ post }: { post: BlogPost }) {
  const sections = getPostSections(post);
  const relatedPosts = blogPosts
    .filter(
      (relatedPost) =>
        relatedPost.slug !== post.slug && relatedPost.category === post.category
    )
    .slice(0, 3);
  const fallbackRelatedPosts = blogPosts
    .filter((relatedPost) => relatedPost.slug !== post.slug)
    .slice(0, 3);
  const visibleRelatedPosts =
    relatedPosts.length > 0 ? relatedPosts : fallbackRelatedPosts;

  return (
    <div className="page-shell blog-shell">
      <SiteHeader />

      <main className="blog-post-main">
        <article id="top">
          <header className="blog-post-header">
            <div className="blog-breadcrumb">
              <Link to="/blog">Blog</Link>
              <span aria-hidden="true">/</span>
              <span>{post.category}</span>
            </div>
            <p className="blog-post-date">
              {post.date} <span aria-hidden="true">-</span> {post.category}
            </p>
            <h1>{post.title}</h1>
          </header>

          <div className="blog-post-byline">
            <span>OneQuery Maintainers</span>
            <span aria-hidden="true">-</span>
            <span>{post.readTime}</span>
          </div>

          <div className="blog-post-layout">
            <aside className="blog-post-toc">
              <h2>Table of Contents</h2>
              <nav>
                <a href="#top">Up</a>
                {sections.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>
                    {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="blog-post-body">
              <p className="blog-post-deck">{post.description}</p>
              {sections.map((section) => (
                <section key={section.id} id={section.id}>
                  <h2>{section.title}</h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </article>

        <section className="blog-related">
          <h2>Related posts</h2>
          <div className="blog-related-grid">
            {visibleRelatedPosts.map((relatedPost) => (
              <Link
                key={relatedPost.slug}
                to="/blog/$postSlug"
                params={{ postSlug: relatedPost.slug }}
              >
                <span>
                  {relatedPost.date} - {relatedPost.category}
                </span>
                <h3>{relatedPost.title}</h3>
                <p>
                  {relatedPost.readTime} <span aria-hidden="true">→</span>
                </p>
              </Link>
            ))}
          </div>
          <Link to="/blog" className="blog-more-link">
            View more posts <span aria-hidden="true">→</span>
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
