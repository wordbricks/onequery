import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    hideSkippedTests: true,
    silent: "passed-only",
  },
});
