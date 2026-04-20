import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  getLandingDevPort,
  LANDING_DEV_SERVER_HOST,
} from "./src/landing/config/landing-config";
// Comment: keep Vite-only helpers under `src/tooling` instead of `src/build`;
// the repo-wide `.gitignore` treats nested `build/` directories as outputs.
import { createInstallScriptPlugin } from "./src/tooling/vite-install-script";

export default defineConfig(({ command }) => {
  const config = {
    plugins: [
      tanstackRouter({
        autoCodeSplitting: true,
        generatedRouteTree: "./src/app/routeTree.gen.ts",
        routeFileIgnorePattern: "\\.test\\.tsx?$",
        routesDirectory: "./src/app/routes",
        target: "react",
      }),
      react(),
      createInstallScriptPlugin(),
    ],
    build: {
      outDir: "dist/client",
    },
  };

  if (command !== "serve") {
    return config;
  }

  return {
    ...config,
    server: {
      host: LANDING_DEV_SERVER_HOST,
      port: getLandingDevPort(),
      strictPort: true,
    },
  };
});
