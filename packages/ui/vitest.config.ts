import { resolve } from "node:path";

import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    hideSkippedTests: true,
    include: ["src/**/*.test.{ts,tsx}"],
    name: "ui",
    setupFiles: ["./vitest.setup.ts"],
  },
});
