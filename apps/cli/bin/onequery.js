#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLI_BINARY_NAME,
  CLI_PACKAGE_NAME,
  CLI_SERVER_BINARY_NAME,
  PLATFORM_PACKAGE_BY_TARGET,
  resolveTargetTriple,
} from "./package-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { platform, arch } = process;
const targetTriple = resolveTargetTriple(platform, arch);

const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
if (!platformPackage) {
  throw new Error(`Unsupported target triple: ${targetTriple}`);
}

// CONTEXT: platform packages are installed through npm alias names so the
// launcher resolves the alias folder, not the underlying published package id.
const localVendorRoot = path.join(__dirname, "..", "vendor");
const localBinaryPath = path.join(
  localVendorRoot,
  targetTriple,
  "onequery",
  CLI_BINARY_NAME
);
const packageRoot = path.resolve(__dirname, "..");

let vendorRoot;
try {
  const packageJsonPath = require.resolve(`${platformPackage}/package.json`);
  vendorRoot = path.join(path.dirname(packageJsonPath), "vendor");
} catch {
  if (existsSync(localBinaryPath)) {
    vendorRoot = localVendorRoot;
  } else {
    const packageManager = detectPackageManager();
    const reinstallCommand =
      packageManager === "bun"
        ? `bun install -g ${CLI_PACKAGE_NAME}@latest`
        : `npm install -g ${CLI_PACKAGE_NAME}@latest`;
    throw new Error(
      `Missing optional dependency ${platformPackage}. Reinstall OneQuery CLI: ${reinstallCommand}`
    );
  }
}

const binaryPath = path.join(
  vendorRoot,
  targetTriple,
  "onequery",
  CLI_BINARY_NAME
);
const serverBinaryPath = path.join(
  vendorRoot,
  targetTriple,
  "server",
  CLI_SERVER_BINARY_NAME
);

ensureExecutable(binaryPath);
if (existsSync(serverBinaryPath)) {
  ensureExecutable(serverBinaryPath);
}

const child = spawn(binaryPath, process.argv.slice(2), {
  env: {
    ...process.env,
    ONEQUERY_NPM_ROOT: process.env.ONEQUERY_NPM_ROOT ?? packageRoot,
    ONEQUERY_PGLITE_ASSET_DIR:
      process.env.ONEQUERY_PGLITE_ASSET_DIR ??
      path.join(packageRoot, "runtime", "pglite"),
    ONEQUERY_RUNTIME_ROOT: process.env.ONEQUERY_RUNTIME_ROOT ?? packageRoot,
    ONEQUERY_SERVER_EXECUTABLE:
      process.env.ONEQUERY_SERVER_EXECUTABLE ?? serverBinaryPath,
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

function ensureExecutable(filePath) {
  const currentMode = statSync(filePath).mode & 0o777;
  if ((currentMode & 0o111) !== 0) {
    return;
  }

  // CONTEXT: npm tarballs store vendored native binaries without execute bits,
  // so restore the expected mode before spawning the packaged CLI binary.
  chmodSync(filePath, currentMode | 0o755);
}
