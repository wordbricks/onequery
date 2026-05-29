/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import type { TestUserConfig } from "vitest/config";

const test = {
  hideSkippedTests: true,
  include: ["src/**/*.test.ts"],
  name: "astro-agent-markdown",
} satisfies TestUserConfig;

export default getViteConfig({
  test,
} as Parameters<typeof getViteConfig>[0]);
