import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const repoRootDir = resolve(import.meta.dir, "..");
const rootDirs = ["apps", "packages", "scripts"];
const sourceFileExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const disallowedSpecifiers = [
  "@onequery/config/src",
  "../packages/config/src",
  "../../config/src",
  "packages/config/src",
];
const importSpecifierPattern =
  /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
        continue;
      }

      files.push(...collectSourceFiles(path));
      continue;
    }

    if (sourceFileExtensions.has(extname(path))) {
      files.push(path);
    }
  }

  return files;
}

const violations: string[] = [];

for (const rootDir of rootDirs) {
  const absoluteRootDir = resolve(repoRootDir, rootDir);

  for (const filePath of collectSourceFiles(absoluteRootDir)) {
    const contents = readFileSync(filePath, "utf8");

    for (const match of contents.matchAll(importSpecifierPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) {
        continue;
      }

      if (
        disallowedSpecifiers.some((disallowedSpecifier) =>
          specifier.includes(disallowedSpecifier)
        )
      ) {
        violations.push(`${relative(repoRootDir, filePath)}: ${specifier}`);
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    [
      "Direct config src imports are not allowed outside packages/config.",
      ...violations.map((violation) => `- ${violation}`),
    ].join("\n")
  );
}

console.log("Config package boundaries are clean.");
