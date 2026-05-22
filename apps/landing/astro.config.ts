import { readdirSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig, fontProviders } from "astro/config";
import { visualizer } from "rollup-plugin-visualizer";

import {
  BLOG_POST_CATEGORIES,
  getBlogCategorySlug,
} from "./src/landing/blog/blog-taxonomy";
import type { BlogPostCategory } from "./src/landing/blog/blog-taxonomy";
import {
  DEFAULT_DEV_PORT,
  DEV_SERVER_HOST,
} from "./src/landing/config/landing-config";

const BUNDLE_REPORT_TEMPLATES = ["markdown", "list", "raw-data"] as const;
const BLOG_CONTENT_DIRECTORY = new URL("./src/content/blog/", import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PERMANENT_REDIRECT_STATUS = 308;

type BundleReportTemplate = (typeof BUNDLE_REPORT_TEMPLATES)[number];
type RedirectConfig = {
  destination: string;
  status: typeof PERMANENT_REDIRECT_STATUS;
};

function isBlogPostCategory(category: string): category is BlogPostCategory {
  return BLOG_POST_CATEGORIES.includes(category as BlogPostCategory);
}

function getBlogRedirectInventory() {
  const categories = new Set<BlogPostCategory>();
  const postSlugs = readdirSync(BLOG_CONTENT_DIRECTORY)
    .filter((filename) => extname(filename) === ".json")
    .map((filename) => {
      const postContent = JSON.parse(
        readFileSync(new URL(filename, BLOG_CONTENT_DIRECTORY), "utf-8")
      ) as { category?: string };

      if (postContent.category && isBlogPostCategory(postContent.category)) {
        categories.add(postContent.category);
      }

      return basename(filename, ".json");
    })
    .toSorted();

  const categorySlugs = BLOG_POST_CATEGORIES.filter((category) =>
    categories.has(category)
  ).map(getBlogCategorySlug);

  return { categorySlugs, postSlugs };
}

function createRedirectConfig(destination: string): RedirectConfig {
  return {
    destination,
    status: PERMANENT_REDIRECT_STATUS,
  };
}

function createCanonicalRedirects(): Record<string, RedirectConfig> {
  const { categorySlugs, postSlugs } = getBlogRedirectInventory();

  return {
    "/index.html": createRedirectConfig("/"),
    "/blog/index.html": createRedirectConfig("/blog/"),
    "/connectors/index.html": createRedirectConfig("/connectors/"),
    ...Object.fromEntries(
      postSlugs.map((postSlug) => [
        `/blog/${postSlug}/index.html`,
        createRedirectConfig(`/blog/${postSlug}/`),
      ])
    ),
    ...Object.fromEntries(
      categorySlugs.map((categorySlug) => [
        `/blog/category/${categorySlug}/index.html`,
        createRedirectConfig(`/blog/category/${categorySlug}/`),
      ])
    ),
  };
}

function getBundleReportTemplate(): BundleReportTemplate {
  const template = process.env.ONEQUERY_BUNDLE_REPORT_TEMPLATE ?? "markdown";

  if (BUNDLE_REPORT_TEMPLATES.includes(template as BundleReportTemplate)) {
    return template as BundleReportTemplate;
  }

  throw new Error(
    `Unsupported ONEQUERY_BUNDLE_REPORT_TEMPLATE "${template}". Use markdown, list, or raw-data.`
  );
}

function getBundleReportFilename(template: BundleReportTemplate) {
  switch (template) {
    case "list":
      return ".reports/landing-bundle.yml";
    case "raw-data":
      return ".reports/landing-bundle.json";
    case "markdown":
      return ".reports/landing-bundle.md";
  }
}

function createBundleReportPlugin() {
  const template = getBundleReportTemplate();

  return visualizer({
    brotliSize: true,
    filename: getBundleReportFilename(template),
    gzipSize: true,
    projectRoot: REPOSITORY_ROOT,
    template,
  }) as never;
}

export default defineConfig({
  adapter: cloudflare({
    imageService: { build: "compile", runtime: "cloudflare-binding" },
  }),
  fonts: [
    {
      cssVariable: "--font-geist",
      name: "Geist",
      provider: fontProviders.google(),
      styles: ["normal"],
      subsets: ["latin"],
      weights: ["400 700"],
    },
  ],
  integrations: [react()],
  // Astro's Cloudflare redirect output does not preserve a useful dynamic
  // /index.html alias rule here, so expand the finite SEO inventory instead.
  redirects: createCanonicalRedirects(),
  server: {
    host: DEV_SERVER_HOST,
    port: DEFAULT_DEV_PORT,
  },
  site: "https://onequery.dev",
  // Cloudflare normalizes extensionless page URLs with trailing slashes in
  // production, so keep Astro's generated route shape aligned with the edge.
  trailingSlash: "always",
  vite: {
    optimizeDeps: {
      exclude: ["@nanostores/react"],
    },
    plugins: [
      visualizer({
        emitFile: true,
        filename: "stats.html",
      }) as never,
      ...(process.env.ONEQUERY_BUNDLE_REPORT === "1"
        ? [createBundleReportPlugin()]
        : []),
    ],
    resolve: {
      dedupe: ["react", "react-dom", "remotion"],
    },
    server: {
      allowedHosts: ["localhost", "host.docker.internal"],
      strictPort: true,
    },
    ssr: {
      noExternal: ["@nanostores/react"],
    },
  },
});
