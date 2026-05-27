import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

type BoundaryRule = {
  root: string;
  blocked: RegExp[];
  message: string;
};

type PackageDependencyRule = {
  packageJson: string;
  blockedDependencies: string[];
  message: string;
};

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/u, "");

const rules: BoundaryRule[] = [
  {
    root: "packages/query/src",
    blocked: [
      /from\s+["']@onequery\/db(?:\/|["'])/u,
      /from\s+["']@onequery\/server(?:\/|["'])/u,
      /from\s+["']@onequery\/sql-polyglot(?:\/|["'])/u,
      /from\s+["']@polyglot-sql\/sdk["']/u,
      /from\s+["'](?:node:)?(?:fs|path|crypto|net|tls|http|https)["']/u,
      /from\s+["'](?:pg|mysql2|mysql2\/promise|snowflake-sdk)["']/u,
      /import\(["'](?:pg|mysql2|mysql2\/promise|snowflake-sdk)["']\)/u,
    ],
    message:
      "@onequery/query must stay a pure kernel: no db/server/polyglot/node/provider imports.",
  },
  {
    root: "packages/server/src",
    blocked: [
      /from\s+["']@polyglot-sql\/sdk["']/u,
      /from\s+["'](?:pg|mysql2|mysql2\/promise|snowflake-sdk)["']/u,
      /import\(["'](?:pg|mysql2|mysql2\/promise|snowflake-sdk)["']\)/u,
      /export\s+(?:type\s+)?(?:\{[\s\S]*?\}|\*)\s+from\s+["']@onequery\/(?:query|query-node|query-workers)(?:\/|["'])/u,
    ],
    message:
      "@onequery/server must not import provider SDKs, import Polyglot directly, or keep query compatibility re-export shims.",
  },
  {
    root: "packages/query-node/src",
    blocked: [
      /from\s+["']@onequery\/db(?:\/|["'])/u,
      /from\s+["']@onequery\/server(?:\/|["'])/u,
    ],
    message:
      "@onequery/query-node must expose runtime ports instead of importing db/server control-plane code.",
  },
  {
    root: "packages/query-node/src/providers",
    blocked: [/from\s+["']@onequery\/sql-polyglot(?:\/|["'])/u],
    message:
      "@onequery/query-node providers must receive prepared SQL from the runtime service, not import the validator.",
  },
  {
    root: "packages/query-workers/src",
    blocked: [
      /from\s+["']@onequery\/sql-polyglot(?:\/|["'])/u,
      /from\s+["'](?:node:)?(?:fs|path|crypto|net|tls|http|https)["']/u,
      /from\s+["'](?:pg|mysql2|mysql2\/promise|snowflake-sdk)["']/u,
      /import\(["'](?:pg|mysql2|mysql2\/promise|snowflake-sdk)["']\)/u,
    ],
    message:
      "@onequery/query-workers must stay Workers-safe: no Node builtins or Node provider SDKs.",
  },
];

const packageDependencyRules: PackageDependencyRule[] = [
  {
    packageJson: "packages/query/package.json",
    blockedDependencies: [
      "@onequery/db",
      "@onequery/server",
      "@onequery/sql-polyglot",
      "@polyglot-sql/sdk",
      "mysql2",
      "pg",
      "snowflake-sdk",
    ],
    message:
      "@onequery/query package.json must stay pure: no db/server/polyglot/provider dependencies.",
  },
  {
    packageJson: "packages/server/package.json",
    blockedDependencies: [
      "@onequery/sql-polyglot",
      "@polyglot-sql/sdk",
      "mysql2",
      "pg",
      "snowflake-sdk",
    ],
    message:
      "@onequery/server package.json must not depend on Polyglot or Node provider SDKs directly.",
  },
  {
    packageJson: "packages/query-node/package.json",
    blockedDependencies: ["@onequery/db", "@onequery/server"],
    message:
      "@onequery/query-node package.json must not depend on db/server packages.",
  },
  {
    packageJson: "packages/query-workers/package.json",
    blockedDependencies: [
      "@onequery/sql-polyglot",
      "mysql2",
      "pg",
      "snowflake-sdk",
    ],
    message:
      "@onequery/query-workers package.json must not depend on Polyglot or Node provider SDKs.",
  },
];

const allowedPolyglotRoots = new Set(["packages/sql-polyglot"]);
const ignoredDirectories = new Set([
  ".turbo",
  "coverage",
  "dist",
  "dist-worker",
  "node_modules",
]);

type Violation = {
  file: string;
  message: string;
};

async function listSourceFiles(root: string): Promise<string[]> {
  const absoluteRoot = join(repoRoot, root);
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          return [];
        }
        return listSourceFiles(path);
      }
      return /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/u.test(entry.name) ? [path] : [];
    })
  );
  return files.flat();
}

async function checkRule(rule: BoundaryRule): Promise<Violation[]> {
  const files = await listSourceFiles(rule.root);
  const violations: Violation[] = [];
  for (const file of files) {
    const source = await readFile(join(repoRoot, file), "utf8");
    if (rule.blocked.some((pattern) => pattern.test(source))) {
      violations.push({ file, message: rule.message });
    }
  }
  return violations;
}

async function checkPolyglotOwnership(): Promise<Violation[]> {
  const files = await listSourceFiles("packages");
  const violations: Violation[] = [];
  for (const file of files) {
    const source = await readFile(join(repoRoot, file), "utf8");
    if (!source.includes("@polyglot-sql/sdk")) {
      continue;
    }

    const packageRoot = relative(repoRoot, join(repoRoot, file))
      .split("/")
      .slice(0, 2)
      .join("/");
    if (!allowedPolyglotRoots.has(packageRoot)) {
      violations.push({
        file,
        message:
          "@polyglot-sql/sdk must be owned by @onequery/sql-polyglot only.",
      });
    }
  }
  return violations;
}

async function checkPackageDependencyRule(
  rule: PackageDependencyRule
): Promise<Violation[]> {
  const source = await readFile(join(repoRoot, rule.packageJson), "utf8");
  const manifest = JSON.parse(source) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const dependencyNames = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const hasBlockedDependency = rule.blockedDependencies.some((dependency) =>
    dependencyNames.has(dependency)
  );
  return hasBlockedDependency
    ? [
        {
          file: rule.packageJson,
          message: rule.message,
        },
      ]
    : [];
}

const violations = [
  ...(await checkPolyglotOwnership()),
  ...(await Promise.all(rules.map(checkRule))).flat(),
  ...(
    await Promise.all(packageDependencyRules.map(checkPackageDependencyRule))
  ).flat(),
];

if (violations.length > 0) {
  console.error("Query boundary violations:");
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.message}`);
  }
  process.exitCode = 1;
}
