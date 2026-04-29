import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protoRoot = resolve(rootDir, "proto");

type BoundaryRule = {
  forbiddenImport: RegExp;
  importDescription: string;
  sourceDir: string;
  sourceDescription: string;
};

const rules: BoundaryRule[] = [
  {
    forbiddenImport: /^onequery\/cli\/v1\//,
    importDescription: "onequery/cli/v1/**",
    sourceDescription: "workflow proto",
    sourceDir: resolve(protoRoot, "onequery/workflow/v1"),
  },
  {
    forbiddenImport: /^onequery\/workflow\/v1\//,
    importDescription: "onequery/workflow/v1/**",
    sourceDescription: "CLI/API proto",
    sourceDir: resolve(protoRoot, "onequery/cli/v1"),
  },
  {
    forbiddenImport: /^onequery\/workflow\/v1\//,
    importDescription: "onequery/workflow/v1/**",
    sourceDescription: "API proto",
    sourceDir: resolve(protoRoot, "onequery/api/v1"),
  },
  {
    forbiddenImport: /^onequery\/(?:cli|workflow)\/v1\//,
    importDescription: "onequery/cli/v1/** or onequery/workflow/v1/**",
    sourceDescription: "runtime proto",
    sourceDir: resolve(protoRoot, "onequery/runtime/v1"),
  },
  {
    forbiddenImport: /^onequery\/runtime\/v1\//,
    importDescription: "onequery/runtime/v1/**",
    sourceDescription: "CLI/API proto",
    sourceDir: resolve(protoRoot, "onequery/cli/v1"),
  },
  {
    forbiddenImport: /^onequery\/runtime\/v1\//,
    importDescription: "onequery/runtime/v1/**",
    sourceDescription: "workflow proto",
    sourceDir: resolve(protoRoot, "onequery/workflow/v1"),
  },
  {
    forbiddenImport: /^onequery\/runtime\/v1\//,
    importDescription: "onequery/runtime/v1/**",
    sourceDescription: "API proto",
    sourceDir: resolve(protoRoot, "onequery/api/v1"),
  },
];

type BoundaryViolation = {
  filePath: string;
  importPath: string;
  line: number;
  rule: BoundaryRule;
};

function listProtoFiles(dir: string): string[] {
  try {
    const dirStat = statSync(dir);
    if (!dirStat.isDirectory()) {
      return [];
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }

  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listProtoFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".proto")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function findViolations(rule: BoundaryRule): BoundaryViolation[] {
  const importPattern =
    /^\s*import\s+(?:(?:public|weak)\s+)?["']([^"']+)["']\s*;/;

  return listProtoFiles(rule.sourceDir).flatMap((filePath) => {
    const lines = readFileSync(filePath, "utf8").split("\n");
    return lines.flatMap((lineText, index) => {
      const match = importPattern.exec(lineText);
      const importPath = match?.[1];

      if (!importPath || !rule.forbiddenImport.test(importPath)) {
        return [];
      }

      return {
        filePath,
        importPath,
        line: index + 1,
        rule,
      };
    });
  });
}

const violations = rules.flatMap(findViolations);

if (violations.length > 0) {
  console.error("Proto package boundary check failed:");
  for (const violation of violations) {
    console.error(
      `- ${relative(rootDir, violation.filePath)}:${violation.line} imports ${violation.importPath}; ${violation.rule.sourceDescription} files must not import ${violation.rule.importDescription}`
    );
  }
  process.exit(1);
}

console.log("Proto package boundary check passed.");
