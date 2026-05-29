import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AstroConfig, AstroIntegrationLogger } from "astro";
import { describe, expect, it } from "vitest";

import { exportMarkdownSourceContent } from "./source-content";

function createLogger(): AstroIntegrationLogger {
  return {
    warn: () => undefined,
  } as unknown as AstroIntegrationLogger;
}

describe("exportMarkdownSourceContent", () => {
  it("copies Markdown and MDX source files to route-shaped sidecars", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "markdown-source-"));
    const sourceDirectory = path.join(root, "src/content/blog");
    const outputDir = path.join(root, "dist");

    await fs.mkdir(path.join(sourceDirectory, "nested"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDirectory, "hello.mdx"),
      "---\ntitle: Hello\n---\n\n## Hello\n"
    );
    await fs.writeFile(
      path.join(sourceDirectory, "nested/index.md"),
      "# Nested\n"
    );

    const exportedCount = await exportMarkdownSourceContent({
      config: {
        root: pathToFileURL(`${root}/`),
      } as AstroConfig,
      logger: createLogger(),
      outputDir,
      source: {
        routePrefix: "/blog",
        sourceDirectory: "src/content/blog",
      },
    });

    await expect(
      fs.readFile(path.join(outputDir, "blog/hello/index.md"), "utf8")
    ).resolves.toContain("## Hello");
    await expect(
      fs.readFile(path.join(outputDir, "blog/nested/index.md"), "utf8")
    ).resolves.toBe("# Nested\n");
    expect(exportedCount).toBe(2);
  });
});
