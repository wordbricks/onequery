import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ResolvedWorkspaceDevConfig } from "@onequery/config";
import {
  ensureWorkspaceDevSecretsFileSync,
  loadWorkspaceDev,
} from "@onequery/config-node";

let workspaceDevCache: ResolvedWorkspaceDevConfig | undefined;

function getWorkspaceDev(): ResolvedWorkspaceDevConfig {
  if (!workspaceDevCache) {
    workspaceDevCache = loadWorkspaceDev({
      rootDir: process.cwd(),
    });
  }

  return workspaceDevCache;
}

function ensureWorkspaceDevSecretsFile(): void {
  const result = ensureWorkspaceDevSecretsFileSync({
    rootDir: process.cwd(),
  });

  if (!result.created) {
    return;
  }

  console.log(`Created ${result.path} with generated local secrets.`);
}

export function resolveWorkspaceDevPgliteDir(rootDir: string): string {
  return resolve(rootDir, ".onequery", "dev", "pglite", "onequery");
}

function ensureWorkspaceDevPgliteDir(): void {
  const pgliteDir = resolveWorkspaceDevPgliteDir(process.cwd());

  mkdirSync(pgliteDir, {
    recursive: true,
  });

  console.log(`Prepared PGlite directory: ${pgliteDir}`);
}

async function main(): Promise<void> {
  console.log("\n========================================");
  console.log("  OneQuery Development Environment Setup");
  console.log("========================================\n");

  ensureWorkspaceDevSecretsFile();
  getWorkspaceDev();

  ensureWorkspaceDevPgliteDir();

  console.log("\n========================================");
  console.log("  Setup complete! Starting dev server...");
  console.log("========================================\n");
}

// Run the setup
main().catch((error) => {
  console.error("Setup failed:", error);
  process.exit(1);
});
