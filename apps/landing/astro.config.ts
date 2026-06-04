import { fileURLToPath } from "node:url";

import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";
import partytown from "@astrojs/partytown";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { agentMarkdown } from "@onequery/astro-agent-markdown/astro";
import { defineConfig, envField, fontProviders } from "astro/config";
import { visualizer } from "rollup-plugin-visualizer";

import { remarkReadingTime } from "./src/features/blog/remark-reading-time";
import {
  DEFAULT_DEV_PORT,
  DEV_SERVER_HOST,
  REPOSITORY_URL,
} from "./src/shared/config/site";

const BUNDLE_REPORT_TEMPLATES = ["markdown", "list", "raw-data"] as const;
const BUNDLE_REPORT_TEMPLATE_SET = new Set<string>(BUNDLE_REPORT_TEMPLATES);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SITE_URL = "https://onequery.dev";

type BundleReportTemplate = (typeof BUNDLE_REPORT_TEMPLATES)[number];

function isBundleReportTemplate(
  template: string
): template is BundleReportTemplate {
  return BUNDLE_REPORT_TEMPLATE_SET.has(template);
}

function getBundleReportTemplate(): BundleReportTemplate {
  const template = process.env.ONEQUERY_BUNDLE_REPORT_TEMPLATE ?? "markdown";

  if (isBundleReportTemplate(template)) {
    return template;
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
  });
}

export default defineConfig({
  adapter: cloudflare({
    imageService: { build: "compile", runtime: "cloudflare-binding" },
    prerenderEnvironment: "workerd",
  }),
  build: {
    // Let Astro externalize shared Starlight CSS instead of duplicating it in
    // every docs HTML payload.
    inlineStylesheets: "auto",
  },
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
  env: {
    schema: {
      LANDING_SLACK_WEBHOOK_URL: envField.string({
        access: "secret",
        context: "server",
        optional: true,
      }),
    },
  },
  experimental: {
    queuedRendering: {
      enabled: true,
    },
    rustCompiler: true,
  },
  integrations: [
    partytown({
      config: {
        forward: ["dataLayer.push"],
      },
    }),
    react(),
    starlight({
      description:
        "Documentation for setting up and operating OneQuery's governed agent access layer.",
      // Keep the existing marketing 404 route; Starlight otherwise injects one too.
      disable404Route: true,
      editLink: {
        baseUrl: `${REPOSITORY_URL}/edit/main/apps/landing/`,
      },
      favicon: "/favicon-96x96.png",
      logo: {
        alt: "OneQuery",
        src: "/src/assets/onequery-icon.svg",
      },
      routeMiddleware: "./src/starlightRouteData.ts",
      sidebar: [
        {
          items: ["docs", "docs/getting-started"],
          label: "Start Here",
        },
        {
          items: [{ autogenerate: { directory: "docs/concepts" } }],
          label: "Concepts",
        },
        {
          items: [{ autogenerate: { directory: "docs/guide" } }],
          label: "Guide",
        },
        {
          items: [{ autogenerate: { directory: "docs/integrations" } }],
          label: "Integrations",
        },
        {
          items: [{ autogenerate: { directory: "docs/examples" } }],
          label: "Examples",
        },
        {
          items: [{ autogenerate: { directory: "docs/operations" } }],
          label: "Operations",
        },
        {
          items: [{ autogenerate: { directory: "docs/security" } }],
          label: "Security",
        },
        {
          items: [{ autogenerate: { directory: "docs/reference" } }],
          label: "Reference",
        },
        {
          items: [{ autogenerate: { directory: "docs/support" } }],
          label: "Support",
        },
      ],
      social: [
        {
          href: REPOSITORY_URL,
          icon: "github",
          label: "GitHub",
        },
      ],
      title: "OneQuery Docs",
    }),
    mdx(),
    sitemap({
      changefreq: "daily",
      priority: 0.7,
    }),
    agentMarkdown({
      bundle: {
        documents: [
          {
            description:
              "Complete Markdown export of OneQuery marketing, connector, comparison, blog, and documentation pages for agent ingestion.",
            include: [
              /^\/$/u,
              /^\/blog(?:\/|$)/u,
              /^\/compare(?:\/|$)/u,
              /^\/connectors(?:\/|$)/u,
              /^\/docs(?:\/|$)/u,
            ],
            promote: [
              /^\/$/u,
              /^\/docs\/$/u,
              /^\/docs\/getting-started\/$/u,
              /^\/connectors\/$/u,
              /^\/compare\/$/u,
              /^\/blog\/$/u,
            ],
            title: "OneQuery Full Site Markdown",
            url: "/llms-full.txt",
          },
          {
            description:
              "Focused Markdown export of core OneQuery product, setup, source, and safety pages for smaller agent contexts.",
            include: [
              /^\/$/u,
              /^\/connectors\/$/u,
              /^\/docs\/$/u,
              /^\/docs\/getting-started\/$/u,
              /^\/docs\/guide\/(?:install-cli|connect-source|run-query|source-api|agent-tool-setup)\/$/u,
              /^\/docs\/concepts\/(?:governed-access|query-boundaries|source-identifiers|audit-history)\/$/u,
              /^\/docs\/security\/(?:security-architecture|data-handling|cost-limits)\/$/u,
              /^\/docs\/operations\/(?:self-host|credential-management|audit-review)\/$/u,
              /^\/blog\/(?:llm-safe-data-access-layer|do-not-give-agents-production-keys|debug-production-agent-runs-with-onequery)\/$/u,
            ],
            promote: [
              /^\/$/u,
              /^\/docs\/getting-started\/$/u,
              /^\/docs\/guide\/install-cli\/$/u,
              /^\/docs\/guide\/connect-source\/$/u,
              /^\/docs\/guide\/run-query\/$/u,
            ],
            title: "OneQuery Essential Agent Markdown",
            url: "/llms-small.txt",
          },
        ],
        index: {
          description:
            "Agent-readable Markdown exports for OneQuery, a governed production context layer for AI agents.",
          details:
            "Use these files as canonical public context for OneQuery product positioning, setup guidance, connector coverage, safety model, and operating documentation.",
          notes:
            "- The generated Markdown is derived from the public OneQuery landing site at build time.\n- Prefer the smaller export for concise answers and the full export for retrieval or long-context ingestion.",
          optionalLinks: [
            {
              description: "Source repository for OneQuery.",
              label: "GitHub repository",
              url: REPOSITORY_URL,
            },
            {
              description: "Installable OneQuery CLI package.",
              label: "npm package",
              url: "https://www.npmjs.com/package/@onequery/cli",
            },
            {
              description: "Search engine sitemap for public pages.",
              label: "Sitemap",
              url: "/sitemap-index.xml",
            },
          ],
          title: "OneQuery",
        },
      },
      content: [
        {
          collection: "blog",
          routePrefix: "/blog",
        },
        {
          collection: "compare",
          routePrefix: "/compare",
        },
      ],
    }),
  ],
  markdown: {
    remarkPlugins: [remarkReadingTime],
  },
  server: {
    host: DEV_SERVER_HOST,
    port: DEFAULT_DEV_PORT,
  },
  site: SITE_URL,
  // Cloudflare normalizes extensionless page URLs with trailing slashes in
  // production, so keep Astro's generated route shape aligned with the edge.
  trailingSlash: "always",
  vite: {
    optimizeDeps: {
      exclude: ["@nanostores/react"],
    },
    plugins: [
      // Bundle reports are opt-in so internal analyzer HTML is not published
      // as a crawlable page.
      ...(process.env.ONEQUERY_BUNDLE_REPORT === "1"
        ? [createBundleReportPlugin()]
        : []),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
      dedupe: ["react", "react-dom"],
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
