import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vitest/config";

function createBasePlugins(): Plugin[] {
  return [
    tsconfigPaths({
      // Comment: Vitest 4 still needs explicit tsconfig scanning here. The app,
      // UI package, and server package each use `@/*` as a package-local alias.
      projects: [
        "./tsconfig.json",
        "../../packages/ui/tsconfig.json",
        "../../packages/server/tsconfig.json",
      ],
    }),
  ];
}

export default defineConfig({
  plugins: [...createBasePlugins(), react(), tailwindcss()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
