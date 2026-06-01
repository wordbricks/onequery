import type { ImageMetadata } from "astro";
import { describe, expect, it } from "vitest";

import type { BlogPost } from "@/features/blog/types";
import {
  DATA_SOURCE_CONNECTORS,
  getConnectorFaqs,
  getRelatedConnectors,
} from "@/features/connectors/data";
import { NPM_PACKAGE_URL } from "@/shared/config/site";

import {
  createBlogPostStructuredData,
  createCanonicalUrl,
  createConnectorIndexStructuredData,
  createConnectorPageStructuredData,
  createHomePageStructuredData,
} from "./schema";

function getConnector(key: string) {
  const connector = DATA_SOURCE_CONNECTORS.find(
    (candidate) => candidate.key === key
  );

  if (!connector) {
    throw new Error(`Expected connector "${key}" to exist.`);
  }

  return connector;
}

describe("createCanonicalUrl", () => {
  it("normalizes page and endpoint URLs for public SEO links", () => {
    expect(createCanonicalUrl("/blog")).toBe("https://onequery.dev/blog/");
    expect(createCanonicalUrl("/sitemap.xml")).toBe(
      "https://onequery.dev/sitemap.xml"
    );
  });
});

describe("createHomePageStructuredData", () => {
  it("emits landing-page schema with npm as the install target", () => {
    const schema = createHomePageStructuredData({
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

describe("createConnectorIndexStructuredData", () => {
  it("emits CollectionPage and ItemList schema for connector discovery", () => {
    const connectors = DATA_SOURCE_CONNECTORS.slice(0, 2);
    const schema = createConnectorIndexStructuredData({
      connectors,
      description: "Supported OneQuery connectors.",
      title: "OneQuery Connectors",
    });
    const graph = schema["@graph"];

    expect(Array.isArray(graph)).toBe(true);
    expect(graph).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "@type": "CollectionPage",
          "@id": "https://onequery.dev/connectors/#webpage",
        }),
        expect.objectContaining({
          "@type": "ItemList",
          "@id": "https://onequery.dev/connectors/#connectors",
          numberOfItems: connectors.length,
          itemListElement: expect.arrayContaining([
            expect.objectContaining({
              item: expect.objectContaining({
                "@id": "https://onequery.dev/connectors/postgresql/#connector",
                name: "OneQuery PostgreSQL connector",
              }),
            }),
          ]),
        }),
      ])
    );
  });
});

describe("createConnectorPageStructuredData", () => {
  it("emits connector WebPage, FAQPage, and setup checklist schema", () => {
    const connector = getConnector("ga");
    const schema = createConnectorPageStructuredData({
      connector,
      description: "Use the Google Analytics connector in OneQuery.",
      faqs: getConnectorFaqs(connector),
      relatedConnectors: getRelatedConnectors(connector),
      title: "Google Analytics Connector | OneQuery",
    });
    const graph = schema["@graph"];

    expect(Array.isArray(graph)).toBe(true);
    expect(graph).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "@type": "WebPage",
          "@id": "https://onequery.dev/connectors/google-analytics/#webpage",
          mainEntity: {
            "@id":
              "https://onequery.dev/connectors/google-analytics/#connector",
          },
        }),
        expect.objectContaining({
          "@type": "SoftwareApplication",
          "@id": "https://onequery.dev/connectors/google-analytics/#connector",
          name: "OneQuery Google Analytics connector",
        }),
        expect.objectContaining({
          "@type": "FAQPage",
          "@id": "https://onequery.dev/connectors/google-analytics/#faq",
          mainEntity: expect.arrayContaining([
            expect.objectContaining({
              "@type": "Question",
            }),
          ]),
        }),
        expect.objectContaining({
          "@type": "ItemList",
          "@id":
            "https://onequery.dev/connectors/google-analytics/#setup-checklist",
          numberOfItems: connector.guideSteps.length,
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
      body: "## Evidence loop\n\nEvidence paragraph",
      category: "Engineering",
      coverImage: {
        alt: "Debugging production on Cloudflare with Codex cover image.",
        src: coverImage,
      },
      date: "May 6, 2026",
      description:
        "How Codex can use OneQuery-connected Cloudflare logs to inspect production failures, separate evidence from guesses, and make targeted code changes.",
      headings: [
        {
          depth: 2,
          slug: "evidence-loop",
          text: "Evidence loop",
        },
      ],
      publishedAt: "2026-05-06",
      readTime: "7 min read",
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
