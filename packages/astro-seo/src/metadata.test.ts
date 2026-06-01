import { describe, expect, it } from "vitest";

import { createSeoHeadEntries, formatKeywords } from "./metadata";

describe("formatKeywords", () => {
  it("normalizes keyword arrays", () => {
    expect(formatKeywords([" OneQuery ", "", "AI agents"])).toBe(
      "OneQuery, AI agents"
    );
  });
});

describe("createSeoHeadEntries", () => {
  it("creates social metadata and escaped JSON-LD script entries", () => {
    const entries = createSeoHeadEntries({
      canonicalUrl: "https://onequery.dev/docs/",
      description: "Docs for governed agent access.",
      image: {
        alt: "OneQuery share image",
        height: 630,
        type: "image/png",
        url: "https://onequery.dev/og.png",
        width: 1200,
      },
      keywords: ["OneQuery docs", "agent data access"],
      openGraph: {
        locale: "en_US",
        siteName: "OneQuery",
        type: "website",
      },
      robots: "index, follow",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "</script>",
      },
      title: "OneQuery Documentation",
    });

    expect(entries).toContainEqual({
      tag: "meta",
      attrs: { name: "keywords", content: "OneQuery docs, agent data access" },
    });
    expect(entries).toContainEqual({
      tag: "meta",
      attrs: { property: "og:image:width", content: "1200" },
    });
    expect(entries).toContainEqual({
      tag: "meta",
      attrs: { name: "twitter:image:alt", content: "OneQuery share image" },
    });

    const script = entries.find((entry) => entry.tag === "script");

    expect(script?.content).toContain("\\u003c/script\\u003e");
  });
});
