import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AstroIntegrationLogger } from "astro";
import { describe, expect, it } from "vitest";

import { exportHtmlMarkdownSidecars, getHtmlRoutePath } from "./html-sidecars";

function createLogger(): AstroIntegrationLogger {
  return {
    warn: () => undefined,
  } as unknown as AstroIntegrationLogger;
}

describe("HTML Markdown sidecars", () => {
  it("normalizes generated HTML asset paths to route paths", () => {
    expect(getHtmlRoutePath("index.html")).toBe("/");
    expect(getHtmlRoutePath("connectors/index.html")).toBe("/connectors/");
    expect(getHtmlRoutePath("404.html")).toBe("/404/");
    expect(getHtmlRoutePath("hello.world/index.html")).toBe("/hello.world/");
  });

  it("exports Markdown sidecars for generated HTML pages", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "html-md-"));

    await fs.mkdir(path.join(outputDir, "connectors"), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, "index.html"),
      "<main><h1>OneQuery</h1><p>Context, not keys.</p></main>"
    );
    await fs.writeFile(
      path.join(outputDir, "connectors/index.html"),
      "<main><h1>Connectors</h1><p>Bring your data.</p></main>"
    );
    await fs.writeFile(
      path.join(outputDir, "404.html"),
      "<main><h1>Not found</h1></main>"
    );

    const count = await exportHtmlMarkdownSidecars({
      assets: new Map([
        [
          "/",
          [
            pathToFileURL(path.join(outputDir, "index.html")),
            pathToFileURL(path.join(outputDir, "connectors/index.html")),
            pathToFileURL(path.join(outputDir, "404.html")),
          ],
        ],
      ]),
      dir: pathToFileURL(`${outputDir}/`),
      exclude: [/^\/404(?:\/|$)/u],
      logger: createLogger(),
    });

    await expect(
      fs.readFile(path.join(outputDir, "index.md"), "utf8")
    ).resolves.toContain("# OneQuery");
    await expect(
      fs.readFile(path.join(outputDir, "connectors/index.md"), "utf8")
    ).resolves.toContain("# Connectors");
    await expect(
      fs.readFile(path.join(outputDir, "404.md"), "utf8")
    ).rejects.toThrow();
    expect(count).toBe(2);
  });

  it("does not overwrite content collection Markdown sidecars", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "html-md-"));
    const blogDir = path.join(outputDir, "blog/post");

    await fs.mkdir(blogDir, { recursive: true });
    await fs.writeFile(
      path.join(blogDir, "index.html"),
      "<main><h1>Rendered Blog</h1></main>"
    );
    await fs.writeFile(path.join(blogDir, "index.md"), "# Source Blog\n");

    const count = await exportHtmlMarkdownSidecars({
      assets: new Map([
        ["/blog/[post]", [pathToFileURL(path.join(blogDir, "index.html"))]],
      ]),
      dir: pathToFileURL(`${outputDir}/`),
      logger: createLogger(),
    });

    await expect(
      fs.readFile(path.join(blogDir, "index.md"), "utf8")
    ).resolves.toBe("# Source Blog\n");
    expect(count).toBe(0);
  });
});
