import { cloudflare } from "@cloudflare/vite-plugin";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  getLandingDevPort,
  LANDING_DEV_SERVER_HOST,
} from "./src/landing/config/landing-config";
import { createInstallScriptPlugin } from "./src/tooling/vite-install-script";

export default defineConfig(({ command }) => {
  const isVitest = process.env.VITEST === "true";
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
    ],
  };

  if (command !== "serve") {
    return config;
  }

  return {
    ...config,
    server: {
      host: LANDING_DEV_SERVER_HOST,
      // Comment: the Cloudflare Vite plugin runs the worker inside the Vite
      // dev server, so landing RPC stays same-origin without a separate proxy.
      port: getLandingDevPort(),
      strictPort: true,
      allowedHosts: ["localhost", "host.docker.internal"],
    },
  };
});
