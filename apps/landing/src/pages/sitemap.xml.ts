import type { APIRoute } from "astro";

import { blogPostSummaries } from "../landing/blog/blog-posts";
import {
  normalizeSiteUrl,
  toIsoDateTime,
} from "../landing/seo/structured-data";

export const prerender = true;

type SitemapEntry = {
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  lastmod?: string;
  loc: string;
  priority?: string;
};

export const GET: APIRoute = ({ site }) => {
  const siteUrl = normalizeSiteUrl(site);
  const entries: SitemapEntry[] = [
    {
      changefreq: "weekly",
      loc: `${siteUrl}/`,
      priority: "1.0",
    },
    {
      changefreq: "weekly",
      loc: `${siteUrl}/blog`,
      priority: "0.8",
    },
    ...blogPostSummaries.map((post) => ({
      changefreq: "monthly" as const,
      lastmod: toIsoDateTime(post.publishedAt)?.slice(0, 10),
      loc: `${siteUrl}/blog/${post.slug}`,
      priority: "0.7",
    })),
  ];

  return new Response(renderSitemap(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
};

function renderSitemap(entries: SitemapEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(renderSitemapEntry).join("\n")}
</urlset>
`;
}

function renderSitemapEntry(entry: SitemapEntry) {
  return `  <url>
    <loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}${entry.changefreq ? `\n    <changefreq>${entry.changefreq}</changefreq>` : ""}${entry.priority ? `\n    <priority>${entry.priority}</priority>` : ""}
  </url>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
