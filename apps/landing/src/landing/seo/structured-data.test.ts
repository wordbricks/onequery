import type { ImageMetadata } from "astro";
import { describe, expect, it } from "vitest";

import type { BlogPost } from "../blog/blog-types";
import { createBlogPostStructuredData, toIsoDateTime } from "./structured-data";

describe("toIsoDateTime", () => {
  it("converts canonical publication dates to UTC date-time output", () => {
    expect(toIsoDateTime("2026-05-06")).toBe("2026-05-06T00:00:00.000Z");
    expect(toIsoDateTime("2026-04-21")).toBe("2026-04-21T00:00:00.000Z");
  });

  it("does not parse display dates", () => {
    expect(toIsoDateTime("May 6, 2026")).toBeUndefined();
  });

  it("rejects invalid calendar dates", () => {
    expect(toIsoDateTime("2026-02-31")).toBeUndefined();
  });
});

describe("createBlogPostStructuredData", () => {
  it("emits BlogPosting schema from existing post fields", () => {
    const coverImage = {
      format: "png",
      height: 630,
      src: "/_astro/debug-production-agent-runs-with-onequery-icon.png",
      width: 1200,
    } as ImageMetadata;
    const post: BlogPost = {
      category: "Engineering",
      coverImage: {
        alt: "Debugging production on Cloudflare with Codex cover image.",
        src: coverImage,
      },
      date: "May 6, 2026",
      description:
        "How Codex can use OneQuery-connected Cloudflare logs to inspect production failures, separate evidence from guesses, and make targeted code changes.",
      publishedAt: "2026-05-06",
      readTime: "7 min read",
      sections: [
        {
          id: "evidence-loop",
          images: [],
          inlineImages: [],
          paragraphs: ["Evidence paragraph"],
          title: "Evidence loop",
        },
      ],
      slug: "debug-production-agent-runs-with-onequery",
      title: "Debugging production on Cloudflare with Codex.",
    };
    const schema = createBlogPostStructuredData(post);
    const graph = schema["@graph"];

    expect(Array.isArray(graph)).toBe(true);
    expect(graph).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "@type": "BlogPosting",
          headline: post.title,
          datePublished: "2026-05-06T00:00:00.000Z",
          articleSection: post.category,
          hasPart: [
            expect.objectContaining({
              "@id":
                "https://onequery.dev/blog/debug-production-agent-runs-with-onequery#evidence-loop",
              name: "Evidence loop",
            }),
          ],
        }),
      ])
    );
  });
});
