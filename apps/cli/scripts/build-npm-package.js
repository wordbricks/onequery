#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
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
  RUNTIME_BUNDLE_SPEC_FILENAME,
  getRuntimeAssetFamilyConfig,
  getRuntimeAssetFamilyIds,
  getRuntimeBundleEntryConfig,
  resolvePackagedRuntimeAssetDir,
  resolvePackagedRuntimeEntryDir,
  resolveRuntimeBundleSpecSourcePath,
} from "@onequery/base/runtime-bundle";

import {
  CLI_BINARY_NAME,
  CLI_NPM_PACK_DIR_PREFIX,
  CLI_NPM_STAGE_DIR_PREFIX,
  CLI_NPM_TARBALL_PREFIX,
  CLI_PACKAGE_NAME,
  PLATFORM_PACKAGES,
  RELEASE_PLATFORM_PACKAGES,
  EXTRA_RELEASE_PLATFORM_PACKAGES,
  binaryNameForTargetTriple,
} from "../bin/package-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(CLI_ROOT, "..", "..");
const WORKSPACE_MANIFEST_PATH = path.join(WORKSPACE_ROOT, "package.json");
const workspacePackageRequireCache = new Map();
let workspacePackageManifestPathIndexPromise = null;
let buildWebAssetsPromise = null;
const WEB_BUILD_ROOT = path.join(WORKSPACE_ROOT, "apps", "web");
const WEB_DIST_DIR = path.join(WEB_BUILD_ROOT, "dist");
const WEB_DIST_ENTRY = getRuntimeBundleEntryConfig("webDist");
if (!WEB_DIST_ENTRY.requiredFile) {
  throw new Error(
    "Expected runtime bundle webDist entry to declare requiredFile."
  );
}

const WEB_INDEX_FILENAME = WEB_DIST_ENTRY.requiredFile;
const DB_MIGRATIONS_DIR = path.join(
  WORKSPACE_ROOT,
  "packages",
  "db",
  "src",
  "migrations"
);
const CLI_INSTALL_TARBALL_PREFIX = "onequery-install";
const INSTALL_BUNDLE_PACKAGES = Object.fromEntries(
  Object.values(PLATFORM_PACKAGES)
    .filter((platformPackage) => platformPackage.os !== "win32")
    .map((platformPackage) => [
      `cli-install-${platformPackage.npmTag}`,
      platformPackage,
    ])
);

export const PACKAGE_EXPANSIONS = {
  cli: ["cli", ...Object.keys(PLATFORM_PACKAGES)],
  "cli-install": Object.keys(INSTALL_BUNDLE_PACKAGES),
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

  const installBundlePackage = INSTALL_BUNDLE_PACKAGES[packageName];
  if (installBundlePackage) {
    return `${CLI_INSTALL_TARBALL_PREFIX}-${installBundlePackage.npmTag}.tgz`;
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

  const packageJson = await readCliPackageJson();
  const readmePath = path.join(CLI_ROOT, "README.md");
  const installBundlePackage = INSTALL_BUNDLE_PACKAGES[packageName];
  const releasePlatformPackage = RELEASE_PLATFORM_PACKAGES[packageName];
  const vendorTargetTriple =
    installBundlePackage?.targetTriple ?? releasePlatformPackage?.targetTriple;

  if (vendorTargetTriple && !vendorSrc) {
    throw new Error(
      `Package '${packageName}' requires --vendor-src pointing to staged release binaries.`
    );
  }

  if (installBundlePackage) {
    await stageInstallBundle({
      packageJson,
      readmePath,
      stagingDir: resolvedStagingDir,
      targetTriple: vendorTargetTriple,
      vendorSrc,
      version,
    });
  } else {
    await stageSources({
      packageJson,
      packageName,
      readmePath,
      stagingDir: resolvedStagingDir,
      version,
    });
  }

  if (releasePlatformPackage) {
    await copyPlatformVendor({
      stagingDir: resolvedStagingDir,
      targetTriple: vendorTargetTriple,
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

async function readCliPackageJson() {
  return JSON.parse(
    await readFile(path.join(CLI_ROOT, "package.json"), "utf8")
  );
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

async function stagePublishedMetadataFiles({
  includeRuntimeBundleSpec = false,
  readmePath,
  stagingDir,
}) {
  await copyFile(readmePath, path.join(stagingDir, "README.md"));

  if (includeRuntimeBundleSpec) {
    await copyFile(
      resolveRuntimeBundleSpecSourcePath(),
      path.join(stagingDir, RUNTIME_BUNDLE_SPEC_FILENAME)
    );
  }
}

async function stagePublishedRuntimeFiles({
  includeRuntimeBundleSpec = false,
  readmePath,
  stagingDir,
  targetTriple,
}) {
  await stagePublishedMetadataFiles({
    includeRuntimeBundleSpec,
    readmePath,
    stagingDir,
  });
  await stagePackagedRuntime({
    runtimeRoot: path.join(stagingDir, "vendor", targetTriple),
  });
}

async function stageSources({
  packageJson,
  packageName,
  readmePath,
  stagingDir,
  version,
}) {
  if (packageName === "cli") {
    await cp(path.join(CLI_ROOT, "bin"), path.join(stagingDir, "bin"), {
      recursive: true,
    });
    await stagePublishedMetadataFiles({
      includeRuntimeBundleSpec: true,
      readmePath,
      stagingDir,
    });

    await writeJson(
      path.join(stagingDir, "package.json"),
      createCliPackageManifest(packageJson, version)
    );
    return;
  }

  const platformPackage = RELEASE_PLATFORM_PACKAGES[packageName];
  if (!platformPackage) {
    throw new Error(`Unknown package '${packageName}'.`);
  }

  await stagePublishedRuntimeFiles({
    readmePath,
    stagingDir,
    targetTriple: platformPackage.targetTriple,
  });

  await writeJson(
    path.join(stagingDir, "package.json"),
    createReleasePlatformPackageManifest(packageJson, platformPackage, version)
  );
}

async function stageInstallBundle({
  packageJson,
  readmePath,
  stagingDir,
  targetTriple,
  vendorSrc,
  version,
}) {
  await stagePublishedRuntimeFiles({
    includeRuntimeBundleSpec: true,
    readmePath,
    stagingDir,
    targetTriple,
  });
  await copyPlatformVendor({
    stagingDir,
    targetTriple,
    vendorSrc,
  });

  await writeJson(
    path.join(stagingDir, "package.json"),
    createInstallBundlePackageManifest(packageJson, version)
  );
}

function platformPackageVersion(version, platformTag) {
  return `${version}-${platformTag}`;
}

function createCliPackageManifest(packageJson, version) {
  const {
    private: _private,
    scripts: _scripts,
    devDependencies: _devDependencies,
    ...publishedPackageJson
  } = packageJson;

  return {
    ...publishedPackageJson,
    version,
    files: ["bin", RUNTIME_BUNDLE_SPEC_FILENAME, "README.md"],
    // CONTEXT: apps/cli is both the Rust workspace root and the npm package
    // source. Only published platform aliases belong in optionalDependencies;
    // GNU Linux extras stay as GitHub-release-only tarballs.
    // CONTEXT: optional dependency keys stay unscoped because they are npm
    // alias names. The published package backing each alias is @onequery/cli.
    optionalDependencies: Object.fromEntries(
      Object.values(PLATFORM_PACKAGES).map((platformPackage) => [
        platformPackage.optionalDependencyName,
        `npm:${CLI_PACKAGE_NAME}@${platformPackageVersion(version, platformPackage.npmTag)}`,
      ])
    ),
  };
}

function createReleasePlatformPackageManifest(
  packageJson,
  platformPackage,
  version
) {
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

  return stagedPlatformPackage;
}

function createInstallBundlePackageManifest(packageJson, version) {
  const {
    private: _private,
    scripts: _scripts,
    devDependencies: _devDependencies,
    bin: _bin,
    optionalDependencies: _optionalDependencies,
    ...publishedPackageJson
  } = packageJson;

  return {
    ...publishedPackageJson,
    version,
    files: ["README.md", RUNTIME_BUNDLE_SPEC_FILENAME, "vendor"],
  };
}

async function copyPlatformVendor({ vendorSrc, stagingDir, targetTriple }) {
  const resolvedVendorSrc = path.resolve(vendorSrc);
  const targetSource = path.join(resolvedVendorSrc, targetTriple);
  const targetDestination = path.join(stagingDir, "vendor", targetTriple);

  await mkdir(path.dirname(targetDestination), { recursive: true });
  await cp(targetSource, targetDestination, { recursive: true });
  await restorePackagedExecutableModes({
    targetRoot: targetDestination,
    targetTriple,
  });
}

async function restorePackagedExecutableModes({ targetRoot, targetTriple }) {
  if (targetTriple.includes("-windows-")) {
    return;
  }

  // COMMENT: GitHub artifact downloads normalize uploaded native binaries to
  // 0644, so reassert the executable bit before npm pack snapshots the vendor
  // payload into the release tarball.
  const executablePaths = [
    path.join(
      targetRoot,
      "onequery",
      binaryNameForTargetTriple(targetTriple, CLI_BINARY_NAME)
    ),
  ];

  await Promise.all(
    executablePaths.map((executablePath) => chmod(executablePath, 0o755))
  );
}

export async function stagePackagedRuntime({ runtimeRoot }) {
  await ensureWebAssetsBuilt();

  const migrationsOutDir = resolvePackagedRuntimeEntryDir(
    runtimeRoot,
    "migrations"
  );
  const webOutDir = resolvePackagedRuntimeEntryDir(runtimeRoot, "webDist");
  const builtWebDistDir = await resolveBuiltWebDistDir();
  const runtimeAssetCopyPlans = await Promise.all(
    getRuntimeAssetFamilyIds().map(async (family) => ({
      family,
      outDir: resolvePackagedRuntimeAssetDir(runtimeRoot, family),
      sourcePaths: await resolveRuntimeAssetSourcePaths(family),
    }))
  );

  await mkdir(runtimeRoot, { recursive: true });
  await Promise.all(
    [migrationsOutDir, webOutDir]
      .map((outDir) => path.dirname(outDir))
      .map((outDir) => mkdir(outDir, { recursive: true }))
  );
  await cp(DB_MIGRATIONS_DIR, migrationsOutDir, { recursive: true });
  await Promise.all(
    runtimeAssetCopyPlans.map(({ outDir }) =>
      mkdir(outDir, { recursive: true })
    )
  );
  await Promise.all(
    runtimeAssetCopyPlans.flatMap(({ outDir, sourcePaths }) =>
      sourcePaths.map(({ filename, sourcePath }) =>
        copyFile(sourcePath, path.join(outDir, filename))
      )
    )
  );
  await cp(builtWebDistDir, webOutDir, { recursive: true });
}

async function resolveRuntimeAssetSourcePaths(family) {
  const familyConfig = getRuntimeAssetFamilyConfig(family);
  let sourceResolver;
  try {
    sourceResolver = await resolveWorkspacePackageRequire(
      familyConfig.buildOwnerPackage
    );
  } catch (error) {
    throw new Error(
      `Failed to resolve runtime asset owner '${familyConfig.buildOwnerPackage}' for '${family}'.`,
      { cause: error }
    );
  }

  try {
    switch (familyConfig.buildSource.kind) {
      case "package-entrypoint-directory": {
        const packageEntrypoint = sourceResolver.resolve(
          familyConfig.buildSource.packageSpecifier
        );
        const distDir = path.dirname(packageEntrypoint);
        const sourcePaths = Object.values(familyConfig.files).map(
          (fileConfig) => ({
            filename: fileConfig.filename,
            sourcePath: path.join(distDir, fileConfig.filename),
          })
        );

        await Promise.all(
          sourcePaths.map(({ sourcePath }) => access(sourcePath))
        );
        return sourcePaths;
      }
      case "resolved-specifier-map": {
        const sourcePaths = Object.entries(familyConfig.files).map(
          ([fileRole, fileConfig]) => ({
            filename: fileConfig.filename,
            sourcePath: sourceResolver.resolve(
              familyConfig.buildSource.specifiersByFileRole[fileRole]
            ),
          })
        );

        await Promise.all(
          sourcePaths.map(({ sourcePath }) => access(sourcePath))
        );
        return sourcePaths;
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to resolve runtime asset sources for '${family}' from '${familyConfig.buildOwnerPackage}'.`,
      { cause: error }
    );
  }

  throw new Error(
    `Unsupported runtime asset build source '${familyConfig.buildSource.kind}' for '${family}'.`
  );
}

async function resolveWorkspacePackageRequire(packageSpecifier) {
  const cachedRequire = workspacePackageRequireCache.get(packageSpecifier);
  if (cachedRequire) {
    return cachedRequire;
  }

  // Comment: Runtime asset ownership is declared in runtime-bundle.json, so
  // source resolution must anchor to the owning workspace package manifest
  // rather than to whichever packages happen to be linked at the workspace root.
  const packageJsonPath =
    await resolveWorkspacePackageManifestPath(packageSpecifier);
  const packageRequire = createRequire(packageJsonPath);
  workspacePackageRequireCache.set(packageSpecifier, packageRequire);
  return packageRequire;
}

async function resolveWorkspacePackageManifestPath(packageSpecifier) {
  const workspacePackageManifestPathIndex =
    await loadWorkspacePackageManifestPathIndex();
  const packageJsonPath =
    workspacePackageManifestPathIndex.get(packageSpecifier);
  if (packageJsonPath) {
    return packageJsonPath;
  }

  throw new Error(
    `Workspace package '${packageSpecifier}' was not found in the manifests declared by '${WORKSPACE_MANIFEST_PATH}'.`
  );
}

async function loadWorkspacePackageManifestPathIndex() {
  if (!workspacePackageManifestPathIndexPromise) {
    workspacePackageManifestPathIndexPromise =
      createWorkspacePackageManifestPathIndex();
  }

  return workspacePackageManifestPathIndexPromise;
}

async function createWorkspacePackageManifestPathIndex() {
  const workspacePackagePatterns = await loadWorkspacePackagePatterns();
  const workspacePackageManifests = (
    await Promise.all(
      workspacePackagePatterns.map((workspacePackagePattern) =>
        loadWorkspacePackageManifestsForPattern(workspacePackagePattern)
      )
    )
  ).flat();

  return indexWorkspacePackageManifestPaths(workspacePackageManifests);
}

async function loadWorkspacePackagePatterns() {
  const workspaceManifest = JSON.parse(
    await readFile(WORKSPACE_MANIFEST_PATH, "utf8")
  );
  const workspacePackagePatterns = workspaceManifest.workspaces?.packages;
  if (
    Array.isArray(workspacePackagePatterns) &&
    workspacePackagePatterns.length > 0
  ) {
    return workspacePackagePatterns;
  }

  throw new Error(
    `Expected '${WORKSPACE_MANIFEST_PATH}' to declare workspace package patterns.`
  );
}

async function loadWorkspacePackageManifestsForPattern(
  workspacePackagePattern
) {
  if (
    typeof workspacePackagePattern !== "string" ||
    !workspacePackagePattern.endsWith("/*")
  ) {
    throw new Error(
      `Unsupported workspace package pattern '${workspacePackagePattern}' in '${WORKSPACE_MANIFEST_PATH}'.`
    );
  }

  const workspacePackageDir = path.join(
    WORKSPACE_ROOT,
    workspacePackagePattern.slice(0, -2)
  );
  const directoryEntries = await readdir(workspacePackageDir, {
    withFileTypes: true,
  });
  const workspacePackageManifests = await Promise.all(
    directoryEntries
      .filter((directoryEntry) => directoryEntry.isDirectory())
      .map(async (directoryEntry) => {
        const packageJsonPath = path.join(
          workspacePackageDir,
          directoryEntry.name,
          "package.json"
        );

        try {
          const packageJson = JSON.parse(
            await readFile(packageJsonPath, "utf8")
          );
          return {
            name: packageJson.name,
            packageJsonPath,
          };
        } catch (error) {
          if (error?.code === "ENOENT") {
            return null;
          }

          throw error;
        }
      })
  );

  return workspacePackageManifests.filter(
    (workspacePackageManifest) => workspacePackageManifest !== null
  );
}

function indexWorkspacePackageManifestPaths(workspacePackageManifests) {
  const workspacePackageManifestPathIndex = new Map();

  for (const workspacePackageManifest of workspacePackageManifests) {
    if (
      typeof workspacePackageManifest.name !== "string" ||
      workspacePackageManifest.name.trim().length === 0
    ) {
      throw new Error(
        `Expected workspace package manifest '${workspacePackageManifest.packageJsonPath}' to declare a package name.`
      );
    }

    const existingPackageJsonPath = workspacePackageManifestPathIndex.get(
      workspacePackageManifest.name
    );
    if (existingPackageJsonPath) {
      throw new Error(
        `Duplicate workspace package name '${workspacePackageManifest.name}' in '${existingPackageJsonPath}' and '${workspacePackageManifest.packageJsonPath}'.`
      );
    }

    workspacePackageManifestPathIndex.set(
      workspacePackageManifest.name,
      workspacePackageManifest.packageJsonPath
    );
  }

  return workspacePackageManifestPathIndex;
}

export const __internal = {
  INSTALL_BUNDLE_PACKAGES,
  indexWorkspacePackageManifestPaths,
  readCliPackageJson,
  restorePackagedExecutableModes,
  resolveRuntimeAssetSourcePaths,
  resolveWorkspacePackageManifestPath,
  resolveWorkspacePackageRequire,
  stageInstallBundle,
  stageSources,
  stagePackagedRuntime,
};

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

async function ensureWebAssetsBuilt() {
  if (!buildWebAssetsPromise) {
    buildWebAssetsPromise = buildWebAssets().catch((error) => {
      buildWebAssetsPromise = null;
      throw error;
    });
  }

  await buildWebAssetsPromise;
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
