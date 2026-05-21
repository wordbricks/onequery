import { Fragment } from "react";

import { SiteFooter, SiteHeader } from "./blog-page";
import { blogPostSummaries } from "./blog-posts";
import type { BlogPost, BlogPostSection } from "./blog-posts";

function getPostSections(post: BlogPost): BlogPostSection[] {
  if (post.sections) {
    return post.sections;
  }

  return [
    {
      id: "why-it-matters",
      paragraphs: [post.body[0] ?? ""],
      title: "Why it matters",
    },
    {
      id: "how-it-works",
      paragraphs: [post.body[1] ?? ""],
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

const URL_PATTERN = /(https?:\/\/[^\s.]+(?:\.[^\s.]+)*[^\s.,)])/g;

function renderParagraphWithLinks(paragraph: string) {
  const parts = paragraph.split(URL_PATTERN);

  return parts.map((part) => {
    if (!part.match(URL_PATTERN)) {
      return part;
    }

    return (
      <a key={part} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    );
  });
}

function renderSectionImage(section: BlogPostSection) {
  if (!section.imageSrc) {
    return null;
  }

  const className =
    section.imagePlacement === "after-title"
      ? "blog-post-figure blog-post-figure-after-title"
      : "blog-post-figure";

  return (
    <figure className={className}>
      <img src={section.imageSrc} alt={section.imageAlt ?? ""} />
    </figure>
  );
}

function renderSectionImages(section: BlogPostSection) {
  if (!section.images?.length) {
    return null;
  }

  return section.images.map((image) => (
    <figure className="blog-post-figure" key={image.src}>
      <img src={image.src} alt={image.alt} />
    </figure>
  ));
}

function renderInlineSectionImages(
  section: BlogPostSection,
  beforeParagraphIndex: number
) {
  const images = section.inlineImages?.filter(
    (image) => image.beforeParagraphIndex === beforeParagraphIndex
  );

  if (!images?.length) {
    return null;
  }

  return images.map((image) => (
    <figure
      className="blog-post-figure blog-post-figure-inline"
      key={image.src}
    >
      <img src={image.src} alt={image.alt} />
    </figure>
  ));
}

function renderSectionTable(section: BlogPostSection) {
  if (!section.table) {
    return null;
  }

  return (
    <div className="blog-post-table-wrap">
      <table className="blog-post-table">
        <thead>
          <tr>
            {section.table.headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.table.rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell) => (
                <td key={cell}>{renderParagraphWithLinks(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BlogPostPage({ post }: { post: BlogPost }) {
  const sections = getPostSections(post);
  const relatedPosts = blogPostSummaries
    .filter(
      (relatedPost) =>
        relatedPost.slug !== post.slug && relatedPost.category === post.category
    )
    .slice(0, 3);
  const fallbackRelatedPosts = blogPostSummaries
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
              <a href="/blog">Blog</a>
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
                  {section.imagePlacement === "after-title"
                    ? renderSectionImage(section)
                    : null}
                  {section.paragraphs.map((paragraph, paragraphIndex) => (
                    <Fragment key={paragraph}>
                      {renderInlineSectionImages(section, paragraphIndex)}
                      <p>{renderParagraphWithLinks(paragraph)}</p>
                    </Fragment>
                  ))}
                  {renderSectionTable(section)}
                  {renderSectionImages(section)}
                  {section.imagePlacement !== "after-title"
                    ? renderSectionImage(section)
                    : null}
                </section>
              ))}
            </div>
          </div>
        </article>

        <section className="blog-related">
          <h2>Related posts</h2>
          <div className="blog-related-grid">
            {visibleRelatedPosts.map((relatedPost) => (
              <a key={relatedPost.slug} href={`/blog/${relatedPost.slug}`}>
                <span>
                  {relatedPost.date} - {relatedPost.category}
                </span>
                <h3>{relatedPost.title}</h3>
                <p>
                  {relatedPost.readTime} <span aria-hidden="true">→</span>
                </p>
              </a>
            ))}
          </div>
          <a href="/blog" className="blog-more-link">
            View more posts <span aria-hidden="true">→</span>
          </a>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
