import { describe, expect, it } from "vitest";

import {
  contentEntryToMarkdown,
  createContentCollectionStaticPaths,
  getContentEntryMarkdownAssetPath,
  getContentMarkdownForPath,
} from "./content";

describe("content collection Markdown", () => {
  it("reconstructs Markdown from an Astro content entry", async () => {
    const markdown = await contentEntryToMarkdown(
      {
        body: "## Evidence\n",
        data: { title: "Parsed title" },
        id: "debug-production-agent-runs-with-onequery",
      },
      {
        frontmatter: {
          category: "Engineering",
          title: "Debugging production",
        },
      }
    );

    expect(markdown).toBe(`---
category: Engineering
title: Debugging production
---

## Evidence
`);
  });

  it("falls back to rendered HTML when a loader does not retain source body", async () => {
    await expect(
      contentEntryToMarkdown({
        data: { title: "Rendered entry" },
        id: "rendered-entry",
        rendered: {
          html: "<main><h2>Rendered</h2><p>HTML body.</p></main>",
        },
      })
    ).resolves.toBe(`---
title: Rendered entry
---

## Rendered

HTML body.
`);
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

  it("finds a content entry by negotiated page pathname", async () => {
    await expect(
      getContentMarkdownForPath({
        contentCollections: [
          {
            getEntries: async () => [
              {
                body: "## Evidence\n",
                id: "debug-production-agent-runs-with-onequery",
              },
            ],
            routePrefix: "/blog",
          },
        ],
        pathname: "/blog/debug-production-agent-runs-with-onequery/",
      })
    ).resolves.toBe("## Evidence\n");
  });
});
