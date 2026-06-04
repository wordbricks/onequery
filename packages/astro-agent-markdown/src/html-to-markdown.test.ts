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

  it("prefers main content over page chrome", () => {
    expect(
      htmlToMarkdown(`<!doctype html>
        <html>
          <body>
            <header><a href="/">Home</a></header>
            <main><h1>Docs</h1><p>Canonical page content.</p></main>
            <footer><a href="/contact/">Contact</a></footer>
          </body>
        </html>`)
    ).toBe(`# Docs

Canonical page content.
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
});
