import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const repoRootDir = resolve(import.meta.dir, "..");
const sourceRootDirs = ["apps", "packages", "scripts"];
const packageRootDirs = ["apps", "packages"];
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
const importSpecifierPattern =
  /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

type PackageOwner = {
  rootDir: string;
  scopeName: string;
};

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      if (
        entry === "node_modules" ||
        entry === "dist" ||
        entry === "dist-worker" ||
        entry === ".turbo"
      ) {
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

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function getPackageOwner(filePath: string): PackageOwner | null {
  const relativePath = normalizePath(relative(repoRootDir, filePath));
  const segments = relativePath.split("/");

  if (segments.length < 2 || !packageRootDirs.includes(segments[0] ?? "")) {
    return null;
  }

  return {
    rootDir: segments.slice(0, 2).join("/"),
    scopeName: `@onequery/${segments[1]}`,
  };
}

function resolveRelativeImportTarget(
  filePath: string,
  specifier: string
): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  return normalizePath(resolve(dirname(filePath), specifier));
}

function findTargetPackageRoot(absolutePath: string): string | null {
  const relativePath = normalizePath(relative(repoRootDir, absolutePath));
  const segments = relativePath.split("/");

  if (
    segments.length < 3 ||
    !packageRootDirs.includes(segments[0] ?? "") ||
    segments[2] !== "src"
  ) {
    return null;
  }

  return segments.slice(0, 2).join("/");
}

function describeViolation(filePath: string, specifier: string): string {
  return `${normalizePath(relative(repoRootDir, filePath))}: ${specifier}`;
}

function isPrivateWorkspacePackageImport(
  owner: PackageOwner | null,
  specifier: string
): boolean {
  if (!specifier.startsWith("@onequery/")) {
    return false;
  }

  const segments = specifier.split("/");
  if (segments.length < 3 || segments[2] !== "src") {
    return false;
  }

  const targetScopeName = `${segments[0]}/${segments[1]}`;
  return owner?.scopeName !== targetScopeName;
}

const violations: string[] = [];

for (const rootDir of sourceRootDirs) {
  const absoluteRootDir = resolve(repoRootDir, rootDir);

  for (const filePath of collectSourceFiles(absoluteRootDir)) {
    const contents = readFileSync(filePath, "utf8");
    const owner = getPackageOwner(filePath);

    for (const match of contents.matchAll(importSpecifierPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) {
        continue;
      }

      if (isPrivateWorkspacePackageImport(owner, specifier)) {
        violations.push(describeViolation(filePath, specifier));
        continue;
      }

      const resolvedTarget = resolveRelativeImportTarget(filePath, specifier);
      if (!resolvedTarget) {
        continue;
      }

      const targetPackageRoot = findTargetPackageRoot(resolvedTarget);
      if (!targetPackageRoot || targetPackageRoot === owner?.rootDir) {
        continue;
      }

      violations.push(describeViolation(filePath, specifier));
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    [
      "Cross-package private src imports are not allowed.",
      ...violations.map((violation) => `- ${violation}`),
    ].join("\n")
  );
}

console.log("Package boundaries are clean.");
