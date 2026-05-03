import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import runtimeBundleLayout from "@onequery/base/runtime-bundle.json" with { type: "json" };
import { readTomlFileSync } from "@onequery/config-loader";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selfHostRuntimeDir = resolve(rootDir, "packages", "self-host-runtime");
const bundledRuntimePath = resolve(selfHostRuntimeDir, "dist", "node-entry.js");

type ChildEnvOptions = {
  runtimeRoot?: string;
};

type RuntimeAssetFamilyId =
  keyof typeof runtimeBundleLayout.runtimeAssetFamilies;

type LaunchConfigJson = {
  workspaceDev: {
    common: {
      assets: {
        distDir: string;
      };
      auth: {
        secret: string;
      };
      connectors: {
        enrollmentToken: string;
      };
      crypto: {
        masterEncryptionKey: string;
      };
      listen: {
        host: string;
        port: number;
      };
      migrations: {
        dir: string;
      };
      publicOrigin: string;
      rateLimit: {
        api: {
          storage: "SERVER_LAUNCH_API_RATE_LIMIT_STORAGE_MEMORY";
        };
        enabled: false;
      };
      storage: {
        pglite: {
          dir: string;
        };
      };
    };
  };
};

type RuntimePreparationResult =
  | {
      error?: Error;
      isErr(): boolean;
    }
  | {
      error?: undefined;
      isErr(): boolean;
    };

function prependPathEntries(
  entries: readonly string[],
  currentPath: string | undefined
): string {
  const seen = new Set<string>();
  const merged = [...entries, ...(currentPath?.split(delimiter) ?? [])].filter(
    (entry) => {
      if (!entry || seen.has(entry)) {
        return false;
      }

      seen.add(entry);
      return true;
    }
  );

  return merged.join(delimiter);
}

function requiredString(
  value: unknown,
  path: string,
  secretsPath: string
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Invalid workspace-dev config.\nSecrets file: ${secretsPath}\n- secrets.${path}: Expected non-empty string.`
    );
  }

  return value.trim();
}

function readWorkspaceDevSecrets(configRootDir: string): {
  authSecret: string;
  connectorEnrollmentToken: string;
  masterEncryptionKey: string;
} {
  const secretsPath = resolve(
    configRootDir,
    ".onequery",
    "dev",
    "secrets.toml"
  );
  const secrets = readTomlFileSync(secretsPath);
  const auth = secrets.auth;
  const connectors = secrets.connectors;
  const crypto = secrets.crypto;
  if (
    typeof auth !== "object" ||
    auth === null ||
    typeof connectors !== "object" ||
    connectors === null ||
    typeof crypto !== "object" ||
    crypto === null
  ) {
    throw new Error(
      `Invalid workspace-dev config.\nSecrets file: ${secretsPath}\n- secrets: Expected auth, connectors, and crypto tables.`
    );
  }

  const masterEncryptionKey = requiredString(
    (crypto as Record<string, unknown>).master_encryption_key,
    "crypto.master_encryption_key",
    secretsPath
  );
  if (Buffer.from(masterEncryptionKey, "base64").length !== 32) {
    throw new Error(
      `Invalid workspace-dev config.\nSecrets file: ${secretsPath}\n- secrets.crypto.master_encryption_key: Master encryption key must be valid base64 that decodes to exactly 32 bytes.`
    );
  }

  return {
    authSecret: requiredString(
      (auth as Record<string, unknown>).secret,
      "auth.secret",
      secretsPath
    ),
    connectorEnrollmentToken: requiredString(
      (connectors as Record<string, unknown>).enrollment_token,
      "connectors.enrollment_token",
      secretsPath
    ),
    masterEncryptionKey,
  };
}

export function parseRunMode(argv: readonly string[]): "dev" {
  const modeFlag = argv[0];

  if (modeFlag === "--dev" || modeFlag === undefined) {
    return "dev";
  }

  throw new Error(
    `Unknown mode: ${modeFlag}. Use --dev when running scripts/run-self-host-runtime.ts.`
  );
}

export function createLaunchConfig(
  configRootDir: string = rootDir
): LaunchConfigJson {
  const secrets = readWorkspaceDevSecrets(configRootDir);
  const workspaceDevStorageDir = resolve(
    configRootDir,
    ".onequery",
    "dev",
    "pglite",
    "onequery"
  );

  return {
    workspaceDev: {
      common: {
        assets: {
          distDir: resolve(configRootDir, "apps", "dashboard", "dist"),
        },
        auth: {
          secret: secrets.authSecret,
        },
        connectors: {
          enrollmentToken: secrets.connectorEnrollmentToken,
        },
        crypto: {
          masterEncryptionKey: secrets.masterEncryptionKey,
        },
        listen: {
          host: "127.0.0.1",
          port: 4555,
        },
        migrations: {
          dir: resolve(configRootDir, "packages", "db", "src", "migrations"),
        },
        publicOrigin: "http://localhost:4545",
        rateLimit: {
          api: {
            storage: "SERVER_LAUNCH_API_RATE_LIMIT_STORAGE_MEMORY",
          },
          enabled: false,
        },
        storage: {
          pglite: {
            dir: workspaceDevStorageDir,
          },
        },
      },
    },
  };
}

export function writeLaunchConfigFile(launchConfig: LaunchConfigJson): {
  launchConfigPath: string;
  tempDir: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "onequery-self-host-runtime-"));
  const launchConfigPath = join(tempDir, "launch.json");

  writeFileSync(launchConfigPath, `${JSON.stringify(launchConfig, null, 2)}\n`);

  return {
    launchConfigPath,
    tempDir,
  };
}

export function createWorkspaceDevRuntimeRoot(tempDir: string): string {
  return join(tempDir, "runtime-root");
}

function createOkResult(): RuntimePreparationResult {
  return {
    isErr: () => false,
  };
}

function createErrResult(error: Error): RuntimePreparationResult {
  return {
    error,
    isErr: () => true,
  };
}

function runtimeAssetOwnerPackageJsonPath(ownerPackage: string): string {
  switch (ownerPackage) {
    case "@onequery/db":
      return resolve(rootDir, "packages", "db", "package.json");
    case "@onequery/server":
      return resolve(rootDir, "packages", "server", "package.json");
    default:
      throw new Error(`Unsupported runtime asset owner '${ownerPackage}'.`);
  }
}

function copyRuntimeAssetFamily(input: {
  runtimeRoot: string;
  family: RuntimeAssetFamilyId;
}): void {
  const familyConfig = runtimeBundleLayout.runtimeAssetFamilies[input.family];
  const familyRequire = createRequire(
    runtimeAssetOwnerPackageJsonPath(familyConfig.buildOwnerPackage)
  );
  const outDir = resolve(input.runtimeRoot, familyConfig.packagedPath);

  mkdirSync(outDir, {
    recursive: true,
  });

  const buildSource = familyConfig.buildSource;

  if ("packageSpecifier" in buildSource) {
    const resolvedPackageFile = familyRequire.resolve(
      buildSource.packageSpecifier
    );
    const sourceDir = dirname(resolvedPackageFile);

    for (const fileConfig of Object.values(familyConfig.files)) {
      copyFileSync(
        join(sourceDir, fileConfig.filename),
        join(outDir, fileConfig.filename)
      );
    }
    return;
  }

  if ("specifiersByFileRole" in buildSource) {
    const specifiersByFileRole: Readonly<Record<string, string>> =
      buildSource.specifiersByFileRole;

    for (const [fileRole, fileConfig] of Object.entries(familyConfig.files)) {
      const sourceSpecifier = specifiersByFileRole[fileRole];

      if (!sourceSpecifier) {
        throw new Error(
          `Missing runtime asset build source specifier for '${input.family}.${fileRole}'.`
        );
      }

      const sourcePath = familyRequire.resolve(sourceSpecifier);
      copyFileSync(sourcePath, join(outDir, fileConfig.filename));
    }
    return;
  }

  throw new Error(
    `Unsupported runtime asset build source for '${input.family}'.`
  );
}

export async function stageWorkspaceDevRuntimeAssetsResult(
  runtimeRoot: string
): Promise<RuntimePreparationResult> {
  try {
    mkdirSync(runtimeRoot, {
      recursive: true,
    });
    for (const family of Object.keys(
      runtimeBundleLayout.runtimeAssetFamilies
    ) as RuntimeAssetFamilyId[]) {
      copyRuntimeAssetFamily({ family, runtimeRoot });
    }
    return createOkResult();
  } catch (cause) {
    return createErrResult(
      new Error(
        `Failed to stage self-host runtime assets (dev): ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause }
      )
    );
  }
}

export function createChildEnv(
  options: ChildEnvOptions = {}
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ONEQUERY_RUNTIME_ROOT: options.runtimeRoot ?? rootDir,
    PATH: prependPathEntries(
      [
        join(selfHostRuntimeDir, "node_modules/.bin"),
        join(rootDir, "node_modules/.bin"),
      ],
      process.env.PATH
    ),
  };

  return childEnv;
}

export function createRuntimeArgs(launchConfigPath: string): string[] {
  return ["--watch", bundledRuntimePath, launchConfigPath];
}

export function createRuntimeBuildArgs(): string[] {
  // Comment: dev mode still uses Bun for fast incremental bundling, but the
  // launched self-host runtime process itself runs on Node.
  return [
    "build",
    "--target",
    "node",
    "--format",
    "esm",
    "--outfile",
    bundledRuntimePath,
    "--conditions",
    "bun",
    "--watch",
    "src/node-entry.ts",
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForBundledRuntimeResult(input: {
  buildStartedAtMs: number;
  builder: ReturnType<typeof spawn>;
  bundledRuntimePath: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<RuntimePreparationResult> {
  const deadline = Date.now() + (input.timeoutMs ?? 15_000);
  const pollIntervalMs = input.pollIntervalMs ?? 50;

  while (Date.now() <= deadline) {
    if (input.builder.exitCode !== null || input.builder.signalCode !== null) {
      return createErrResult(
        new Error(
          "Runtime bundle build exited before the Node entry was ready."
        )
      );
    }

    try {
      const stats = statSync(input.bundledRuntimePath, {
        throwIfNoEntry: false,
      });
      if (stats?.isFile() && stats.mtimeMs >= input.buildStartedAtMs) {
        return createOkResult();
      }
    } catch (cause) {
      return createErrResult(
        new Error(
          `Failed to inspect bundled self-host runtime entry at ${input.bundledRuntimePath}.\n${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          { cause }
        )
      );
    }

    await sleep(pollIntervalMs);
  }

  return createErrResult(
    new Error(
      `Timed out waiting for bundled self-host runtime entry at ${input.bundledRuntimePath}.`
    )
  );
}

function terminateChild(
  child: ReturnType<typeof spawn> | null,
  signal: NodeJS.Signals = "SIGTERM"
): void {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}

function failBeforeRuntimeStart(tempDir: string, message: string): never {
  rmSync(tempDir, {
    force: true,
    recursive: true,
  });
  console.error(message);
  process.exit(1);
}

export async function main(): Promise<void> {
  parseRunMode(process.argv.slice(2));
  const launchConfig = writeLaunchConfigFile(createLaunchConfig());
  const runtimeRoot = createWorkspaceDevRuntimeRoot(launchConfig.tempDir);
  const runtimeAssets = await stageWorkspaceDevRuntimeAssetsResult(runtimeRoot);
  if (runtimeAssets.isErr()) {
    failBeforeRuntimeStart(
      launchConfig.tempDir,
      runtimeAssets.error?.message ??
        "Failed to stage self-host runtime assets."
    );
  }

  const buildStartedAtMs = Date.now();
  const builder = spawn("bun", createRuntimeBuildArgs(), {
    cwd: selfHostRuntimeDir,
    env: createChildEnv({ runtimeRoot }),
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  let runtime: ReturnType<typeof spawn> | null = null;
  let finalized = false;

  const finalize = (code: number | null, signal: NodeJS.Signals | null) => {
    if (finalized) {
      return;
    }
    finalized = true;

    rmSync(launchConfig.tempDir, {
      force: true,
      recursive: true,
    });

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  };

  const forwardSignal = (signal: "SIGINT" | "SIGTERM") => {
    process.on(signal, () => {
      terminateChild(runtime, signal);
      terminateChild(builder, signal);
    });
  };

  forwardSignal("SIGINT");
  forwardSignal("SIGTERM");

  builder.on("exit", (code, signal) => {
    if (finalized) {
      return;
    }

    terminateChild(runtime, signal ?? "SIGTERM");
    finalize(code, signal);
  });

  builder.on("error", (error) => {
    terminateChild(runtime);
    rmSync(launchConfig.tempDir, {
      force: true,
      recursive: true,
    });
    console.error(
      `Failed to build Node self-host runtime entry: ${error.message}`
    );
    process.exit(1);
  });

  const bundledRuntime = await waitForBundledRuntimeResult({
    buildStartedAtMs,
    builder,
    bundledRuntimePath,
  });
  if (bundledRuntime.isErr()) {
    terminateChild(builder);
    failBeforeRuntimeStart(
      launchConfig.tempDir,
      bundledRuntime.error?.message ??
        "Failed to prepare bundled self-host runtime entry."
    );
  }

  runtime = spawn("node", createRuntimeArgs(launchConfig.launchConfigPath), {
    cwd: selfHostRuntimeDir,
    env: createChildEnv({ runtimeRoot }),
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  runtime.on("exit", (code, signal) => {
    terminateChild(builder, signal ?? "SIGTERM");
    finalize(code, signal);
  });

  runtime.on("error", (error) => {
    terminateChild(builder);
    rmSync(launchConfig.tempDir, {
      force: true,
      recursive: true,
    });
    console.error(`Failed to start self-host runtime (dev): ${error.message}`);
    process.exit(1);
  });
}

function isDirectlyInvoked(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  return resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isDirectlyInvoked()) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
