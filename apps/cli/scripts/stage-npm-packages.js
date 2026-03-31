#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  packageStagingDirPrefix,
  PLATFORM_PACKAGES,
} from "../bin/package-constants.js";
import {
  buildPackage,
  PACKAGE_EXPANSIONS,
  tarballNameForPackage,
} from "./build-npm-package.js";

const STAGE_NPM_PACKAGE_OPTIONS = new Set([
  "--output-dir",
  "--package",
  "--release-version",
  "--vendor-src",
  "--help",
  "-h",
]);

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value === undefined || STAGE_NPM_PACKAGE_OPTIONS.has(value)) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

export function parseArgs(argv) {
  const args = {
    outputDir: path.resolve("dist/npm"),
    packages: [],
    releaseVersion: null,
    vendorSrc: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--output-dir": {
        args.outputDir = path.resolve(readOptionValue(argv, index, argument));
        index += 1;
        break;
      }
      case "--package": {
        args.packages.push(readOptionValue(argv, index, argument));
        index += 1;
        break;
      }
      case "--release-version": {
        args.releaseVersion = readOptionValue(argv, index, argument);
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

  if (!args.releaseVersion) {
    throw new Error("--release-version is required.");
  }

  if (args.packages.length === 0) {
    throw new Error("At least one --package is required.");
  }

  return args;
}

export function expandPackages(packages) {
  const hasExplicitPlatformPackage = packages.some(
    (packageName) => packageName in PLATFORM_PACKAGES
  );
  const expandedPackages = [];

  for (const packageName of packages) {
    const packageGroup =
      packageName === "cli" && hasExplicitPlatformPackage
        ? ["cli"]
        : (PACKAGE_EXPANSIONS[packageName] ?? [packageName]);
    for (const expandedPackage of packageGroup) {
      if (!expandedPackages.includes(expandedPackage)) {
        expandedPackages.push(expandedPackage);
      }
    }
  }

  return expandedPackages;
}

function printHelp() {
  console.log(`Usage: bun apps/cli/scripts/stage-npm-packages.js --package cli --release-version <version> [options]

Options:
  --output-dir <path>   Directory where tarballs will be written
  --vendor-src <path>   Vendor root containing target directories
`);
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const packages = expandPackages(args.packages);

  for (const packageName of packages) {
    const stagingDir = await mkdtemp(
      path.join(tmpdir(), packageStagingDirPrefix(packageName))
    );

    try {
      await buildPackage({
        packOutput: path.join(
          args.outputDir,
          tarballNameForPackage(packageName, args.releaseVersion)
        ),
        packageName,
        stagingDir,
        vendorSrc: args.vendorSrc,
        version: args.releaseVersion,
      });
    } finally {
      await rm(stagingDir, { force: true, recursive: true });
    }
  }
}
