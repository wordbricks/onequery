import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    hideSkippedTests: true,
    include: ["src/**/*.test.ts"],
    name: "astro-markdown-for-agents",
  },
});
