#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLI_BINARY_NAME,
  CLI_PACKAGE_NAME,
  PLATFORM_PACKAGE_BY_TARGET,
  binaryNameForPlatform,
  resolveTargetTriple,
  resolveTargetTripleCandidates,
} from "./package-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const runtimeBundleSpec = readRuntimeBundleSpec(resolveRuntimeBundleSpecPath());

const { platform, arch } = process;
const targetTriple = resolveTargetTriple(platform, arch);
const targetTripleCandidates = resolveTargetTripleCandidates(platform, arch);
const binaryName = binaryNameForPlatform(platform, CLI_BINARY_NAME);

// CONTEXT: platform packages are installed through npm alias names so the
// launcher resolves the alias folder, not the underlying published package id.
const localVendorRoot = path.join(__dirname, "..", "vendor");
const resolvedVendor = resolveVendorPayload({
  binaryName,
  localVendorRoot,
  runtimeBundleSpec,
  targetTripleCandidates,
});

if (!resolvedVendor) {
  const preferredPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  const packageManager = detectPackageManager();
  const reinstallCommand =
    packageManager === "bun"
      ? `bun install -g ${CLI_PACKAGE_NAME}@latest`
      : `npm install -g ${CLI_PACKAGE_NAME}@latest`;

  if (preferredPackage) {
    throw new Error(
      `Missing optional dependency ${preferredPackage}. Reinstall OneQuery CLI: ${reinstallCommand}`
    );
  }

  throw new Error(`Unsupported target triple: ${targetTriple}`);
}

const { binaryPath, bundleRoot } = resolvedVendor;

if (platform !== "win32") {
  ensureExecutable(binaryPath);
}

const child = spawn(binaryPath, process.argv.slice(2), {
  env: {
    ...process.env,
    [runtimeBundleSpec.runtimeRootEnvVar]:
      process.env[runtimeBundleSpec.runtimeRootEnvVar] ?? bundleRoot,
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

const forwardSignal = (signal) => {
  if (child.killed) {
    return;
  }

  try {
    child.kill(signal);
  } catch {
    // Ignore forwarding failures if the child already exited.
  }
};

["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
  process.on(signal, () => forwardSignal(signal));
});

const childResult = await new Promise((resolve) => {
  child.on("exit", (code, signal) => {
    if (signal) {
      resolve({ signal, type: "signal" });
      return;
    }

    resolve({ exitCode: code ?? 1, type: "code" });
  });
});

if (childResult.type === "signal") {
  process.kill(process.pid, childResult.signal);
} else {
  process.exit(childResult.exitCode);
}

function detectPackageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (/\bbun\//.test(userAgent)) {
    return "bun";
  }

  const execPath = process.env.npm_execpath ?? "";
  if (execPath.includes("bun")) {
    return "bun";
  }

  if (
    __dirname.includes(".bun/install/global") ||
    __dirname.includes(".bun\\install\\global")
  ) {
    return "bun";
  }

  return userAgent ? "npm" : null;
}

function resolveVendorPayload({
  binaryName,
  localVendorRoot,
  runtimeBundleSpec,
  targetTripleCandidates,
}) {
  for (const candidateTargetTriple of targetTripleCandidates) {
    const localBundle = resolveBundlePaths({
      binaryName,
      bundleRoot: path.join(localVendorRoot, candidateTargetTriple),
      runtimeBundleSpec,
    });

    const platformPackage = PLATFORM_PACKAGE_BY_TARGET[candidateTargetTriple];
    if (platformPackage) {
      try {
        const packageJsonPath = require.resolve(
          `${platformPackage}/package.json`
        );
        const resolvedVendorRoot = path.join(
          path.dirname(packageJsonPath),
          "vendor"
        );
        const packagedBundle = resolveBundlePaths({
          binaryName,
          bundleRoot: path.join(resolvedVendorRoot, candidateTargetTriple),
          runtimeBundleSpec,
        });
        if (packagedBundle) {
          return {
            ...packagedBundle,
          };
        }
      } catch {
        // Keep checking fallback targets and local vendor payloads.
      }
    }

    if (localBundle) {
      return {
        ...localBundle,
      };
    }
  }

  return null;
}

function resolveBundlePaths({ binaryName, bundleRoot, runtimeBundleSpec }) {
  const binaryPath = path.join(
    bundleRoot,
    runtimeBundleSpec.directories.cli.relativePath,
    binaryName
  );
  if (!existsSync(binaryPath)) {
    return null;
  }

  return {
    binaryPath,
    bundleRoot,
  };
}

function resolveRuntimeBundleSpecPath() {
  const packagedSpecPath = path.join(__dirname, "..", "runtime-bundle.json");
  if (existsSync(packagedSpecPath)) {
    return packagedSpecPath;
  }

  // Comment: local workspace execution reads the canonical bundle spec from the
  // repo; published npm packages ship the same file at the package root.
  return path.join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "base",
    "src",
    "runtime-bundle.json"
  );
}

function readRuntimeBundleSpec(specPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(specPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to read runtime bundle spec at ${specPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  const runtimeRootEnvVar = readNonEmptyString(parsed?.runtimeRootEnvVar);
  const cliRelativePath = readNonEmptyString(
    parsed?.directories?.cli?.relativePath
  );
  const serverRelativePath = readNonEmptyString(
    parsed?.directories?.server?.relativePath
  );
  if (!runtimeRootEnvVar || !cliRelativePath || !serverRelativePath) {
    throw new Error(`Invalid runtime bundle spec at ${specPath}.`);
  }

  return {
    directories: {
      cli: {
        relativePath: cliRelativePath,
      },
      server: {
        relativePath: serverRelativePath,
      },
    },
    runtimeRootEnvVar,
  };
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ensureExecutable(filePath) {
  const currentMode = statSync(filePath).mode & 0o777;
  if ((currentMode & 0o111) !== 0) {
    return;
  }

  // CONTEXT: npm tarballs store vendored native binaries without execute bits,
  // so restore the expected mode before spawning the packaged CLI binary.
  chmodSync(filePath, currentMode | 0o755);
}
