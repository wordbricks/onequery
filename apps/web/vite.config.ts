import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolveViteDevServerConfig } from "./src/lib/vite-dev-server-config";

const isE2E = process.env.ONEQUERY_E2E === "1";

export default defineConfig(() => {
  const { apiProxyTarget, port } = resolveViteDevServerConfig(process.env);

  return {
    define: {
      "globalThis.__ONEQUERY_E2E__": JSON.stringify(isE2E),
    },
    plugins: [
      tanstackRouter({
        autoCodeSplitting: true,
        generatedRouteTree: "./src/routeTree.gen.ts",
        routeFileIgnorePattern: "\\.test\\.tsx?$",
        routesDirectory: "./src/routes",
        target: "react",
      }),
      react(),
      // Surprising: editor type-checking for this plugin also needs
      // @types/babel__core, even though @babel/core is already installed.
      babel({
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      host: "0.0.0.0",
      // Comment: Dev browser traffic lives on its own dedicated origin while
      // Vite proxies `/api` to the separate Bun listener so auth/cookie
      // behavior still stays same-origin under HMR.
      port,
      proxy: {
        "/api": apiProxyTarget,
      },
      strictPort: true,
      // Allow requests from Docker containers
      allowedHosts: ["localhost", "host.docker.internal"],
    },
  };
});
