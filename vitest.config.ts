import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 80,
        statements: 80,
      },
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/dist-worker/**",
        "**/*.config.{js,ts}",
        "**/coverage/**",
      ],
    },
    hideSkippedTests: true,
    projects: ["apps/*", "packages/*"],
    silent: "passed-only",
  },
});
