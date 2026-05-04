import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

import {
  DEFAULT_DEV_PORT,
  DEV_SERVER_HOST,
} from "./src/landing/config/landing-config";
import { createInstallScriptPlugin } from "./src/tooling/vite-install-script";

const BUNDLE_REPORT_TEMPLATES = ["markdown", "list", "raw-data"] as const;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

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

function createBundleReportPlugin(): Plugin {
  const template = getBundleReportTemplate();
  const plugin = visualizer({
    brotliSize: true,
    filename: getBundleReportFilename(template),
    gzipSize: true,
    projectRoot: REPOSITORY_ROOT,
    template,
  }) as unknown as Plugin;

  return {
    ...plugin,
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
  };
}

export default defineConfig(({ command }) => {
  const isVitest = process.env.VITEST === "true";
  const shouldBuildBundleReport = process.env.ONEQUERY_BUNDLE_REPORT === "1";
  const config = {
    environments: {
      client: {
        build: {
          outDir: "dist/client",
        },
      },
    },
    plugins: [
      tanstackRouter({
        autoCodeSplitting: true,
        generatedRouteTree: "./src/app/routeTree.gen.ts",
        routeFileIgnorePattern: "\\.test\\.tsx?$",
        routesDirectory: "./src/app/routes",
        target: "react",
      }),
      react(),
      babel({
        presets: [reactCompilerPreset()],
      }),
      createInstallScriptPlugin(),
      // Comment: Vitest injects `resolve.external`, which the Cloudflare Vite
      // plugin rejects for Worker environments. Tests only need the client-side
      // Vite pipeline, so keep the Worker runtime integration for dev/build.
      ...(isVitest ? [] : [cloudflare()]),
      ...(shouldBuildBundleReport ? [createBundleReportPlugin()] : []),
    ],
  };

  if (command !== "serve") {
    return config;
  }

  return {
    ...config,
    server: {
      host: DEV_SERVER_HOST,
      // Comment: the Cloudflare Vite plugin runs the worker inside the Vite
      // dev server, so landing RPC stays same-origin without a separate proxy.
      // Comment: keep the default port here and let Vite's native `--port`
      // handling override it when a local workflow needs a different port.
      port: DEFAULT_DEV_PORT,
      strictPort: true,
      allowedHosts: ["localhost", "host.docker.internal"],
    },
  };
});
