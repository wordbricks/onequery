import { fileURLToPath } from "node:url";

import cloudflare from "@astrojs/cloudflare";
import partytown from "@astrojs/partytown";
import react from "@astrojs/react";
import { defineConfig, envField, fontProviders } from "astro/config";
import { visualizer } from "rollup-plugin-visualizer";
import { loadEnv } from "vite";

import {
  DEFAULT_DEV_PORT,
  DEV_SERVER_HOST,
} from "./src/landing/config/landing-config";

const BUNDLE_REPORT_TEMPLATES = ["markdown", "list", "raw-data"] as const;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
// `astro:env` is unavailable in config files, so use Vite's loadEnv only
// to avoid registering Partytown when GTM is not configured.
const BUILD_ENV = loadEnv(
  process.env.NODE_ENV ?? "development",
  process.cwd(),
  "PUBLIC_"
);
const HAS_GOOGLE_TAG_MANAGER_ID = Boolean(
  BUILD_ENV.PUBLIC_GOOGLE_TAG_MANAGER_ID?.trim()
);

type BundleReportTemplate = (typeof BUNDLE_REPORT_TEMPLATES)[number];

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
  build: {
    // Keep page CSS out of a separate render-blocking request for first-load LCP.
    inlineStylesheets: "always",
  },
  prefetch: {
    defaultStrategy: "hover",
  },
  env: {
    schema: {
      PUBLIC_GOOGLE_TAG_MANAGER_ID: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
    },
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
  integrations: [
    ...(HAS_GOOGLE_TAG_MANAGER_ID
      ? [
          partytown({
            config: {
              forward: ["dataLayer.push"],
            },
          }),
        ]
      : []),
    react(),
  ],
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
