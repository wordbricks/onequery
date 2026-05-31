import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "./html-to-markdown";

describe("htmlToMarkdown", () => {
  it("exports the readable body content as Markdown", () => {
    expect(
      htmlToMarkdown(`<!doctype html>
        <html>
          <head>
            <style>body { color: red; }</style>
            <title>Ignored</title>
          </head>
          <body>
            <main>
              <h1>OneQuery</h1>
              <p>Give agents <strong>context</strong>, not keys.</p>
              <ul><li>No prod keys</li><li>Full audit</li></ul>
              <p><a href="/connectors/">Data sources</a></p>
            </main>
            <script>console.log("ignored")</script>
          </body>
        </html>`)
    ).toBe(`# OneQuery

Give agents **context**, not keys.

- No prod keys
- Full audit

[Data sources](/connectors/)
`);
  });

  it("converts tables to GitHub-flavored Markdown tables", () => {
    expect(
      htmlToMarkdown(`<table>
        <thead><tr><th>Source</th><th>Capability</th></tr></thead>
        <tbody><tr><td>PostgreSQL</td><td>Query | read-only</td></tr></tbody>
      </table>`)
    ).toBe(`| Source | Capability |
| --- | --- |
| PostgreSQL | Query \\| read-only |
`);
  });

  it("drops empty icon links after unreadable nodes are removed", () => {
    expect(
      htmlToMarkdown(`<main>
        <a href="/docs/">Docs <svg aria-hidden="true"></svg></a>
        <a href="https://github.com/wordbricks/onequery" aria-label="GitHub">
          <svg aria-hidden="true"></svg>
        </a>
      </main>`)
    ).toBe("[Docs](/docs/)\n");
  });

  it("prefers main content over Starlight navigation chrome", () => {
    expect(
      htmlToMarkdown(`<!doctype html>
        <html>
          <body>
            <header><a href="/">OneQuery Docs</a></header>
            <nav>
              <a href="/docs/">Overview</a>
              <a href="/docs/getting-started/">Getting Started</a>
            </nav>
            <main>
              <h1>Getting Started</h1>
              <div class="sl-heading-wrapper level-h2">
                <h2 id="install">Install</h2>
                <a class="sl-anchor-link" href="#install">
                  <span aria-hidden="true">#</span>
                  <span class="sr-only">Section titled “Install”</span>
                </a>
              </div>
              <p>Install OneQuery and run one governed query.</p>
              <figure>
                <figcaption><span class="sr-only">Terminal window</span></figcaption>
                <pre><code>onequery --version</code></pre>
              </figure>
            </main>
            <aside>On this page</aside>
            <footer>Previous Next</footer>
          </body>
        </html>`)
    ).toBe(
      [
        "# Getting Started",
        "",
        "## Install",
        "",
        "Install OneQuery and run one governed query.",
        "",
        "```",
        "onequery --version",
        "```",
        "",
      ].join("\n")
    );
  });
});
