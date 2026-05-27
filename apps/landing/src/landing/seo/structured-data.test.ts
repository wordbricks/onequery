import type { ImageMetadata } from "astro";
import { describe, expect, it } from "vitest";

import type { BlogPost } from "../blog/blog-types";
import { NPM_PACKAGE_URL } from "../config/landing-config";
import {
  createBlogPostStructuredData,
  createCanonicalUrl,
  createLandingPageStructuredData,
} from "./structured-data";

describe("createCanonicalUrl", () => {
  it("normalizes page and endpoint URLs for public SEO links", () => {
    expect(createCanonicalUrl("/blog")).toBe("https://onequery.dev/blog/");
    expect(createCanonicalUrl("/sitemap.xml")).toBe(
      "https://onequery.dev/sitemap.xml"
    );
  });
});

describe("createLandingPageStructuredData", () => {
  it("emits landing-page schema with npm as the install target", () => {
    const schema = createLandingPageStructuredData({
      description: "Landing description",
      imageAlt: "OneQuery share image",
      imageUrl: "/og.png",
      title: "OneQuery",
      video: {
        contentUrl: "/_astro/openclaw-demo-video.hash.mp4",
        description: "Demo video description",
        duration: "PT20S",
        name: "OneQuery OpenClaw agent access demo",
        pageUrl: "https://onequery.dev/#demo",
        thumbnailHeight: 900,
        thumbnailUrl: "/_astro/openclaw-demo-poster.hash.avif",
        thumbnailWidth: 1400,
        uploadDate: "2026-05-22T00:00:00.000Z",
      },
    });
    const graph = schema["@graph"];

    expect(Array.isArray(graph)).toBe(true);
    expect(graph).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "@type": "VideoObject",
          "@id": "https://onequery.dev/#demo-video",
          contentUrl:
            "https://onequery.dev/_astro/openclaw-demo-video.hash.mp4",
        }),
        expect.objectContaining({
          "@type": "WebPage",
          hasPart: {
            "@id": "https://onequery.dev/#demo-video",
          },
          significantLink: expect.arrayContaining([NPM_PACKAGE_URL]),
          video: {
            "@id": "https://onequery.dev/#demo-video",
          },
        }),
        expect.objectContaining({
          "@type": "SoftwareApplication",
          installUrl: NPM_PACKAGE_URL,
        }),
      ])
    );
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
                "https://onequery.dev/blog/debug-production-agent-runs-with-onequery/#evidence-loop",
              name: "Evidence loop",
            }),
          ],
        }),
      ])
    );
  });
});
