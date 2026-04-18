import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  getLandingDevPort,
  LANDING_DEV_SERVER_HOST,
} from "./src/landing-config";
import { createInstallScriptPlugin } from "./src/lib/vite-install-script";

export default defineConfig(({ command }) => {
  const config = {
    plugins: [
      tanstackRouter({
        autoCodeSplitting: true,
        generatedRouteTree: "./src/routeTree.gen.ts",
        routeFileIgnorePattern: "\\.test\\.tsx?$",
        routesDirectory: "./src/routes",
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
