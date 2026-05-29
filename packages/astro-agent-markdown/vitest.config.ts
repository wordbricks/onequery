/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import type { TestUserConfig } from "vitest/config";

const test = {
  hideSkippedTests: true,
  include: ["src/**/*.test.ts"],
  name: "astro-agent-markdown",
} satisfies TestUserConfig;

// Astro's documented Vitest setup uses getViteConfig(), but oxlint's
// type-aware pass does not apply Vitest's Vite module augmentation here.
// Keep the test block checked against Vitest's config type, then hand it to
// Astro's helper without pulling in Vitest's separate Vite version.
export default getViteConfig({
  test,
} as Parameters<typeof getViteConfig>[0]);
