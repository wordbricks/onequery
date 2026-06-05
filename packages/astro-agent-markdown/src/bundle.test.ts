import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AstroIntegrationLogger } from "astro";
import { describe, expect, it, vi } from "vitest";

import { exportAgentMarkdownBundles, getMarkdownFileRoutePath } from "./bundle";

function createLogger(): AstroIntegrationLogger {
  return {
    warn: vi.fn(),
  } as unknown as AstroIntegrationLogger;
}

async function writeMarkdownPage(
  outputDir: string,
  routePath: string,
  markdown: string
) {
  const relativePath =
    routePath === "/"
      ? "index.md"
      : `${routePath.replace(/^\/|\/$/gu, "")}/index.md`;
  const filePath = path.join(outputDir, relativePath);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, markdown);
}

describe("agent Markdown bundles", () => {
  it("normalizes route-shaped Markdown files back to page paths", () => {
    expect(getMarkdownFileRoutePath("index.md")).toBe("/");
    expect(getMarkdownFileRoutePath("docs/index.md")).toBe("/docs/");
    expect(getMarkdownFileRoutePath("docs/guide/index.md")).toBe(
      "/docs/guide/"
    );
    expect(getMarkdownFileRoutePath("agent.md")).toBeUndefined();
  });

  it("generates document bundles and an index file", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-md-"));
    const logger = createLogger();

    await writeMarkdownPage(outputDir, "/", "# OneQuery\n");
    await writeMarkdownPage(outputDir, "/docs/", "# Docs\n");
    await writeMarkdownPage(outputDir, "/docs/guide/", "# Guide\n");
    await writeMarkdownPage(outputDir, "/blog/post/", "# Post\n");
    await writeMarkdownPage(outputDir, "/404/", "# Missing\n");

    const result = await exportAgentMarkdownBundles({
      bundle: {
        documents: [
          {
            description: "Complete agent-readable content.",
            include: [/^\/$/u, /^\/docs(?:\/|$)/u, /^\/blog(?:\/|$)/u],
            promote: [/^\/docs\/guide\/$/u, /^\/$/u],
            title: "Full site",
            url: "/llms-full.txt",
          },
        ],
        index: {
          description: "Agent-readable OneQuery source files.",
          details: "Use these files as canonical OneQuery website context.",
          optionalLinks: [
            {
              description: "Project source",
              label: "GitHub",
              url: "https://github.com/wordbricks/onequery",
            },
          ],
          title: "OneQuery",
        },
      },
      dir: pathToFileURL(`${outputDir}/`),
      logger,
      site: "https://onequery.dev",
    });

    await expect(
      fs.readFile(path.join(outputDir, "llms.txt"), "utf8")
    ).resolves.toContain(
      "- [Full site](https://onequery.dev/llms-full.txt): Complete agent-readable content."
    );

    const fullDocument = await fs.readFile(
      path.join(outputDir, "llms-full.txt"),
      "utf8"
    );

    expect(fullDocument).toContain("# Full site");
    expect(fullDocument).toContain(
      "## Source: https://onequery.dev/docs/guide/"
    );
    expect(fullDocument).toContain("## Source: https://onequery.dev/");
    expect(fullDocument).toContain(
      "## Source: https://onequery.dev/blog/post/"
    );
    expect(fullDocument).not.toContain("# Missing");
    expect(fullDocument.indexOf("# Guide")).toBeLessThan(
      fullDocument.indexOf("# OneQuery")
    );
    expect(result).toEqual({ documentCount: 1, pageCount: 4 });
  });

  it("can write only document files when the index is disabled", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-md-"));

    await writeMarkdownPage(outputDir, "/docs/", "# Docs\n");

    await exportAgentMarkdownBundles({
      bundle: {
        documents: [
          {
            description: "Docs only.",
            include: [/^\/docs\/$/u],
            title: "Docs",
            url: "/agent-docs.txt",
          },
        ],
        index: false,
      },
      dir: pathToFileURL(`${outputDir}/`),
      logger: createLogger(),
    });

    await expect(
      fs.readFile(path.join(outputDir, "agent-docs.txt"), "utf8")
    ).resolves.toContain("# Docs");
    await expect(
      fs.readFile(path.join(outputDir, "llms.txt"), "utf8")
    ).rejects.toThrow();
  });
});
