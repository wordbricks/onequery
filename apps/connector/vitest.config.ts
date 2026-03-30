import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types.ts", "src/index.ts"],
      reporter: ["text", "html"],
      thresholds: {
        perFile: true,
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
