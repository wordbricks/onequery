import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    hideSkippedTests: true,
    include: ["src/**/*.test.ts"],
    name: "astro-agent-markdown",
  },
});
