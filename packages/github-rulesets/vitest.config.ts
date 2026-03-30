import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    hideSkippedTests: true,
    include: ["src/**/*.test.ts"],
    silent: "passed-only",
  },
});
