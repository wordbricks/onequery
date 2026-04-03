#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACKAGED_PGLITE_DIR_SEGMENTS,
  PGLITE_RUNTIME_ASSET_FILENAMES,
} from "@onequery/db/pglite";

import {
  CLI_NPM_PACK_DIR_PREFIX,
  CLI_NPM_STAGE_DIR_PREFIX,
  CLI_NPM_TARBALL_PREFIX,
  CLI_PACKAGE_NAME,
  PLATFORM_PACKAGES,
  RELEASE_PLATFORM_PACKAGES,
  EXTRA_RELEASE_PLATFORM_PACKAGES,
} from "../bin/package-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(CLI_ROOT, "..", "..");
const dbPackageRequire = createRequire(
  path.join(WORKSPACE_ROOT, "packages", "db", "package.json")
);
const WEB_BUILD_ROOT = path.join(WORKSPACE_ROOT, "apps", "web");
const WEB_DIST_DIR = path.join(WEB_BUILD_ROOT, "dist");
const WEB_INDEX_FILENAME = "index.html";
const DB_MIGRATIONS_DIR = path.join(
  WORKSPACE_ROOT,
  "packages",
  "db",
  "src",
  "migrations"
);
const PACKAGED_PGLITE_DIR = path.join(...PACKAGED_PGLITE_DIR_SEGMENTS);

export const PACKAGE_EXPANSIONS = {
  cli: ["cli", ...Object.keys(PLATFORM_PACKAGES)],
  "cli-release-extras": Object.keys(EXTRA_RELEASE_PLATFORM_PACKAGES),
};
const BUILD_NPM_PACKAGE_OPTIONS = new Set([
  "--package",
  "--version",
  "--release-version",
  "--staging-dir",
  "--pack-output",
  "--vendor-src",
  "--help",
  "-h",
]);

export function tarballNameForPackage(packageName, version) {
  if (packageName === "cli") {
    return `${CLI_NPM_TARBALL_PREFIX}-${version}.tgz`;
  }

  const platformPackage = RELEASE_PLATFORM_PACKAGES[packageName];
  if (!platformPackage) {
    throw new Error(`Unknown package '${packageName}'.`);
  }

  return `${CLI_NPM_TARBALL_PREFIX}-${platformPackage.npmTag}-${version}.tgz`;
}

export async function buildPackage({
  packageName,
  version,
  stagingDir,
  packOutput,
  vendorSrc,
}) {
  if (!packageName) {
    throw new Error("Missing packageName.");
  }

  if (!version) {
    throw new Error("Missing version.");
  }

  const resolvedStagingDir = stagingDir
    ? await prepareStagingDir(stagingDir)
    : await mkdtemp(path.join(tmpdir(), CLI_NPM_STAGE_DIR_PREFIX));

  await stageSources({
    packageName,
    stagingDir: resolvedStagingDir,
    version,
  });

  if (packageName in RELEASE_PLATFORM_PACKAGES) {
    if (!vendorSrc) {
      throw new Error(
        `Package '${packageName}' requires --vendor-src pointing to staged release binaries.`
      );
    }

    const platformPackage = RELEASE_PLATFORM_PACKAGES[packageName];
    await copyPlatformVendor({
      stagingDir: resolvedStagingDir,
      targetTriple: platformPackage.targetTriple,
      vendorSrc,
    });
  }

  if (packOutput) {
    await runNpmPack({
      packOutput,
      stagingDir: resolvedStagingDir,
    });
  }

  return resolvedStagingDir;
}

async function prepareStagingDir(stagingDir) {
  const resolvedStagingDir = path.resolve(stagingDir);
  await mkdir(resolvedStagingDir, { recursive: true });
  const entries = await readdir(resolvedStagingDir);
  if (entries.length > 0) {
    throw new Error(`Staging directory ${resolvedStagingDir} is not empty.`);
  }

  return resolvedStagingDir;
}

async function stageSources({ stagingDir, packageName, version }) {
  const packageJsonPath = path.join(CLI_ROOT, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const readmePath = path.join(CLI_ROOT, "README.md");

  if (packageName === "cli") {
    await cp(path.join(CLI_ROOT, "bin"), path.join(stagingDir, "bin"), {
      recursive: true,
    });
    await copyFile(readmePath, path.join(stagingDir, "README.md"));

    // CONTEXT: apps/cli is both the Rust workspace root and the npm package
    // source. Only published platform aliases belong in optionalDependencies;
    // GNU Linux extras stay as GitHub-release-only tarballs.
    delete packageJson.private;
    delete packageJson.scripts;
    packageJson.version = version;
    packageJson.files = ["bin", "README.md"];
    // CONTEXT: optional dependency keys stay unscoped because they are npm
    // alias names. The published package backing each alias is @onequery/cli.
    packageJson.optionalDependencies = Object.fromEntries(
      Object.values(PLATFORM_PACKAGES).map((platformPackage) => [
        platformPackage.optionalDependencyName,
        `npm:${CLI_PACKAGE_NAME}@${platformPackageVersion(version, platformPackage.npmTag)}`,
      ])
    );

    await writeJson(path.join(stagingDir, "package.json"), packageJson);
    return;
  }

  const platformPackage = RELEASE_PLATFORM_PACKAGES[packageName];
  if (!platformPackage) {
    throw new Error(`Unknown package '${packageName}'.`);
  }

  await copyFile(readmePath, path.join(stagingDir, "README.md"));
  await stagePackagedRuntime({
    runtimeRoot: path.join(stagingDir, "vendor", platformPackage.targetTriple),
  });

  const stagedPlatformPackage = {
    cpu: [platformPackage.cpu],
    description: packageJson.description,
    files: ["vendor", "README.md"],
    license: packageJson.license,
    name: CLI_PACKAGE_NAME,
    os: [platformPackage.os],
    publishConfig: packageJson.publishConfig,
    repository: packageJson.repository,
    version: platformPackageVersion(version, platformPackage.npmTag),
  };

  if (packageJson.engines) {
    stagedPlatformPackage.engines = packageJson.engines;
  }

  if (packageJson.packageManager) {
    stagedPlatformPackage.packageManager = packageJson.packageManager;
  }

  await writeJson(path.join(stagingDir, "package.json"), stagedPlatformPackage);
}

function platformPackageVersion(version, platformTag) {
  return `${version}-${platformTag}`;
}

async function copyPlatformVendor({ vendorSrc, stagingDir, targetTriple }) {
  const resolvedVendorSrc = path.resolve(vendorSrc);
  const targetSource = path.join(resolvedVendorSrc, targetTriple);
  const targetDestination = path.join(stagingDir, "vendor", targetTriple);

  await mkdir(path.dirname(targetDestination), { recursive: true });
  await cp(targetSource, targetDestination, { recursive: true });
}

export async function stagePackagedRuntime({ runtimeRoot }) {
  await buildWebAssets();

  const runtimeDir = path.join(runtimeRoot, "runtime");
  const migrationsOutDir = path.join(runtimeDir, "migrations");
  // Comment: `runtimeRoot` is already the packaged bundle root
  // (`vendor/<target>`), so the PGlite payload should land at
  // `vendor/<target>/runtime/pglite`, not `runtime/runtime/pglite`.
  const pgliteOutDir = path.join(runtimeRoot, PACKAGED_PGLITE_DIR);
  const webOutDir = path.join(runtimeDir, "web");
  const builtWebDistDir = await resolveBuiltWebDistDir();
  const pgliteDistDir = await resolvePgliteDistDir();

  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  await cp(DB_MIGRATIONS_DIR, migrationsOutDir, { recursive: true });
  await mkdir(pgliteOutDir, { recursive: true });
  await Promise.all(
    PGLITE_RUNTIME_ASSET_FILENAMES.map((filename) =>
      copyFile(
        path.join(pgliteDistDir, filename),
        path.join(pgliteOutDir, filename)
      )
    )
  );
  await cp(builtWebDistDir, webOutDir, { recursive: true });
}

async function resolvePgliteDistDir() {
  const packageEntrypoint = dbPackageRequire.resolve("@electric-sql/pglite");
  const distDir = path.dirname(packageEntrypoint);

  await Promise.all(
    PGLITE_RUNTIME_ASSET_FILENAMES.map((filename) =>
      access(path.join(distDir, filename))
    )
  );

  return distDir;
}

async function buildWebAssets() {
  // Comment: Build the web package through Turbo so its workspace
  // prerequisites (notably repo-local packages that export generated `dist/`
  // entrypoints) are materialized on clean CI runners before npm staging.
  const result = spawnSync(
    "bun",
    ["x", "turbo", "run", "build", "--filter=@onequery/web"],
    {
      cwd: WORKSPACE_ROOT,
      encoding: "utf8",
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .trim();
    const message =
      output.length > 0
        ? `failed to build apps/web for npm packaging\n${output}`
        : "failed to build apps/web for npm packaging";

    throw new Error(message);
  }
}

async function resolveBuiltWebDistDir() {
  const indexPath = path.join(WEB_DIST_DIR, WEB_INDEX_FILENAME);
  try {
    await access(indexPath);
    return WEB_DIST_DIR;
  } catch {
    throw new Error(`failed to locate built web assets; expected ${indexPath}`);
  }
}

async function runNpmPack({ stagingDir, packOutput }) {
  const resolvedPackOutput = path.resolve(packOutput);
  await mkdir(path.dirname(resolvedPackOutput), { recursive: true });
  const packDir = await mkdtemp(path.join(tmpdir(), CLI_NPM_PACK_DIR_PREFIX));

  try {
    // CONTEXT: `bun pm pack` normalizes vendored native binaries to 0644 in the
    // tarball, which breaks `npx`/`bunx` with EACCES when the launcher spawns
    // the installed executable. Use `npm pack` so the vendor payload keeps its
    // executable bit.
    const result = spawnSync(
      "npm",
      ["pack", "--json", "--pack-destination", packDir],
      {
        cwd: stagingDir,
        encoding: "utf8",
      }
    );

    if (result.status !== 0) {
      throw new Error(`npm pack failed for ${stagingDir}`);
    }

    const tarballName = parseNpmPackTarballName(result.stdout, stagingDir);

    const stagedTarballPath = path.join(packDir, tarballName);
    await copyFile(stagedTarballPath, resolvedPackOutput);
    await rm(stagedTarballPath, { force: true });
  } finally {
    await rm(packDir, { force: true, recursive: true });
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseNpmPackTarballName(stdout, stagingDir) {
  let parsedOutput;
  try {
    parsedOutput = JSON.parse(stdout);
  } catch {
    throw new Error(`npm pack returned invalid JSON for ${stagingDir}`);
  }

  if (!Array.isArray(parsedOutput)) {
    throw new Error(
      `npm pack returned an unexpected payload for ${stagingDir}`
    );
  }

  const packEntry = parsedOutput[0];
  if (typeof packEntry !== "object" || packEntry === null) {
    throw new Error(`npm pack returned an empty payload for ${stagingDir}`);
  }

  const tarballName =
    readNonEmptyString(packEntry.filename) ??
    readNonEmptyString(packEntry.name);
  if (!tarballName) {
    throw new Error(
      `Unable to determine npm pack output filename for ${stagingDir}`
    );
  }

  return tarballName;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value === undefined || BUILD_NPM_PACKAGE_OPTIONS.has(value)) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

function parseArgs(argv) {
  const args = {
    packOutput: null,
    packageName: null,
    stagingDir: null,
    vendorSrc: null,
    version: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--package": {
        args.packageName = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--version":
      case "--release-version": {
        args.version = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--staging-dir": {
        args.stagingDir = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--pack-output": {
        args.packOutput = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--vendor-src": {
        args.vendorSrc = readOptionValue(argv, index, argument);
        index += 1;
        break;
      }
      case "--help":
      case "-h": {
        printHelp();
        process.exit(0);
        return args;
      }
      default: {
        throw new Error(`Unknown argument '${argument}'.`);
      }
    }
  }

  if (!args.packageName) {
    throw new Error("--package is required.");
  }

  if (!args.version) {
    throw new Error("--release-version is required.");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: bun apps/cli/scripts/build-npm-package.js --package <name> --release-version <version> [options]

Options:
  --staging-dir <path>  Empty directory to stage into
  --pack-output <path>  Output tarball path for bun pm pack
  --vendor-src <path>   Vendor root containing target directories
`);
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));

  await buildPackage({
    packOutput: args.packOutput,
    packageName: args.packageName,
    stagingDir: args.stagingDir,
    vendorSrc: args.vendorSrc,
    version: args.version,
  });
}
