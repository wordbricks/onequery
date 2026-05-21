import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const isE2E = process.env.ONEQUERY_E2E === "1";

export default defineConfig(async ({ command }) => {
  const config = {
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
  };

  if (command !== "serve") {
    return config;
  }

  const configNodePackage = "@onequery/config-node";
  const { loadViteDevServerConfig } = await import(configNodePackage);
  const { apiProxyTarget, port } = loadViteDevServerConfig();

  return {
    ...config,
    server: {
      host: "localhost",
      // Comment: Keep the browser on the workspace-dev browser origin and proxy only
      // `/api` in dev so auth/cookie behavior stays same-origin while the Bun
      // server can restart independently under Vite HMR.
      port,
      proxy: {
        "/api": apiProxyTarget,
      },
      strictPort: true,
    },
  };
});
