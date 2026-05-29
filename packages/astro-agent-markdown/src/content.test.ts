import { describe, expect, it } from "vitest";

import {
  contentEntryToMarkdown,
  createContentCollectionStaticPaths,
  getContentEntryIdForMarkdownPath,
  getContentEntryMarkdownAssetPath,
  getContentMarkdownForPath,
} from "./content";

describe("content collection Markdown", () => {
  it("reconstructs Markdown from source body and frontmatter", () => {
    const markdown = contentEntryToMarkdown({
      body: "## Evidence\n",
      frontmatter: {
        category: "Engineering",
        title: "Debugging production",
      },
    });

    expect(markdown).toBe(`---
category: Engineering
title: Debugging production
---

## Evidence
`);
  });

  it("omits frontmatter when the source has no frontmatter fields", () => {
    expect(
      contentEntryToMarkdown({
        body: "## Evidence",
        frontmatter: {},
      })
    ).toBe("## Evidence\n");
  });

  it("creates Astro static paths from collection entry ids", () => {
    expect(
      createContentCollectionStaticPaths([
        { id: "/nested/hello/" },
        { id: "debug-production-agent-runs-with-onequery" },
      ])
    ).toEqual([
      {
        params: { agentMarkdownSlug: "nested/hello" },
        props: { entry: { id: "/nested/hello/" } },
      },
      {
        params: {
          agentMarkdownSlug: "debug-production-agent-runs-with-onequery",
        },
        props: { entry: { id: "debug-production-agent-runs-with-onequery" } },
      },
    ]);
  });

  it("maps content entry ids to route-shaped Markdown assets", () => {
    expect(
      getContentEntryMarkdownAssetPath({
        entry: { id: "debug-production-agent-runs-with-onequery" },
        routePrefix: "/blog",
      })
    ).toBe("/blog/debug-production-agent-runs-with-onequery/index.md");
  });

  it("maps a Markdown asset path back to a content entry id", () => {
    expect(
      getContentEntryIdForMarkdownPath({
        markdownPath:
          "/blog/debug-production-agent-runs-with-onequery/index.md",
        routePrefix: "/blog",
      })
    ).toBe("debug-production-agent-runs-with-onequery");
  });

  it("finds a content entry by negotiated page pathname", async () => {
    await expect(
      getContentMarkdownForPath({
        contentRoutes: [
          {
            getMarkdown: async (entryId) =>
              entryId === "debug-production-agent-runs-with-onequery"
                ? "## Evidence\n"
                : undefined,
            routePrefix: "/blog",
          },
        ],
        pathname: "/blog/debug-production-agent-runs-with-onequery/",
      })
    ).resolves.toBe("## Evidence\n");
  });
});
