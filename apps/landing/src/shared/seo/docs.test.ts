import { describe, expect, it } from "vitest";

import {
  DOCS_INDEX_DESCRIPTION,
  DOCS_INDEX_TITLE,
  createDocsIndexHeadEntries,
} from "./docs";

describe("createDocsIndexHeadEntries", () => {
  it("creates reusable docs index SEO head entries", () => {
    const entries = createDocsIndexHeadEntries();

    expect(entries).toContainEqual({
      tag: "title",
      content: DOCS_INDEX_TITLE,
    });
    expect(entries).toContainEqual({
      tag: "meta",
      attrs: {
        name: "description",
        content: DOCS_INDEX_DESCRIPTION,
      },
    });
    expect(entries).toContainEqual({
      tag: "meta",
      attrs: {
        property: "og:image:width",
        content: "1200",
      },
    });

    const jsonLd = entries.find((entry) => entry.tag === "script");

    expect(jsonLd?.content).toContain(
      '"@id":"https://onequery.dev/docs/#webpage"'
    );
  });
});
