import { describe, expect, it } from "vitest";

import { blogPostSummaries } from "../blog/blog-post-summaries";
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
    const summary = blogPostSummaries[0];

    if (!summary) {
      throw new Error("Expected at least one blog post summary");
    }

    const post: BlogPost = {
      ...summary,
      body: ["Body paragraph"],
      sections: [
        {
          id: "evidence-loop",
          paragraphs: ["Evidence paragraph"],
          title: "Evidence loop",
        },
      ],
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
